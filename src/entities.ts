import { createId } from './ids.js';
import type {
  CharacterEntity,
  CharacterRole,
  Entity,
  EntityId,
  ItemEntity,
  JsonRecord,
  LocationEntity
} from './types.js';
import { EntityExistsError, EntityNotFoundError, KindMismatchError } from './errors.js';

/* ------------------------------------------------------------------ *
 * Creation inputs
 * ------------------------------------------------------------------ */

export interface BaseEntityInput {
  /** Stable id; auto-generated when omitted (e.g. `ch_a1b2c3`). */
  id?: EntityId;
  name: string;
  aliases?: string[];
  description?: string;
  attributes?: JsonRecord;
  tags?: string[];
  /** Chapter the entity is introduced in; defaults to the current chapter. */
  chapter?: number;
}

export interface CreateCharacterInput extends BaseEntityInput {
  role?: CharacterRole;
}

export interface CreateLocationInput extends BaseEntityInput {
  /** Ids of directly-reachable locations. */
  connections?: EntityId[];
  atmosphere?: string;
}

export interface CreateItemInput extends BaseEntityInput {
  /** Character carrying the item. */
  ownerId?: EntityId;
  /** Location where the item rests. */
  locationId?: EntityId;
}

/* ------------------------------------------------------------------ *
 * Entity factories
 * ------------------------------------------------------------------ */

export function buildCharacter(
  input: CreateCharacterInput,
  defaultChapter: number
): CharacterEntity {
  return {
    id: input.id ?? createId('ch'),
    kind: 'character',
    name: input.name,
    aliases: input.aliases ? [...input.aliases] : [],
    description: input.description ?? '',
    attributes: input.attributes ? { ...input.attributes } : {},
    tags: input.tags ? [...input.tags] : [],
    introducedAtChapter: input.chapter ?? defaultChapter,
    role: input.role ?? 'supporting',
    relationships: []
  };
}

export function buildLocation(
  input: CreateLocationInput,
  defaultChapter: number
): LocationEntity {
  return {
    id: input.id ?? createId('loc'),
    kind: 'location',
    name: input.name,
    aliases: input.aliases ? [...input.aliases] : [],
    description: input.description ?? '',
    attributes: input.attributes ? { ...input.attributes } : {},
    tags: input.tags ? [...input.tags] : [],
    introducedAtChapter: input.chapter ?? defaultChapter,
    connections: input.connections ? [...input.connections] : [],
    atmosphere: input.atmosphere
  };
}

export function buildItem(input: CreateItemInput, defaultChapter: number): ItemEntity {
  const entity: ItemEntity = {
    id: input.id ?? createId('item'),
    kind: 'item',
    name: input.name,
    aliases: input.aliases ? [...input.aliases] : [],
    description: input.description ?? '',
    attributes: input.attributes ? { ...input.attributes } : {},
    tags: input.tags ? [...input.tags] : [],
    introducedAtChapter: input.chapter ?? defaultChapter
  };
  if (input.ownerId !== undefined) entity.ownerId = input.ownerId;
  if (input.locationId !== undefined) entity.locationId = input.locationId;
  return entity;
}

/* ------------------------------------------------------------------ *
 * Read view over a projected state
 * ------------------------------------------------------------------ */

/**
 * A read-only registry wrapping an entity map. Getters return *copies*, so
 * callers cannot accidentally mutate the engine's projected state.
 */
export class EntityRegistry {
  private readonly entities: Record<EntityId, Entity>;

  constructor(entities: Record<EntityId, Entity>) {
    this.entities = entities;
  }

  has(id: EntityId): boolean {
    return id in this.entities;
  }

  get(id: EntityId): Entity | undefined {
    const e = this.entities[id];
    return e ? structuredClone(e) : undefined;
  }

  getCharacter(id: EntityId): CharacterEntity | undefined {
    const e = this.entities[id];
    return e && e.kind === 'character' ? structuredClone(e) : undefined;
  }

  getLocation(id: EntityId): LocationEntity | undefined {
    const e = this.entities[id];
    return e && e.kind === 'location' ? structuredClone(e) : undefined;
  }

  getItem(id: EntityId): ItemEntity | undefined {
    const e = this.entities[id];
    return e && e.kind === 'item' ? structuredClone(e) : undefined;
  }

  require(id: EntityId): Entity {
    const e = this.get(id);
    if (!e) throw new EntityNotFoundError(id);
    return e;
  }

  requireCharacter(id: EntityId): CharacterEntity {
    const e = this.entities[id];
    if (!e) throw new EntityNotFoundError(id);
    if (e.kind !== 'character') throw new KindMismatchError(id, 'character', e.kind);
    return structuredClone(e);
  }

  requireLocation(id: EntityId): LocationEntity {
    const e = this.entities[id];
    if (!e) throw new EntityNotFoundError(id);
    if (e.kind !== 'location') throw new KindMismatchError(id, 'location', e.kind);
    return structuredClone(e);
  }

  requireItem(id: EntityId): ItemEntity {
    const e = this.entities[id];
    if (!e) throw new EntityNotFoundError(id);
    if (e.kind !== 'item') throw new KindMismatchError(id, 'item', e.kind);
    return structuredClone(e);
  }

  /** Entities whose *name or alias* matches exactly. */
  byName(name: string): Entity[] {
    const target = name.trim();
    return Object.values(this.entities)
      .filter((e) => e.name === target || e.aliases.includes(target))
      .map((e) => structuredClone(e));
  }

  listCharacters(): CharacterEntity[] {
    return this.listByKind('character') as CharacterEntity[];
  }

  listLocations(): LocationEntity[] {
    return this.listByKind('location') as LocationEntity[];
  }

  listItems(): ItemEntity[] {
    return this.listByKind('item') as ItemEntity[];
  }

  listByKind(kind: Entity['kind']): Entity[] {
    return Object.values(this.entities)
      .filter((e) => e.kind === kind)
      .map((e) => structuredClone(e));
  }
}
