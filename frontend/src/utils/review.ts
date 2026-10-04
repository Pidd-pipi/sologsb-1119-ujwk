import {
  CARD_BASELINE_FIELDS,
  type CardBaseline,
  type CardFieldChange,
  type Specimen,
} from '../types/specimen';
import type { PrepProcedure } from '../types/procedure';

/** 取标本卡上的敏感字段快照（对照值） */
export function baselineOf(card: {
  taxon: string;
  horizon: string;
  lithology: string;
  matrixHardness: number;
}): CardBaseline {
  return {
    taxon: card.taxon,
    horizon: card.horizon,
    lithology: card.lithology,
    matrixHardness: card.matrixHardness,
  };
}

function fieldText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '（空）';
  return String(value);
}

/** 数值类敏感字段按数值比较，避免 '3' / 3 误判 */
function fieldEqual(key: keyof CardBaseline, a: unknown, b: unknown): boolean {
  if (key === 'matrixHardness') return Number(a) === Number(b);
  return fieldText(a) === fieldText(b);
}

/** 计算两份卡片快照之间发生变化的敏感字段 */
export function diffBaseline(before: CardBaseline, after: CardBaseline): CardFieldChange[] {
  const changes: CardFieldChange[] = [];
  for (const { key, label } of CARD_BASELINE_FIELDS) {
    if (!fieldEqual(key, before[key], after[key])) {
      changes.push({
        field: key,
        label,
        oldValue: fieldText(before[key]),
        newValue: fieldText(after[key]),
      });
    }
  }
  return changes;
}

/**
 * 合并字段变化：以 field 去重，保留最早出现的旧值、更新为最新的新值。
 * 卡片多次修订后工序仍待复核时，历次变化都留在同一条复核信息里。
 */
export function mergeChanges(prev: CardFieldChange[], next: CardFieldChange[]): CardFieldChange[] {
  const map = new Map<keyof CardBaseline, CardFieldChange>();
  for (const c of prev) map.set(c.field, c);
  for (const c of next) {
    const existed = map.get(c.field);
    map.set(c.field, {
      ...c,
      oldValue: existed ? existed.oldValue : c.oldValue,
    });
  }
  return CARD_BASELINE_FIELDS.filter(({ key }) => map.has(key)).map(({ key }) => map.get(key)!);
}

export interface ProcedureGate {
  /** 处于待复核：被本次卡片修订失效，尚未恢复 */
  inReview: boolean;
  /** 缺对照值：历史工序无 baseline，按待补处理 */
  baselineMissing: boolean;
  /** 是否可计入进度 / 交付校验的已完成节点 */
  countsAsDone: boolean;
  /** 是否放行进度推进与交付（完成节点之外不阻断，但完成节点必须可认领） */
  ready: boolean;
  /** 阻断原因文案（用于按钮提示） */
  reason: string;
  /** 徽标文案与配色 */
  badge: { label: string; color: 'default' | 'warning' | 'error' | 'success' };
}

/**
 * 工序闸门：待复核 / 待补对照值的工序不得计入完成度与交付校验。
 */
export function procedureGate(p: PrepProcedure): ProcedureGate {
  const inReview = p.state === 'review';
  const baselineMissing = !p.baseline;
  const countsAsDone = p.state === 'done' && !inReview && !baselineMissing;

  if (inReview) {
    return {
      inReview,
      baselineMissing,
      countsAsDone: false,
      ready: false,
      reason: baselineMissing
        ? '卡片修订后待复核，且缺少对照值：请先补全对照值，再由负责人确认适用性'
        : '卡片修订后待复核：须由负责人重新确认工具 / 胶种适用性',
      badge: baselineMissing
        ? { label: '待复核 · 待补对照值', color: 'error' }
        : { label: '待复核', color: 'warning' },
    };
  }

  if (baselineMissing) {
    return {
      inReview,
      baselineMissing,
      countsAsDone: false,
      ready: false,
      reason: '缺少卡片对照值，按待补处理：补全前不能当作已确认，也不能计入完成 / 交付',
      badge: { label: '待补对照值', color: 'error' },
    };
  }

  return {
    inReview,
    baselineMissing,
    countsAsDone,
    ready: true,
    reason: '',
    badge:
      p.state === 'done'
        ? { label: '已完成', color: 'success' }
        : p.state === 'rolledback'
          ? { label: '已回退', color: 'error' }
          : { label: '待办', color: 'default' },
  };
}

/** 标本是否允许进入交付校验（待交付 / 已交付） */
export function deliveryBlocked(procedures: PrepProcedure[]): string {
  const reviewing = procedures.filter((p) => p.state === 'review');
  const missing = procedures.filter((p) => p.state !== 'review' && !p.baseline);
  if (reviewing.length > 0) {
    return `有 ${reviewing.length} 个工序因卡片修订待复核，恢复前不能进入交付：${reviewing
      .map((p) => `#${p.seq}`)
      .join('、')}`;
  }
  if (missing.length > 0) {
    return `有 ${missing.length} 个工序缺少卡片对照值（待补），补全并确认前不能进入交付：${missing
      .map((p) => `#${p.seq}`)
      .join('、')}`;
  }
  return '';
}

/** 从标本卡构建 baseline 的便捷封装，供表单层引用 */
export function specimenBaseline(specimen: Specimen): CardBaseline {
  return baselineOf(specimen);
}
