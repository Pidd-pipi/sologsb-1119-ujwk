import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import UndoIcon from '@mui/icons-material/Undo';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import type { PrepProcedure } from '../../types/procedure';
import { procedureGate } from '../../utils/review';

export interface ProcedureTimelineProps {
  items: PrepProcedure[];
  onFinish?: (id: string) => void;
  onRollback?: (id: string) => void;
  /** 打开复核 / 补对照值弹窗 */
  onReview?: (procedure: PrepProcedure) => void;
  onOpenPhoto?: (procedureId: string) => void;
}

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const BADGE_COLOR: Record<string, 'default' | 'success' | 'error' | 'warning'> = {
  default: 'default',
  success: 'success',
  error: 'error',
  warning: 'warning',
};

/**
 * 纵向工序节点流：步骤图标、状态、耗时、环境参数折叠区。
 * 被标本详情页、工序录入页消费。
 * 待复核 / 待补对照值节点以警示样式呈现，只能走复核入口恢复。
 */
export function ProcedureTimeline({ items, onFinish, onRollback, onReview, onOpenPhoto }: ProcedureTimelineProps) {
  const [expanded, setExpanded] = useState<string | null>(items[0]?.id ?? null);

  if (items.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          该标本暂无工序节点，请到「新建工序节点」登记。
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={1} data-testid="procedure-timeline">
      {items.map((node, index) => {
        const gate = procedureGate(node);
        const isDone = node.state === 'done' && !gate.inReview && !gate.baselineMissing;
        const open = expanded === node.id;
        const review = node.review;
        const changedFields = review?.changedFields ?? [];
        return (
          <Box key={node.id} sx={{ display: 'flex', gap: 1.5 }}>
            <Stack alignItems="center" sx={{ pt: 0.5 }}>
              {isDone ? (
                <CheckCircleIcon color="success" fontSize="small" />
              ) : gate.inReview || gate.baselineMissing ? (
                <PauseCircleOutlineIcon color={gate.inReview ? 'warning' : 'error'} fontSize="small" />
              ) : (
                <RadioButtonUncheckedIcon color={node.state === 'rolledback' ? 'error' : 'disabled'} fontSize="small" />
              )}
              {index < items.length - 1 ? (
                <Box sx={{ flex: 1, width: '2px', minHeight: 32, bgcolor: 'divider', my: 0.5 }} />
              ) : null}
            </Stack>
            <Paper
              variant="outlined"
              sx={{
                p: 1.5,
                flex: 1,
                mb: 0.5,
                borderColor: gate.inReview ? 'warning.light' : gate.baselineMissing ? 'error.light' : undefined,
                bgcolor: gate.inReview ? 'warning.50' : gate.baselineMissing ? 'error.50' : undefined,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip size="small" label={`#${node.seq}`} color="primary" variant="outlined" />
                <Typography variant="subtitle2" fontWeight={700}>
                  {node.stepType} · {node.nodeName}
                </Typography>
                <Tooltip title={gate.ready ? '' : gate.reason}>
                  <Chip
                    size="small"
                    data-testid={`procedure-badge-${node.id}`}
                    label={gate.inReview ? gate.badge.label : node.state === 'rolledback' ? '已回退' : gate.baselineMissing ? '待补对照值' : isDone ? '已完成' : '待办'}
                    color={BADGE_COLOR[gate.inReview ? gate.badge.color : node.state === 'rolledback' ? 'error' : gate.baselineMissing ? 'error' : isDone ? 'success' : 'default']}
                  />
                </Tooltip>
                <Typography variant="caption" color="text.secondary">
                  耗时 {node.durationMin} min · 责任人 {node.operator}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {gate.inReview && onReview ? (
                  <Button
                    size="small"
                    color="warning"
                    variant="contained"
                    onClick={() => onReview(node)}
                    data-testid={`review-btn-${node.id}`}
                  >
                    {gate.baselineMissing ? '补对照值并复核' : '负责人复核'}
                  </Button>
                ) : null}
                {!gate.inReview && gate.baselineMissing && onReview ? (
                  <Button size="small" color="error" variant="outlined" onClick={() => onReview(node)} data-testid={`fill-baseline-btn-${node.id}`}>
                    补对照值
                  </Button>
                ) : null}
                {gate.ready && node.state !== 'done' && onFinish ? (
                  <Button size="small" variant="contained" onClick={() => onFinish(node.id)}>
                    完成节点
                  </Button>
                ) : null}
                {gate.baselineMissing && node.state !== 'review' && onFinish ? (
                  <Tooltip title="缺少卡片对照值，补全前不能标记完成">
                    <span>
                      <Button size="small" variant="contained" disabled>
                        完成节点
                      </Button>
                    </span>
                  </Tooltip>
                ) : null}
                {isDone && onRollback ? (
                  <Button size="small" color="warning" startIcon={<UndoIcon />} onClick={() => onRollback(node.id)}>
                    回退节点
                  </Button>
                ) : null}
                <Tooltip title={open ? '收起环境参数' : '展开环境参数'}>
                  <IconButton size="small" onClick={() => setExpanded(open ? null : node.id)}>
                    <ExpandMoreIcon
                      fontSize="small"
                      sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: '0.2s' }}
                    />
                  </IconButton>
                </Tooltip>
              </Stack>

              {gate.inReview ? (
                <Box sx={{ mt: 1 }} data-testid={`review-notice-${node.id}`}>
                  <Typography variant="body2" color="warning.dark" fontWeight={600}>
                    标本卡于 {fmtTime(review?.since)} 修订，本节点已失效，原{review?.previousState === 'done' ? '已完成' : review?.previousState === 'rolledback' ? '已回退' : '待办'}记录保留；负责人确认适用性前不计入进度与交付。
                  </Typography>
                  {changedFields.length > 0 ? (
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                      {changedFields.map((c) => (
                        <Chip
                          key={c.field}
                          size="small"
                          color="warning"
                          variant="outlined"
                          label={`${c.label}：${c.oldValue} → ${c.newValue}`}
                        />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="error.main">
                      缺少登记时的卡片对照值（待补），补全前不能确认适用性。
                    </Typography>
                  )}
                </Box>
              ) : gate.baselineMissing ? (
                <Typography variant="body2" color="error.main" sx={{ mt: 1 }} data-testid={`baseline-notice-${node.id}`}>
                  该历史节点缺少卡片对照值（分类 / 层位 / 岩性 / 硬度），按待补处理；补全并确认前不能当作已确认节点。
                </Typography>
              ) : null}

              <Collapse in={open} unmountOnExit>
                <Divider sx={{ my: 1 }} />
                <Stack direction="row" spacing={2} flexWrap="wrap" rowGap={0.5}>
                  <Typography variant="body2">工具：{node.tools.length ? node.tools.join('、') : '—'}</Typography>
                  <Typography variant="body2">磨料：{node.abrasive || '—'}</Typography>
                  <Typography variant="body2">
                    胶种：{node.adhesive || '—'}
                    {node.adhesiveConc > 0 ? `（浓度 ${node.adhesiveConc} %）` : ''}
                  </Typography>
                  <Typography variant="body2">
                    环境：{node.tempC} ℃ / RH {node.rh} %
                  </Typography>
                  <Typography variant="body2">开始：{fmtTime(node.startedAt)}</Typography>
                  <Typography variant="body2">结束：{fmtTime(node.finishedAt)}</Typography>
                  <Typography variant="body2">
                    影像：前 {node.photoBeforeIds.length} 张 / 后 {node.photoAfterIds.length} 张
                  </Typography>
                  {onOpenPhoto ? (
                    <Button size="small" onClick={() => onOpenPhoto(node.id)}>
                      查看对照
                    </Button>
                  ) : null}
                </Stack>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  登记时卡片对照：
                  {node.baseline
                    ? `分类 ${node.baseline.taxon || '（空）'} · 层位 ${node.baseline.horizon || '（空）'} · 岩性 ${node.baseline.lithology || '（空）'} · 莫氏 ${node.baseline.matrixHardness}`
                    : '缺失（待补）'}
                </Typography>
                {node.reviewLogs && node.reviewLogs.length > 0 ? (
                  <Box sx={{ mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      复核留痕（{node.reviewLogs.length} 条）：
                    </Typography>
                    {node.reviewLogs
                      .slice(-3)
                      .reverse()
                      .map((log) => (
                        <Typography key={log.id} variant="caption" display="block" color="text.secondary">
                          · {fmtTime(log.at)}{' '}
                          {log.action === 'invalidated'
                            ? `卡片修订失效（原状态：${log.previousState}）${log.changedFields?.length ? `；变化：${log.changedFields.map((c) => c.label).join('、')}` : ''}`
                            : log.action === 'baselineFilled'
                              ? '补全卡片对照值'
                              : `负责人恢复（结论：${applicabilitySafe(log.applicability)}，确认人：${log.confirmer ?? '—'}）`}
                        </Typography>
                      ))}
                  </Box>
                ) : null}
              </Collapse>
            </Paper>
          </Box>
        );
      })}
    </Stack>
  );
}

/** 留痕里的复核结论可能来自旧字段缺失，安全取值 */
function applicabilitySafe(v: string | undefined): string {
  return v ?? '—';
}

export default ProcedureTimeline;
