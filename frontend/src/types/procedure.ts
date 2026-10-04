import type { CardBaseline, CardFieldChange } from './specimen';

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

/**
 * 工序节点状态：
 * - pending：待办
 * - done：已完成
 * - rolledback：已回退
 * - review：卡片修订后待复核（完成度与交付校验均不认领，原操作记录保留）
 */
export type ProcedureState = 'pending' | 'done' | 'rolledback' | 'review';

/** 负责人对工具 / 胶种适用性的复核结论 */
export type ReviewApplicability = '适用' | '需调整工具' | '需更换胶种' | '不适用需返工';

export const REVIEW_APPLICABILITY_OPTIONS: ReviewApplicability[] = [
  '适用',
  '需调整工具',
  '需更换胶种',
  '不适用需返工',
];

/** 当前挂起的复核信息（工序处于 review 态时存在） */
export interface ProcedureReview {
  /** 被置为待复核的时间 */
  since: number;
  /** 触发来源：卡片修订 / 补对照值时发现现状已变 */
  source: 'cardRevision' | 'baselineFill';
  /** 关联的标本卡修订记录 id（卡片修订触发时） */
  revisionId?: string;
  /** 失效前的工序状态，复核通过后恢复到该状态 */
  previousState: 'pending' | 'done' | 'rolledback';
  /** 失效前的 finishedAt，恢复 done 时带回 */
  previousFinishedAt?: number;
  /** 工序当时对照的旧卡片值（缺对照值时为空） */
  baseline?: CardBaseline;
  /** 相对对照值发生变化的敏感字段（补对照值后可能从空变为有值） */
  changedFields: CardFieldChange[];
  /** 复核确认信息；存在表示负责人已确认，等待恢复 */
  confirmed?: {
    at: number;
    confirmer: string;
    applicability: ReviewApplicability;
    comment?: string;
  };
}

/** 复核留痕（原操作记录与旧值保留，每次复核归档一条，不覆盖） */
export interface ProcedureReviewLog {
  id: string;
  at: number;
  /** 触发来源：卡片修订 / 补对照值 / 负责人恢复 */
  action: 'invalidated' | 'baselineFilled' | 'resumed';
  /** 来源类型（invalidated 时） */
  source?: 'cardRevision' | 'baselineFill';
  /** 失效前工序状态（invalidated 时） */
  previousState?: 'pending' | 'done' | 'rolledback';
  /** 失效前完成时间（invalidated 时） */
  previousFinishedAt?: number;
  revisionId?: string;
  /** 本次记录时的对照值快照 */
  baseline?: CardBaseline;
  changedFields?: CardFieldChange[];
  /** 复核结论（resumed 时） */
  applicability?: ReviewApplicability;
  confirmer?: string;
  comment?: string;
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
  /**
   * 工序适用的卡片对照值（登记时快照）。
   * 历史数据缺该字段时按「待补对照值」处理，补全前不得确认、不计完成。
   */
  baseline?: CardBaseline;
  /** 挂起中的复核信息（state === 'review' 时存在） */
  review?: ProcedureReview;
  /** 历次复核留痕（追加，不覆盖） */
  reviewLogs?: ProcedureReviewLog[];
}

export type PrepProcedureDraft = Omit<
  PrepProcedure,
  'id' | 'baseline' | 'review' | 'reviewLogs'
> &
  Partial<Pick<PrepProcedure, 'baseline'>>;
