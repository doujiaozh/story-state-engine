/**
 * Timeline invariants: ordering, id/seq assignment, chapter-bounded queries.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Timeline } from '../src/timeline.js';
import { compareEvents } from '../src/timeline.js';
import type { StoryEvent } from '../src/types.js';

function ev(chapter: number, seq: number, extra: Partial<StoryEvent> = {}): StoryEvent {
  return {
    type: 'plot/beat',
    id: `ev_${chapter}_${seq}`,
    seq,
    chapter,
    createdAt: '2026-01-01T00:00:00.000Z',
    text: '节拍',
    ...extra
  } as StoryEvent;
}

describe('compareEvents', () => {
  it('orders by chapter, then scene, then seq', () => {
    const a = ev(1, 5, { scene: 2 });
    const b = ev(1, 3, { scene: 1 });
    const c = ev(2, 1);
    assert.equal(compareEvents(a, b), 1);
    assert.equal(compareEvents(b, a), -1);
    assert.equal(compareEvents(a, a), 0);
    assert.equal(compareEvents(b, c), -1);
  });
});

describe('Timeline', () => {
  it('backfills events in story order and renumbers nothing', () => {
    const tl = new Timeline([ev(2, 1), ev(1, 1)]);
    const all = tl.getAll();
    assert.equal(all[0].chapter, 1);
    assert.equal(all[1].chapter, 2);
  });

  it('appends events sorted by story time regardless of insertion order', () => {
    const tl = new Timeline();
    tl.append({ type: 'plot/beat', chapter: 1, text: '最早' });
    tl.append({ type: 'plot/beat', chapter: 3, text: '最晚' });
    tl.append({ type: 'plot/beat', chapter: 2, text: '居中' });
    const chapters = tl.getAll().map((e) => e.chapter);
    assert.deepEqual(chapters, [1, 2, 3]);
  });

  it('assigns id, seq and createdAt on append', () => {
    const tl = new Timeline();
    const e = tl.append({ type: 'plot/beat', chapter: 1, text: 'x' });
    assert.ok(e.id);
    assert.ok(e.id.length > 0);
    assert.equal(typeof e.seq, 'number');
    assert.ok(e.createdAt);
  });

  it('assigns seq by insertion even when story order differs', () => {
    const tl = new Timeline();
    const first = tl.append({ type: 'plot/beat', chapter: 2, text: '后发生' });
    const second = tl.append({ type: 'plot/beat', chapter: 1, text: '先发生' });
    assert.ok(second.seq > first.seq, 'seq is a log counter, independent of story order');
    // story order still rules the log itself
    assert.deepEqual(
      tl.getAll().map((e) => e.chapter),
      [1, 2]
    );
  });

  it('returns events up to a chapter, inclusive or exclusive', () => {
    const tl = new Timeline();
    tl.append({ type: 'plot/beat', chapter: 1, text: '一' });
    tl.append({ type: 'plot/beat', chapter: 2, text: '二' });
    tl.append({ type: 'plot/beat', chapter: 3, text: '三' });
    assert.equal(tl.getEventsUpToChapter(2, true).length, 2);
    assert.equal(tl.getEventsUpToChapter(2, false).length, 1);
    assert.equal(tl.getEventsUpToChapter(0).length, 0);
  });

  it('returns recent summaries in story order', () => {
    const tl = new Timeline();
    tl.append({ type: 'plot/beat', chapter: 1, text: '第一章事件' });
    tl.append({ type: 'plot/beat', chapter: 2, text: '第二章事件' });
    const recent = tl.recentSummaries(2, 5);
    assert.equal(recent.length, 2);
    assert.equal(recent[0], '第一章事件');
    assert.equal(recent[1], '第二章事件');
  });

  it('round-trips through toJSON/fromJSON losslessly', () => {
    const tl = new Timeline();
    tl.append({ type: 'plot/beat', chapter: 1, text: 'a' });
    tl.append({ type: 'plot/beat', chapter: 2, text: 'b' });
    const copy = Timeline.fromJSON(tl.toJSON());
    assert.deepEqual(copy.toJSON(), tl.toJSON());
  });

  it('reset clears and rebuilds the log', () => {
    const tl = new Timeline();
    tl.append({ type: 'plot/beat', chapter: 9, text: '旧' });
    tl.reset([ev(1, 1), ev(2, 2)]);
    assert.equal(tl.getAll().length, 2);
    assert.equal(tl.getAll()[0].chapter, 1);
  });
});
