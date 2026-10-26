import type { ProjectData } from '../types.js';

/** A slot name must stay filesystem-safe across every Store implementation. */
export const SLOT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function validateSlotName(name: string): void {
  if (!SLOT_NAME_PATTERN.test(name)) {
    throw new TypeError(`非法的存档名 "${name}"：仅允许字母、数字、下划线与连字符，长度 1-64`);
  }
}

/**
 * The storage contract. Implementations must make `save` atomic (a crash
 * mid-write must never corrupt the project) and must tolerate a missing
 * project (`load` returns null).
 */
export interface Store {
  /** Load the main project, or null when the store is empty. */
  load(): Promise<ProjectData | null>;
  /** Overwrite the main project atomically. */
  save(data: ProjectData): Promise<void>;
}

/**
 * Stores that additionally support *named slots* — the "多端保存" story.
 * A slot is a full, independently loadable project snapshot: keep one per
 * device ("laptop", "desktop", "phone"), or one per branch of the plot.
 */
export interface SlotStore extends Store {
  saveSlot(name: string, data: ProjectData): Promise<void>;
  loadSlot(name: string): Promise<ProjectData | null>;
  listSlots(): Promise<string[]>;
  deleteSlot(name: string): Promise<void>;
}

export function supportsSlots(store: Store): store is SlotStore {
  return (
    typeof (store as Partial<SlotStore>).saveSlot === 'function' &&
    typeof (store as Partial<SlotStore>).loadSlot === 'function' &&
    typeof (store as Partial<SlotStore>).listSlots === 'function' &&
    typeof (store as Partial<SlotStore>).deleteSlot === 'function'
  );
}
