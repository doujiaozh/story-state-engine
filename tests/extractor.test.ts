/**
 * The Dynamic Context Extractor: outline parsing, entity/foreshadow retrieval,
 * prompt rendering, and budget trimming — the engine's core answer to
 * "the model forgot what it wrote three chapters ago".
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ContextExtractor } from '../src/extractor/ContextExtractor.js';
import type { ExtractionSource } from '../src/extractor/ContextExtractor.js';
import {
  chineseToNumber,
  cjkBigrams,
  countOccurrences,
  detectChapter,
  normalizeText,
  parseOutline
} from '../src/extractor/outline.js';
import { retrieveEntities, retrieveForeshadows } from '../src/extractor/retrieval.js';
import {
  estimateTokens,
  formatValue,
  renderSections,
  renderSystemPrompt,
  trimToTokenBudget
} from '../src/extractor/prompt.js';
import { buildCharacter, buildItem, buildLocation } from '../src/entities.js';
import type {
  CharacterEntity,
  Entity,
  Foreshadow,
  ItemEntity,
  LocationEntity,
  StoryEvent
} from '../src/types.js';
import type { EngineState } from '../src/types.js';

/* -------------------------------------------------------------- *
 * Fixtures: a small projected world, built like the engine does.
 * -------------------------------------------------------------- */

function makeState(): EngineState {
  const zhang = buildCharacter(
    {
      id: 'ch_zhang',
      name: '张三',
      aliases: ['张少侠'],
      description: '主角',
      role: 'protagonist',
      chapter: 1,
      attributes: { locationId: 'loc_mist', 情绪: '警惕', 有伤: true }
    },
    1
  );
  const li = buildCharacter(
    {
      id: 'ch_li',
      name: '李四',
      description: '同伴',
      role: 'supporting',
      chapter: 1,
      attributes: { locationId: 'loc_mist' }
    },
    1
  );
  li.relationships.push({ entityId: 'ch_zhang', type: '挚友' });
  const elder = buildCharacter(
    {
      id: 'ch_elder',
      name: '云长老',
      description: '隐士',
      role: 'supporting',
      chapter: 2,
      attributes: { locationId: 'loc_peak' }
    },
    2
  );
  const mist = buildLocation(
    {
      id: 'loc_mist',
      name: '雾谷',
      description: '常年大雾',
      chapter: 1,
      connections: ['loc_peak']
    },
    1
  );
  const peak = buildLocation(
    {
      id: 'loc_peak',
      name: '青云山顶',
      chapter: 1,
      connections: ['loc_mist']
    },
    1
  );
  const sword = buildItem(
    {
      id: 'item_sword',
      name: '玄铁剑',
      description: '沉重钝剑',
      chapter: 1,
      ownerId: 'ch_zhang'
    },
    1
  );

  const entities: Record<string, Entity> = { ch_zhang: zhang, ch_li: li, ch_elder: elder, loc_mist: mist, loc_peak: peak, item_sword: sword };
  const foreshadows: Record<string, Foreshadow> = {
    f_sword: {
      id: 'f_sword',
      description: '玄铁剑上的裂纹在月光下发出低鸣',
      entityId: 'item_sword',
      chapter: 1,
      importance: 'high',
      status: 'pending'
    },
    f_elder: {
      id: 'f_elder',
      description: '云长老提及旧年的一场大火',
      entityId: 'ch_elder',
      chapter: 2,
      importance: 'medium',
      status: 'pending'
    },
    f_resolved: {
      id: 'f_resolved',
      description: '张三怀中的半块玉佩',
      entityId: 'ch_zhang',
      chapter: 1,
      importance: 'high',
      status: 'resolved',
      resolvedAtChapter: 2,
      resolution: '与李四的玉佩合二为一'
    },
    f_future: {
      id: 'f_future',
      description: '雾谷深处的禁地',
      chapter: 3,
      importance: 'medium',
      status: 'pending'
    }
  };
  return {
    entities,
    foreshadows,
    chapters: [{ chapter: 1, startedAtSeq: 0 }, { chapter: 2, startedAtSeq: 5 }],
    highestChapter: 2
  };
}

function fakeSource(state: EngineState, events: StoryEvent[] = []): ExtractionSource {
  return {
    getStateAtChapter: () => state,
    getMeta: () => ({
      name: '测试小说',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }),
    recentEvents: () => events
  };
}

function beatEvent(chapter: number, summary: string): StoryEvent {
  return {
    type: 'plot/beat',
    id: `id_b${chapter}`,
    seq: chapter,
    chapter,
    createdAt: '2026-01-01T00:00:00.000Z',
    text: '',
    summary
  };
}

/* -------------------------------------------------------------- *
 * Outline parsing
 * -------------------------------------------------------------- */

describe('outline parsing', () => {
  it('parses chinese and arabic chapter numbers', () => {
    assert.equal(chineseToNumber('三'), 3);
    assert.equal(chineseToNumber('十二'), 12);
    assert.equal(chineseToNumber('一百零五'), 105);
    assert.equal(chineseToNumber('5'), 5);
    assert.equal(chineseToNumber('abc'), null);
  });

  it('detects chapter markers in many shapes', () => {
    assert.equal(detectChapter('第三章 风起'), 3);
    assert.equal(detectChapter('第十二回 旧事'), 12);
    assert.equal(detectChapter('chapter 5'), 5);
    assert.equal(detectChapter('Ch. 12 - the peak'), 12);
    assert.equal(detectChapter('没有章节信息的一行大纲'), null);
  });

  it('normalizes fullwidth characters without touching CJK', () => {
    assert.equal(normalizeText('Ａｂｃ　１２３'), 'abc 123');
    assert.equal(normalizeText('雾谷'), '雾谷');
  });

  it('extracts cjk bigrams for soft matching', () => {
    assert.deepEqual([...cjkBigrams('雾谷深处')].sort(), ['深处', '谷深', '雾谷']);
    assert.deepEqual([...cjkBigrams('ab')], []);
  });

  it('counts occurrences and refuses single-character needles', () => {
    assert.equal(countOccurrences('雾谷，雾谷，还是雾谷', '雾谷'), 3);
    assert.equal(countOccurrences('abc', ''), 0);
    assert.equal(countOccurrences('abc', 'a'), 0, 'a lone char would match unrelated prose');
    assert.equal(countOccurrences('雾谷雾谷', '雾谷'), 2, 'no double-counting overlaps');
  });

  it('parseOutline yields normalized text plus chapter', () => {
    const cues = parseOutline('第三章 张三进入雾谷，玄铁剑发出低鸣');
    assert.equal(cues.chapter, 3);
    assert.ok(cues.normalized.includes('张三'));
  });
});

/* -------------------------------------------------------------- *
 * Entity retrieval
 * -------------------------------------------------------------- */

describe('retrieveEntities', () => {
  const state = makeState();

  it('scores name hits above alias hits', () => {
    const matched = retrieveEntities(state, '张三走进雾谷，张三四下打量');
    const zhang = matched.find((m) => m.entity.id === 'ch_zhang');
    const mist = matched.find((m) => m.entity.id === 'loc_mist');
    assert.ok(zhang);
    assert.ok(zhang!.reasons.some((r) => r.includes('2 次')), 'two name hits recorded');
    assert.equal(zhang!.score, 7.5, '6 from name hits + 1.5 present-at-matched-location');
    assert.ok(mist, 'location mentioned by name is recalled');
    assert.ok(mist!.score < zhang!.score);
  });

  it('matches aliases at a lower weight', () => {
    const matched = retrieveEntities(state, '张少侠拔剑');
    const zhang = matched.find((m) => m.entity.id === 'ch_zhang');
    assert.ok(zhang);
    assert.equal(zhang!.score, 2);
  });

  it('expands one hop along the entity graph', () => {
    const matched = retrieveEntities(state, '玄铁剑');
    const owner = matched.find((m) => m.entity.id === 'ch_zhang');
    assert.ok(owner, 'item drags its owner in');

    const fromName = retrieveEntities(state, '李四');
    const zhang = fromName.find((m) => m.entity.id === 'ch_zhang');
    assert.ok(zhang, 'character drags in its relationship target');
    assert.ok(zhang!.reasons.some((r) => r.includes('挚友')));

    const atPeak = retrieveEntities(state, '青云山顶');
    const elder = atPeak.find((m) => m.entity.id === 'ch_elder');
    assert.ok(elder, 'location drags in its current occupant');
    assert.ok(elder!.reasons.some((r) => r.includes('正处于')));

    const fromLoc = retrieveEntities(state, '雾谷');
    const peak = fromLoc.find((m) => m.entity.id === 'loc_peak');
    assert.ok(peak, 'location drags in what it connects to');
  });

  it('honors explicit entityIds with the highest weight', () => {
    const matched = retrieveEntities(state, '完全无关的一行大纲', {
      entityIds: ['ch_elder']
    });
    const elder = matched.find((m) => m.entity.id === 'ch_elder');
    assert.ok(elder);
    assert.equal(elder!.score, 10);
    assert.ok(elder!.reasons.includes('调用方显式指定'));
  });

  it('breaks score ties: characters before items before locations', () => {
    const matched = retrieveEntities(state, '李四擦拭玄铁剑，望向青云山顶', { maxEntities: 5 });
    // 张三(3: owner+friend of 李四), 李四(3), 玄铁剑(3) and 青云山顶(3) all tie;
    // ties break by kind rank, then by name.
    const topKinds = matched.slice(0, 4).map((m) => m.entity.kind);
    assert.deepEqual(topKinds, ['character', 'character', 'item', 'location']);
    const swordIdx = matched.findIndex((m) => m.entity.id === 'item_sword');
    const peakIdx = matched.findIndex((m) => m.entity.id === 'loc_peak');
    assert.ok(swordIdx < peakIdx, 'items outrank locations on ties');
  });

  it('caps results at maxEntities', () => {
    const matched = retrieveEntities(state, '张三 李四 云长老 雾谷 青云山顶 玄铁剑 张少侠', {
      maxEntities: 2
    });
    assert.ok(matched.length <= 2);
  });
});

/* -------------------------------------------------------------- *
 * Foreshadow retrieval
 * -------------------------------------------------------------- */

describe('retrieveForeshadows', () => {
  const state = makeState();

  it('only returns pending threads planted at or before the as-of chapter', () => {
    const out = retrieveForeshadows(state, '无关文字', new Set(), 2);
    const ids = out.map((f) => f.id);
    assert.ok(!ids.includes('f_resolved'), 'resolved threads never come back');
    assert.ok(!ids.includes('f_future'), 'threads planted in a future chapter are invisible');
    assert.ok(ids.includes('f_sword'));
    assert.ok(ids.includes('f_elder'));
  });

  it('boosts threads bound to matched entities and threads echoed by the outline', () => {
    const bound = retrieveForeshadows(state, '月光', new Set(['item_sword']), 2);
    const echo = retrieveForeshadows(state, '玄铁剑发出低鸣，裂纹如故', new Set(), 2);
    assert.equal(bound[0]!.id, 'f_sword');
    assert.equal(echo[0]!.id, 'f_sword', 'bigram overlap with the outline wins');
  });

  it('ranks high importance above medium on otherwise equal scores', () => {
    const out = retrieveForeshadows(state, '无关文字', new Set(), 2);
    const sword = out.findIndex((f) => f.id === 'f_sword');
    const elder = out.findIndex((f) => f.id === 'f_elder');
    assert.ok(sword >= 0 && elder >= 0);
    assert.ok(sword < elder, 'importance is the tiebreaker');
  });

  it('caps at maxForeshadows', () => {
    const out = retrieveForeshadows(state, '无关文字', new Set(), 2, { maxForeshadows: 1 });
    assert.equal(out.length, 1);
  });
});

/* -------------------------------------------------------------- *
 * Prompt rendering
 * -------------------------------------------------------------- */

describe('prompt rendering', () => {
  const state = makeState();
  const events = [beatEvent(1, '张三入谷'), beatEvent(2, '雾中逢敌')];

  function render() {
    return renderSections({
      meta: { name: '测试小说', createdAt: 't', updatedAt: 't' },
      chapter: 3,
      asOfChapter: 2,
      state,
      characters: [state.entities.ch_zhang as CharacterEntity],
      locations: [state.entities.loc_mist as LocationEntity],
      items: [state.entities.item_sword as ItemEntity],
      foreshadowing: [state.foreshadows.f_sword!],
      recentEvents: events,
      warnings: [],
      options: { locale: 'zh', extraRules: [], includeWritingRules: true }
    });
  }

  it('emits header, world sections, and rules with stable keys', () => {
    const sections = render();
    assert.deepEqual(
      sections.map((s) => s.key),
      ['header', 'characters', 'locations', 'items', 'foreshadowing', 'timeline', 'rules']
    );
  });

  it('renders the character section with live dynamic state', () => {
    const prompt = renderSystemPrompt(render());
    assert.ok(prompt.includes('张三'));
    assert.ok(prompt.includes('情绪：警惕'));
    assert.ok(prompt.includes('有伤：true'), 'dynamic attributes appear as verifiable facts');
    assert.ok(prompt.includes('雾谷'), 'current location is resolved by name');
    assert.ok(prompt.includes('玄铁剑'));
    assert.ok(prompt.includes('状态截至第 2 章'));
  });

  it('formats values readably', () => {
    assert.equal(formatValue(null), '无');
    assert.equal(formatValue(true), 'true');
    assert.equal(formatValue([1, 2]), '1、2');
    assert.equal(formatValue({ a: 1 }), '{"a":1}');
  });

  it('estimates tokens: cjk chars cost one each', () => {
    assert.equal(estimateTokens('雾谷'), 2);
    assert.ok(estimateTokens('abcd') === 1);
    assert.equal(estimateTokens(''), 0);
  });
});

describe('trimToTokenBudget', () => {
  const state = makeState();

  function sections() {
    return renderSections({
      meta: { name: '测试小说', createdAt: 't', updatedAt: 't' },
      chapter: 3,
      asOfChapter: 2,
      state,
      characters: [state.entities.ch_zhang as CharacterEntity],
      locations: [state.entities.loc_mist as LocationEntity],
      items: [state.entities.item_sword as ItemEntity],
      foreshadowing: [state.foreshadows.f_sword!],
      recentEvents: [beatEvent(1, '张三入谷')],
      warnings: [],
      options: { locale: 'zh', extraRules: [], includeWritingRules: true }
    });
  }

  it('keeps everything when the budget is generous', () => {
    const all = sections();
    const { sections: kept, dropped } = trimToTokenBudget(all, 10_000);
    assert.equal(kept.length, all.length);
    assert.deepEqual(dropped, []);
  });

  it('drops droppable sections in priority order and keeps canon sections', () => {
    const all = sections();
    const fullCost = estimateTokens(renderSystemPrompt(all));
    const { sections: kept, dropped } = trimToTokenBudget(all, 40);
    assert.ok(dropped.length > 0, 'a tight budget must drop something, even in chinese');
    assert.ok(kept.some((s) => s.key === 'header'), 'header survives');
    assert.ok(kept.some((s) => s.key === 'rules'), 'writing rules survive');
    assert.ok(estimateTokens(renderSystemPrompt(kept)) <= Math.max(40, fullCost));
    assert.ok(dropped.includes('## 时间线脉络（最近发生）'), 'timeline is trimmed first');
  });

  it('never drops the always-kept sections', () => {
    const { sections: kept } = trimToTokenBudget(sections(), 1);
    for (const s of kept) assert.ok(!s.droppable, 'only non-droppable sections remain');
  });
});

/* -------------------------------------------------------------- *
 * ContextExtractor end-to-end
 * -------------------------------------------------------------- */

describe('ContextExtractor', () => {
  it('detects the target chapter and reads the world as of the previous chapter', () => {
    const state = makeState();
    const extractor = new ContextExtractor(fakeSource(state));
    const ctx = extractor.extract('第三章 张三在雾谷中擦拭玄铁剑');
    assert.equal(ctx.chapter, 3);
    assert.equal(ctx.asOfChapter, 2);
    assert.equal(ctx.outline, '第三章 张三在雾谷中擦拭玄铁剑');
  });

  it('lets options.chapter override the detected chapter', () => {
    const extractor = new ContextExtractor(fakeSource(makeState()));
    const ctx = extractor.extract('第三章 张三在雾谷', { chapter: 8 });
    assert.equal(ctx.chapter, 8);
    assert.equal(ctx.asOfChapter, 7);
  });

  it('falls back to highestChapter when the outline names no chapter', () => {
    const extractor = new ContextExtractor(fakeSource(makeState()));
    const ctx = extractor.extract('张三在雾谷中擦拭玄铁剑');
    assert.equal(ctx.chapter, 2);
    assert.equal(ctx.asOfChapter, 1);
  });

  it('recalls exactly the entities the outline is about', () => {
    const extractor = new ContextExtractor(fakeSource(makeState()));
    const ctx = extractor.extract('张三走进雾谷，玄铁剑低鸣');
    const ids = ctx.matchedEntities.map((m) => m.entity.id);
    assert.ok(ids.includes('ch_zhang'));
    assert.ok(ids.includes('loc_mist'));
    assert.ok(ids.includes('item_sword'));
    assert.equal(ctx.characters[0]!.id, 'ch_zhang');
    assert.ok(ctx.systemPrompt.includes('张三'));
    assert.ok(ctx.systemPrompt.includes('玄铁剑'));
    assert.ok(ctx.estimatedTokens > 0);
  });

  it('surfaces open foreshadows and filters resolved ones', () => {
    const extractor = new ContextExtractor(fakeSource(makeState()));
    const ctx = extractor.extract('第三章 雾谷 玄铁剑 云长老');
    const ids = ctx.foreshadowing.map((f) => f.id);
    assert.ok(ids.includes('f_sword'));
    assert.ok(ids.includes('f_elder'));
    assert.ok(!ids.includes('f_resolved'));
    assert.ok(ctx.systemPrompt.includes('前文伏笔'));
  });

  it('warns when the outline matches nothing', () => {
    const extractor = new ContextExtractor(fakeSource(makeState()));
    const ctx = extractor.extract('完全陌生的角色在陌生的地方做陌生的事');
    assert.equal(ctx.matchedEntities.length, 0);
    assert.ok(ctx.warnings.some((w) => w.includes('未匹配到任何')));
  });

  it('warns about stale foreshadows left uncollected too long', () => {
    const state = makeState();
    state.foreshadows['f_old'] = {
      id: 'f_old',
      description: '十年前的旧信',
      chapter: 1,
      importance: 'high',
      status: 'pending'
    };
    state.highestChapter = 8;
    const extractor = new ContextExtractor(fakeSource(state));
    const ctx = extractor.extract('第九章 山雨欲来', { chapter: 9 });
    assert.ok(ctx.warnings.some((w) => w.includes('旧信') && w.includes('未回收')));
  });

  it('includes recent events the model must stay consistent with', () => {
    const events = [beatEvent(1, '张三入谷'), beatEvent(2, '雾中逢敌')];
    const extractor = new ContextExtractor(fakeSource(makeState(), events));
    const ctx = extractor.extract('第三章 雾散', { chapter: 3 });
    assert.equal(ctx.recentEvents.length, 2);
    assert.ok(ctx.systemPrompt.includes('雾中逢敌'));
  });

  it('honors a tight token budget by trimming, not by truncating facts', () => {
    const events = [beatEvent(1, '张三入谷')];
    const extractor = new ContextExtractor(fakeSource(makeState(), events));
    const ctx = extractor.extract('张三在雾谷', { tokenBudget: 30 });
    assert.ok(ctx.droppedSections.length > 0);
    assert.ok(ctx.estimatedTokens <= 30 || ctx.droppedSections.length >= 4);
  });

  it('disables recent events when asked', () => {
    const events = [beatEvent(1, '张三入谷')];
    const extractor = new ContextExtractor(fakeSource(makeState(), events));
    const ctx = extractor.extract('张三在雾谷', { recentEvents: 0 });
    assert.equal(ctx.recentEvents.length, 0);
  });

  it('renders an english prompt when locale is en', () => {
    const extractor = new ContextExtractor(fakeSource(makeState()));
    const ctx = extractor.extract('Chapter 3: Zhang San in the fog valley', { locale: 'en' });
    assert.ok(ctx.systemPrompt.includes('Writing Context'));
    assert.ok(ctx.systemPrompt.includes('Character Current State'));
  });

  it('appends extra rules to the writing-constraints section', () => {
    const extractor = new ContextExtractor(fakeSource(makeState()));
    const ctx = extractor.extract('张三在雾谷', {
      extraRules: ['6. 本章字数不少于 4000。']
    });
    assert.ok(ctx.systemPrompt.includes('6. 本章字数不少于 4000。'));
    assert.ok(ctx.sections.some((s) => s.key === 'rules'));
  });
});
