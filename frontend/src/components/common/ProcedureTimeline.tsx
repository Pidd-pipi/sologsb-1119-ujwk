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
import Alert from '@mui/material/Alert';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import UndoIcon from '@mui/icons-material/Undo';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import HistoryEduIcon from '@mui/icons-material/HistoryEdu';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import type { PrepProcedure, BasisSnapshot } from '../../types/procedure';
import { REVIEW_STATUS_META, diffBasis, isBlocking } from '../../utils/review';

export interface ProcedureTimelineProps {
  items: PrepProcedure[];
  onFinish?: (id: string) => void;
  onRollback?: (id: string) => void;
  onOpenPhoto?: (procedureId: string) => void;
  /** 确认工具 / 胶种适用性（待复核工序） */
  onConfirm?: (id: string) => void;
  /** 补全对照值（待补工序） */
  onSupplement?: (id: string) => void;
  /** 标本当前基础字段，用于展示待复核差异 */
  currentBasis?: BasisSnapshot;
}

function fmtTime(ts?: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtBasis(s?: BasisSnapshot): string {
  if (!s) return '—';
  return `分类 ${s.taxon || '—'} · 层位 ${s.horizon || '—'} · 岩性 ${s.lithology || '—'} · 硬度 ${s.matrixHardness}`;
}

/**
 * 纵向工序节点流：步骤图标、状态、复核状态、耗时、环境参数折叠区。
 * 待复核 / 待补工序不计入进度，需负责人确认或补全后恢复。
 * 被标本详情页、工序录入页消费。
 */
export function ProcedureTimeline({
  items,
  onFinish,
  onRollback,
  onOpenPhoto,
  onConfirm,
  onSupplement,
  currentBasis,
}: ProcedureTimelineProps) {
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
        const isDone = node.state === 'done';
        const open = expanded === node.id;
        const blocking = isBlocking(node.reviewStatus);
        const meta = REVIEW_STATUS_META[node.reviewStatus ?? 'tosupply'];
        const changes =
          node.reviewStatus === 'toreview' && currentBasis
            ? diffBasis(node.basisSnapshot, currentBasis)
            : [];
        return (
          <Box key={node.id} sx={{ display: 'flex', gap: 1.5 }}>
            <Stack alignItems="center" sx={{ pt: 0.5 }}>
              {isDone ? (
                <CheckCircleIcon color="success" fontSize="small" />
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
                borderColor: blocking && node.reviewStatus === 'toreview' ? 'warning.main' : undefined,
                borderStyle: blocking ? 'solid' : undefined,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip size="small" label={`#${node.seq}`} color="primary" variant="outlined" />
                <Typography variant="subtitle2" fontWeight={700}>
                  {node.stepType} · {node.nodeName}
                </Typography>
                <Chip
                  size="small"
                  label={node.state === 'done' ? '已完成' : node.state === 'rolledback' ? '已回退' : '待办'}
                  color={isDone ? 'success' : node.state === 'rolledback' ? 'error' : 'default'}
                />
                <Chip
                  size="small"
                  variant={node.reviewStatus === 'current' ? 'outlined' : 'filled'}
                  color={meta.color}
                  icon={node.reviewStatus === 'current' ? <VerifiedUserIcon /> : undefined}
                  label={meta.label}
                />
                <Typography variant="caption" color="text.secondary">
                  耗时 {node.durationMin} min · 责任人 {node.operator}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {node.reviewStatus === 'toreview' && onConfirm ? (
                  <Button
                    size="small"
                    color="warning"
                    variant="contained"
                    startIcon={<VerifiedUserIcon />}
                    onClick={() => onConfirm(node.id)}
                  >
                    确认适用性
                  </Button>
                ) : null}
                {node.reviewStatus === 'tosupply' && onSupplement ? (
                  <Button
                    size="small"
                    color="error"
                    variant="contained"
                    startIcon={<HistoryEduIcon />}
                    onClick={() => onSupplement(node.id)}
                  >
                    补全对照值
                  </Button>
                ) : null}
                {!isDone && !blocking && onFinish ? (
                  <Button size="small" variant="contained" onClick={() => onFinish(node.id)}>
                    完成节点
                  </Button>
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

              {blocking ? (
                <Alert
                  severity={node.reviewStatus === 'toreview' ? 'warning' : 'error'}
                  sx={{ mt: 1, py: 0.5 }}
                >
                  {node.reviewStatus === 'toreview' ? (
                    <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                      <Typography variant="body2">基础字段已修订，工具 / 胶种适用性待确认：</Typography>
                      {changes.map((c) => (
                        <Stack key={c.field} direction="row" spacing={0.5} alignItems="center">
                          <Typography variant="caption" color="text.secondary" sx={{ textDecoration: 'line-through' }}>
                            {String(c.old)}
                          </Typography>
                          <ArrowForwardIcon fontSize="inherit" color="action" />
                          <Typography variant="caption" fontWeight={600}>
                            {String(c.next)}
                          </Typography>
                        </Stack>
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="body2">
                      缺少对照值快照，补全前不计入进度与交付校验。
                    </Typography>
                  )}
                </Alert>
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
                  <Typography variant="body2" sx={{ width: '100%' }}>
                    对照值：{fmtBasis(node.basisSnapshot)}
                    {node.basisHistory && node.basisHistory.length > 1
                      ? `（历次快照 ${node.basisHistory.length} 次，旧值已保留）`
                      : ''}
                  </Typography>
                  {node.lastConfirmedBy ? (
                    <Typography variant="body2" color="text.secondary">
                      最近确认：{node.lastConfirmedBy} · {fmtTime(node.lastConfirmedAt)}
                    </Typography>
                  ) : null}
                  {onOpenPhoto ? (
                    <Button size="small" onClick={() => onOpenPhoto(node.id)}>
                      查看对照
                    </Button>
                  ) : null}
                </Stack>
              </Collapse>
            </Paper>
          </Box>
        );
      })}
    </Stack>
  );
}

export default ProcedureTimeline;
