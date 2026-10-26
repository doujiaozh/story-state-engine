import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { StoreError } from '../errors.js';
import type { ProjectData } from '../types.js';
import type { SlotStore } from './types.js';
import { validateSlotName } from './types.js';

export interface JsonStoreOptions {
  /** Path of the main project file, e.g. `projects/my-novel.story.json`. */
  filePath: string;
  /** Directory for named slots; defaults to `<filePath>.slots/`. */
  slotsDir?: string;
}

/**
 * Single-file JSON persistence.
 *
 * Writes are atomic: the project is serialized to a pid-scoped temp file and
 * then `rename`d into place, so an interrupted write can never leave a
 * half-encoded novel behind. Slots are separate JSON files in a sibling
 * directory — copy the directory (or the main file) to another machine and
 * the project travels with it.
 */
export class JsonStore implements SlotStore {
  private readonly options: JsonStoreOptions;

  constructor(options: JsonStoreOptions) {
    this.options = options;
  }

  private get filePath(): string {
    return this.options.filePath;
  }

  private get slotsDir(): string {
    return this.options.slotsDir ?? `${this.options.filePath}.slots`;
  }

  async load(): Promise<ProjectData | null> {
    return this.readJson<ProjectData>(this.filePath);
  }

  async save(data: ProjectData): Promise<void> {
    await this.writeJson(this.filePath, data);
  }

  async saveSlot(name: string, data: ProjectData): Promise<void> {
    validateSlotName(name);
    await this.writeJson(join(this.slotsDir, `${name}.json`), data);
  }

  async loadSlot(name: string): Promise<ProjectData | null> {
    validateSlotName(name);
    return this.readJson<ProjectData>(join(this.slotsDir, `${name}.json`));
  }

  async listSlots(): Promise<string[]> {
    try {
      const entries = await readdir(this.slotsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.json'))
        .map((e) => e.name.slice(0, -'.json'.length))
        .sort((a, b) => a.localeCompare(b));
    } catch (err) {
      if (isEnoent(err)) return [];
      throw err;
    }
  }

  async deleteSlot(name: string): Promise<void> {
    validateSlotName(name);
    try {
      await unlink(join(this.slotsDir, `${name}.json`));
    } catch (err) {
      if (isEnoent(err)) throw new StoreError(`存档不存在: ${name}`);
      throw err;
    }
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      const raw = await readFile(file, 'utf8');
      return JSON.parse(raw) as T;
    } catch (err) {
      if (isEnoent(err)) return null;
      throw new StoreError(`读取项目文件失败 (${file}): ${(err as Error).message}`);
    }
  }

  private async writeJson(file: string, data: ProjectData): Promise<void> {
    const tmp = `${file}.tmp.${process.pid}`;
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await rename(tmp, file);
    } catch (err) {
      throw new StoreError(`写入项目文件失败 (${file}): ${(err as Error).message}`);
    }
  }
}

function isEnoent(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}
