/** 工序类型 */
export type StepType = '清修' | '加固' | '粘接' | '补配' | '翻模';

export const STEP_TYPES: StepType[] = ['清修', '加固', '粘接', '补配', '翻模'];

/** 各工序类型适用的工具、磨料、胶种候选（表单动态字段用） */
export const STEP_FIELD_MAP: Record<
  StepType,
  { tools: string[]; abrasives: string[]; adhesives: string[]; needConc: boolean }
> = {
  清修: {
    tools: ['气动笔', '剔针', '超声波清洗机', '软毛刷'],
    abrasives: ['400 目', '800 目', '1200 目'],
    adhesives: [],
    needConc: false,
  },
  加固: {
    tools: ['渗透滴管', '真空浸渗罐', '加热台'],
    abrasives: [],
    adhesives: ['Paraloid B-72', '氰基丙烯酸酯', '环氧树脂 E44'],
    needConc: true,
  },
  粘接: {
    tools: ['点胶针', '夹持架', '热风枪'],
    abrasives: [],
    adhesives: ['Paraloid B-72', '氰基丙烯酸酯', '动物胶'],
    needConc: true,
  },
  补配: {
    tools: ['刮刀', '雕刻刀', '石膏模'],
    abrasives: ['600 目', '1000 目'],
    adhesives: ['环氧树脂 E44', 'Paraloid B-72'],
    needConc: true,
  },
  翻模: {
    tools: ['硅胶模具', '真空脱泡机', '石膏桶'],
    abrasives: [],
    adhesives: ['硅橡胶', '石膏浆料'],
    needConc: false,
  },
};

/** 工序节点状态 */
export type ProcedureState = 'pending' | 'done' | 'rolledback';

/**
 * 工序复核状态（独立于节点生命周期状态）。
 * - current：对照值与标本当前基础字段一致，或已经负责人确认适用性
 * - toreview：标本基础字段已变更，工具/胶种适用性待负责人重新确认
 * - tosupply：工序缺少对照值快照，待补全，补全前不能当成已确认
 */
export type ReviewStatus = 'current' | 'toreview' | 'tosupply';

/** 触发工序复核的标本基础字段 */
export const BASIS_FIELDS = ['taxon', 'horizon', 'lithology', 'matrixHardness'] as const;
export type BasisField = (typeof BASIS_FIELDS)[number];

export const BASIS_FIELD_LABELS: Record<BasisField, string> = {
  taxon: '分类鉴定',
  horizon: '层位',
  lithology: '围岩岩性',
  matrixHardness: '莫氏硬度',
};

/** 对照值快照：工序登记 / 确认适用性时所依据的标本基础字段 */
export interface BasisSnapshot {
  taxon: string;
  horizon: string;
  lithology: string;
  matrixHardness: number;
  /** 快照采集时间 */
  capturedAt: number;
}

/** 修复工序 */
export interface PrepProcedure {
  id: string;
  specimenId: string;
  stepType: StepType;
  /** 节点名称 */
  nodeName: string;
  /** 序号，不得跳号 */
  seq: number;
  /** 工具 */
  tools: string[];
  /** 磨料目数 */
  abrasive: string;
  /** 胶种 */
  adhesive: string;
  /** 胶液浓度 % */
  adhesiveConc: number;
  /** 耗时 min */
  durationMin: number;
  /** 环境温度 ℃ */
  tempC: number;
  /** 相对湿度 % */
  rh: number;
  photoBeforeIds: string[];
  photoAfterIds: string[];
  operator: string;
  startedAt: number;
  state: ProcedureState;
  finishedAt?: number;
  /** 对照值快照（登记 / 确认时的标本基础字段） */
  basisSnapshot?: BasisSnapshot;
  /** 历次对照值快照，旧值保留 */
  basisHistory?: BasisSnapshot[];
  /** 复核状态，默认 current（迁移时对缺快照的记录补 tosupply） */
  reviewStatus: ReviewStatus;
  /** 最近一次适用性确认时间 */
  lastConfirmedAt?: number;
  /** 最近一次适用性确认责任人 */
  lastConfirmedBy?: string;
}

export type PrepProcedureDraft = Omit<PrepProcedure, 'id'>;
