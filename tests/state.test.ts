/**
 * projectState: the event log is the only truth; state is a pure projection.
 * Every test here replays raw events and asserts the derived world view.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getEntitiesByKind,
  cloneState,
  pendingForeshadows,
  foreshadowsForEntity,
  staleForeshadows,
  projectState
} from '../src/state.js';
import type { CharacterEntity, StoryEvent } from '../src/types.js';

function log(): StoryEvent[] {
  return [];
}

function chapterStarted(chapter: number, title?: string): StoryEvent {
  return {
    type: 'story/chapter-started',
    id: `id_c${chapter}`,
    seq: 0,
    chapter,
    createdAt: '2026-01-01T00:00:00.000Z',
    title
  } as StoryEvent;
}

function createdCharacter(
  id: string,
  name: string,
  chapter: number,
  extra: Partial<CharacterEntity> = {}
): StoryEvent {
  return {
    type: 'entity/created',
    id: `id_${id}`,
    seq: 0,
    chapter,
    createdAt: '2026-01-01T00:00:00.000Z',
    entity: {
      id,
      kind: 'character',
      name,
      aliases: [],
      description: '',
      attributes: {},
      tags: [],
      introducedAtChapter: chapter,
      role: 'supporting',
      relationships: [],
      ...extra
    }
  } as StoryEvent;
}

describe('projectState · entities', () => {
  it('creates entities from entity/created events', () => {
    const events = [
      chapterStarted(1),
      createdCharacter('ch_zhangsan', '张三', 1, { role: 'protagonist' })
    ];
    const state = projectState(events);
    const zhangsan = state.entities['ch_zhangsan'];
    assert.equal(zhangsan.kind, 'character');
    assert.equal(zhangsan.name, '张三');
    assert.equal((zhangsan as CharacterEntity).role, 'protagonist');
    assert.equal(state.highestChapter, 1);
  });

  it('applies entity/updated patches', () => {
    const events: StoryEvent[] = [
      createdCharacter('ch_a', '甲', 1),
      {
        type: 'entity/updated',
        id: 'id_u1',
        seq: 1,
        chapter: 1,
        createdAt: 'x',
        entityId: 'ch_a',
        patch: { name: '甲改名', tags: ['勇士'], aliases: ['阿甲'] }
      } as StoryEvent
    ];
    const state = projectState(events);
    const e = state.entities['ch_a'];
    assert.equal(e.name, '甲改名');
    assert.deepEqual(e.tags, ['勇士']);
    assert.deepEqual(e.aliases, ['阿甲']);
  });

  it('applies property-set and property-delete', () => {
    const events: StoryEvent[] = [
      createdCharacter('ch_a', '甲', 1),
      {
        type: 'entity/property-set',
        id: 'id_p1',
        seq: 1,
        chapter: 1,
        createdAt: 'x',
        entityId: 'ch_a',
        property: '伤势',
        value: '轻伤'
      } as StoryEvent,
      {
        type: 'entity/property-set',
        id: 'id_p2',
        seq: 2,
        chapter: 1,
        createdAt: 'x',
        entityId: 'ch_a',
        property: '伤势',
        value: '重伤'
      } as StoryEvent,
      {
        type: 'entity/property-delete',
        id: 'id_p3',
        seq: 3,
        chapter: 1,
        createdAt: 'x',
        entityId: 'ch_a',
        property: '伤势'
      } as StoryEvent
    ];
    const state = projectState(events);
    assert.equal(state.entities['ch_a'].attributes['伤势'], undefined);
  });

  it('updates connections for locations only', () => {
    const events: StoryEvent[] = [
      {
        type: 'entity/created',
        id: 'id_l1',
        seq: 0,
        chapter: 1,
        createdAt: 'x',
        entity: {
          id: 'loc_a',
          kind: 'location',
          name: '甲地',
          aliases: [],
          description: '',
          attributes: {},
          tags: [],
          introducedAtChapter: 1,
          connections: []
        }
      } as StoryEvent,
      {
        type: 'entity/created',
        id: 'id_l2',
        seq: 1,
        chapter: 1,
        createdAt: 'x',
        entity: {
          id: 'loc_b',
          kind: 'location',
          name: '乙地',
          aliases: [],
          description: '',
          attributes: {},
          tags: [],
          introducedAtChapter: 1,
          connections: []
        }
      } as StoryEvent,
      {
        type: 'entity/updated',
        id: 'id_l3',
        seq: 2,
        chapter: 1,
        createdAt: 'x',
        entityId: 'loc_a',
        patch: { connections: ['loc_b'] }
      } as StoryEvent
    ];
    const state = projectState(events);
    assert.deepEqual(
      (state.entities['loc_a'] as { connections?: string[] }).connections,
      ['loc_b']
    );
  });
});

describe('projectState · movement & relationships & items', () => {
  function baseEvents(): StoryEvent[] {
    return [
      createdCharacter('ch_a', '甲', 1),
      createdCharacter('ch_b', '乙', 1),
      {
        type: 'entity/created',
        id: 'id_loc',
        seq: 3,
        chapter: 1,
        createdAt: 'x',
        entity: {
          id: 'loc_x',
          kind: 'location',
          name: '某地',
          aliases: [],
          description: '',
          attributes: {},
          tags: [],
          introducedAtChapter: 1,
          connections: []
        }
      } as StoryEvent,
      {
        type: 'entity/created',
        id: 'id_item',
        seq: 4,
        chapter: 1,
        createdAt: 'x',
        entity: {
          id: 'item_sword',
          kind: 'item',
          name: '剑',
          aliases: [],
          description: '',
          attributes: {},
          tags: [],
          introducedAtChapter: 1
        }
      } as StoryEvent
    ];
  }

  it('tracks character movement', () => {
    const events: StoryEvent[] = [
      ...baseEvents(),
      {
        type: 'character/moved',
        id: 'id_m1',
        seq: 5,
        chapter: 1,
        createdAt: 'x',
        entityId: 'ch_a',
        from: undefined,
        to: 'loc_x'
      } as StoryEvent,
      {
        type: 'character/moved',
        id: 'id_m2',
        seq: 6,
        chapter: 2,
        createdAt: 'x',
        entityId: 'ch_a',
        from: 'loc_x',
        to: 'loc_x'
      } as StoryEvent
    ];
    const state = projectState(events);
    assert.equal(state.entities['ch_a'].attributes['locationId'], 'loc_x');
  });

  it('set and remove relationships', () => {
    const events: StoryEvent[] = [
      ...baseEvents(),
      {
        type: 'character/relationship-set',
        id: 'id_r1',
        seq: 5,
        chapter: 1,
        createdAt: 'x',
        entityId: 'ch_a',
        targetId: 'ch_b',
        relationType: '宿敌'
      } as StoryEvent,
      {
        type: 'character/relationship-set',
        id: 'id_r2',
        seq: 6,
        chapter: 1,
        createdAt: 'x',
        entityId: 'ch_a',
        targetId: 'ch_b',
        relationType: '挚友'
      } as StoryEvent,
      {
        type: 'character/relationship-remove',
        id: 'id_r3',
        seq: 7,
        chapter: 2,
        createdAt: 'x',
        entityId: 'ch_a',
        targetId: 'ch_b'
      } as StoryEvent
    ];
    const state = projectState(events);
    const rel = (state.entities['ch_a'] as CharacterEntity).relationships;
    assert.equal(rel.length, 0);
  });

  it('transfers item ownership and placement (carried ≠ resting)', () => {
    const events: StoryEvent[] = [
      ...baseEvents(),
      {
        type: 'item/transferred',
        id: 'id_t1',
        seq: 5,
        chapter: 1,
        createdAt: 'x',
        itemId: 'item_sword',
        from: undefined,
        to: 'ch_a'
      } as StoryEvent,
      {
        type: 'item/placed',
        id: 'id_t2',
        seq: 6,
        chapter: 2,
        createdAt: 'x',
        itemId: 'item_sword',
        locationId: 'loc_x'
      } as StoryEvent
    ];
    const carried = projectState(events.slice(0, -1)).entities['item_sword'] as {
      ownerId?: string;
      locationId?: string;
    };
    assert.equal(carried.ownerId, 'ch_a');
    assert.equal(carried.locationId, undefined, '随身物品不再放置于地点');

    const placed = projectState(events).entities['item_sword'] as {
      ownerId?: string;
      locationId?: string;
    };
    assert.equal(placed.locationId, 'loc_x');
    assert.equal(placed.ownerId, undefined, '放置于地点的物品脱离持有');
  });
});

describe('projectState · foreshadows', () => {
  function planted(id: string, chapter: number, entityId?: string): StoryEvent {
    return {
      type: 'foreshadow/planted',
      id: `id_fs_${id}`,
      seq: 0,
      chapter,
      createdAt: 'x',
      foreshadow: {
        id,
        description: `伏笔${id}`,
        entityId,
        chapter,
        importance: 'medium',
        status: 'pending'
      }
    } as StoryEvent;
  }

  it('plants, resolves and abandons foreshadows', () => {
    const events: StoryEvent[] = [
      planted('fs_1', 1),
      planted('fs_2', 1),
      planted('fs_3', 1),
      {
        type: 'foreshadow/resolved',
        id: 'id_rs',
        seq: 1,
        chapter: 3,
        createdAt: 'x',
        foreshadowId: 'fs_1',
        resolution: '真相揭晓'
      } as StoryEvent,
      {
        type: 'foreshadow/abandoned',
        id: 'id_ab',
        seq: 2,
        chapter: 4,
        createdAt: 'x',
        foreshadowId: 'fs_2',
        reason: '分支被砍'
      } as StoryEvent
    ];
    const state = projectState(events);
    assert.equal(state.foreshadows['fs_1'].status, 'resolved');
    assert.equal(state.foreshadows['fs_1'].resolvedAtChapter, 3);
    assert.equal(state.foreshadows['fs_1'].resolution, '真相揭晓');
    assert.equal(state.foreshadows['fs_2'].status, 'abandoned');
    assert.equal(state.foreshadows['fs_3'].status, 'pending');
    assert.equal(pendingForeshadows(state).length, 1);
  });

  it('filters pending foreshadows by as-of chapter', () => {
    const events: StoryEvent[] = [planted('fs_a', 1), planted('fs_b', 5)];
    const state = projectState(events);
    assert.equal(pendingForeshadows(state, 3).length, 1);
    assert.equal(pendingForeshadows(state, 9).length, 2);
  });

  it('groups foreshadows per entity', () => {
    const events: StoryEvent[] = [planted('fs_a', 1, 'ch_hero'), planted('fs_b', 1, 'ch_hero')];
    const state = projectState(events);
    assert.equal(foreshadowsForEntity(state, 'ch_hero').length, 2);
    assert.equal(foreshadowsForEntity(state, 'ch_other').length, 0);
  });

  it('flags foreshadows stale past a chapter threshold', () => {
    const events: StoryEvent[] = [planted('fs_old', 1), planted('fs_new', 4)];
    const state = projectState(events);
    const stale = staleForeshadows(state, 7, 5);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].id, 'fs_old');
  });
});

describe('projectState · chapters', () => {
  it('records started chapters and keeps them sorted', () => {
    const events: StoryEvent[] = [
      chapterStarted(2, '第二章'),
      chapterStarted(1, '第一章')
    ];
    const state = projectState(events);
    assert.equal(state.chapters.length, 2);
    assert.equal(state.chapters[0].chapter, 1);
    assert.equal(state.chapters[1].chapter, 2);
    assert.equal(state.highestChapter, 2);
  });

  it('replaces a duplicate chapter-started event', () => {
    const events: StoryEvent[] = [chapterStarted(1, '初稿'), chapterStarted(1, '定稿')];
    const state = projectState(events);
    assert.equal(state.chapters.length, 1);
    assert.equal(state.chapters[0].title, '定稿');
  });

  it('groups entities by kind', () => {
    const events: StoryEvent[] = [
      createdCharacter('ch_a', '甲', 1),
      {
        type: 'entity/created',
        id: 'id_l',
        seq: 1,
        chapter: 1,
        createdAt: 'x',
        entity: {
          id: 'loc_a',
          kind: 'location',
          name: '某地',
          aliases: [],
          description: '',
          attributes: {},
          tags: [],
          introducedAtChapter: 1,
          connections: []
        }
      } as StoryEvent
    ];
    const state = projectState(events);
    assert.equal(getEntitiesByKind(state, 'character').length, 1);
    assert.equal(getEntitiesByKind(state, 'location').length, 1);
    assert.equal(getEntitiesByKind(state, 'item').length, 0);
  });
});

describe('cloneState', () => {
  it('deep-clones so mutations to the copy do not leak back', () => {
    const events: StoryEvent[] = [createdCharacter('ch_a', '甲', 1)];
    const state = projectState(events);
    const copy = cloneState(state);
    (copy.entities['ch_a'] as CharacterEntity).name = '篡改';
    assert.equal(state.entities['ch_a'].name, '甲');
  });
});

describe('projectState · empty & unknown', () => {
  it('starts from an empty log', () => {
    const state = projectState(log());
    assert.equal(Object.keys(state.entities).length, 0);
    assert.equal(state.highestChapter, 0);
  });

  it('ignores events referencing unknown entities', () => {
    const events: StoryEvent[] = [
      {
        type: 'entity/property-set',
        id: 'id_x',
        seq: 0,
        chapter: 1,
        createdAt: 'x',
        entityId: 'ch_nope',
        property: 'p',
        value: 1
      } as StoryEvent
    ];
    const state = projectState(events);
    assert.equal(Object.keys(state.entities).length, 0);
  });
});
