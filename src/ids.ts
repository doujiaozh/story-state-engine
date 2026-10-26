/**
 * Deterministic-enough unique id generator (no external dependency).
 *
 * Format: `<prefix>_<base36(time)>-<base36(counter)>-<random>`
 * The counter is per-process and monotonically increasing, which makes ids
 * generated inside a single run sort in creation order — handy for debugging.
 */
let idCounter = 0;

export function createId(prefix: string): string {
  idCounter += 1;
  const time = Date.now().toString(36);
  const counter = idCounter.toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${counter}${rand}`;
}

export const ENTITY_ID_PREFIXES = {
  character: 'ch',
  location: 'loc',
  item: 'item'
} as const;

/** Validate that an id looks like one produced by this library. */
export function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length > 3 && id.includes('_');
}
