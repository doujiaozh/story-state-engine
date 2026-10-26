import type {
  ChapterInfo,
  EngineState,
  Entity,
  EntityId,
  Foreshadow,
  ForeshadowId,
  StoryEvent
} from './types.js';

/**
 * The projection: reduce an ordered event log into a point-in-time world
 * state. Pure and deterministic — replaying the same log always yields the
 * same world, and replaying only the first N chapters yields the world *as
 * of the end of chapter N*. That is what makes "state when writing chapter
 * K" a well-defined, testable concept instead of an LLM guess.
 */
export function projectState(events: Iterable<StoryEvent>): EngineState {
  const state: EngineState = {
    entities: {},
    foreshadows: {},
    chapters: [],
    highestChapter: 0
  };
  for (const event of events) {
    applyEvent(state, event);
  }
  return state;
}

export function cloneState(state: EngineState): EngineState {
  return structuredClone(state);
}

export function applyEvent(state: EngineState, event: StoryEvent): void {
  switch (event.type) {
    case 'story/chapter-started': {
      const info: ChapterInfo = {
        chapter: event.chapter,
        title: event.title,
        synopsis: event.synopsis,
        startedAtSeq: event.seq
      };
      // replace if the same chapter was started before (re-write scenario)
      const idx = state.chapters.findIndex((c) => c.chapter === event.chapter);
      if (idx >= 0) state.chapters[idx] = info;
      else state.chapters.splice(info.chapter - 1, 0, info);
      // keep the chapter list ordered even when chapters start out of order
      state.chapters.sort((a, b) => a.chapter - b.chapter);
      if (event.chapter > state.highestChapter) state.highestChapter = event.chapter;
      break;
    }

    case 'entity/created': {
      state.entities[event.entity.id] = structuredClone(event.entity);
      break;
    }

    case 'entity/updated': {
      const entity = state.entities[event.entityId];
      if (!entity) break;
      const { name, description, aliases, tags, connections } = event.patch;
      if (name !== undefined) entity.name = name;
      if (description !== undefined) entity.description = description;
      if (aliases !== undefined) entity.aliases = [...aliases];
      if (tags !== undefined) entity.tags = [...tags];
      if (connections !== undefined && entity.kind === 'location') {
        entity.connections = [...connections];
      }
      break;
    }

    case 'entity/property-set': {
      const entity = state.entities[event.entityId];
      if (!entity) break;
      entity.attributes[event.property] = event.value;
      break;
    }

    case 'entity/property-delete': {
      const entity = state.entities[event.entityId];
      if (!entity) break;
      delete entity.attributes[event.property];
      break;
    }

    case 'character/moved': {
      const entity = state.entities[event.entityId];
      if (!entity) break;
      entity.attributes.locationId = event.to;
      break;
    }

    case 'character/relationship-set': {
      const entity = state.entities[event.entityId];
      if (!entity || entity.kind !== 'character') break;
      const rel = entity.relationships.find((r) => r.entityId === event.targetId);
      if (rel) {
        rel.type = event.relationType;
        if (event.value !== undefined) rel.value = event.value;
        if (event.note !== undefined) rel.note = event.note;
      } else {
        entity.relationships.push({
          entityId: event.targetId,
          type: event.relationType,
          value: event.value,
          note: event.note
        });
      }
      break;
    }

    case 'character/relationship-remove': {
      const entity = state.entities[event.entityId];
      if (!entity || entity.kind !== 'character') break;
      entity.relationships = entity.relationships.filter((r) => r.entityId !== event.targetId);
      break;
    }

    case 'item/transferred': {
      const entity = state.entities[event.itemId];
      if (!entity || entity.kind !== 'item') break;
      entity.ownerId = event.to;
      // carried items are no longer resting at a location
      entity.locationId = undefined;
      break;
    }

    case 'item/placed': {
      const entity = state.entities[event.itemId];
      if (!entity || entity.kind !== 'item') break;
      entity.locationId = event.locationId;
      entity.ownerId = undefined;
      break;
    }

    case 'foreshadow/planted': {
      state.foreshadows[event.foreshadow.id] = structuredClone(event.foreshadow);
      break;
    }

    case 'foreshadow/resolved': {
      const f = state.foreshadows[event.foreshadowId];
      if (!f) break;
      f.status = 'resolved';
      f.resolution = event.resolution;
      f.resolvedAtChapter = event.chapter;
      break;
    }

    case 'foreshadow/abandoned': {
      const f = state.foreshadows[event.foreshadowId];
      if (!f) break;
      f.status = 'abandoned';
      f.resolution = event.reason;
      break;
    }

    case 'plot/beat':
      // free-form author note; nothing to project
      break;

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
      break;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Read-only views over a projected state
 * ------------------------------------------------------------------ */

export function getEntitiesByKind(state: EngineState, kind: Entity['kind']): Entity[] {
  return Object.values(state.entities).filter((e) => e.kind === kind);
}

export function pendingForeshadows(state: EngineState, asOfChapter?: number): Foreshadow[] {
  return Object.values(state.foreshadows).filter(
    (f) =>
      f.status === 'pending' &&
      (asOfChapter === undefined || f.chapter <= asOfChapter)
  );
}

export function foreshadowsForEntity(state: EngineState, entityId: EntityId): Foreshadow[] {
  return Object.values(state.foreshadows).filter(
    (f) => f.entityId === entityId && f.status === 'pending'
  );
}

/**
 * Pending threads that have gone stale: planted more than `threshold`
 * chapters before `asOfChapter`. High-importance stale threads are exactly
 * the "伏笔烂尾" failure mode this engine exists to prevent.
 */
export function staleForeshadows(
  state: EngineState,
  asOfChapter: number,
  threshold = 5
): Foreshadow[] {
  return pendingForeshadows(state, asOfChapter).filter(
    (f) => asOfChapter - f.chapter >= threshold
  );
}

export function getChapterInfo(state: EngineState, chapter: number): ChapterInfo | undefined {
  return state.chapters.find((c) => c.chapter === chapter);
}

export function resolveForeshadowId(state: EngineState, id: ForeshadowId): Foreshadow | undefined {
  return state.foreshadows[id];
}
