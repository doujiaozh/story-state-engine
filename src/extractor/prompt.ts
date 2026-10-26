import type {
  CharacterEntity,
  EngineState,
  Entity,
  Foreshadow,
  ItemEntity,
  Json,
  LocationEntity,
  ProjectMeta,
  StoryEvent
} from '../types.js';
import { summarizeEvent } from '../timeline.js';
import type { ExtractContextOptions, PromptSection, SectionKey } from './types.js';

type Locale = 'zh' | 'en';

interface Dictionary {
  titleProject: (name: string, chapter: number, asOf: number) => string;
  premise: string;
  characters: (asOf: number) => string;
  locations: string;
  items: string;
  foreshadowing: string;
  timeline: string;
  warnings: string;
  rules: string;
  emptyCharacters: string;
  emptyLocations: string;
  emptyItems: string;
  emptyForeshadowing: string;
  emptyTimeline: string;
  role: Record<string, string>;
  location: string;
  unknownLocation: string;
  relationships: string;
  noRelationships: string;
  atmosphere: string;
  connections: string;
  present: string;
  carrier: string;
  foundAt: string;
  none: string;
  chapterPrefix: (n: number) => string;
  importance: Record<string, string>;
  boundTo: (name: string) => string;
  rulesText: string[];
  warningPrefix: string;
}

const DICT: Record<Locale, Dictionary> = {
  zh: {
    titleProject: (name, chapter, asOf) =>
      `# 小说《${name}》写作上下文（目标：第 ${chapter} 章；状态截至第 ${asOf} 章）`,
    premise: '故事前提',
    characters: (asOf) => `## 角色当前状态（截至第 ${asOf} 章）`,
    locations: '## 相关地点设定',
    items: '## 关键物品',
    foreshadowing: '## 前文伏笔（尚未回收，请推进或计划回收）',
    timeline: '## 时间线脉络（最近发生）',
    warnings: '## ⚠ 一致性提醒',
    rules: '## 写作约束（一致性红线）',
    emptyCharacters: '（暂无已登记角色）',
    emptyLocations: '（暂无相关地点）',
    emptyItems: '（暂无相关物品）',
    emptyForeshadowing: '（当前没有待回收伏笔）',
    emptyTimeline: '（暂无事件）',
    role: {
      protagonist: '主角',
      deuteragonist: '双主角',
      antagonist: '反派',
      supporting: '配角',
      minor: '龙套'
    },
    location: '位置',
    unknownLocation: '未设定',
    relationships: '人际关系',
    noRelationships: '无',
    atmosphere: '氛围',
    connections: '相连地点',
    present: '当前在场',
    carrier: '持有者',
    foundAt: '所在地点',
    none: '无',
    chapterPrefix: (n) => `第 ${n} 章`,
    importance: { high: '高', medium: '中', low: '低' },
    boundTo: (name) => `（关联：${name}）`,
    warningPrefix: '⚠',
    rulesText: [
      '1. 严格遵循以上「角色当前状态」「关键物品」「地点设定」，不得与既定设定冲突；如果情节需要违背，必须先由上层应用通过引擎变更状态。状态即事实。',
      '2. 上文列出的「前文伏笔」必须在合理章节内回收或推进；禁止当它们不存在。',
      '3. 事件顺序必须与「时间线脉络」一致，禁止制造时间上的自相矛盾。',
      '4. 本章新登场的人物、地点、物品与状态变化，请只作为提案输出给上层应用，由应用写回引擎后方可视为正史。',
      '5. 保持人物言行与其属性（情绪、伤势、关系）一致；角色不知道伏笔中尚未揭示给他的信息。'
    ]
  },
  en: {
    titleProject: (name, chapter, asOf) =>
      `# Novel "${name}" — Writing Context (target: chapter ${chapter}; state as of chapter ${asOf})`,
    premise: 'Premise',
    characters: (asOf) => `## Character Current State (as of chapter ${asOf})`,
    locations: '## Relevant Locations',
    items: '## Key Items',
    foreshadowing: '## Open Foreshadowing (must be advanced or planned)',
    timeline: '## Recent Timeline',
    warnings: '## ⚠ Consistency Notes',
    rules: '## Writing Constraints (hard canon rules)',
    emptyCharacters: '(no registered characters yet)',
    emptyLocations: '(no relevant locations)',
    emptyItems: '(no relevant items)',
    emptyForeshadowing: '(no open threads right now)',
    emptyTimeline: '(no events yet)',
    role: {
      protagonist: 'protagonist',
      deuteragonist: 'deuteragonist',
      antagonist: 'antagonist',
      supporting: 'supporting',
      minor: 'minor'
    },
    location: 'Location',
    unknownLocation: 'unset',
    relationships: 'Relationships',
    noRelationships: 'none',
    atmosphere: 'Atmosphere',
    connections: 'Connected to',
    present: 'Present here',
    carrier: 'Carried by',
    foundAt: 'Found at',
    none: 'none',
    chapterPrefix: (n) => `Chapter ${n}`,
    importance: { high: 'high', medium: 'medium', low: 'low' },
    boundTo: (name) => `(bound to: ${name})`,
    warningPrefix: '!',
    rulesText: [
      '1. Follow the character, item and location states above strictly. Canon is state, not memory; changing it requires the host app to commit a change through the engine first.',
      '2. Every open foreshadowing thread above must be advanced or given a plan in a reasonable chapter. Never silently drop a thread.',
      '3. Event order must match the recent timeline. No anachronistic contradictions.',
      '4. New characters, places, items and state changes proposed in this chapter are proposals only: the host app must write them back through the engine before they are canon.',
      '5. Keep behavior consistent with attributes (mood, wounds, relationships). Characters do not know information that foreshadowing has not yet revealed to them.'
    ]
  }
};

/* ------------------------------------------------------------------ *
 * Value formatting
 * ------------------------------------------------------------------ */

export function formatValue(value: Json): string {
  if (value === null || value === undefined) return '无';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => formatValue(v)).join('、');
  return JSON.stringify(value);
}

/** Rough token estimate: 1 token per CJK char, ~4 latin chars per token. */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/.test(ch)) cjk += 1;
    else if (/\S/.test(ch)) other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

export interface RenderInput {
  meta: ProjectMeta;
  chapter: number;
  asOfChapter: number;
  state: EngineState;
  characters: CharacterEntity[];
  locations: LocationEntity[];
  items: ItemEntity[];
  foreshadowing: Foreshadow[];
  recentEvents: StoryEvent[];
  warnings: string[];
  options: Required<Pick<ExtractContextOptions, 'locale' | 'extraRules' | 'includeWritingRules'>>;
}

function entityName(state: EngineState, id: string | undefined): string | undefined {
  if (!id) return undefined;
  const e = state.entities[id];
  return e ? e.name : undefined;
}

export function renderSections(input: RenderInput): PromptSection[] {
  const d = DICT[input.options.locale];
  const sections: PromptSection[] = [];
  const state = input.state;

  // Title + premise
  const head: string[] = [d.titleProject(input.meta.name, input.chapter, input.asOfChapter)];
  if (input.meta.premise) head.push(`**${d.premise}**：${input.meta.premise}`);
  sections.push({ key: 'header', title: 'header', body: head.join('\n'), droppable: false });

  // Characters
  const charLines: string[] = [];
  for (const c of input.characters) {
    charLines.push(`### ${c.name}（${d.role[c.role] ?? c.role}）`);
    if (c.aliases.length > 0) charLines.push(`- 别名：${c.aliases.join('、')}`);
    const where = entityName(state, c.attributes.locationId as string | undefined);
    charLines.push(`- ${d.location}：${where ?? d.unknownLocation}`);
    for (const [key, value] of Object.entries(c.attributes)) {
      if (key === 'locationId') continue;
      charLines.push(`- ${key}：${formatValue(value)}`);
    }
    const rels = c.relationships
      .map((r) => `${entityName(state, r.entityId) ?? r.entityId}（${r.type}）`)
      .join('、');
    charLines.push(`- ${d.relationships}：${rels || d.noRelationships}`);
    charLines.push('');
  }
  sections.push({
    key: 'characters',
    title: d.characters(input.asOfChapter),
    body: charLines.length > 0 ? charLines.join('\n').trimEnd() : d.emptyCharacters,
    droppable: true
  });

  // Locations
  const locLines: string[] = [];
  for (const loc of input.locations) {
    locLines.push(`### ${loc.name}`);
    if (loc.description) locLines.push(loc.description);
    if (loc.atmosphere) locLines.push(`- ${d.atmosphere}：${loc.atmosphere}`);
    const conns = loc.connections
      .map((id) => entityName(state, id))
      .filter(Boolean)
      .join('、');
    if (conns) locLines.push(`- ${d.connections}：${conns}`);
    const present = Object.values(state.entities)
      .filter((e) => e.kind === 'character' && e.attributes.locationId === loc.id)
      .map((e) => e.name)
      .join('、');
    if (present) locLines.push(`- ${d.present}：${present}`);
    locLines.push('');
  }
  sections.push({
    key: 'locations',
    title: d.locations,
    body: locLines.length > 0 ? locLines.join('\n').trimEnd() : d.emptyLocations,
    droppable: true
  });

  // Items
  const itemLines: string[] = [];
  for (const item of input.items) {
    itemLines.push(`### ${item.name}`);
    if (item.description) itemLines.push(item.description);
    const owner = entityName(state, item.ownerId);
    if (owner) itemLines.push(`- ${d.carrier}：${owner}`);
    const at = entityName(state, item.locationId);
    if (at) itemLines.push(`- ${d.foundAt}：${at}`);
    for (const [key, value] of Object.entries(item.attributes)) {
      itemLines.push(`- ${key}：${formatValue(value)}`);
    }
    itemLines.push('');
  }
  sections.push({
    key: 'items',
    title: d.items,
    body: itemLines.length > 0 ? itemLines.join('\n').trimEnd() : d.emptyItems,
    droppable: true
  });

  // Foreshadowing
  const fLines: string[] = [];
  input.foreshadowing.forEach((f, i) => {
    const parts = [
      `${i + 1}. 【${d.chapterPrefix(f.chapter)} · ${d.importance[f.importance]}】${f.description}`
    ];
    const bound = entityName(state, f.entityId);
    if (bound) parts.push(`   ${d.boundTo(bound)}`);
    fLines.push(parts.join('\n'));
  });
  sections.push({
    key: 'foreshadowing',
    title: d.foreshadowing,
    body: fLines.length > 0 ? fLines.join('\n') : d.emptyForeshadowing,
    droppable: true
  });

  // Recent timeline
  const tLines = input.recentEvents
    .map((e) => {
      const summary = summarizeEvent(e) ?? e.type;
      return `- ${d.chapterPrefix(e.chapter)}${e.scene ? `·${e.scene}` : ''}：${summary}`;
    })
    .filter(Boolean);
  sections.push({
    key: 'timeline',
    title: d.timeline,
    body: tLines.length > 0 ? tLines.join('\n') : d.emptyTimeline,
    droppable: true
  });

  // Warnings
  if (input.warnings.length > 0) {
    sections.push({
      key: 'warnings',
      title: d.warnings,
      body: input.warnings.map((w) => `${d.warningPrefix} ${w}`).join('\n'),
      droppable: false
    });
  }

  // Writing rules
  if (input.options.includeWritingRules) {
    const rules = [...d.rulesText, ...input.options.extraRules];
    sections.push({ key: 'rules', title: d.rules, body: rules.join('\n'), droppable: false });
  }

  return sections;
}

export function renderSystemPrompt(sections: PromptSection[]): string {
  return sections.map((s) => (s.title === 'header' ? s.body : `${s.title}\n${s.body}`)).join('\n\n');
}

/* ------------------------------------------------------------------ *
 * Budget trimming
 * ------------------------------------------------------------------ */

const DROP_PRIORITY: SectionKey[] = ['timeline', 'items', 'locations', 'foreshadowing', 'characters'];

export function trimToTokenBudget(
  sections: PromptSection[],
  budget: number
): { sections: PromptSection[]; dropped: string[] } {
  const dropped: string[] = [];
  const kept = [...sections];
  let cost = estimateTokens(renderSystemPrompt(kept));
  for (const marker of DROP_PRIORITY) {
    while (cost > budget) {
      const idx = kept.findIndex((s) => s.droppable && s.key === marker);
      if (idx < 0) break;
      dropped.push(kept[idx]!.title);
      kept.splice(idx, 1);
      cost = estimateTokens(renderSystemPrompt(kept));
    }
  }
  return { sections: kept, dropped };
}
