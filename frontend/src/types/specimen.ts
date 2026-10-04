/** 标本状态 */
export type SpecimenStatus = '待清修' | '修复中' | '已加固' | '待交付' | '已交付';

export const SPECIMEN_STATUSES: SpecimenStatus[] = [
  '待清修',
  '修复中',
  '已加固',
  '待交付',
  '已交付',
];

/** 标本卡上影响工具 / 胶种选型的敏感字段，修订后需触发工序复核 */
export interface CardBaseline {
  /** 分类鉴定 */
  taxon: string;
  /** 层位 */
  horizon: string;
  /** 围岩岩性 */
  lithology: string;
  /** 围岩莫氏硬度 */
  matrixHardness: number;
}

export const CARD_BASELINE_FIELDS: { key: keyof CardBaseline; label: string }[] = [
  { key: 'taxon', label: '分类鉴定' },
  { key: 'horizon', label: '层位' },
  { key: 'lithology', label: '围岩岩性' },
  { key: 'matrixHardness', label: '莫氏硬度' },
];

/** 敏感字段的一次值变化（旧值留痕用） */
export interface CardFieldChange {
  field: keyof CardBaseline;
  label: string;
  oldValue: string;
  newValue: string;
}

/** 标本卡修订记录：旧版本、新值与受影响工序全部留痕 */
export interface SpecimenRevision {
  id: string;
  at: number;
  /** 修订人 */
  editor?: string;
  note?: string;
  /** 本次保存中发生变化的敏感字段；为空表示仅改了非敏感字段 */
  changes: CardFieldChange[];
  /** 修订前的敏感字段快照（旧版本） */
  before: CardBaseline;
  /** 修订后的敏感字段快照 */
  after: CardBaseline;
  /** 本次被置为待复核的工序 id */
  affectedProcedureIds: string[];
}

/** 化石标本 */
export interface Specimen {
  id: string;
  /** 标本号 */
  specimenNo: string;
  /** 分类鉴定 */
  taxon: string;
  /** 层位 */
  horizon: string;
  /** 产地 */
  locality: string;
  /** 围岩岩性 */
  lithology: string;
  /** 围岩莫氏硬度 */
  matrixHardness: number;
  /** 尺寸 mm，形如 210×140×60 */
  dimensions: string;
  /** 重量 g */
  weight: number;
  /** 匣位 */
  storageBox: string;
  status: SpecimenStatus;
  createdAt: number;
  /** 卡片修订留痕（旧版本与旧值保留，不覆盖） */
  revisions?: SpecimenRevision[];
}

export type SpecimenDraft = Omit<Specimen, 'id' | 'createdAt' | 'revisions'>;
