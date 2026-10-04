import { useMemo } from 'react';
import { useProcedureStore } from '../stores/procedureStore';
import type { PrepProcedure } from '../types/procedure';
import { findSeqGaps } from '../utils/id';
import { deliveryBlocked, procedureGate } from '../utils/review';

export interface PrepProgress {
  list: PrepProcedure[];
  total: number;
  /** 计入完成度的节点数（待复核、待补对照值的已完成节点不计） */
  done: number;
  rolledback: number;
  /** 卡片修订后待复核节点数（含同时缺对照值的） */
  review: number;
  /** 缺卡片对照值、按待补处理的节点数（不含待复核中的） */
  baselineMissing: number;
  /** 完成率：只按已确认可认领的完成节点计 */
  percent: number;
  /** 当前待办节点（待复核 / 待补节点在前，优先提示处理） */
  current: PrepProcedure | undefined;
  /** 跳号（应为空） */
  gaps: number[];
  /** 是否全部节点均已确认完成（交付校验前提） */
  allConfirmedDone: boolean;
  /** 交付阻断原因；空字符串表示放行 */
  deliveryBlockReason: string;
}

/**
 * 计算某标本的工序完成度与当前待办节点。
 * 被标本详情页、工序录入页、前后对照页消费。
 *
 * 复核闸门：
 * - 待复核节点（state === 'review'）立即失效，不计完成、不计交付；
 * - 历史节点缺对照值（baseline）按待补处理，补全前不算已确认。
 */
export function usePrepProgress(specimenId: string | undefined): PrepProgress {
  const items = useProcedureStore((s) => s.items);

  return useMemo<PrepProgress>(() => {
    const list = items
      .filter((it) => (specimenId ? it.specimenId === specimenId : true))
      .sort((a, b) => a.seq - b.seq);

    const gates = list.map((it) => ({ it: it, gate: procedureGate(it) }));
    const done = gates.filter(({ gate }) => gate.countsAsDone).length;
    const rolledback = list.filter((it) => it.state === 'rolledback').length;
    const review = list.filter((it) => it.state === 'review').length;
    const baselineMissing = gates.filter(({ it, gate }) => gate.baselineMissing && it.state !== 'review').length;
    const percent = list.length === 0 ? 0 : Math.round((done / list.length) * 100);

    // 待复核 / 待补对照值的节点最先暴露；其次取第一个未完成节点
    const blocked = gates.find(({ gate }) => gate.inReview || gate.baselineMissing);
    const current = blocked?.it ?? list.find((it) => it.state !== 'done');

    const gaps = findSeqGaps(list.map((it) => it.seq));
    const allConfirmedDone = list.length > 0 && gates.every(({ gate }) => gate.countsAsDone);
    const deliveryBlockReason = deliveryBlocked(list);

    return {
      list,
      total: list.length,
      done,
      rolledback,
      review,
      baselineMissing,
      percent,
      current,
      gaps,
      allConfirmedDone,
      deliveryBlockReason,
    };
  }, [items, specimenId]);
}
