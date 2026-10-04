import { BASIS_FIELDS, BASIS_FIELD_LABELS, type BasisField, type BasisSnapshot, type ReviewStatus } from '../types/procedure';
import type { Specimen } from '../types/specimen';
import type { PrepProcedure } from '../types/procedure';

/** 从标本档案提取基础字段对照值快照 */
export function snapshotFromSpecimen(specimen: Specimen, at = Date.now()): BasisSnapshot {
  return {
    taxon: specimen.taxon,
    horizon: specimen.horizon,
    lithology: specimen.lithology,
    matrixHardness: specimen.matrixHardness,
    capturedAt: at,
  };
}

/** 两次快照在基础字段上的差异项（旧值 → 新值） */
export interface BasisChange {
  field: BasisField;
  label: string;
  old: string | number;
  next: string | number;
}

export function diffBasis(oldSnap: BasisSnapshot | undefined, nextSnap: BasisSnapshot): BasisChange[] {
  if (!oldSnap) return [];
  const changes: BasisChange[] = [];
  for (const field of BASIS_FIELDS) {
    const oldV = oldSnap[field];
    const newV = nextSnap[field];
    if (oldV !== newV) {
      changes.push({ field, label: BASIS_FIELD_LABELS[field], old: oldV, next: newV });
    }
  }
  return changes;
}

/** 标本修订后，某道工序应转入的复核状态 */
export function reviewStatusFor(
  snapshot: BasisSnapshot | undefined,
  current: BasisSnapshot,
): ReviewStatus {
  if (!snapshot) return 'tosupply';
  return diffBasis(snapshot, current).length > 0 ? 'toreview' : 'current';
}

/** 复核状态是否阻断进度 / 交付 */
export function isBlocking(status: ReviewStatus | undefined): boolean {
  return status !== 'current';
}

/** 取标本基础字段中发生变化的字段（用于保存前提示） */
export function changedBasisFields(
  oldSpecimen: Specimen,
  patch: Partial<Specimen>,
): BasisField[] {
  const fields: BasisField[] = [];
  for (const field of BASIS_FIELDS) {
    if (field in patch && patch[field] !== undefined && patch[field] !== oldSpecimen[field]) {
      fields.push(field);
    }
  }
  return fields;
}

/** 交付校验：存在未复核工序时返回阻断清单 */
export function assertDeliveryReady(list: PrepProcedure[]): {
  ok: boolean;
  blocking: PrepProcedure[];
} {
  const blocking = list.filter((it) => isBlocking(it.reviewStatus));
  return { ok: blocking.length === 0, blocking };
}

/** 复核状态文案 / 配色 */
export const REVIEW_STATUS_META: Record<
  ReviewStatus,
  { label: string; color: 'default' | 'success' | 'warning' | 'error' }
> = {
  current: { label: '已确认', color: 'success' },
  toreview: { label: '待复核', color: 'warning' },
  tosupply: { label: '待补', color: 'error' },
};
