import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { isBlocking } from '../utils/review';
import type { PrepProcedure, PrepProcedureDraft, BasisSnapshot } from '../types/procedure';

interface ProcedureState {
  items: PrepProcedure[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: PrepProcedureDraft) => Promise<PrepProcedure>;
  finish: (id: string) => Promise<void>;
  rollback: (id: string, reason?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** 负责人确认工具/胶种适用性：按当前标本基础字段重新立对照值，转 current */
  confirmApplicability: (id: string, operator: string, current: BasisSnapshot) => Promise<void>;
  /** 补全缺失的对照值（待补 → current），补全前不能当成已确认 */
  supplementBasis: (id: string, snapshot: BasisSnapshot, operator: string) => Promise<void>;
  bySpecimen: (specimenId: string) => PrepProcedure[];
}

/** 归一化老版本记录：缺复核状态按待补处理，缺对照值快照补空数组 */
function normalize(row: Partial<PrepProcedure>): PrepProcedure {
  return {
    ...(row as PrepProcedure),
    reviewStatus: row.reviewStatus ?? (row.basisSnapshot ? 'current' : 'tosupply'),
    basisHistory: row.basisHistory ?? (row.basisSnapshot ? [row.basisSnapshot] : []),
  };
}

export const useProcedureStore = create<ProcedureState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const rows = await db.procedures.toArray();
    const items = rows.map(normalize);
    items.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
    set({ items, loaded: true });
  },
  async add(draft) {
    const record: PrepProcedure = normalize({
      ...draft,
      id: newId('prc'),
      reviewStatus: draft.reviewStatus ?? 'current',
    });
    await db.procedures.put(record);
    set({ items: [...get().items, record] });
    return record;
  },
  async finish(id) {
    const target = get().items.find((it) => it.id === id);
    if (target && isBlocking(target.reviewStatus)) {
      throw new Error('工序待复核 / 待补，暂不能计入进度，请先由负责人确认适用性');
    }
    const patch: Partial<PrepProcedure> = { state: 'done', finishedAt: Date.now() };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async rollback(id) {
    const patch: Partial<PrepProcedure> = { state: 'rolledback', finishedAt: undefined };
    await db.procedures.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async remove(id) {
    await db.procedures.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
  async confirmApplicability(id, operator, current) {
    const target = get().items.find((it) => it.id === id);
    if (!target) return;
    const prev = { ...target };
    const next: PrepProcedure = {
      ...target,
      reviewStatus: 'current',
      basisSnapshot: current,
      basisHistory: [...(target.basisHistory ?? []), current],
      lastConfirmedAt: Date.now(),
      lastConfirmedBy: operator.trim() || target.operator,
    };
    // 乐观更新：先落本地，失败再回滚
    set({ items: get().items.map((it) => (it.id === id ? next : it)) });
    try {
      await db.procedures.put(next);
    } catch (err) {
      set({ items: get().items.map((it) => (it.id === id ? prev : it)) });
      throw err;
    }
  },
  async supplementBasis(id, snapshot, operator) {
    const target = get().items.find((it) => it.id === id);
    if (!target) return;
    const prev = { ...target };
    const next: PrepProcedure = {
      ...target,
      basisSnapshot: snapshot,
      basisHistory: [...(target.basisHistory ?? []), snapshot],
      reviewStatus: 'current',
      lastConfirmedAt: Date.now(),
      lastConfirmedBy: operator.trim() || target.operator,
    };
    set({ items: get().items.map((it) => (it.id === id ? next : it)) });
    try {
      await db.procedures.put(next);
    } catch (err) {
      set({ items: get().items.map((it) => (it.id === id ? prev : it)) });
      throw err;
    }
  },
  bySpecimen(specimenId) {
    return get()
      .items.filter((it) => it.specimenId === specimenId)
      .sort((a, b) => a.seq - b.seq);
  },
}));
