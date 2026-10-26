import type { EngineState, Entity, Foreshadow } from '../types.js';
import { countOccurrences, cjkBigrams } from './outline.js';
import type { ScoredEntity } from './types.js';

export interface RetrievalOptions {
  entityIds?: string[];
  maxEntities?: number;
}

const NAME_WEIGHT = 3;
const ALIAS_WEIGHT = 2;
const RELATIONSHIP_WEIGHT = 1.5;
const PRESENT_WEIGHT = 1.5;
const CONNECTION_WEIGHT = 1;

/**
 * Retrieve the entities relevant to an outline, ranked by evidence.
 *
 * Matching is lexical (name/alias substring over the normalized outline —
 * no tokenizer, no model call) and then expanded one hop along the entity
 * graph: a character's relationships, a location's connections and current
 * occupants, an item's carrier. Pure and stateless over any projected
 * `EngineState`, so it is fully unit-testable.
 */
export function retrieveEntities(
  state: EngineState,
  normalizedOutline: string,
  options: RetrievalOptions = {}
): ScoredEntity[] {
  const maxEntities = options.maxEntities ?? 12;
  const scores = new Map<string, ScoredEntity>();

  const add = (entity: Entity, delta: number, reason: string): void => {
    if (delta <= 0) return;
    const existing = scores.get(entity.id);
    if (existing) {
      existing.score += delta;
      existing.reasons.push(reason);
    } else {
      scores.set(entity.id, { entity, score: delta, reasons: [reason] });
    }
  };

  // 1. Explicit caller request — highest priority.
  for (const id of options.entityIds ?? []) {
    const entity = state.entities[id];
    if (entity) add(entity, 10, '调用方显式指定');
  }

  // 2. Lexical name/alias matching.
  for (const entity of Object.values(state.entities)) {
    const nameHits = countOccurrences(normalizedOutline, normalize(entity.name));
    if (nameHits > 0) {
      add(entity, NAME_WEIGHT * nameHits, `名字在大纲中出现 ${nameHits} 次`);
    }
    for (const alias of entity.aliases) {
      const aliasHits = countOccurrences(normalizedOutline, normalize(alias));
      if (aliasHits > 0) {
        add(entity, ALIAS_WEIGHT * aliasHits, `别名「${alias}」在大纲中出现 ${aliasHits} 次`);
      }
    }
  }

  // 3. One-hop graph expansion along the relationships it makes sense to pull.
  const matchedIds = new Set(scores.keys());
  for (const id of matchedIds) {
    const entity = state.entities[id];
    if (!entity) continue;
    if (entity.kind === 'character') {
      for (const rel of entity.relationships) {
        const target = state.entities[rel.entityId];
        if (target) add(target, RELATIONSHIP_WEIGHT, `与「${entity.name}」为${rel.type}关系`);
      }
    } else if (entity.kind === 'location') {
      for (const connectedId of entity.connections) {
        const target = state.entities[connectedId];
        if (target) add(target, CONNECTION_WEIGHT, `与「${entity.name}」相连`);
      }
      for (const candidate of Object.values(state.entities)) {
        if (candidate.kind === 'character' && candidate.attributes.locationId === entity.id) {
          add(candidate, PRESENT_WEIGHT, `正处于「${entity.name}」`);
        }
      }
    } else if (entity.kind === 'item') {
      if (entity.ownerId) {
        const owner = state.entities[entity.ownerId];
        if (owner) add(owner, PRESENT_WEIGHT, `持有「${entity.name}」`);
      }
      if (entity.locationId) {
        const where = state.entities[entity.locationId];
        if (where) add(where, CONNECTION_WEIGHT, `「${entity.name}」所在之地`);
      }
    }
  }

  const scored = [...scores.values()];
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const kindRank = (k: Entity['kind']) => (k === 'character' ? 0 : k === 'item' ? 1 : 2);
    const rankDiff = kindRank(a.entity.kind) - kindRank(b.entity.kind);
    if (rankDiff !== 0) return rankDiff;
    return a.entity.name.localeCompare(b.entity.name, 'zh-Hans-CN');
  });
  return scored.slice(0, maxEntities);
}

function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim();
}

/* ------------------------------------------------------------------ *
 * Foreshadowing retrieval
 * ------------------------------------------------------------------ */

export interface ForeshadowRetrievalOptions {
  maxForeshadows?: number;
}

/**
 * Which open foreshadowing threads belong in this prompt, best-first:
 * threads bound to a matched character, threads whose wording overlaps the
 * outline (the outline literally talks about the planted image), important
 * threads, and threads planted recently enough to still feel warm.
 */
export function retrieveForeshadows(
  state: EngineState,
  rawOutline: string,
  matchedEntityIds: ReadonlySet<string>,
  asOfChapter: number,
  options: ForeshadowRetrievalOptions = {}
): Foreshadow[] {
  const max = options.maxForeshadows ?? 10;
  const outlineBigrams = cjkBigrams(rawOutline);
  const scored: Array<{ foreshadow: Foreshadow; score: number }> = [];

  for (const f of Object.values(state.foreshadows)) {
    if (f.status !== 'pending') continue;
    if (f.chapter > asOfChapter) continue;
    let score = 0;
    if (f.entityId && matchedEntityIds.has(f.entityId)) score += 5;
    for (const gram of cjkBigrams(f.description)) {
      if (outlineBigrams.has(gram)) {
        score += 3;
        break;
      }
    }
    score += f.importance === 'high' ? 2 : f.importance === 'medium' ? 1 : 0;
    if (f.chapter >= asOfChapter - 4) score += 1;
    if (score > 0) scored.push({ foreshadow: f, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.foreshadow.chapter - a.foreshadow.chapter;
  });
  return scored.slice(0, max).map((s) => s.foreshadow);
}
