/**
 * Core domain types for story-state-engine.
 *
 * The engine is event-sourced: the event log (`StoryEvent[]`) is the single
 * source of truth. Everything else — entity snapshots, foreshadowing state,
 * chapter structure — is *derived* by replaying events (see `state.ts`).
 *
 * This is what kills "吃书" (context-eating): state is never "what the model
 * remembers", it is always "what the log can prove".
 */

/* ------------------------------------------------------------------ *
 * JSON primitives
 * ------------------------------------------------------------------ */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonRecord = Record<string, Json>;

/* ------------------------------------------------------------------ *
 * Entities
 * ------------------------------------------------------------------ */

export type EntityId = string;
export type EventId = string;
export type ForeshadowId = string;

export type EntityKind = 'character' | 'location' | 'item';

export type CharacterRole = 'protagonist' | 'deuteragonist' | 'antagonist' | 'supporting' | 'minor';

/**
 * A typed relationship between a character and another entity (usually
 * another character). `type` is free-form ("师父", "青梅竹马", "宿敌") so
 * novels are not forced into a western-fiction ontology.
 */
export interface Relationship {
  entityId: EntityId;
  type: string;
  /** Optional affinity in [-100, 100]. Positive = friendly. */
  value?: number;
  note?: string;
}

export interface BaseEntity {
  id: EntityId;
  kind: EntityKind;
  name: string;
  aliases: string[];
  description: string;
  /** Dynamic properties: 情绪 / 受伤 / locationId / 装备 … anything the plot moves. */
  attributes: JsonRecord;
  tags: string[];
  /** Chapter number in which the entity first appeared. */
  introducedAtChapter: number;
}

export interface CharacterEntity extends BaseEntity {
  kind: 'character';
  role: CharacterRole;
  relationships: Relationship[];
}

export interface LocationEntity extends BaseEntity {
  kind: 'location';
  /** Ids of locations reachable from this one directly. */
  connections: EntityId[];
  /** Free-form atmosphere hint: "终年大雾，行人稀少". */
  atmosphere?: string;
}

export interface ItemEntity extends BaseEntity {
  kind: 'item';
  /** Character currently carrying/owning the item, if any. */
  ownerId?: EntityId;
  /** Location where the item currently rests, if not carried. */
  locationId?: EntityId;
}

export type Entity = CharacterEntity | LocationEntity | ItemEntity;

/* ------------------------------------------------------------------ *
 * Events — the timeline graph
 * ------------------------------------------------------------------ */

export type EventType =
  | 'story/chapter-started'
  | 'entity/created'
  | 'entity/updated'
  | 'entity/property-set'
  | 'entity/property-delete'
  | 'character/moved'
  | 'character/relationship-set'
  | 'character/relationship-remove'
  | 'item/transferred'
  | 'item/placed'
  | 'foreshadow/planted'
  | 'foreshadow/resolved'
  | 'foreshadow/abandoned'
  | 'plot/beat';

/**
 * Every change to the world is an event. Events are ordered by story-time
 * (`chapter` → `scene` → insertion counter `seq`), NOT by wall-clock, so a
 * writer can backfill the past without corrupting the present.
 */
export interface BaseEvent<T extends EventType = EventType> {
  id: EventId;
  type: T;
  /** 1-based story chapter this event belongs to. */
  chapter: number;
  /** Scene inside the chapter (optional; treated as 0 for ordering). */
  scene?: number;
  /** Monotonic insertion counter — deterministic tie-breaker. */
  seq: number;
  /** Optional in-world clock, free-form: "第三日黄昏". */
  storyTime?: string;
  /** One-line human-readable note; this is what the prompt builder prints. */
  summary?: string;
  /** Wall-clock ISO timestamp of when the author/app wrote this event. */
  createdAt: string;
}

export interface ChapterStartedEvent extends BaseEvent<'story/chapter-started'> {
  title?: string;
  synopsis?: string;
}

export interface EntityCreatedEvent extends BaseEvent<'entity/created'> {
  entity: Entity;
}

export interface EntityUpdatedEvent extends BaseEvent<'entity/updated'> {
  entityId: EntityId;
  patch: Partial<Pick<BaseEntity, 'name' | 'description' | 'aliases' | 'tags'>> &
    Partial<Pick<LocationEntity, 'connections'>>;
}

export interface PropertySetEvent extends BaseEvent<'entity/property-set'> {
  entityId: EntityId;
  property: string;
  value: Json;
  oldValue?: Json;
}

export interface PropertyDeleteEvent extends BaseEvent<'entity/property-delete'> {
  entityId: EntityId;
  property: string;
}

export interface CharacterMovedEvent extends BaseEvent<'character/moved'> {
  entityId: EntityId;
  from?: EntityId;
  to: EntityId;
}

export interface RelationshipSetEvent extends BaseEvent<'character/relationship-set'> {
  entityId: EntityId;
  targetId: EntityId;
  /** Free-form relation label: "师父", "宿敌", "未婚妻" … */
  relationType: string;
  value?: number;
  note?: string;
}

export interface RelationshipRemoveEvent extends BaseEvent<'character/relationship-remove'> {
  entityId: EntityId;
  targetId: EntityId;
}

export interface ItemTransferredEvent extends BaseEvent<'item/transferred'> {
  itemId: EntityId;
  from?: EntityId;
  to: EntityId;
}

export interface ItemPlacedEvent extends BaseEvent<'item/placed'> {
  itemId: EntityId;
  locationId: EntityId;
}

export interface ForeshadowPlantedEvent extends BaseEvent<'foreshadow/planted'> {
  foreshadow: Foreshadow;
}

export interface ForeshadowResolvedEvent extends BaseEvent<'foreshadow/resolved'> {
  foreshadowId: ForeshadowId;
  resolution?: string;
}

export interface ForeshadowAbandonedEvent extends BaseEvent<'foreshadow/abandoned'> {
  foreshadowId: ForeshadowId;
  reason?: string;
}

export interface PlotBeatEvent extends BaseEvent<'plot/beat'> {
  /** Free-form note about what happened here (used verbatim in prompts). */
  text: string;
}

export type StoryEvent =
  | ChapterStartedEvent
  | EntityCreatedEvent
  | EntityUpdatedEvent
  | PropertySetEvent
  | PropertyDeleteEvent
  | CharacterMovedEvent
  | RelationshipSetEvent
  | RelationshipRemoveEvent
  | ItemTransferredEvent
  | ItemPlacedEvent
  | ForeshadowPlantedEvent
  | ForeshadowResolvedEvent
  | ForeshadowAbandonedEvent
  | PlotBeatEvent;

/** Event types that may be attached to the entity they mutate. */
export function eventEntityIds(event: StoryEvent): EntityId[] {
  switch (event.type) {
    case 'entity/created':
      return [event.entity.id];
    case 'entity/updated':
    case 'entity/property-set':
    case 'entity/property-delete':
    case 'character/moved':
    case 'item/transferred':
    case 'item/placed':
      return [event.entityId];
    case 'character/relationship-set':
    case 'character/relationship-remove':
      return [event.entityId, event.targetId];
    case 'foreshadow/planted':
      return event.foreshadow.entityId ? [event.foreshadow.entityId] : [];
    case 'foreshadow/resolved':
    case 'foreshadow/abandoned':
    case 'story/chapter-started':
    case 'plot/beat':
      return [];
  }
}

/* ------------------------------------------------------------------ *
 * Foreshadowing (前文伏笔)
 * ------------------------------------------------------------------ */

export type ForeshadowStatus = 'pending' | 'resolved' | 'abandoned';
export type Importance = 'low' | 'medium' | 'high';

export interface Foreshadow {
  id: ForeshadowId;
  /** What was planted, e.g. "张三背上的剑印在月夜里发烫". */
  description: string;
  /** Optional entity this thread is bound to. */
  entityId?: EntityId;
  /** Chapter in which it was planted. */
  chapter: number;
  importance: Importance;
  status: ForeshadowStatus;
  resolvedAtChapter?: number;
  /** How it was paid off, once resolved. */
  resolution?: string;
}

/* ------------------------------------------------------------------ *
 * Derived engine state (projection of the event log)
 * ------------------------------------------------------------------ */

export interface ChapterInfo {
  chapter: number;
  title?: string;
  synopsis?: string;
  startedAtSeq: number;
}

export interface EngineState {
  entities: Record<EntityId, Entity>;
  foreshadows: Record<ForeshadowId, Foreshadow>;
  chapters: ChapterInfo[];
  highestChapter: number;
}

/* ------------------------------------------------------------------ *
 * Project serialization
 * ------------------------------------------------------------------ */

export interface ProjectMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
  author?: string;
  /** One-line premise; injected at the top of every generated prompt. */
  premise?: string;
}

export interface ProjectData {
  schemaVersion: number;
  meta: ProjectMeta;
  /** The canonical event log. Everything else is derived from it. */
  events: StoryEvent[];
}

export const SCHEMA_VERSION = 1;
