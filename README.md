# story-state-engine

> 为长篇 AI 小说创作打造的「上下文与状态管理引擎」——让 LLM 写到第 30 章时，仍然记得第 1 章设定的一切。

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](./package.json)
[![Tests](https://img.shields.io/badge/tests-126%20passing-brightgreen.svg)](#测试)

**TypeScript** 编写，**零运行时依赖**，**不调用任何 LLM API**。它是引擎底座：上层应用（你的写作助手、你的 AI 小说产品）基于它来组装一份**精确、可验证**的上下文，再喂给大模型。

---

## 痛点：为什么 AI 写长篇必定「30 章崩」？

现在的 LLM 写短篇小说很惊艳，但一旦写长篇，几乎必然出现以下崩溃模式：

| 崩溃现象 | 根因 |
| --- | --- |
| **遗忘设定**：第 3 章设定的「玄铁剑只有张家的血脉能拔出」，第 25 章「李四随手拔出玄铁剑」 | 总字数远超上下文窗口，早期设定被挤出窗口 |
| **吃书**：第 2 章张三左臂有伤，第 10 章生龙活虎地双刀对敌 | 状态以**自然语言**存在于正文里，没有任何结构化记录 |
| **人设崩塌**：张三从「寡言」变成「话痨」，李四从「挚友」变成「路人」 | 没有「角色当前状态」的权威来源 |
| **伏笔烂尾**：第 1 章埋的「家徽之谜」，写到结局也没回收 | 没有伏笔跟踪机制，写后即忘 |
| **时间线错乱**：第 5 章出现第 8 章才发生的事 | 剧情推进依赖模型对正文的记忆 |

### 核心洞见

**小说正文不适合作为状态存储。** 正文是给人看的，不是给机器查的。解决方案不是「更大的上下文窗口」，而是**换一种数据结构**：

> 把「世界状态」从正文里抽出来，变成**结构化数据 + 事件日志**；写每一章前，用检索引擎而不是全文粘贴，精确生成这一章所需的上下文。

这正是 story-state-engine 做的事。

---

## 架构：事件溯源（Event Sourcing）的小型实践

引擎采用**事件溯源**架构——这与大型应用（如金融系统）管理状态的思路一致，但对小说世界做了特化：

```
应用层（你的写作 APP）
        │  StoryEngine 门面（唯一入口）
        ▼
┌───────────────────────────────────────────────┐
│  事件日志 Timeline          实体状态 Entity     │
│  （唯一真相源）    ──投影──▶  （角色/地点/物品） │
│        │                          ▲            │
│        │                          │ 检索        │
│        ▼                          │            │
│  伏笔 Foreshadow ────────────────┘            │
│        │                                       │
│        ▼                                       │
│  动态上下文提取器 ──▶ System Prompt ──▶ 你的 LLM │
└───────────────────────────────────────────────┘
        │
        ▼
  纯本地持久化（JSON / SQLite，支持多端存档槽）
```

**三个设计决策，各解决一类崩溃：**

1. **事件日志是唯一真相源（Single Source of Truth）**
   所有状态变更必须以**事件**形式追加到时间线（`character/moved`、`entity/property-set`、`foreshadow/planted`…），按章节排序。**不存在日志之外的变更**——因此任何时刻的世界状态都可以**重放日志**精确复现。这消灭了「吃书」：状态是什么，查日志就知道，不依赖模型记忆。

2. **实体状态是日志的纯函数投影（Projection）**
   `世界状态 = projectState(事件日志)`。角色「张三当前是否有伤、在哪个地点、情绪如何」全部是结构化字段。想要第 7 章开头时的世界状态？重放前 6 章的事件即可——**时间旅行**式的状态查询，消灭时间线错乱。

3. **上下文是检索出来的，不是粘贴出来的（Dynamic Context Extractor）**
   写第 N 章前，输入该章**大纲片段**，引擎自动检索出：与之相关的**角色当前状态**（截至第 N-1 章的快照）、**相关地点设定**、**待回收的伏笔**、**近期时间线节拍**，渲染成一份结构化 System Prompt。**相关性由检索决定，而非由窗口大小决定**——即使写到第 300 章，喂给模型的仍是精确的一小段上下文。

---

## 快速开始

### 安装

```bash
git clone https://github.com/doujiaozh/story-state-engine.git
cd story-state-engine
npm install
```

> 需要 Node.js ≥ 18。SQLite 存储需要 Node ≥ 22.5（使用内置 `node:sqlite`，零原生依赖）；Node < 22 时使用 JSON 存储即可。

### 三分钟演示

```bash
npm run demo
```

`demo.ts` 完整演示了交付要求中的流程：创建角色 → 推进两章剧情（改变角色状态）→ 输入第三章大纲 → 提取出上下文 Prompt。核心代码：

```typescript
import { StoryEngine, JsonStore } from 'story-state-engine';

// 1. 打开（或创建）项目，纯本地持久化
const store = new JsonStore({ filePath: './demo-out/novel.story.json' });
const engine = await StoryEngine.open(store, { name: '雾中纪' });

// 2. 定义世界：角色、地点、物品
engine.createCharacter({ name: '张三', role: 'protagonist' });
engine.createLocation({ name: '藏剑阁', connections: ['青云山'] });
engine.createItem({ name: '玄铁剑', ownerId: 'ch_xxx' });

// 3. 推进剧情：所有变更都是事件，世界状态始终可复现
engine.startChapter(1, { title: '入山' });
engine.moveCharacter('ch_zhang', 'loc_swordhall');
engine.setProperty('ch_zhang', '有伤', true);             // 动态属性
engine.plantForeshadow('剑匣上的张家家徽', { entityId: 'item_sword' });
engine.startChapter(2, { title: '夜谈' });
engine.deleteProperty('ch_zhang', '有伤');                 // 伤势痊愈

await engine.save();                                       // 主存档
await engine.saveSlot('device-laptop');                    // 多端存档槽

// 4. 写第三章前：输入大纲，引擎自动检索出精确上下文
const ctx = engine.extractContext('第三章 张三与李四在藏剑阁夜话，家徽之谜浮现');

console.log(ctx.systemPrompt);
// 《雾中纪》写作上下文（目标：第 3 章；状态截至第 2 章）
// ## 角色当前状态
// - 张三（主角）：位于「藏剑阁」；情绪：警惕；人际关系：李四（挚友）
// ## 相关地点
// ## 前文伏笔（务必回收）
// - 剑匣上的张家家徽（第 1 章埋下，高重要性）
// ## 时间线脉络 ...
// ## ⚠ 写作一致性红线 ...

// 把 ctx.systemPrompt 作为 system 消息发给任意 LLM：
const reply = await yourLLM.chat([
  { role: 'system', content: ctx.systemPrompt },
  { role: 'user', content: '第三章大纲：张三与李四在藏剑阁夜话……' }
]);
```

### 上游应用的标准接入循环

```
每写一章：
  大纲片段 ──▶ engine.extractContext(outline) ──▶ System Prompt
       │                                          │
       │                                          ▼
       │                                     你的 LLM（ChatGPT/DeepSeek/任意模型）
       │                                          │
       │                                          ▼ 生成正文
       ▼                                     解析新状态变更
  extractContext 返回的 warnings ◀──────── 引擎 record(...) 写回事件日志
  （如「伏笔已 6 章未回收」）              （位置/属性/关系/伏笔/节拍）
```

引擎**不解析正文**（那是上层应用的责任，可结合 LLM function-calling 或人工校对）。引擎负责的是：**存什么、怎么查、怎么不遗忘**。

---

## 核心功能

### 1. 实体状态机（Entity State）

三种实体类型，均有**静态资料**（名字、别名、描述、标签）与**动态属性**（`attributes` 自由 JSON 字段）：

| 类型 | 专属字段 | 典型动态属性 |
| --- | --- | --- |
| `CharacterEntity` | `role`（主角/反派/配角…）、`relationships` | `有伤: true`、`locationId`、`情绪: '警惕'`、`信任度: 8` |
| `LocationEntity` | `connections`（连通地点图）、`atmosphere` | `是否开启: false`、`天气` |
| `ItemEntity` | `ownerId` / `locationId`（持有与放置互斥） | `耐久: 73`、`是否封印` |

特点：

- **动态属性任意扩展**：`setProperty('ch_zhang', '有伤', true)` —— 你的世界里有什么状态，就记什么。
- **引用完整性受保护**：创建物品时 `ownerId` 指向不存在的角色会直接报错；`moveCharacter` 会校验目标地点存在且类型正确。
- **持有与放置互斥**：玄铁剑要么在张三手里（`ownerId`），要么放在藏剑阁（`locationId`），转移时自动清除另一端——消灭「同一把剑同时出现在两个地方」的 bug。

### 2. 时间线图谱（Timeline）

**所有状态变更都必须有事件支持**，按 `章节 → 场景 → 序号` 排序，不依赖普通文本：

```typescript
const events: StoryEvent[] =
  | { type: 'story/chapter-started', chapter: 1, title: '入山' }
  | { type: 'character/moved', entityId: 'ch_zhang', from: 'loc_a', to: 'loc_b' }
  | { type: 'entity/property-set', entityId: 'ch_zhang', property: '有伤', value: true }
  | { type: 'foreshadow/planted', foreshadow: {...} }
  | { type: 'plot/beat', text: '张三在藏剑阁中抚摸剑匣' }   // 自由剧情节拍
  | … 共 14 种事件类型
```

- **重放即复现**：`new StoryEngine({ initialData })` / `loadSlot()` 从日志重建整个世界。
- **乱序回填友好**：补写前文事件时，时间线自动按故事时间排序插入。
- **查询任意时刻**：`engine.getStateAtChapter(7)` —— 第 7 章开头时的完整世界快照。
- **自动摘要**：每个事件都有人类可读的中文摘要（可自定义），构成「时间线脉络」分节。

### 3. 动态上下文提取器（Dynamic Context Extractor）—— 核心卖点

```typescript
const ctx = engine.extractContext(outline, {
  chapter: 3,              // 可选；默认从大纲解析（「第三章」/「chapter 3」），再回退到当前章
  maxEntities: 12,         // 召回实体上限
  maxForeshadows: 10,      // 伏笔上限
  recentEvents: 10,        // 近期事件条数
  tokenBudget: 4000,       // token 预算：超预算时按优先级丢弃低价值分节
  locale: 'zh',            // 或 'en'
  extraRules: ['本章必须出现雨天的描写']  // 追加写作约束
});
```

**检索如何工作**（`ctx.matchedEntities` 里的每项都有 `score` 和 `reasons`，完全白盒）：

- 大纲中**实体名字**命中 +3 分/次，**别名** +2 分/次；
- **一跳图扩展**：匹配到的角色拉入其关系对象（+1.5）、匹配到的地点拉入在场角色（+1.5）与连通地点（+1）、物品拉入持有者与所在地；
- 调用方可**显式指定**实体（`entityIds`，+10 分强制召回）。

**生成的 System Prompt 分节**（稳定 `key`，可逐节裁剪）：

1. `header`——项目名、目标章节、状态截至章节；
2. `characters`——角色**当前**状态（位置、动态属性、人际关系），而非静态设定；
3. `locations` / `items`——相关地点与关键物品；
4. `foreshadowing`——**待回收伏笔**（按重要性排序）；
5. `timeline`——近期剧情节拍；
6. `warnings`——未匹配到实体时的提示、**超过 N 章未回收的伏笔警报**（`staleForeshadows` 主动暴露烂尾风险）；
7. `rules`——五条写作一致性红线（状态即事实、伏笔必须回收、事件顺序一致、新设定需经引擎写回、角色不知晓未揭示信息）。

**Token 预算裁剪**：`trimToTokenBudget` 按 `timeline → items → locations → foreshadowing → characters` 优先级丢弃可丢弃分节，`header` 与 `rules` 永不丢弃。中文/英文提示的 token 估算分别针对 CJK 与拉丁字符做了区分。

### 4. 纯本地持久化 + 多端存档

三种存储后端，实现同一契约（`Store` / `SlotStore`）：

| 后端 | 说明 |
| --- | --- |
| `MemoryStore` | 纯内存，测试与临时会话用 |
| `JsonStore` | 默认。单文件 JSON，**原子写入**（临时文件 + rename），`<file>.slots/` 目录承载命名槽位 |
| `SqliteStore` | 基于 Node 内置 `node:sqlite`（零原生依赖），事务化整体重写，`<path>.slots/` 下每槽位一个 .db |

**多端保存**通过**命名槽位**实现：每个槽位是一份完整的项目快照，可按设备（`device-laptop`、`device-phone`）或剧情分支（`plot-branch-a`）命名，用 `saveSlot` / `loadSlot` 管理。项目文件整体迁移即包含全部槽位。

`schemaVersion` 版本守卫：读取不兼容版本的项目数据时抛出 `SchemaVersionError`。

---

## 测试

126 项单元测试全部通过，覆盖「状态能正确更新」与「能按大纲准确召回」两大交付要求：

```bash
npm test
```

| 测试文件 | 覆盖点 |
| --- | --- |
| `tests/timeline.test.ts` | 事件排序（章节→场景→序号）、乱序回填、边界包含/排除、JSON 往返 |
| `tests/state.test.ts` | **14 种事件的投影**：实体增改删、移动、关系、物品转移/放置、伏笔三态、深拷贝隔离 |
| `tests/entities.test.ts` | 工厂默认值、输入集合拷贝、Registry 只读视图与校验异常 |
| `tests/persistence.test.ts` | 三后端同一套契约：无损往返、覆盖写、槽位增删查、原子写、表结构 |
| `tests/extractor.test.ts` | 中文章节号解析、全角归一、检索评分与图扩展、伏笔过滤、提示渲染、**预算裁剪优先级**、端到端提取 |
| `tests/engine.test.ts` | 门面全链路：章节推进、实体校验、伏笔状态机、视图隔离、存档往返、**按大纲提取完整 Prompt** |

代表性断言（`tests/engine.test.ts`）——证明「按大纲准确召回」：

```typescript
const ctx = engine.extractContext('第三章 张三与李四在藏剑阁夜话，玄铁剑的家徽之谜浮现');
assert.equal(ctx.chapter, 3);
assert.equal(ctx.asOfChapter, 2);                       // 世界快照截至前一章
assert.ok(ids.includes('ch_zhang') && ids.includes('item_sword'));  // 按大纲召回
assert.ok(!ctx.systemPrompt.includes('有伤：true'));   // 第 2 章已痊愈 → 不应出现
```

```bash
npm run typecheck   # tsc --noEmit（src）
npm test            # node --test（全部测试，含 ts-hooks 加载器）
npm run build       # tsc → dist/
npm run demo        # 运行演示
```

---

## 项目结构

```
story-state-engine/
├── src/
│   ├── index.ts                  # 顶层导出桶
│   ├── StoryEngine.ts            # 门面：唯一入口（章节/实体/伏笔/存档/提取）
│   ├── types.ts                  # 领域类型：事件联合、实体、伏笔、ProjectData
│   ├── timeline.ts               # 事件日志：排序、追加、查询
│   ├── state.ts                  # 状态投影：事件 → 世界（纯函数）
│   ├── entities.ts               # 实体工厂 + 只读注册表
│   ├── errors.ts                 # 中文错误的类型体系
│   ├── ids.ts                    # 带前缀的实体 id 生成
│   ├── persistence/              # MemoryStore / JsonStore / SqliteStore
│   └── extractor/                # 大纲解析 / 检索评分 / 提示渲染 / 门面
├── tests/                        # 6 个测试文件，126 项断言
├── demo.ts                       # 端到端演示
├── tools/ts-hooks.mjs            # node 运行 TS 的 .js→.ts 解析钩子（零构建依赖运行测试）
└── package.json
```

### 工具链说明

- 构建：`tsc`（标准 TypeScript 编译，输出至 `dist/`）。
- 测试与演示：Node 内建 `node --test` + `--experimental-strip-types`（直接运行 `.ts`，经 `tools/ts-hooks.mjs` 把 `.js` 说明符映射回同级 `.ts`），因此 `npm test` 与 `npm run demo` 在安装依赖后即可运行，无 vitest/jest 等重型框架。

---

## API 一览

```typescript
// 项目与存档
StoryEngine.open(store, meta?)          // 从存储打开或新建
engine.save() / saveSlot(name) / loadSlot(name)
engine.toProjectData()                  // { schemaVersion, meta, events }
engine.getMeta() / updateMeta(patch)

// 章节
engine.startChapter(n?, { title, synopsis, storyTime })
engine.beat(text, { chapter, scene })   // 自由剧情节拍

// 实体（全部返回追加的事件，可继续自定义 summary）
engine.createCharacter(input) / createLocation(input) / createItem(input)
engine.updateEntity(id, patch)          // 含 connections（仅地点）
engine.setProperty(id, prop, value) / deleteProperty(id, prop)
engine.moveCharacter(id, toLocationId)
engine.setRelationship(charId, targetId, type, { value, note }) / removeRelationship(...)
engine.transferItem(itemId, toCharId) / placeItem(itemId, locationId)

// 伏笔
engine.plantForeshadow(description, { entityId, importance, chapter })
engine.resolveForeshadow(id, { resolution, chapter })
engine.abandonForeshadow(id, { reason })
engine.pendingForeshadows(asOfChapter?)

// 读取（全部返回拷贝，绝不泄漏内部状态）
engine.getState() / getStateAtChapter(n) / entities / getEvents()
engine.currentChapter / getChapters() / getChapterInfo(n)
engine.recentEvents(upToChapter, limit)

// 动态上下文提取
engine.extractContext(outline, options?)  // → ExtractedContext
```

---

## 设计 FAQ

**Q：为什么不直接把前文全部塞给 LLM？**
A：一本 30 章小说约 10 万字 ≈ 15 万 token，超出所有商用模型的实用窗口；且即使塞得下，注意力稀释也会让模型「看而不见」。检索 + 结构化状态是唯一可扩展的路。

**Q：为什么事件溯源，而不是直接存「当前状态」表？**
A：当前状态表只能回答「现在怎样」，无法回答「第 7 章时怎样」「张三的伤是什么时候好的」；也无法多端合并与重放。事件日志是顺序的、可压缩的、可回放的——和小说的「时间线」天然同构。

**Q：引擎不解析正文，那状态怎么写回？**
A：由上层应用负责：LLM 生成正文的边角，通过 function call / 结构化输出 / 人工确认，把「张三受伤」翻译成 `setProperty('ch_zhang', '有伤', true)`。引擎只保证**存了就不忘、查了就准确**。

**Q：会不会引擎自己把伏笔剧透给模型？**
A：伏笔分节默认只列 `pending` 且埋设章节 ≤ 目标章的伏笔，并明确标注「务必回收」——这是给作者的提词器，不是给角色的。角色「不知道未揭示信息」这条红线写进了每个提示的约束分节。

---

## License

[Apache License 2.0](./LICENSE) © 2026 doujiaozh

本引擎意在成为长篇 AI 写作工具链的基础设施：自由嵌入你的产品、自由二次开发。
