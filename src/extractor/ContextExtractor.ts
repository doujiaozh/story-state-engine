import type { EngineState, ProjectMeta, StoryEvent } from '../types.js';
import { staleForeshadows } from '../state.js';
import { summarizeEvent } from '../timeline.js';
import type { Entity } from '../types.js';
import { parseOutline } from './outline.js';
import { retrieveEntities, retrieveForeshadows } from './retrieval.js';
import {
  estimateTokens,
  renderSections,
  renderSystemPrompt,
  trimToTokenBudget,
  type RenderInput
} from './prompt.js';
import type { ExtractContextOptions, ExtractedContext, ScoredEntity } from './types.js';

/**
 * What the extractor needs from its host. `StoryEngine` implements this; tests
 * may pass a fake. Keeping the seam explicit means the extraction pipeline —
 * the library's most subtle logic — stays testable without a full engine.
 */
export interface ExtractionSource {
  getStateAtChapter(chapter: number): EngineState;
  getMeta(): ProjectMeta;
  recentEvents(upToChapter: number, limit: number): StoryEvent[];
}

const DEFAULTS = {
  maxEntities: 12,
  maxForeshadows: 10,
  recentEvents: 10,
  tokenBudget: 4000,
  locale: 'zh' as const,
  extraRules: [] as string[],
  includeWritingRules: true
};

/**
 * The Dynamic Context Extractor.
 *
 * Input: the outline fragment of the chapter about to be written.
 * Output: a structured `ExtractedContext` plus a ready-to-use system prompt
 * that contains the *relevant, current, verifiable* world state — and nothing
 * else. This is the mechanism that keeps a 300-chapter novel inside a fixed
 * context window without flattening it into lossy summaries.
 */
export class ContextExtractor {
  private readonly source: ExtractionSource;

  constructor(source: ExtractionSource) {
    this.source = source;
  }

  extract(outline: string, options: ExtractContextOptions = {}): ExtractedContext {
    const opts = { ...DEFAULTS, ...options };
    const cues = parseOutline(outline);

    const chapter = Math.max(
      1,
      opts.chapter ?? cues.chapter ?? this.source.getStateAtChapter(0).highestChapter
    );
    const asOfChapter = Math.max(0, chapter - 1);

    // The snapshot of the world "as of the end of the previous chapter".
    const state = this.source.getStateAtChapter(asOfChapter);

    // 1. Which entities does this outline actually care about?
    const matched: ScoredEntity[] = retrieveEntities(state, cues.normalized, {
      entityIds: opts.entityIds,
      maxEntities: opts.maxEntities
    });
    const matchedIds = new Set(matched.map((m) => m.entity.id));

    // 2. Which open threads belong in the prompt?
    const foreshadowing = retrieveForeshadows(state, cues.raw, matchedIds, asOfChapter, {
      maxForeshadows: opts.maxForeshadows
    });

    // 3. What recently happened the model must stay consistent with?
    const recent = opts.recentEvents > 0 ? this.source.recentEvents(asOfChapter, opts.recentEvents) : [];

    // 4. Warnings — the engine's job is to make latent problems loud.
    const warnings: string[] = [];
    if (matched.length === 0) {
      warnings.push('大纲未匹配到任何已登记的角色/地点/物品，请确认是否为全新场景。');
    }
    for (const f of staleForeshadows(state, asOfChapter, 5)) {
      warnings.push(`伏笔「${f.description}」自第 ${f.chapter} 章埋下，已 ${asOfChapter - f.chapter} 章未回收。`);
    }

    // 5. Split matched entities by kind (characters first, per ranking).
    const byKind = (kind: Entity['kind']) =>
      matched
        .filter((m) => m.entity.kind === kind)
        .map((m) => m.entity) as ExtractedContext['characters'];

    const renderInput: RenderInput = {
      meta: this.source.getMeta(),
      chapter,
      asOfChapter,
      state,
      characters: byKind('character'),
      locations: byKind('location'),
      items: byKind('item'),
      foreshadowing,
      recentEvents: recent,
      warnings,
      options: {
        locale: opts.locale,
        extraRules: opts.extraRules,
        includeWritingRules: opts.includeWritingRules
      }
    };

    const sections = renderSections(renderInput);
    const { sections: kept, dropped } = trimToTokenBudget(sections, opts.tokenBudget);
    const systemPrompt = renderSystemPrompt(kept);
    const recentWithSummary = recent.filter((e) => summarizeEvent(e) !== null);

    return {
      outline,
      chapter,
      asOfChapter,
      matchedEntities: matched,
      characters: renderInput.characters,
      locations: renderInput.locations,
      items: renderInput.items,
      foreshadowing,
      recentEvents: recentWithSummary,
      warnings,
      sections: kept,
      droppedSections: dropped,
      systemPrompt,
      estimatedTokens: estimateTokens(systemPrompt)
    };
  }
}
