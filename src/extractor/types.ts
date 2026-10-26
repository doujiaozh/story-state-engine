import type { Entity, Foreshadow, StoryEvent } from '../types.js';

/** Options controlling one context-extraction call. */
export interface ExtractContextOptions {
  /** Chapter the outline asks the LLM to write; auto-detected when omitted. */
  chapter?: number;
  /** Force-include these entity ids regardless of outline matching. */
  entityIds?: string[];
  /** Max entities surfaced in the prompt (default 12). */
  maxEntities?: number;
  /** Max pending foreshadows surfaced (default 10). */
  maxForeshadows?: number;
  /** Number of recent story beats included (default 10, set 0 to disable). */
  recentEvents?: number;
  /** Soft token budget for the rendered prompt (default 4000). */
  tokenBudget?: number;
  /** Prompt language: 'zh' (default) or 'en'. */
  locale?: 'zh' | 'en';
  /** Extra lines appended to the writing-rules section. */
  extraRules?: string[];
  /** Include the engine's consistency rules (default true). */
  includeWritingRules?: boolean;
}

/** Stable, locale-independent identity of a prompt section. */
export type SectionKey =
  | 'header'
  | 'characters'
  | 'locations'
  | 'items'
  | 'foreshadowing'
  | 'timeline'
  | 'warnings'
  | 'rules';

export interface PromptSection {
  /** Stable key used for budget trimming; never changes with locale. */
  key: SectionKey;
  /** Human-readable, localized title shown in the prompt. */
  title: string;
  body: string;
  /** Why this section exists; used for budget trimming diagnostics. */
  droppable?: boolean;
}

export interface ScoredEntity {
  entity: Entity;
  score: number;
  reasons: string[];
}

/** The result of one extraction: full transparency about what was recalled. */
export interface ExtractedContext {
  /** The outline that was analysed. */
  outline: string;
  /** Chapter the prompt targets. */
  chapter: number;
  /** State was read "as of the end of chapter N" — always chapter - 1. */
  asOfChapter: number;
  /** Every entity considered relevant, best first, with the evidence. */
  matchedEntities: ScoredEntity[];
  characters: Entity[];
  locations: Entity[];
  items: Entity[];
  foreshadowing: Foreshadow[];
  recentEvents: StoryEvent[];
  warnings: string[];
  sections: PromptSection[];
  /** Sections dropped to respect the token budget. */
  droppedSections: string[];
  /** The final, ready-to-use system prompt. */
  systemPrompt: string;
  /** Rough token estimate of `systemPrompt`. */
  estimatedTokens: number;
}
