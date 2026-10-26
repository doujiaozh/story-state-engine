/**
 * story-state-engine — 端到端演示。
 *
 * 流程：创建角色与世界 -> 推进两章剧情（状态变更 + 埋伏笔）
 *      -> 输入第三章大纲 -> 引擎提取出一份精确的 System Prompt。
 *
 * 运行：pnpm demo / npm run demo / npx tsx demo.ts
 */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { JsonStore, MemoryStore } from './src/index.js';
import { StoryEngine } from './src/index.js';

const DEMO_DIR = 'demo-out';
const PROJECT_FILE = join(DEMO_DIR, 'demo.story.json');
const SLOTS_NOTE = join(DEMO_DIR, 'demo.story.json.slots');

const line = (ch: string, n = 72) => ch.repeat(n);
const head = (title: string) =>
  `\n${line('=')}\n${title}\n${line('=')}`;

async function main(): Promise<void> {
  await rm(DEMO_DIR, { recursive: true, force: true });

  /* ---------------------------------------------------------------- *
   * 0. 项目与存储：一份存档 = 一个完整可移植的项目（多端保存的载体）
   * ---------------------------------------------------------------- */
  console.log(head('0. 打开（或创建）项目'));
  const store = new JsonStore({ filePath: PROJECT_FILE });
  const engine = await StoryEngine.open(store, {
    name: '雾中纪',
    author: 'demo',
    premise: '大山里的少年捡到一把会发烫的旧剑，而整座山都在隐瞒它的来历。'
  });
  console.log(`项目《${engine.getMeta().name}》已就绪，当前章 ${engine.currentChapter}`);

  /* ---------------------------------------------------------------- *
   * 1. 创建世界：地点先行（connections 互相连接），再角色与物品
   * ---------------------------------------------------------------- */
  console.log(head('1. 创建角色、地点、物品'));

  // 无向图需要双向连接，但创建时对方尚不存在——先建，再用 updateEntity 回填
  engine.createLocation({
    id: 'loc_backhill',
    name: '青云后山',
    description: '禁地，据说埋着开派祖师的剑。'
  });
  engine.createLocation({
    id: 'loc_swordhall',
    name: '藏剑阁',
    description: '宗门藏剑之处，日夜有剑鸣。'
  });
  engine.createLocation({
    id: 'loc_fogvalley',
    name: '雾谷',
    description: '青云山脚的深谷，雾气终年不散，少年捡到铁剑的地方。'
  });
  const qingyun = engine.createLocation({
    id: 'loc_qingyun',
    name: '青云山',
    aliases: ['青云'],
    description: '终年大雾缭绕的修仙小宗，门人不过百，以铸剑闻名。',
    atmosphere: '终年大雾，行人稀少',
    tags: ['宗门', '铸剑'],
    connections: ['loc_backhill', 'loc_swordhall', 'loc_fogvalley']
  });
  for (const id of ['loc_backhill', 'loc_swordhall', 'loc_fogvalley'] as const) {
    engine.updateEntity(id, { connections: ['loc_qingyun'] }, { summary: '修通了通往青云山的路' });
  }
  console.log(`  地点：${qingyun.summary}`);

  const zhangsan = engine.createCharacter({
    id: 'ch_zhangsan',
    name: '张三',
    aliases: ['少年'],
    role: 'protagonist',
    description: '雾谷长大的孤儿，性格执拗，不信命。',
    attributes: { 伤势: '无', 情绪: '平静' }
  });
  const lisi = engine.createCharacter({
    id: 'ch_lisi',
    name: '李四',
    aliases: ['李师兄'],
    role: 'deuteragonist',
    description: '张三的同门师兄，温和，剑术入门最快。',
    attributes: { 伤势: '无', 情绪: '平和' }
  });
  const elder = engine.createCharacter({
    id: 'ch_yun',
    name: '云长老',
    role: 'supporting',
    description: '看似慈祥的长老， Knows more than he says.',
    tags: ['长老', '可疑'],
    attributes: { 情绪: '深不可测' }
  });
  console.log(`  角色：${zhangsan.summary} / ${lisi.summary} / ${elder.summary}`);

  const ironSword = engine.createItem({
    id: 'item_ironsword',
    name: '玄铁剑',
    aliases: ['铁剑'],
    description: '雾谷里捡来的无鞘旧剑，剑身上有一道形似剑印的裂纹。',
    ownerId: 'ch_zhangsan',
    attributes: { 状态: '沉寂' }
  });
  console.log(`  物品：${ironSword.summary}`);

  /* ---------------------------------------------------------------- *
   * 2. 第一章：剧情推进 = 往时间线写事件，状态由事件投影而来
   * ---------------------------------------------------------------- */
  console.log(head('2. 推进两章剧情'));

  engine.startChapter(1, { title: '雾中来客', synopsis: '张三捡到玄铁剑，被带回青云山。' });
  engine.beat('张三在雾谷深处捡起一把无鞘旧剑，剑身裂纹像一道剑印。', { chapter: 1 });
  engine.plantForeshadow('玄铁剑的剑印在月夜里隐隐发烫，似乎在回应什么。', {
    entityId: 'item_ironsword',
    importance: 'high',
    chapter: 1
  });
  engine.moveCharacter('ch_zhangsan', 'loc_qingyun', { chapter: 1 });
  engine.setRelationship('ch_zhangsan', 'ch_yun', '师父', { chapter: 1, note: '拜入门下' });
  engine.setRelationship('ch_zhangsan', 'ch_lisi', '同门师兄', { chapter: 1 });

  // 第二章：状态变更 —— 伤势、情绪、关系、物品归属、新伏笔
  engine.startChapter(2, { title: '山中岁月', synopsis: '张三与李四切磋受伤，云长老夜入后山。' });
  engine.beat('张三与李四在藏剑阁前切磋，李四收剑不及，剑气划伤张三右臂。', { chapter: 2 });
  engine.setProperty('ch_zhangsan', '伤势', '右臂被剑气划伤', { chapter: 2 });
  engine.setProperty('ch_zhangsan', '情绪', '不甘', { chapter: 2 });
  engine.moveCharacter('ch_zhangsan', 'loc_swordhall', { chapter: 2 });
  engine.setProperty('item_ironsword', '状态', '沉寂但隐有暖意', { chapter: 2 });
  engine.plantForeshadow('云长老深夜独自走入青云后山禁地，回来时袖口沾着陈年血迹。', {
    entityId: 'ch_yun',
    importance: 'medium',
    chapter: 2
  });
  engine.beat('李四替张三包扎，说"你这性子，迟早要吃亏"。', { chapter: 2 });

  const zhang = engine.entities.requireCharacter('ch_zhangsan');
  console.log('  第一章埋伏笔 + 第二章切磋负伤后，张三的当前状态：');
  console.log(`    位置 = ${zhang.attributes.locationId}  伤势 = ${zhang.attributes['伤势']}  情绪 = ${zhang.attributes['情绪']}`);
  console.log(`    时间线事件数 = ${engine.getEvents().length}，待回收伏笔 = ${engine.pendingForeshadows().length}`);

  /* ---------------------------------------------------------------- *
   * 3. 持久化 + 命名存档（多端保存）
   * ---------------------------------------------------------------- */
  console.log(head('3. 保存与多端存档'));
  await engine.save();
  await engine.saveSlot('device-laptop');
  await engine.saveSlot('plot-branch-a');
  console.log(`  主存档：${PROJECT_FILE}`);
  console.log(`  槽位存档目录：${SLOTS_NOTE}/`);
  console.log(`  槽位列表：${(await (store as { listSlots(): Promise<string[]> }).listSlots()).join(', ')}`);

  // 重新打开一份引擎，验证状态完全由事件日志重建
  const reopened = await StoryEngine.open(new JsonStore({ filePath: PROJECT_FILE }));
  const zhangAfterReload = reopened.entities.requireCharacter('ch_zhangsan');
  console.log(`  从磁盘重新打开后：伤势 = ${zhangAfterReload.attributes['伤势']}（与内存一致 —— 状态可复现）`);

  /* ---------------------------------------------------------------- *
   * 4. 第三章大纲 -> 提取上下文 Prompt
   * ---------------------------------------------------------------- */
  console.log(head('4. 输入第三章大纲，提取上下文'));

  const outline = [
    '第三章《下山》',
    '张三伤愈后奉云长老之命下山历练，途经雾谷旧地，玄铁剑的剑印再度发烫；',
    '李四执意同行，两人在雾谷口遭遇一名神秘黑衣人。'
  ].join('\n');

  const ctx = engine.extractContext(outline);

  console.log(`  目标章节识别：第 ${ctx.chapter} 章（状态快照截至第 ${ctx.asOfChapter} 章）`);
  console.log('  召回实体（按相关度排序）：');
  for (const m of ctx.matchedEntities) {
    console.log(`    ${m.entity.name.padEnd(6)} score=${m.score}  ${m.reasons.join('；')}`);
  }
  console.log(`  待回收伏笔：${ctx.foreshadowing.length} 条  |  时间线节拍：${ctx.recentEvents.length} 条`);
  if (ctx.warnings.length > 0) console.log(`  引擎警告：${ctx.warnings.join(' / ')}`);
  console.log(`  预算：约 ${ctx.estimatedTokens} tokens（章节总字数继续增长，窗口大小不变）`);

  console.log(head('5. 生成的 System Prompt（直接喂给大模型）'));
  console.log(ctx.systemPrompt);

  /* ---------------------------------------------------------------- *
   * 6. 轻量的内存后端演示（测试与临时场景）
   * ---------------------------------------------------------------- */
  console.log(head('6. 另一种后端：MemoryStore'));
  const memory = new MemoryStore();
  const memEngine = await StoryEngine.open(memory, { name: '临时稿' });
  memEngine.createCharacter({ id: 'ch_x', name: '路人甲' });
  await memEngine.save();
  console.log(`  MemoryStore 单章演示：${memEngine.entities.require('ch_x').name}，事件 ${memEngine.getEvents().length} 条。`);

  console.log(`\n${line('=')}`);
  console.log('演示完成。查看 demo-out/ 目录可见 JSON 存档与槽位文件。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
