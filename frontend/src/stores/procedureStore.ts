import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import {
  baselineOf,
  diffBaseline,
  mergeChanges,
  procedureGate,
} from '../utils/review';
import type {
  PrepProcedure,
  PrepProcedureDraft,
  ReviewApplicability,
} from '../types/procedure';
import type { Specimen } from '../types/specimen';

interface ProcedureState {
  items: PrepProcedure[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: PrepProcedureDraft) => Promise<PrepProcedure>;
  finish: (id: string) => Promise<void>;
  rollback: (id: string, reason?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  bySpecimen: (specimenId: string) => PrepProcedure[];
  /** 按 id upsert（跨表事务提交后同步内存态用） */
  mergeItems: (rows: PrepProcedure[]) => void;
  /**
   * 为历史工序补卡片对照值。
   * - 工序正处于待复核：补全后仍停留待复核（变化字段即时算好），等负责人确认；
   * - 非待复核：若对照值与当前卡片不一致，立即失效转待复核；一致则保留原状态。
   * 写库失败由调用方提示重试（事务自动回滚，不产生半写状态）。
   */
  fillBaseline: (id: string, baseline: ReturnType<typeof baselineOf>) => Promise<PrepProcedure>;
  /** 负责人确认适用性，工序恢复原状态并重新进入进度 / 交付校验 */
  confirmReview: (
    id: string,
    input: { confirmer: string; applicability: ReviewApplicability; comment?: string },
  ) => Promise<PrepProcedure>;
}

export const useProcedureStore = create<ProcedureState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const items = await db.procedures.toArray();
    items.sort((a, b) => a.seq - b.seq || a.startedAt - b.startedAt);
    set({ items, loaded: true });
  },
  async add(draft) {
    const record: PrepProcedure = { ...draft, id: newId('prc') };
    await db.procedures.put(record);
    set({ items: [...get().items, record] });
    return record;
  },
  async finish(id) {
    const current = await db.procedures.get(id);
    if (!current) throw new Error('工序不存在或已被删除');
    if (!current.baseline) {
      throw new Error('该工序缺少卡片对照值（待补），补全前不能标记完成');
    }
    if (current.state === 'review') {
      throw new Error('该工序因卡片修订待复核，负责人确认前不能标记完成');
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
  bySpecimen(specimenId) {
    return get()
      .items.filter((it) => it.specimenId === specimenId)
      .sort((a, b) => a.seq - b.seq);
  },
  mergeItems(rows) {
    if (rows.length === 0) return;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const existingIds = new Set(get().items.map((it) => it.id));
    set({
      items: [
        ...get().items.map((it) => byId.get(it.id) ?? it),
        ...rows.filter((r) => !existingIds.has(r.id)),
      ],
    });
  },
  async fillBaseline(id, baseline) {
    // 与 specimens 表同事务读取当前卡片，保证「补全即比对」的判断与库内一致
    return db.transaction('rw', db.procedures, db.specimens, async () => {
      const current = await db.procedures.get(id);
      if (!current) throw new Error('工序不存在或已被删除');
      if (current.baseline) throw new Error('该工序已有对照值，无需补全');

      const specimen = await db.specimens.get(current.specimenId);
      const nowBaseline = specimen ? baselineOf(specimen) : baseline;
      const changedFields = diffBaseline(baseline, nowBaseline);
      // 失效前状态只可能是三态；异常数据兜底为 pending
      const previousState: 'pending' | 'done' | 'rolledback' =
        current.state === 'review' ? current.review?.previousState ?? 'pending' : current.state;

      const logs = [...(current.reviewLogs ?? [])];
      let next: PrepProcedure;

      if (current.state === 'review' && current.review) {
        // 待复核中的工序：补全对照值，变化字段并入现有复核信息，仍停在待复核
        const review = {
          ...current.review,
          baseline,
          changedFields: mergeChanges(current.review.changedFields, changedFields),
        };
        logs.push({
          id: newId('rvl'),
          at: Date.now(),
          action: 'baselineFilled',
          revisionId: current.review.revisionId,
          baseline,
          changedFields,
        });
        next = { ...current, baseline, review, reviewLogs: logs };
      } else if (changedFields.length > 0) {
        // 非待复核工序补对照值时发现卡片现状已变：立即失效转待复核
        logs.push({
          id: newId('rvl'),
          at: Date.now(),
          action: 'baselineFilled',
          baseline,
          changedFields,
        });
        logs.push({
          id: newId('rvl'),
          at: Date.now(),
          action: 'invalidated',
          source: 'baselineFill',
          previousState,
          previousFinishedAt: current.finishedAt,
          baseline,
          changedFields,
        });
        next = {
          ...current,
          baseline,
          state: 'review',
          finishedAt: undefined,
          review: {
            since: Date.now(),
            source: 'baselineFill',
            previousState,
            previousFinishedAt: current.finishedAt,
            baseline,
            changedFields,
          },
          reviewLogs: logs,
        };
      } else {
        // 对照值与当前卡片一致：补齐即可，保持原状态
        logs.push({
          id: newId('rvl'),
          at: Date.now(),
          action: 'baselineFilled',
          baseline,
          changedFields: [],
        });
        next = { ...current, baseline, reviewLogs: logs };
      }

      await db.procedures.put(next);
      set({ items: get().items.map((it) => (it.id === id ? next : it)) });
      return next;
    });
  },
  async confirmReview(id, { confirmer, applicability, comment }) {
    return db.transaction('rw', db.procedures, async () => {
      const current = await db.procedures.get(id);
      if (!current) throw new Error('工序不存在或已被删除');
      if (current.state !== 'review' || !current.review) {
        throw new Error('该工序不在待复核状态');
      }
      if (!current.baseline) {
        throw new Error('缺少卡片对照值，按待补处理：补全前不能确认');
      }

      const at = Date.now();
      const restoredState = current.review.previousState;
      const logs = [
        ...(current.reviewLogs ?? []),
        {
          id: newId('rvl'),
          at,
          action: 'resumed' as const,
          previousState: restoredState,
          revisionId: current.review.revisionId,
          baseline: current.baseline,
          changedFields: current.review.changedFields,
          applicability,
          confirmer,
          comment,
        },
      ];
      const next: PrepProcedure = {
        ...current,
        state: restoredState,
        finishedAt:
          restoredState === 'done' ? current.review.previousFinishedAt ?? at : undefined,
        review: undefined,
        reviewLogs: logs,
      };
      await db.procedures.put(next);
      set({ items: get().items.map((it) => (it.id === id ? next : it)) });
      return next;
    });
  },
}));

/** 便捷导出：页面判断工序可否操作时复用同一套闸门 */
export { procedureGate };
