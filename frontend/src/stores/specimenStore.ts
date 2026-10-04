import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import {
  snapshotFromSpecimen,
  reviewStatusFor,
  changedBasisFields,
} from '../utils/review';
import { useProcedureStore } from './procedureStore';
import type { Specimen, SpecimenDraft, SpecimenStatus } from '../types/specimen';
import type { PrepProcedure } from '../types/procedure';

/** 标本卡修订的失败重试条目（写入失败后保留入口） */
export interface PendingWrite {
  /** 以标本 id 为键，一件标本同时只保留一条待重试写入 */
  key: string;
  specimenId: string;
  patch: Partial<Specimen>;
  operator: string;
  createdAt: number;
  attempts: number;
  lastError: string;
}

const OUTBOX_KEY = 'gbfossilprep:pending-writes';

function loadOutbox(): PendingWrite[] {
  try {
    const raw = window.localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingWrite[]) : [];
  } catch {
    return [];
  }
}

function saveOutbox(items: PendingWrite[]): void {
  try {
    window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    /* localStorage 不可用时仅保内存 */
  }
}

/** 按 id 批量替换 procedureStore 中的工序记录 */
function replaceProcedures(rows: PrepProcedure[]): void {
  const current = useProcedureStore.getState().items;
  const ids = new Set(rows.map((r) => r.id));
  useProcedureStore.setState({
    items: [...current.filter((it) => !ids.has(it.id)), ...rows],
  });
}

interface SpecimenState {
  items: Specimen[];
  loading: boolean;
  loaded: boolean;
  pendingWrites: PendingWrite[];
  load: () => Promise<void>;
  add: (draft: SpecimenDraft) => Promise<Specimen>;
  update: (id: string, patch: Partial<Specimen>) => Promise<void>;
  setStatus: (id: string, status: SpecimenStatus) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /**
   * 保存标本卡修订：基础字段（分类 / 层位 / 岩性 / 硬度）变化时，
   * 受影响工序立即失效并转待复核；缺对照值的工序转待补。
   * 标本与工序在同一事务内写入，失败整体回滚并保留重试入口。
   */
  updateSpecimenWithReview: (
    id: string,
    patch: Partial<Specimen>,
    operator: string,
  ) => Promise<{ changed: boolean; invalidated: number }>;
  /** 重试失败的修订写入 */
  retryPendingWrite: (key: string) => Promise<void>;
  /** 忽略待重试条目（放弃本次修订） */
  dismissPendingWrite: (key: string) => void;
}

export const useSpecimenStore = create<SpecimenState>((set, get) => ({
  items: [],
  loading: false,
  loaded: false,
  pendingWrites: loadOutbox(),
  async load() {
    set({ loading: true });
    const items = await db.specimens.orderBy('createdAt').reverse().toArray();
    set({ items, loading: false, loaded: true });
  },
  async add(draft) {
    const record: Specimen = { ...draft, id: newId('spm'), createdAt: Date.now() };
    await db.specimens.put(record);
    set({ items: [record, ...get().items] });
    return record;
  },
  async update(id, patch) {
    await db.specimens.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async setStatus(id, status) {
    await get().update(id, { status });
  },
  async remove(id) {
    await db.specimens.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
  async updateSpecimenWithReview(id, patch, operator) {
    const target = get().items.find((it) => it.id === id);
    if (!target) throw new Error('标本不存在');

    const changedFields = changedBasisFields(target, patch);
    const changed = changedFields.length > 0;

    // 合并后的标本（用于重新计算对照值）
    const merged: Specimen = { ...target, ...patch };
    const nextBasis = snapshotFromSpecimen(merged);

    // 受影响工序：重新计算复核状态（对照值快照保留，旧值不丢）
    const prevProcedures = useProcedureStore
      .getState()
      .items.filter((p) => p.specimenId === id);
    const prevStatusById = new Map(prevProcedures.map((p) => [p.id, p.reviewStatus]));
    const affected: PrepProcedure[] = prevProcedures.map((p) => {
      const nextStatus = reviewStatusFor(p.basisSnapshot, nextBasis);
      return nextStatus === p.reviewStatus ? p : { ...p, reviewStatus: nextStatus };
    });
    const changedRows = affected.filter((p) => p.reviewStatus !== (prevStatusById.get(p.id) ?? 'current'));
    const invalidated = changedRows.filter((p) => p.reviewStatus !== 'current').length;

    // 乐观更新：先落本地
    set({ items: get().items.map((it) => (it.id === id ? merged : it)) });
    if (changedRows.length > 0) replaceProcedures(changedRows);

    try {
      await db.transaction('rw', db.specimens, db.procedures, async () => {
        await db.specimens.update(id, patch);
        if (changedRows.length > 0) {
          await db.procedures.bulkPut(changedRows);
        }
      });
      // 成功：清除该标本的待重试条目
      const nextOutbox = get().pendingWrites.filter((w) => w.key !== id);
      set({ pendingWrites: nextOutbox });
      saveOutbox(nextOutbox);
      return { changed, invalidated };
    } catch (err) {
      // 失败：恢复原版本与待复核标记，保留重试入口
      set({ items: get().items.map((it) => (it.id === id ? target : it)) });
      replaceProcedures(prevProcedures);
      const entry: PendingWrite = {
        key: id,
        specimenId: id,
        patch,
        operator: operator.trim(),
        createdAt: Date.now(),
        attempts: (get().pendingWrites.find((w) => w.key === id)?.attempts ?? 0) + 1,
        lastError: err instanceof Error ? err.message : String(err),
      };
      const nextOutbox = [entry, ...get().pendingWrites.filter((w) => w.key !== id)];
      set({ pendingWrites: nextOutbox });
      saveOutbox(nextOutbox);
      throw err;
    }
  },
  async retryPendingWrite(key) {
    const entry = get().pendingWrites.find((w) => w.key === key);
    if (!entry) return;
    await get().updateSpecimenWithReview(key, entry.patch, entry.operator);
  },
  dismissPendingWrite(key) {
    const nextOutbox = get().pendingWrites.filter((w) => w.key !== key);
    set({ pendingWrites: nextOutbox });
    saveOutbox(nextOutbox);
  },
}));
