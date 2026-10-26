import { createId } from './ids.js';
import type { EventId, StoryEvent } from './types.js';

/**
 * Deterministic story-time ordering. Story time dominates: an event in
 * chapter 2 always precedes an event in chapter 3 no matter when either was
 * written. Within the same chapter+scene, the insertion counter (`seq`)
 * preserves writing order.
 */
export function compareEvents(a: StoryEvent, b: StoryEvent): number {
  if (a.chapter !== b.chapter) return a.chapter - b.chapter;
  const sa = a.scene ?? 0;
  const sb = b.scene ?? 0;
  if (sa !== sb) return sa - sb;
  return a.seq - b.seq;
}

export type NewEventInput<T extends StoryEvent = StoryEvent> = Omit<
  T,
  'id' | 'seq' | 'createdAt'
> &
  Partial<Pick<StoryEvent, 'id' | 'seq' | 'createdAt'>>;

/**
 * The timeline graph: an append-only, always-sorted log of `StoryEvent`s.
 *
 * Events are the *only* place world-state lives. The class is deliberately
 * storage-agnostic — `toJSON()` gives a serializable log that any Store can
 * persist, and `fromJSON()` rebuilds it byte-for-byte.
 */
export class Timeline {
  private events: StoryEvent[] = [];
  private seqCounter = 0;

  constructor(events: StoryEvent[] = []) {
    for (const e of events) this.insert(e);
  }

  /** Number of events stored. */
  get size(): number {
    return this.events.length;
  }

  /** Highest chapter number seen so far (0 when empty). */
  get highestChapter(): number {
    let max = 0;
    for (const e of this.events) if (e.chapter > max) max = e.chapter;
    return max;
  }

  /**
   * Append a new event. The event is placed at its story-time position, so
   * writing "what really happened two chapters ago" works.
   */
  append(input: NewEventInput): StoryEvent {
    this.seqCounter += 1;
    const event = {
      ...input,
      id: (input as { id?: string }).id ?? createId('ev'),
      seq: (input as { seq?: number }).seq ?? this.seqCounter,
      createdAt: (input as { createdAt?: string }).createdAt ?? new Date().toISOString()
    } as StoryEvent;
    this.insert(event);
    return event;
  }

  private insert(event: StoryEvent): void {
    if (event.seq > this.seqCounter) this.seqCounter = event.seq;
    // Keep the log sorted: binary-search the insertion point.
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compareEvents(this.events[mid] as StoryEvent, event) < 0) lo = mid + 1;
      else hi = mid;
    }
    this.events.splice(lo, 0, event);
  }

  /** All events in story order. */
  getAll(): readonly StoryEvent[] {
    return this.events;
  }

  /** Events with `chapter <= n` (or `< n` when `inclusive` is false). */
  getEventsUpToChapter(n: number, inclusive = true): StoryEvent[] {
    return this.events.filter((e) => (inclusive ? e.chapter <= n : e.chapter < n));
  }

  /** Every event touching `entityId`, in story order. */
  getEventsForEntity(entityId: string, upToChapter?: number): StoryEvent[] {
    const out: StoryEvent[] = [];
    for (const e of this.events) {
      if (upToChapter !== undefined && e.chapter > upToChapter) continue;
      if (eventTouches(e, entityId)) out.push(e);
    }
    return out;
  }

  /** Summary lines of the last `limit` events at or before `chapter`. */
  recentSummaries(chapter: number, limit: number): string[] {
    const out: string[] = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const e = this.events[i] as StoryEvent;
      if (e.chapter > chapter) continue;
      const line = summarizeEvent(e);
      if (line) out.unshift(line);
    }
    return out;
  }

  toJSON(): StoryEvent[] {
    return this.events.map((e) => structuredClone(e));
  }

  /** Replace the whole log; used when loading a serialized project. */
  reset(events: StoryEvent[] = []): void {
    this.events = [];
    this.seqCounter = 0;
    for (const e of events) this.insert(e);
  }

  static fromJSON(events: StoryEvent[]): Timeline {
    return new Timeline(events);
  }

  /** Detach the raw array (used for serialization without clones). */
  toRaw(): StoryEvent[] {
    return this.events;
  }
}

function eventTouches(event: StoryEvent, entityId: string): boolean {
  switch (event.type) {
    case 'entity/created':
      return event.entity.id === entityId;
    case 'entity/updated':
    case 'entity/property-set':
    case 'entity/property-delete':
    case 'character/moved':
    case 'item/transferred':
    case 'item/placed':
      return event.entityId === entityId;
    case 'character/relationship-set':
    case 'character/relationship-remove':
      return event.entityId === entityId || event.targetId === entityId;
    case 'foreshadow/planted':
      return event.foreshadow.entityId === entityId;
    default:
      return false;
  }
}

export function summarizeEvent(event: StoryEvent): string | null {
  if (event.summary) return event.summary;
  switch (event.type) {
    case 'story/chapter-started':
      return `第 ${event.chapter} 章${event.title ? `《${event.title}》` : ''}开始`;
    case 'entity/created':
      return `${event.entity.name}登场（${event.entity.kind}）`;
    case 'character/moved':
      return `角色移动（第 ${event.chapter} 章）`;
    case 'plot/beat':
      return event.text;
    case 'foreshadow/planted':
      return `埋下伏笔：${event.foreshadow.description}`;
    default:
      return null;
  }
}
