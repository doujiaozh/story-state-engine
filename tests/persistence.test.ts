/**
 * Store backends: MemoryStore, JsonStore (atomic file writes), SqliteStore.
 * All three implement the same contract, including named slots (多端保存).
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryStore } from '../src/persistence/MemoryStore.js';
import { JsonStore } from '../src/persistence/JsonStore.js';
import { SqliteStore } from '../src/persistence/SqliteStore.js';
import { StoreError } from '../src/errors.js';
import { supportsSlots, validateSlotName } from '../src/persistence/types.js';
import { SCHEMA_VERSION } from '../src/types.js';
import type { ProjectData } from '../src/types.js';

function projectFixture(name: string): ProjectData {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    events: [
      {
        type: 'story/chapter-started',
        id: 'id_c1',
        seq: 0,
        chapter: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        title: '第一章'
      }
    ]
  };
}

let tmpRoot: string | undefined;

function makeTmp(): string {
  if (!tmpRoot) tmpRoot = mkdtempSync(join(tmpdir(), 'sse-'));
  return mkdtempSync(join(tmpRoot, 't-'));
}

after(() => {
  if (!tmpRoot) return;
  // Windows (esp. with on-access AV scanners) briefly locks temp files after
  // sqlite/json writes, so cleanup is best-effort with retries.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
      return;
    } catch {
      // keep trying; the dir lives under the OS temp folder anyway
    }
  }
});

const backends: Array<{ label: string; make: (dir: string) => Promise<MemoryStore | JsonStore | SqliteStore> }> = [
  { label: 'MemoryStore', make: async () => new MemoryStore() },
  {
    label: 'JsonStore',
    make: async (dir) => new JsonStore({ filePath: join(dir, 'proj.story.json') })
  },
  {
    label: 'SqliteStore',
    make: async (dir) => new SqliteStore({ path: join(dir, 'proj.story.db') })
  }
];

for (const { label, make } of backends) {
  describe(`${label} contract`, () => {
    it('returns null from an empty store', async () => {
      const store = await make(makeTmp());
      assert.equal(await store.load(), null);
    });

    it('saves and reloads a project losslessly', async () => {
      const store = await make(makeTmp());
      const data = projectFixture('契约测试');
      await store.save(data);
      const reloaded = await store.load();
      assert.deepEqual(reloaded, data);
    });

    it('overwrites an existing project on save', async () => {
      const store = await make(makeTmp());
      await store.save(projectFixture('第一版'));
      await store.save(projectFixture('第二版'));
      assert.equal((await store.load())?.meta.name, '第二版');
    });

    it('supports named slots and lists them', async () => {
      const store = await make(makeTmp());
      assert.equal(supportsSlots(store), true);
      await store.saveSlot('device-laptop', projectFixture('甲'));
      await store.saveSlot('plot-branch-a', projectFixture('乙'));
      assert.deepEqual((await store.listSlots()).sort(), ['device-laptop', 'plot-branch-a']);
      assert.equal((await store.loadSlot('device-laptop'))?.meta.name, '甲');
      assert.equal((await store.loadSlot('plot-branch-a'))?.meta.name, '乙');
    });

    it('throws StoreError on deleting a missing slot', async () => {
      const store = await make(makeTmp());
      await assert.rejects(() => store.deleteSlot('missing'), StoreError);
    });

    it('deletes a slot', async () => {
      const store = await make(makeTmp());
      await store.saveSlot('gone', projectFixture('甲'));
      await store.deleteSlot('gone');
      assert.deepEqual(await store.listSlots(), []);
    });
  });
}

describe('JsonStore specifics', () => {
  it('writes atomically: no partial file survives a failure', async () => {
    const dir = makeTmp();
    const path = join(dir, 'proj.story.json');
    const store = new JsonStore({ filePath: path });
    await store.save(projectFixture('原子写'));
    const entries = readdirSync(dir).filter((f) => !f.startsWith('.'));
    assert.equal(entries.length, 1, 'only the final file remains, no .tmp leftovers');
    assert.equal(entries[0], 'proj.story.json');
  });

  it('keeps slots under a sibling .slots/ directory', async () => {
    const dir = makeTmp();
    const store = new JsonStore({ filePath: join(dir, 'proj.story.json') });
    await store.saveSlot('phone', projectFixture('手机端'));
    const sub = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory());
    assert.equal(sub.length, 1);
    assert.equal(sub[0].name, 'proj.story.json.slots');
  });

  it('survives a missing file on load and listSlots', async () => {
    const store = new JsonStore({ filePath: join(makeTmp(), 'never.story.json') });
    assert.equal(await store.load(), null);
    assert.deepEqual(await store.listSlots(), []);
  });

  it('a second instance reads what the first wrote (multi-device sharing)', async () => {
    const path = join(makeTmp(), 'shared.story.json');
    await new JsonStore({ filePath: path }).save(projectFixture('共享'));
    const reloaded = await new JsonStore({ filePath: path }).load();
    assert.equal(reloaded?.meta.name, '共享');
  });
});

describe('SqliteStore specifics', () => {
  it('stores events in a real sqlite database file', async () => {
    const dir = makeTmp();
    const path = join(dir, 'proj.story.db');
    const store = new SqliteStore({ path });
    await store.save(projectFixture('SQLite'));
    const reloaded = await store.load();
    assert.equal(reloaded?.events.length, 1);
    assert.equal(reloaded?.schemaVersion, SCHEMA_VERSION);
  });

  it('overwrites previous content on each save', async () => {
    const dir = makeTmp();
    const store = new SqliteStore({ path: join(dir, 'proj.story.db') });
    await store.save(projectFixture('第一版'));
    await store.save(projectFixture('第二版'));
    const reloaded = await store.load();
    assert.equal(reloaded?.meta.name, '第二版');
    assert.equal(reloaded?.events.length, 1);
  });

  it('a second instance reads what the first wrote', async () => {
    const path = join(makeTmp(), 'shared.story.db');
    await new SqliteStore({ path }).save(projectFixture('共享'));
    const reloaded = await new SqliteStore({ path }).load();
    assert.equal(reloaded?.meta.name, '共享');
  });
});

describe('slot name validation', () => {
  it('accepts safe names and rejects hostile ones', () => {
    validateSlotName('device-laptop');
    validateSlotName('plot_branch_2');
    assert.throws(() => validateSlotName('../escape'), TypeError);
    assert.throws(() => validateSlotName('has space'), TypeError);
    assert.throws(() => validateSlotName(''), TypeError);
  });
});
