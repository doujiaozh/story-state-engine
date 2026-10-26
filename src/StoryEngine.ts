import { ContextExtractor, type ExtractionSource } from './extractor/ContextExtractor.js';
import type { ExtractContextOptions, ExtractedContext } from './extractor/types.js';
import {
  EntityExistsError,
  EntityNotFoundError,
  ForeshadowNotFoundError,
  KindMismatchError,
  SchemaVersionError,
  StoreError,
  ValidationError
} from './errors.js';
import {
  buildCharacter,
  buildItem,
  buildLocation,
  EntityRegistry,
  type CreateCharacterInput,
  type CreateItemInput,
  type CreateLocationInput
} from './entities.js';
import { createId } from './ids.js';
import { cloneState, projectState } from './state.js';
import { Timeline, type NewEventInput } from './timeline.js';
import type {
  ChapterInfo,
  CharacterEntity,
  EngineState,
  Entity,
  EntityId,
  Foreshadow,
  Importance,
  ItemEntity,
  Json,
  LocationEntity,
  ProjectData,
  ProjectMeta,
  StoryEvent
} from './types.js';
import { SCHEMA_VERSION } from './types.js';
import { supportsSlots, type SlotStore, type Store } from './persistence/types.js';

export interface StoryEngineOptions {
  /** Project metadata for a freshly created project. */
  meta?: Partial<ProjectMeta>;
  /** Bootstrap from an existing event log. */
  events?: StoryEvent[];
  /** Bootstrap from a full serialized project. */
  initialData?: ProjectData;
}

export interface SaveSlotOptions {
  /** Use this slot-capable store instead of the engine's own store. */
  store?: SlotStore;
}

/**
 * The engine facade — the one entry point an application uses.
 *
 * Everything here ultimately funnels into `Timeline.append`: no mutation
 * exists outside the event log, so the log stays the single source of truth
 * and every state the app can observe remains reproducible by replay.
 */
export class StoryEngine implements ExtractionSource {
  private readonly timeline = new Timeline();
  private metaValue: ProjectMeta;
  private store: Store | null = null;
  private stateCache: EngineState | null = null;

  constructor(options: StoryEngineOptions = {}) {
    if (options.initialData) {
      this.ingest(options.initialData);
      this.metaValue = options.initialData.meta;
    } else {
      const now = new Date().toISOString();
      this.metaValue = {
        name: '未命名项目',
        createdAt: now,
        updatedAt: now,
        ...options.meta
      };
      if (options.events) this.timeline.reset(options.events);
    }
  }

  /* ------------------------------------------------------------------ *
   * Construction / persistence
   * ------------------------------------------------------------------ */

  /** Open a project from a store; creates an empty one when the store is empty. */
  static async open(
    store: Store,
    fallback: Partial<ProjectMeta> = {}
  ): Promise<StoryEngine> {
    const data = await store.load();
    const engine = data
      ? new StoryEngine({ initialData: data })
      : new StoryEngine({ meta: fallback });
    engine.store = store;
    return engine;
  }

  /** Attach (or replace) the store used by `save()` / `saveSlot()`. */
  attachStore(store: Store | null): void {
    this.store = store;
  }

  /** The store this engine saves to, if any. */
  getStore(): Store | null {
    return this.store;
  }

  toProjectData(): ProjectData {
    return {
      schemaVersion: SCHEMA_VERSION,
      meta: cloneMeta(this.metaValue),
      events: this.timeline.toJSON()
    };
  }

  /** Persist the whole project atomically. */
  async save(): Promise<void> {
    if (!this.store) throw new StoreError('未配置存储后端，无法保存');
    this.metaValue.updatedAt = new Date().toISOString();
    await this.store.save(this.toProjectData());
  }

  /** Save a named snapshot (per device, per plot branch — the 多端保存 story). */
  async saveSlot(name: string, options: SaveSlotOptions = {}): Promise<void> {
    const store = options.store ?? this.slotStore();
    this.metaValue.updatedAt = new Date().toISOString();
    await store.saveSlot(name, this.toProjectData());
  }

  /**
   * Replace the in-memory project with a named snapshot. Destructive: the
   * current working log is discarded, so callers normally `save()` first.
   */
  async loadSlot(name: string, options: SaveSlotOptions = {}): Promise<void> {
    const store = options.store ?? this.slotStore();
    const data = await store.loadSlot(name);
    if (!data) throw new StoreError(`存档不存在: ${name}`);
    this.ingest(data);
    this.metaValue = data.meta;
    this.invalidate();
  }

  private slotStore(): SlotStore {
    const store = this.store;
    if (!store) throw new StoreError('未配置存储后端，无法操作存档槽位');
    if (!supportsSlots(store)) throw new StoreError('当前存储后端不支持命名槽位');
    return store;
  }

  private ingest(data: ProjectData): void {
    if (data.schemaVersion !== SCHEMA_VERSION) {
      throw new SchemaVersionError(data.schemaVersion, SCHEMA_VERSION);
    }
    this.timeline.reset(data.events);
    this.invalidate();
  }

  /* ------------------------------------------------------------------ *
   * Meta & read views
   * ------------------------------------------------------------------ */

  getMeta(): ProjectMeta {
    return cloneMeta(this.metaValue);
  }

  updateMeta(patch: Partial<ProjectMeta>): void {
    this.metaValue = { ...this.metaValue, ...patch };
  }

  /** Whole-world state, projected from the full event log (memoized). */
  getState(): EngineState {
    if (!this.stateCache) this.stateCache = projectState(this.timeline.getAll());
    return cloneState(this.stateCache);
  }

  /** World state *as of the end of chapter n* — the anchor for context extraction. */
  getStateAtChapter(chapter: number): EngineState {
    return projectState(this.timeline.getEventsUpToChapter(chapter, true));
  }

  /** Read-only registry over the current state (returns copies). */
  get entities(): EntityRegistry {
    return new EntityRegistry(this.getState().entities);
  }

  /** All events in story order. */
  getEvents(): readonly StoryEvent[] {
    return this.timeline.getAll();
  }

  /** Highest chapter number seen (0 when nothing has started). */
  get currentChapter(): number {
    return this.getState().highestChapter;
  }

  getChapters(): ChapterInfo[] {
    return [...this.getState().chapters];
  }

  getChapterInfo(chapter: number): ChapterInfo | undefined {
    return this.getState().chapters.find((c) => c.chapter === chapter);
  }

  /** Default chapter for new content: explicitly started, else "chapter 1". */
  private get defaultChapter(): number {
    return Math.max(1, this.getState().highestChapter);
  }

  /** Recent events the extractor shows as timeline context. */
  recentEvents(upToChapter: number, limit: number): StoryEvent[] {
    return this.timeline.getEventsUpToChapter(upToChapter, true).slice(-limit);
  }

  /* ------------------------------------------------------------------ *
   * Low-level event recording
   * ------------------------------------------------------------------ */

  /** Append any event; the log, and only the log, changes. */
  record(input: NewEventInput): StoryEvent {
    const event = this.timeline.append(input);
    this.invalidate();
    return event;
  }

  /* ------------------------------------------------------------------ *
   * Chapter control
   * ------------------------------------------------------------------ */

  startChapter(
    chapter?: number,
    options: { title?: string; synopsis?: string; storyTime?: string } = {}
  ): StoryEvent {
    const n = chapter ?? this.getState().highestChapter + 1;
    if (n < 1) throw new ValidationError(`章节号必须为正整数，收到 ${n}`);
    if (chapter === undefined && this.getChapterInfo(n)) {
      throw new ValidationError(`第 ${n} 章已经开始过了`);
    }
    return this.record({
      type: 'story/chapter-started',
      chapter: n,
      title: options.title,
      synopsis: options.synopsis,
      storyTime: options.storyTime,
      summary: options.title ? `第 ${n} 章《${options.title}》开始` : `第 ${n} 章开始`
    });
  }

  /** Free-form plot beat ("李四在城门口等到天黑") — what the timeline remembers. */
  beat(
    text: string,
    options: { chapter?: number; scene?: number; storyTime?: string } = {}
  ): StoryEvent {
    if (!text.trim()) throw new ValidationError('剧情节拍内容不能为空');
    return this.record({
      type: 'plot/beat',
      chapter: options.chapter ?? this.defaultChapter,
      scene: options.scene,
      storyTime: options.storyTime,
      text,
      summary: text
    });
  }

  /* ------------------------------------------------------------------ *
   * Entities
   * ------------------------------------------------------------------ */

  createCharacter(input: CreateCharacterInput): StoryEvent {
    this.assertNotExists(input.id);
    const entity = buildCharacter(input, this.defaultChapter);
    return this.record({
      type: 'entity/created',
      chapter: entity.introducedAtChapter,
      entity,
      summary: `${entity.name}登场（角色）`
    });
  }

  createLocation(input: CreateLocationInput): StoryEvent {
    this.assertNotExists(input.id);
    for (const c of input.connections ?? []) this.requireLocation(c, 'connections');
    const entity = buildLocation(input, this.defaultChapter);
    return this.record({
      type: 'entity/created',
      chapter: entity.introducedAtChapter,
      entity,
      summary: `${entity.name}登场（地点）`
    });
  }

  createItem(input: CreateItemInput): StoryEvent {
    this.assertNotExists(input.id);
    if (input.ownerId) this.requireCharacter(input.ownerId, 'ownerId');
    if (input.locationId) this.requireLocation(input.locationId, 'locationId');
    const entity = buildItem(input, this.defaultChapter);
    return this.record({
      type: 'entity/created',
      chapter: entity.introducedAtChapter,
      entity,
      summary: `${entity.name}登场（物品）`
    });
  }

  updateEntity(
    entityId: EntityId,
    patch: Partial<Pick<Entity, 'name' | 'description' | 'aliases' | 'tags'>> &
      Partial<Pick<LocationEntity, 'connections'>>,
    options: { chapter?: number; summary?: string } = {}
  ): StoryEvent {
    const entity = this.require(entityId);
    if (patch.connections !== undefined) {
      if (entity.kind !== 'location') {
        throw new ValidationError('connections 字段仅适用于地点实体');
      }
      for (const id of patch.connections) this.requireLocation(id, 'connections');
    }
    return this.record({
      type: 'entity/updated',
      chapter: options.chapter ?? this.defaultChapter,
      entityId,
      patch,
      summary: options.summary ?? `更新了「${this.nameOf(entityId)}」的资料`
    });
  }

  setProperty(
    entityId: EntityId,
    property: string,
    value: Json,
    options: { chapter?: number; summary?: string } = {}
  ): StoryEvent {
    const entity = this.require(entityId);
    const oldValue = entity.attributes[property];
    return this.record({
      type: 'entity/property-set',
      chapter: options.chapter ?? this.defaultChapter,
      entityId,
      property,
      value,
      oldValue,
      summary: options.summary ?? `「${entity.name}」的 ${property} 变为 ${formatJson(value)}`
    });
  }

  deleteProperty(
    entityId: EntityId,
    property: string,
    options: { chapter?: number; summary?: string } = {}
  ): StoryEvent {
    const entity = this.require(entityId);
    return this.record({
      type: 'entity/property-delete',
      chapter: options.chapter ?? this.defaultChapter,
      entityId,
      property,
      summary: options.summary ?? `「${entity.name}」的 ${property} 被移除`
    });
  }

  moveCharacter(
    characterId: EntityId,
    toLocationId: EntityId,
    options: { chapter?: number; scene?: number; storyTime?: string; summary?: string } = {}
  ): StoryEvent {
    const character = this.requireCharacter(characterId, 'entityId');
    const to = this.requireLocation(toLocationId, 'to');
    const from = character.attributes.locationId as EntityId | undefined;
    return this.record({
      type: 'character/moved',
      chapter: options.chapter ?? this.defaultChapter,
      scene: options.scene,
      storyTime: options.storyTime,
      entityId: characterId,
      from,
      to: toLocationId,
      summary: options.summary ?? `${character.name}从${this.locName(from)}前往「${to.name}」`
    });
  }

  setRelationship(
    characterId: EntityId,
    targetId: EntityId,
    relationType: string,
    options: { value?: number; note?: string; chapter?: number; summary?: string } = {}
  ): StoryEvent {
    this.requireCharacter(characterId, 'entityId');
    this.require(targetId);
    return this.record({
      type: 'character/relationship-set',
      chapter: options.chapter ?? this.defaultChapter,
      entityId: characterId,
      targetId,
      relationType,
      value: options.value,
      note: options.note,
      summary: options.summary ?? `${this.nameOf(characterId)}与${this.nameOf(targetId)}确立「${relationType}」关系`
    });
  }

  removeRelationship(
    characterId: EntityId,
    targetId: EntityId,
    options: { chapter?: number; summary?: string } = {}
  ): StoryEvent {
    this.requireCharacter(characterId, 'entityId');
    this.require(targetId);
    return this.record({
      type: 'character/relationship-remove',
      chapter: options.chapter ?? this.defaultChapter,
      entityId: characterId,
      targetId,
      summary: options.summary ?? `${this.nameOf(characterId)}与${this.nameOf(targetId)}的关系解除`
    });
  }

  transferItem(
    itemId: EntityId,
    toCharacterId: EntityId,
    options: { chapter?: number; summary?: string } = {}
  ): StoryEvent {
    const item = this.requireItem(itemId, 'itemId');
    const to = this.requireCharacter(toCharacterId, 'to');
    const from = item.ownerId;
    return this.record({
      type: 'item/transferred',
      chapter: options.chapter ?? this.defaultChapter,
      itemId,
      from,
      to: toCharacterId,
      summary: options.summary ?? `「${item.name}」被${from ? `从${this.nameOf(from)}手中` : ''}交给「${to.name}」`
    });
  }

  placeItem(
    itemId: EntityId,
    locationId: EntityId,
    options: { chapter?: number; summary?: string } = {}
  ): StoryEvent {
    const item = this.requireItem(itemId, 'itemId');
    const to = this.requireLocation(locationId, 'locationId');
    return this.record({
      type: 'item/placed',
      chapter: options.chapter ?? this.defaultChapter,
      itemId,
      locationId,
      summary: options.summary ?? `「${item.name}」被放置于「${to.name}」`
    });
  }

  /* ------------------------------------------------------------------ *
   * Foreshadowing (伏笔)
   * ------------------------------------------------------------------ */

  plantForeshadow(
    description: string,
    options: {
      entityId?: EntityId;
      importance?: Importance;
      chapter?: number;
      summary?: string;
    } = {}
  ): StoryEvent {
    if (!description.trim()) throw new ValidationError('伏笔描述不能为空');
    if (options.entityId) this.require(options.entityId);
    const foreshadow: Foreshadow = {
      id: createId('fs'),
      description: description.trim(),
      entityId: options.entityId,
      chapter: options.chapter ?? this.defaultChapter,
      importance: options.importance ?? 'medium',
      status: 'pending'
    };
    return this.record({
      type: 'foreshadow/planted',
      chapter: foreshadow.chapter,
      foreshadow,
      summary: options.summary ?? `埋下伏笔：${foreshadow.description}`
    });
  }

  resolveForeshadow(
    foreshadowId: string,
    options: { resolution?: string; chapter?: number } = {}
  ): StoryEvent {
    const f = this.requireForeshadow(foreshadowId);
    if (f.status !== 'pending') {
      throw new ValidationError(`伏笔「${f.description}」已处于 ${f.status} 状态，无法再次回收`);
    }
    return this.record({
      type: 'foreshadow/resolved',
      chapter: options.chapter ?? this.defaultChapter,
      foreshadowId,
      resolution: options.resolution,
      summary: `伏笔「${f.description}」被回收${options.resolution ? `：${options.resolution}` : ''}`
    });
  }

  abandonForeshadow(
    foreshadowId: string,
    options: { reason?: string; chapter?: number } = {}
  ): StoryEvent {
    const f = this.requireForeshadow(foreshadowId);
    if (f.status !== 'pending') {
      throw new ValidationError(`伏笔「${f.description}」已处于 ${f.status} 状态`);
    }
    return this.record({
      type: 'foreshadow/abandoned',
      chapter: options.chapter ?? this.defaultChapter,
      foreshadowId,
      reason: options.reason,
      summary: `伏笔「${f.description}」被放弃${options.reason ? `：${options.reason}` : ''}`
    });
  }

  /** All pending threads, optionally only those planted by chapter n. */
  pendingForeshadows(asOfChapter?: number): Foreshadow[] {
    const state = this.getState();
    return Object.values(state.foreshadows).filter(
      (f) => f.status === 'pending' && (asOfChapter === undefined || f.chapter <= asOfChapter)
    );
  }

  /* ------------------------------------------------------------------ *
   * Dynamic context extraction
   * ------------------------------------------------------------------ */

  extractContext(outline: string, options: ExtractContextOptions = {}): ExtractedContext {
    return new ContextExtractor(this).extract(outline, options);
  }

  /* ------------------------------------------------------------------ *
   * Internals
   * ------------------------------------------------------------------ */

  private invalidate(): void {
    this.stateCache = null;
  }

  private require(id: EntityId, field = 'entityId'): Entity {
    const entity = this.getState().entities[id];
    if (!entity) {
      const err = new EntityNotFoundError(id);
      if (field !== 'entityId') err.cause = `字段「${field}」引用的实体不存在`;
      throw err;
    }
    return entity;
  }

  private requireCharacter(id: EntityId, field: string): CharacterEntity {
    const e = this.require(id, field);
    if (e.kind !== 'character') throw new KindMismatchError(id, 'character', e.kind);
    return e;
  }

  private requireLocation(id: EntityId, field: string): LocationEntity {
    const e = this.require(id, field);
    if (e.kind !== 'location') throw new KindMismatchError(id, 'location', e.kind);
    return e;
  }

  private requireItem(id: EntityId, field: string): ItemEntity {
    const e = this.require(id, field);
    if (e.kind !== 'item') throw new KindMismatchError(id, 'item', e.kind);
    return e;
  }

  private requireForeshadow(id: string): Foreshadow {
    const f = this.getState().foreshadows[id];
    if (!f) throw new ForeshadowNotFoundError(id);
    return f;
  }

  private assertNotExists(id: EntityId | undefined): void {
    if (id && this.getState().entities[id]) throw new EntityExistsError(id);
  }

  private nameOf(id: EntityId): string {
    return this.getState().entities[id]?.name ?? id;
  }

  private locName(id: EntityId | undefined): string {
    return id ? `「${this.nameOf(id)}」` : '原住所';
  }
}

function cloneMeta(meta: ProjectMeta): ProjectMeta {
  return { ...meta };
}

function formatJson(value: Json): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
