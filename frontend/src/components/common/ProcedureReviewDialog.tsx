import { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { useSpecimenStore } from '../../stores/specimenStore';
import { useProcedureStore } from '../../stores/procedureStore';
import { CARD_BASELINE_FIELDS, type CardBaseline } from '../../types/specimen';
import {
  REVIEW_APPLICABILITY_OPTIONS,
  type PrepProcedure,
  type ReviewApplicability,
} from '../../types/procedure';
import { baselineOf, diffBaseline, procedureGate } from '../../utils/review';
import { MeasureField } from './MeasureField';

export interface ProcedureReviewDialogProps {
  /** null 表示关闭 */
  procedure: PrepProcedure | null;
  onClose: () => void;
  onResumed?: (procedure: PrepProcedure) => void;
}

/**
 * 工序复核弹窗：
 * 1. 历史工序缺对照值时先补「登记时的卡片值」（补全前不能确认）；
 * 2. 负责人对照变化字段，确认工具 / 胶种适用性后恢复原状态，重新进入进度与交付校验。
 */
export function ProcedureReviewDialog({ procedure, onClose, onResumed }: ProcedureReviewDialogProps) {
  const specimens = useSpecimenStore((s) => s.items);
  const fillBaseline = useProcedureStore((s) => s.fillBaseline);
  const confirmReview = useProcedureStore((s) => s.confirmReview);

  const [baselineDraft, setBaselineDraft] = useState<CardBaseline | null>(null);
  const [confirmer, setConfirmer] = useState('');
  const [applicability, setApplicability] = useState<ReviewApplicability>('适用');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const specimen = useMemo(
    () => specimens.find((s) => s.id === procedure?.specimenId),
    [specimens, procedure],
  );

  useEffect(() => {
    if (procedure) {
      setError('');
      setBusy(false);
      setConfirmer(procedure.operator ?? '');
      setApplicability('适用');
      setComment('');
      setBaselineDraft(
        procedure.baseline
          ? { ...procedure.baseline }
          : specimen
            ? baselineOf(specimen)
            : { taxon: '', horizon: '', lithology: '', matrixHardness: 3 },
      );
    }
  }, [procedure, specimen]);

  if (!procedure || !baselineDraft) return null;

  const gate = procedureGate(procedure);
  const currentBaseline = specimen ? baselineOf(specimen) : null;
  // 待复核且已有对照值：以挂起复核记录里的变化字段为准；
  // 缺对照值：按弹窗里补填的对照值与当前卡片即时计算。
  const previewChanges =
    procedure.state === 'review' && procedure.review?.baseline
      ? procedure.review.changedFields
      : currentBaseline
        ? diffBaseline(baselineDraft, currentBaseline)
        : [];
  const needFill = gate.baselineMissing;
  const canConfirm = !needFill && !!procedure.review && procedure.state === 'review';

  const runFill = async (): Promise<PrepProcedure | null> => {
    if (!baselineDraft.taxon.trim() || !baselineDraft.horizon.trim() || !baselineDraft.lithology.trim()) {
      setError('对照值不完整：分类、层位、岩性均不能为空，请按登记时的卡片值补全');
      return null;
    }
    if (!Number.isFinite(baselineDraft.matrixHardness) || baselineDraft.matrixHardness <= 0) {
      setError('莫氏硬度需为大于 0 的数值');
      return null;
    }
    setBusy(true);
    try {
      const updated = await fillBaseline(procedure.id, baselineDraft);
      setError('');
      return updated;
    } catch (e) {
      setError(`对照值写入失败，原版本未改动，可直接重试：${(e as Error).message}`);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleFillOnly = async () => {
    const updated = await runFill();
    if (!updated) return;
    if (updated.state !== 'review') {
      onResumed?.(updated);
      onClose();
    }
    // 仍在 review 时弹窗保持打开，继续走负责人确认
  };

  const runConfirm = async (target: PrepProcedure) => {
    if (!confirmer.trim()) {
      setError('请填写复核负责人');
      return;
    }
    setBusy(true);
    try {
      const updated = await confirmReview(target.id, {
        confirmer: confirmer.trim(),
        applicability,
        comment: comment.trim() || undefined,
      });
      setError('');
      onResumed?.(updated);
      onClose();
    } catch (e) {
      setError(`复核确认失败，原状态未改动，可直接重试：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    let target = procedure;
    if (needFill) {
      const filled = await runFill();
      if (!filled) return;
      target = filled;
    }
    if (target.state !== 'review') {
      onResumed?.(target);
      onClose();
      return;
    }
    await runConfirm(target);
  };

  return (
    <Dialog open={!!procedure} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        工序复核 · #{procedure.seq} {procedure.stepType} · {procedure.nodeName}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error" data-testid="review-error">{error}</Alert> : null}

          <Alert severity={needFill ? 'error' : 'warning'}>
            {needFill
              ? '该工序缺少登记时的卡片对照值，按待补处理：请先补全对照值，且经负责人确认适用性后才能恢复。'
              : '标本卡修订后本工序已失效并转待复核；原操作记录（工具 / 胶种 / 耗时 / 影像）与旧值均保留。负责人确认适用性后，工序恢复原状态并重新计入进度与交付。'}
          </Alert>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" gutterBottom>
              登记时卡片对照值{needFill ? '（待补，请按原卡片填写）' : ''}
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                size="small"
                label="分类鉴定"
                required
                value={baselineDraft.taxon}
                disabled={!needFill}
                onChange={(e) => setBaselineDraft({ ...baselineDraft, taxon: e.target.value })}
              />
              <TextField
                size="small"
                label="层位"
                required
                value={baselineDraft.horizon}
                disabled={!needFill}
                onChange={(e) => setBaselineDraft({ ...baselineDraft, horizon: e.target.value })}
              />
              <TextField
                size="small"
                label="围岩岩性"
                required
                value={baselineDraft.lithology}
                disabled={!needFill}
                onChange={(e) => setBaselineDraft({ ...baselineDraft, lithology: e.target.value })}
              />
              <Box>
                <MeasureField
                  label="围岩莫氏硬度"
                  unit="Mohs"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={baselineDraft.matrixHardness}
                  disabled={!needFill}
                  onChange={(v) => setBaselineDraft({ ...baselineDraft, matrixHardness: v })}
                />
              </Box>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" gutterBottom>
              字段变化对照
            </Typography>
            {!needFill && currentBaseline ? null : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                当前卡片：
                {currentBaseline
                  ? CARD_BASELINE_FIELDS.map((f) => `${f.label} ${String(currentBaseline[f.key])}`).join(' · ')
                  : '未找到标本'}
              </Typography>
            )}
            {previewChanges.length === 0 ? (
              <Typography variant="body2" color="text.secondary" data-testid="review-no-changes">
                对照值与当前卡片一致，无敏感字段变化。
              </Typography>
            ) : (
              <Table size="small" data-testid="review-changes">
                <TableHead>
                  <TableRow>
                    <TableCell>字段</TableCell>
                    <TableCell>旧值（对照）</TableCell>
                    <TableCell>新值（当前卡片）</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {previewChanges.map((c) => (
                    <TableRow key={c.field}>
                      <TableCell>{c.label}</TableCell>
                      <TableCell>{c.oldValue}</TableCell>
                      <TableCell>{c.newValue}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
              <Chip size="small" label={`登记工具：${procedure.tools.join('、') || '—'}`} variant="outlined" />
              <Chip
                size="small"
                label={`登记胶种：${procedure.adhesive || '—'}${procedure.adhesiveConc > 0 ? ` ${procedure.adhesiveConc}%` : ''}`}
                variant="outlined"
              />
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" gutterBottom>
              负责人适用性确认
            </Typography>
            <Stack spacing={1.5}>
              <TextField
                size="small"
                label="复核负责人"
                required
                value={confirmer}
                onChange={(e) => setConfirmer(e.target.value)}
              />
              <TextField
                select
                size="small"
                label="工具 / 胶种适用性"
                value={applicability}
                onChange={(e) => setApplicability(e.target.value as ReviewApplicability)}
              >
                {REVIEW_APPLICABILITY_OPTIONS.map((a) => (
                  <MenuItem key={a} value={a}>
                    {a}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                label="复核备注（可选）"
                multiline
                minRows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </Stack>
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        {needFill ? (
          <Button variant="outlined" onClick={handleFillOnly} disabled={busy} data-testid="review-fill-only">
            仅保存对照值
          </Button>
        ) : null}
        <Button
          variant="contained"
          color={canConfirm || needFill ? 'warning' : 'primary'}
          onClick={handleConfirm}
          disabled={busy}
          data-testid="review-confirm"
        >
          {needFill
            ? procedure.state === 'review'
              ? '补全对照值并确认恢复'
              : '补全对照值'
            : canConfirm
              ? '确认适用性并恢复'
              : '确认恢复'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
