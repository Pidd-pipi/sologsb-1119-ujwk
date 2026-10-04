import { useMemo } from 'react';
import { useProcedureStore } from '../stores/procedureStore';
import type { PrepProcedure } from '../types/procedure';
import { isBlocking } from '../utils/review';
import { findSeqGaps } from '../utils/id';

export interface PrepProgress {
  list: PrepProcedure[];
  total: number;
  /** 已完成且复核状态为 current 的工序数（待复核 / 待补不计入进度） */
  done: number;
  rolledback: number;
  /** 待复核 + 待补的工序数 */
  blocking: number;
  percent: number;
  /** 当前可推进的待办节点（pending 且已确认） */
  current: PrepProcedure | undefined;
  /** 跳号（应为空） */
  gaps: number[];
}

/**
 * 计算某标本的工序完成度与当前待办节点。
 * 待复核 / 待补的工序不计入完成率，也不作为当前待办；
 * 被标本详情页与工序录入页消费。
 */
export function usePrepProgress(specimenId: string | undefined): PrepProgress {
  const items = useProcedureStore((s) => s.items);

  return useMemo<PrepProgress>(() => {
    const list = items
      .filter((it) => (specimenId ? it.specimenId === specimenId : true))
      .sort((a, b) => a.seq - b.seq);
    const done = list.filter((it) => it.state === 'done' && !isBlocking(it.reviewStatus)).length;
    const rolledback = list.filter((it) => it.state === 'rolledback').length;
    const blocking = list.filter((it) => isBlocking(it.reviewStatus)).length;
    const percent = list.length === 0 ? 0 : Math.round((done / list.length) * 100);
    const current = list.find((it) => it.state === 'pending' && !isBlocking(it.reviewStatus));
    const gaps = findSeqGaps(list.map((it) => it.seq));
    return { list, total: list.length, done, rolledback, blocking, percent, current, gaps };
  }, [items, specimenId]);
}
