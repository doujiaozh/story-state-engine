import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { StoreError } from '../errors.js';
import type { ProjectData } from '../types.js';
import type { SlotStore } from './types.js';
import { validateSlotName } from './types.js';

export interface SqliteStoreOptions {
  /** Path of the main SQLite database file, e.g. `projects/my-novel.db`. */
  path: string;
  /** Directory for named slots; defaults to `<path>.slots/`. */
  slotsDir?: string;
}

interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
  close(): void;
}

/**
 * SQLite persistence backed by Node's built-in `node:sqlite` — zero native
 * addons, zero external dependencies. Requires Node.js >= 22.5.
 *
 * The event log is the table; nothing else is stored, because everything
 * else in this engine is derived. Slots are separate small database files,
 * fully portable across machines.
 */
export class SqliteStore implements SlotStore {
  private db: DatabaseSyncLike | null = null;

  private readonly options: SqliteStoreOptions;

  constructor(options: SqliteStoreOptions) {
    this.options = options;
  }

  async load(): Promise<ProjectData | null> {
    if (!existsSync(this.options.path)) return null;
    return this.readAll(this.mainDb());
  }

  async save(data: ProjectData): Promise<void> {
    this.writeAll(this.mainDb(), data);
  }

  async saveSlot(name: string, data: ProjectData): Promise<void> {
    validateSlotName(name);
    const db = this.openAt(this.slotPath(name));
    try {
      this.initSchema(db);
      this.writeAll(db, data);
    } finally {
      db.close();
    }
  }

  async loadSlot(name: string): Promise<ProjectData | null> {
    validateSlotName(name);
    const path = this.slotPath(name);
    if (!existsSync(path)) return null;
    const db = this.openAt(path);
    try {
      return this.readAll(db);
    } finally {
      db.close();
    }
  }

  async listSlots(): Promise<string[]> {
    try {
      const entries = readdirSync(this.slotsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.db'))
        .map((e) => e.name.slice(0, -'.db'.length))
        .sort((a, b) => a.localeCompare(b));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async deleteSlot(name: string): Promise<void> {
    validateSlotName(name);
    const path = this.slotPath(name);
    try {
      unlinkSync(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StoreError(`存档不存在: ${name}`);
      }
      throw err;
    }
  }

  /* -------------------------------------------------------------- */

  private get slotsDir(): string {
    return this.options.slotsDir ?? `${this.options.path}.slots`;
  }

  private slotPath(name: string): string {
    return join(this.slotsDir, `${name}.db`);
  }

  private mainDb(): DatabaseSyncLike {
    if (!this.db) {
      this.db = this.openAt(this.options.path);
      this.initSchema(this.db);
    }
    return this.db;
  }

  private openAt(path: string): DatabaseSyncLike {
    // `node:sqlite` only exists on Node >= 22.5; load it lazily and
    // synchronously via createRequire so the whole class stays sync-oriented.
    let DatabaseSync: new (path: string) => DatabaseSyncLike;
    try {
      const require = createRequire(import.meta.url);
      ({ DatabaseSync } = require('node:sqlite'));
    } catch {
      throw new StoreError(
        'SqliteStore 需要 Node.js >= 22.5 内置的 node:sqlite；请升级 Node，或改用 JsonStore。'
      );
    }
    try {
      mkdirSync(dirname(path), { recursive: true });
      return new DatabaseSync(path);
    } catch (err) {
      throw new StoreError(`打开 SQLite 数据库失败 (${path}): ${(err as Error).message}`);
    }
  }

  private initSchema(db: DatabaseSyncLike): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL,
        chapter INTEGER NOT NULL,
        type TEXT NOT NULL,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_order ON events(chapter, seq);
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  private writeAll(db: DatabaseSyncLike, data: ProjectData): void {
    const insertEvent = db.prepare(
      'INSERT OR REPLACE INTO events (id, seq, chapter, type, json) VALUES (?, ?, ?, ?, ?)'
    );
    const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM events').run();
      for (const event of data.events) {
        insertEvent.run(event.id, event.seq, event.chapter, event.type, JSON.stringify(event));
      }
      setMeta.run('meta', JSON.stringify(data.meta));
      setMeta.run('schemaVersion', String(data.schemaVersion));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new StoreError(`写入 SQLite 失败: ${(err as Error).message}`);
    }
  }

  private readAll(db: DatabaseSyncLike): ProjectData | null {
    this.initSchema(db);
    const rows = db.prepare('SELECT json FROM events ORDER BY chapter ASC, seq ASC').all() as {
      json: string;
    }[];
    if (rows.length === 0) return null;
    const metaRow = db.prepare("SELECT value FROM meta WHERE key = 'meta'").get() as {
      value?: string;
    } | null;
    const versionRow = db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as {
      value?: string;
    } | null;
    return {
      schemaVersion: versionRow?.value ? Number(versionRow.value) : 1,
      meta: metaRow?.value ? (JSON.parse(metaRow.value) as ProjectData['meta']) : fallbackMeta(),
      events: rows.map((row) => JSON.parse(row.json) as ProjectData['events'][number])
    };
  }
}

function fallbackMeta(): ProjectData['meta'] {
  return {
    name: '未命名项目',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}
