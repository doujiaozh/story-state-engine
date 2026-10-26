import type { ProjectData } from '../types.js';
import { StoreError } from '../errors.js';
import type { SlotStore } from './types.js';

/**
 * In-memory store. Useful for tests, for ephemeral sessions, and as a
 * scratch buffer before promoting a project to a persistent store.
 */
export class MemoryStore implements SlotStore {
  private main: ProjectData | null = null;
  private readonly slots = new Map<string, ProjectData>();

  async load(): Promise<ProjectData | null> {
    return this.main ? structuredClone(this.main) : null;
  }

  async save(data: ProjectData): Promise<void> {
    this.main = structuredClone(data);
  }

  async saveSlot(name: string, data: ProjectData): Promise<void> {
    this.slots.set(name, structuredClone(data));
  }

  async loadSlot(name: string): Promise<ProjectData | null> {
    const data = this.slots.get(name);
    return data ? structuredClone(data) : null;
  }

  async listSlots(): Promise<string[]> {
    return [...this.slots.keys()];
  }

  async deleteSlot(name: string): Promise<void> {
    if (!this.slots.delete(name)) throw new StoreError(`存档不存在: ${name}`);
  }
}
