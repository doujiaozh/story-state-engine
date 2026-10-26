import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';

import { StoryEngine } from '../src/StoryEngine.js';
import { MemoryStore } from '../src/persistence/MemoryStore.js';
import {
  EntityExistsError,
  EntityNotFoundError,
  ForeshadowNotFoundError,
  KindMismatchError,
  SchemaVersionError,
  StoreError,
  ValidationError
} from '../src/errors.js';
import { SCHEMA_VERSION } from '../src/types.js';
import type { ProjectData } from '../src/types.js';

/* ------------------------------------------------------------------ *
 * A tiny two-chapter story, driven the way demo.ts drives it.
 * ------------------------------------------------------------------ */

function seedStory(): StoryEngine {
  const engine = new StoryEngine({ meta: { name: '雾中纪' } });
  engine.startChapter(1, { title: '入山' });
  engine.createLocation({ id: 'loc_mountain', name: '青云山', connections: [] });
  engine.createLocation({ id: 'loc_hall', name: '藏剑阁', connections: ['loc_mountain'] });
  engine.createCharacter({
    id: 'ch_zhang',
    name: '张三',
    role: 'protagonist',
    attributes: { locationId: 'loc_mountain' }
  });
  engine.createCharacter({ id: 'ch_li', name: '李四' });
  engine.createItem({ id: 'item_sword', name: '玄铁剑', ownerId: 'ch_zhang' });
  engine.moveCharacter('ch_zhang', 'loc_hall', { scene: 1 });
  engine.setProperty('ch_zhang', '有伤', true);
  engine.setProperty('ch_zhang', '情绪', '警惕');
  engine.setRelationship('ch_zhang', 'ch_li', '挚友');
  engine.plantForeshadow('藏剑阁的剑匣上刻着张家的家徽', {
    entityId: 'item_sword',
    importance: 'high'
  });
  engine.beat('张三在藏剑阁中抚摸剑匣，若有所思');

  engine.startChapter(2, { title: '夜谈' });
  engine.transferItem('item_sword', 'ch_li');
  engine.setProperty('ch_zhang', '情绪', '释然');
  engine.deleteProperty('ch_zhang', '有伤', { summary: '伤势痊愈' });
  return engine;
}

/* ------------------------------------------------------------------ *
 * Bootstrap & meta
 * ------------------------------------------------------------------ */

describe('StoryEngine', () => {
  it('creates a fresh project with default meta', () => {
    const engine = new StoryEngine();
    const meta = engine.getMeta();
    assert.equal(meta.name, '未命名项目');
    assert.ok(meta.createdAt);
    assert.equal(engine.currentChapter, 0);
    assert.deepEqual(engine.getEvents(), []);
  });

  it('honours constructor meta and bootstraps from an event log', () => {
    const engine = new StoryEngine({ meta: { name: '外传' } });
    engine.startChapter(1);
    const events = engine.getEvents();

    const reborn = new StoryEngine({ meta: { name: '外传' }, events: [...events] });
    assert.equal(reborn.getMeta().name, '外传');
    assert.equal(reborn.currentChapter, 1, 'replayed log reproduces the chapter');
    assert.deepEqual(reborn.getEvents(), events);
  });

  it('bootstraps from full ProjectData', () => {
    const source = seedStory();
    const data: ProjectData = source.toProjectData();
    const reborn = new StoryEngine({ initialData: data });
    assert.equal(reborn.getMeta().name, '雾中纪');
    assert.equal(reborn.currentChapter, 2);
    assert.deepEqual(reborn.getState().entities, source.getState().entities);
  });

  it('rejects a ProjectData with the wrong schema version', () => {
    const data = seedStory().toProjectData();
    data.schemaVersion = 9999;
    assert.throws(() => new StoryEngine({ initialData: data }), SchemaVersionError);
  });
});

/* ------------------------------------------------------------------ *
 * Chapters & beats
 * ------------------------------------------------------------------ */

describe('chapters and beats', () => {
  it('starts chapters and collects chapter info', () => {
    const engine = seedStory();
    const chapters = engine.getChapters();
    assert.equal(chapters.length, 2);
    assert.equal(chapters[0]!.title, '入山');
    assert.equal(engine.getChapterInfo(2)?.title, '夜谈');
    assert.equal(engine.getChapterInfo(9), undefined);
  });

  it('auto-advances the chapter number when omitted', () => {
    const engine = new StoryEngine();
    engine.startChapter();
    assert.equal(engine.currentChapter, 1);
    engine.startChapter();
    assert.equal(engine.currentChapter, 2);
  });

  it('restarts a chapter explicitly, replacing its opener', () => {
    const engine = new StoryEngine();
    engine.startChapter(1, { title: '入山' });
    assert.equal(engine.getChapters().length, 1);
    // Re-opening chapter 1 replaces the opener rather than duplicating the chapter.
    engine.startChapter(1, { title: '序章', synopsis: '修订版开头' });
    assert.equal(engine.getChapterInfo(1)?.title, '序章');
    assert.equal(engine.getChapterInfo(1)?.synopsis, '修订版开头');
    assert.equal(engine.getChapters().length, 1, 'not a duplicate chapter');
  });

  it('rejects empty beats and non-positive chapters', () => {
    const engine = new StoryEngine();
    assert.throws(() => engine.beat('   '), ValidationError);
    assert.throws(() => engine.startChapter(0), ValidationError);
  });

  it('records beats under the current chapter by default', () => {
    const engine = seedStory();
    const beat = engine.beat('李四守夜');
    assert.equal(beat.chapter, 2);
    assert.equal(engine.getEvents().at(-1), beat);
  });
});

/* ------------------------------------------------------------------ *
 * Entity mutations, and validation that protects them
 * ------------------------------------------------------------------ */

describe('entities', () => {
  it('creates entities with the expected kinds and defaults', () => {
    const engine = seedStory();
    const zhang = engine.entities.requireCharacter('ch_zhang');
    assert.equal(zhang.kind, 'character');
    assert.equal(zhang.role, 'protagonist');
    assert.equal(engine.getState().entities['item_sword']!.kind, 'item');
  });

  it('rejects duplicate ids and dangling references', () => {
    const engine = seedStory();
    assert.throws(
      () => engine.createCharacter({ id: 'ch_zhang', name: '另一个张三' }),
      EntityExistsError
    );
    assert.throws(
      () => engine.createItem({ id: 'item_map', name: '地图', ownerId: 'ch_nobody' }),
      EntityNotFoundError
    );
    assert.throws(
      () => engine.createLocation({ id: 'loc_nowhere', name: '虚无', connections: ['loc_ghost'] }),
      EntityNotFoundError
    );
  });

  it('requires the right kind for typed operations', () => {
    const engine = seedStory();
    assert.throws(
      () => engine.moveCharacter('item_sword', 'loc_hall'),
      (e: Error) => e instanceof KindMismatchError && /类型不符/.test(e.message)
    );
  });

  it('updates entity profiles, and connections only for locations', () => {
    const engine = seedStory();
    engine.updateEntity('loc_hall', { connections: ['loc_mountain'] }, { summary: '路径开通' });
    assert.deepEqual(
      engine.entities.requireLocation('loc_hall').connections,
      ['loc_mountain']
    );
    assert.throws(
      () => engine.updateEntity('ch_zhang', { connections: ['loc_mountain'] }),
      ValidationError
    );
  });

  it('moves characters, sets dynamic state, and removes it again', () => {
    const engine = seedStory();
    assert.equal(engine.entities.requireCharacter('ch_zhang').attributes.locationId, 'loc_hall');

    engine.moveCharacter('ch_zhang', 'loc_mountain', { chapter: 3, scene: 1 });
    assert.equal(
      engine.getStateAtChapter(3).entities['ch_zhang']!.attributes.locationId,
      'loc_mountain'
    );
    // The pre-move snapshot is untouched: history is not rewritten.
    assert.equal(
      engine.getStateAtChapter(2).entities['ch_zhang']!.attributes.locationId,
      'loc_hall',
      'chapter 2 snapshot still shows the chapter-1 move'
    );

    engine.setProperty('ch_zhang', '情绪', '决意');
    assert.equal(engine.entities.requireCharacter('ch_zhang').attributes.情绪, '决意');
    engine.deleteProperty('ch_zhang', '情绪');
    assert.equal(engine.entities.requireCharacter('ch_zhang').attributes.情绪, undefined);
  });

  it('manages relationships between characters (relationships are directional)', () => {
    const engine = seedStory();
    engine.setRelationship('ch_li', 'ch_zhang', '挚友', { value: 8 });
    const li = engine.entities.requireCharacter('ch_li');
    assert.equal(li.relationships.length, 1);
    assert.equal(li.relationships[0]!.entityId, 'ch_zhang');
    assert.equal(li.relationships[0]!.type, '挚友');
    assert.equal(li.relationships[0]!.value, 8);

    engine.setRelationship('ch_zhang', 'ch_li', '生死之交', { note: '夜谈之后' });
    assert.equal(engine.entities.requireCharacter('ch_zhang').relationships[0]!.type, '生死之交');
    engine.removeRelationship('ch_zhang', 'ch_li');
    assert.equal(engine.entities.requireCharacter('ch_zhang').relationships.length, 0);
    assert.equal(engine.entities.requireCharacter('ch_li').relationships.length, 1, 'reverse bond survives');
  });

  it('transfers items and places them (carrying and resting are exclusive)', () => {
    const engine = seedStory();
    assert.equal(engine.getState().entities['item_sword']!.ownerId, 'ch_li');
    assert.equal(engine.getState().entities['item_sword']!.locationId, undefined);

    engine.placeItem('item_sword', 'loc_hall');
    assert.equal(engine.getState().entities['item_sword']!.locationId, 'loc_hall');
    assert.equal(engine.getState().entities['item_sword']!.ownerId, undefined);
  });
});

/* ------------------------------------------------------------------ *
 * Foreshadowing
 * ------------------------------------------------------------------ */

describe('foreshadowing', () => {
  it('plants, lists, resolves and abandons threads', () => {
    const engine = seedStory();
    const [open] = engine.pendingForeshadows();
    assert.ok(open);
    assert.equal(open.status, 'pending');
    assert.equal(open.importance, 'high');

    engine.resolveForeshadow(open.id, { resolution: '家徽指向张家祖训', chapter: 2 });
    assert.equal(engine.pendingForeshadows().length, 0);
    assert.equal(engine.getState().foreshadows[open.id]!.status, 'resolved');
    assert.equal(engine.getState().foreshadows[open.id]!.resolvedAtChapter, 2);

    const planted = engine.plantForeshadow('山脚下传来异响');
    const second = engine.pendingForeshadows().find((f) => f.description === '山脚下传来异响');
    assert.ok(second, 'planted thread is now pending');
    assert.equal(second!.id, planted.foreshadow!.id, 'the event carries the thread');
    engine.abandonForeshadow(second!.id, { reason: '改用其他线索' });
    assert.equal(engine.getState().foreshadows[second!.id]!.status, 'abandoned');
    assert.equal(engine.pendingForeshadows().length, 0);
  });

  it('guards thread state transitions', () => {
    const engine = seedStory();
    const [open] = engine.pendingForeshadows();
    engine.resolveForeshadow(open.id);
    assert.throws(() => engine.resolveForeshadow(open.id), ValidationError);
    assert.throws(() => engine.abandonForeshadow(open.id), ValidationError);
    assert.throws(() => engine.resolveForeshadow('fs_missing'), ForeshadowNotFoundError);
    assert.throws(() => engine.plantForeshadow('  '), ValidationError);
    assert.throws(() => engine.plantForeshadow('线索', { entityId: 'ch_nobody' }), EntityNotFoundError);
  });

  it('honours the as-of chapter when listing open threads', () => {
    const engine = seedStory();
    const threads = engine.pendingForeshadows(1);
    assert.equal(threads.length, 1, 'planted in chapter 1, visible as of chapter 1');
    assert.equal(threads[0]!.chapter, 1);
  });
});

/* ------------------------------------------------------------------ *
 * Read views: isolation and time travel
 * ------------------------------------------------------------------ */

describe('read views', () => {
  it('returns copies: mutating a view never touches the engine', () => {
    const engine = seedStory();
    const state = engine.getState();
    const zhang = engine.entities.requireCharacter('ch_zhang');
    state.entities['ch_zhang']!.name = '篡改';
    zhang.name = '又被篡改';
    assert.equal(engine.entities.requireCharacter('ch_zhang').name, '张三');
  });

  it('rebuilds the memoized projection after new events', () => {
    const engine = seedStory();
    const before = engine.getState();
    engine.setProperty('ch_li', '情绪', '忧虑');
    const after = engine.getState();
    assert.notEqual(before.entities['ch_li']!.attributes.情绪, '忧虑');
    assert.equal(after.entities['ch_li']!.attributes.情绪, '忧虑');
  });

  it('serves recent events in story order', () => {
    const engine = seedStory();
    engine.beat('李四守夜');
    const recent = engine.recentEvents(2, 5);
    assert.ok(recent.length <= 5);
    assert.equal(recent.at(-1)!.type, 'plot/beat' as const);
    assert.equal(recent.at(-1)!.chapter, 2);
  });
});

/* ------------------------------------------------------------------ *
 * Persistence through the facade
 * ------------------------------------------------------------------ */

describe('persistence facade', () => {
  it('roundtrips a whole project through a store', async () => {
    const store = new MemoryStore();
    const engine = await StoryEngine.open(store, { name: '雾中纪' });
    assert.equal(engine.getStore(), store);
    engine.startChapter(1);
    engine.createCharacter({ name: '张三' });
    await engine.save();

    const reopened = await StoryEngine.open(store);
    assert.equal(reopened.getMeta().name, '雾中纪');
    assert.equal(reopened.currentChapter, 1);
    assert.equal(Object.keys(reopened.getState().entities).length, 1);
  });

  it('saves and loads named slots (the 多端保存 story)', async () => {
    const store = new MemoryStore();
    const engine = await StoryEngine.open(store);
    engine.startChapter(1);
    engine.createCharacter({ name: '张三' });
    await engine.save();
    await engine.saveSlot('device-laptop');

    // Continue the main line; the slot must stay frozen.
    engine.startChapter(2);
    await engine.save();

    await engine.loadSlot('device-laptop');
    assert.equal(engine.currentChapter, 1, 'slot replays its own log');

    const slotLess = new StoryEngine({ meta: { name: 'x' } });
    await assert.rejects(() => slotLess.save(), StoreError);
    await engine.saveSlot('plot-branch-a');
    assert.deepEqual(
      (await store.listSlots()).sort(),
      ['device-laptop', 'plot-branch-a']
    );
  });

  it('refuses slots when the store has no slot support', async () => {
    const store: { load(): Promise<ProjectData | null>; save(_d: ProjectData): Promise<void> } = {
      load: async () => null,
      save: async () => {}
    };
    const engine = await StoryEngine.open(store);
    await assert.rejects(() => engine.saveSlot('x'), StoreError);
    await assert.rejects(() => engine.loadSlot('x'), StoreError);
  });

  it('throws StoreError when loading a missing slot', async () => {
    const engine = await StoryEngine.open(new MemoryStore());
    await assert.rejects(() => engine.loadSlot('ghost'), StoreError);
  });

  it('updates meta through updateMeta without polluting the log', () => {
    const engine = seedStory();
    const eventsBefore = engine.getEvents().length;
    engine.updateMeta({ synopsis: '一个关于雾与剑的故事。' });
    assert.equal(engine.getMeta().synopsis, '一个关于雾与剑的故事。');
    assert.equal(engine.getEvents().length, eventsBefore, 'meta rides outside the event log');
    assert.equal(engine.toProjectData().schemaVersion, SCHEMA_VERSION);
  });
});

/* ------------------------------------------------------------------ *
 * Context extraction, end to end through the facade
 * ------------------------------------------------------------------ */

describe('extractContext through the engine', () => {
  it('rebuilds the exact context prompt a chapter-3 outline needs', () => {
    const engine = seedStory();
    const ctx = engine.extractContext('第三章 张三与李四在藏剑阁夜话，玄铁剑的家徽之谜浮现');

    assert.equal(ctx.chapter, 3);
    assert.equal(ctx.asOfChapter, 2, 'world snapshot is the end of the previous chapter');
    const ids = ctx.matchedEntities.map((m) => m.entity.id).sort();
    assert.ok(ids.includes('ch_zhang') && ids.includes('ch_li') && ids.includes('item_sword'));
    assert.equal(ctx.foreshadowing.length, 1);
    assert.equal(ctx.foreshadowing[0]!.entityId, 'item_sword');

    assert.match(ctx.systemPrompt, /张三/);
    assert.match(ctx.systemPrompt, /情绪/);
    assert.match(ctx.systemPrompt, /藏剑阁|玄铁剑/);
    assert.match(ctx.systemPrompt, /伏笔/);
    assert.ok(!ctx.systemPrompt.includes('有伤：true'), '伤势在第 2 章已痊愈，不应出现');
    // Chapter-2 facts are already in the world as of the snapshot.
    assert.ok(ctx.systemPrompt.length > 200);
  });

  it('lets the caller override the target chapter', () => {
    const engine = seedStory();
    const ctx = engine.extractContext('张三在藏剑阁擦拭玄铁剑', { chapter: 2 });
    assert.equal(ctx.chapter, 2);
    assert.equal(ctx.asOfChapter, 1);
    const sword = ctx.matchedEntities.find((m) => m.entity.id === 'item_sword');
    assert.ok(sword, 'the outline mentions the sword');
    assert.equal(sword!.entity.ownerId, 'ch_zhang', 'as of chapter 1, 张三 still holds the sword');
    assert.equal(sword!.entity.locationId, undefined);
  });
});
