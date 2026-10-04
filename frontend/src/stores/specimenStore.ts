import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { baselineOf, diffBaseline, mergeChanges } from '../utils/review';
import type {
  Specimen,
  SpecimenDraft,
  SpecimenRevision,
  SpecimenStatus,
} from '../types/specimen';
import type { PrepProcedure } from '../types/procedure';
import { useProcedureStore } from './procedureStore';

/** 失效前状态只可能是三态；异常数据（review 却缺 review 对象）兜底为 pending */
function previousStateOf(p: PrepProcedure): 'pending' | 'done' | 'rolledback' {
  if (p.state === 'review') return p.review?.previousState ?? 'pending';
  return p.state;
}

export interface CardRevisionInput {
  /** 保存后的完整标本字段（至少包含全部敏感字段 + 被修改的非敏感字段） */
  patch: Partial<Specimen>;
  editor?: string;
  note?: string;
}

export interface CardRevisionResult {
  specimen: Specimen;
  revision: SpecimenRevision;
  /** 本次被失效转待复核的工序 */
  affected: PrepProcedure[];
}

interface SpecimenState {
  items: Specimen[];
  loading: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: SpecimenDraft) => Promise<Specimen>;
  update: (id: string, patch: Partial<Specimen>) => Promise<void>;
  /**
   * 保存标本卡修订。
   * 敏感字段（分类鉴定 / 层位 / 围岩岩性 / 莫氏硬度）一旦变化：
   * 该标本下全部已有工序立即失效、转待复核，原操作记录与旧值保留。
   * 整个保存走单事务：任一步写入失败则标本恢复原版本、不产生待复核标记，
   * 调用方保留对话框与重试入口即可。
   */
  saveCardRevision: (id: string, input: CardRevisionInput) => Promise<CardRevisionResult>;
  setStatus: (id: string, status: SpecimenStatus) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useSpecimenStore = create<SpecimenState>((set, get) => ({
  items: [],
  loading: false,
  loaded: false,
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
  async saveCardRevision(id, { patch, editor, note }) {
    // 事务内重读，保证基于库内最新版本计算差异；失败整体回滚（原版本 + 原工序状态保留）
    return db.transaction('rw', db.specimens, db.procedures, async () => {
      const current = await db.specimens.get(id);
      if (!current) throw new Error('标本不存在或已被删除');

      const before = baselineOf(current);
      const nextSpecimen: Specimen = { ...current, ...patch, id };
      const after = baselineOf(nextSpecimen);
      const changes = diffBaseline(before, after);
      const at = Date.now();

      const revision: SpecimenRevision = {
        id: newId('rev'),
        at,
        editor: editor?.trim() || undefined,
        note: note?.trim() || undefined,
        changes,
        before,
        after,
        affectedProcedureIds: [],
      };

      let affected: PrepProcedure[] = [];

      if (changes.length > 0) {
        const procedures = await db.procedures.where('specimenId').equals(id).toArray();
        for (const p of procedures) {
          if (p.state === 'review' && p.review) {
            // 已待复核：保留首次失效前的状态与最早旧值，累计新变化，不重置等待
            const review = {
              ...p.review,
              changedFields: mergeChanges(p.review.changedFields, changes),
            };
            const updated: PrepProcedure = {
              ...p,
              review,
              reviewLogs: [
                ...(p.reviewLogs ?? []),
                {
                  id: newId('rvl'),
                  at,
                  action: 'invalidated',
                  source: 'cardRevision',
                  previousState: p.review.previousState,
                  previousFinishedAt: p.review.previousFinishedAt,
                  revisionId: revision.id,
                  baseline: p.baseline,
                  changedFields: changes,
                },
              ],
            };
            await db.procedures.put(updated);
            affected.push(updated);
          } else {
            // 正常工序（含缺对照值的历史工序）：立即失效转待复核，原操作记录全部保留
            const previousState = previousStateOf(p);
            const updated: PrepProcedure = {
              ...p,
              state: 'review',
              finishedAt: undefined,
              review: {
                since: at,
                source: 'cardRevision',
                revisionId: revision.id,
                previousState,
                previousFinishedAt: p.finishedAt,
                baseline: p.baseline,
                changedFields: p.baseline ? mergeChanges([], diffBaseline(p.baseline, after)) : changes,
              },
              reviewLogs: [
                ...(p.reviewLogs ?? []),
                {
                  id: newId('rvl'),
                  at,
                  action: 'invalidated',
                  source: 'cardRevision',
                  previousState,
                  previousFinishedAt: p.finishedAt,
                  revisionId: revision.id,
                  baseline: p.baseline,
                  changedFields: changes,
                },
              ],
            };
            await db.procedures.put(updated);
            affected.push(updated);
          }
        }
        revision.affectedProcedureIds = affected.map((p) => p.id);
      }

      const saved: Specimen = {
        ...nextSpecimen,
        revisions: [...(current.revisions ?? []), revision],
      };
      await db.specimens.put(saved);

      // 事务提交后再同步内存态，保证写库失败时页面状态也不被改动（配合事务回滚）
      set({ items: get().items.map((it) => (it.id === id ? saved : it)) });
      if (affected.length > 0) {
        useProcedureStore.getState().mergeItems(affected);
      }

      return { specimen: saved, revision, affected };
    });
  },
  async setStatus(id, status) {
    await get().update(id, { status });
  },
  async remove(id) {
    await db.specimens.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
}));
