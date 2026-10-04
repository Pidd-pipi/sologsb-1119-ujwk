import { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { useSpecimenStore } from '../../stores/specimenStore';
import { useProcedureStore } from '../../stores/procedureStore';
import { MeasureField } from './MeasureField';
import { changedBasisFields, snapshotFromSpecimen, reviewStatusFor } from '../../utils/review';
import { BASIS_FIELD_LABELS, type BasisField } from '../../types/procedure';
import type { Specimen } from '../../types/specimen';
import { hardnessLabel, mmToInch } from '../../utils/unitConvert';

export interface SpecimenEditDialogProps {
  open: boolean;
  specimen: Specimen;
  onClose: () => void;
  onToast: (msg: string) => void;
}

/**
 * 标本卡修订对话框：分类鉴定 / 层位 / 围岩岩性 / 莫氏硬度变化时，
 * 保存后受影响工序立即失效转待复核；其余字段仅更新卡片。
 */
export function SpecimenEditDialog({ open, specimen, onClose, onToast }: SpecimenEditDialogProps) {
  const updateSpecimenWithReview = useSpecimenStore((s) => s.updateSpecimenWithReview);
  const retryPendingWrite = useSpecimenStore((s) => s.retryPendingWrite);
  const pending = useSpecimenStore((s) => s.pendingWrites.find((w) => w.key === specimen.id));
  const procedures = useProcedureStore((s) => s.items);

  const [draft, setDraft] = useState<Specimen>(specimen);
  const [operator, setOperator] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(specimen);
      setOperator('');
      setError('');
    }
  }, [open, specimen]);

  const basisChanges = useMemo(
    () => changedBasisFields(specimen, draft as Partial<Specimen>),
    [specimen, draft],
  );

  const affectedCount = useMemo(() => {
    if (basisChanges.length === 0) return 0;
    const nextBasis = snapshotFromSpecimen(draft);
    return procedures
      .filter((p) => p.specimenId === specimen.id)
      .filter((p) => reviewStatusFor(p.basisSnapshot, nextBasis) !== p.reviewStatus).length;
  }, [basisChanges, procedures, specimen.id, draft]);

  const set = <K extends keyof Specimen>(key: K, value: Specimen[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = async () => {
    if (!draft.specimenNo.trim()) {
      setError('标本号必填');
      return;
    }
    if (!operator.trim()) {
      setError('请填写修订责任人');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const patch: Partial<Specimen> = {};
      (Object.keys(draft) as (keyof Specimen)[]).forEach((k) => {
        if (draft[k] !== specimen[k]) (patch as Record<string, unknown>)[k] = draft[k];
      });
      const result = await updateSpecimenWithReview(specimen.id, patch, operator);
      const parts = [`标本卡已更新（${specimen.specimenNo}）`];
      if (result.changed) parts.push(`基础字段变化 ${basisChanges.length} 项`);
      if (result.invalidated > 0) parts.push(`${result.invalidated} 道工序转入待复核 / 待补`);
      onToast(parts.join(' · '));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，已保留重试入口');
    } finally {
      setSaving(false);
    }
  };

  const retry = async () => {
    setSaving(true);
    setError('');
    try {
      await retryPendingWrite(specimen.id);
      onToast(`已重试保存标本卡（${specimen.specimenNo}）`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '重试失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>修订标本卡 · {specimen.specimenNo}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {pending ? (
            <Alert
              severity="warning"
              action={
                <Button color="inherit" size="small" onClick={retry} disabled={saving}>
                  重试保存
                </Button>
              }
            >
              上次写入失败（第 {pending.attempts} 次）：{pending.lastError}。已恢复原版本，可重试。
            </Alert>
          ) : null}

          <TextField
            size="small"
            label="标本号"
            value={draft.specimenNo}
            onChange={(e) => set('specimenNo', e.target.value)}
          />
          <TextField
            size="small"
            label={BASIS_FIELD_LABELS.taxon}
            value={draft.taxon}
            onChange={(e) => set('taxon', e.target.value)}
            helperText="分类鉴定变化会触发工序复核"
          />
          <Stack direction="row" spacing={1.5}>
            <TextField
              size="small"
              fullWidth
              label={BASIS_FIELD_LABELS.horizon}
              value={draft.horizon}
              onChange={(e) => set('horizon', e.target.value)}
            />
            <TextField
              size="small"
              fullWidth
              label="产地"
              value={draft.locality}
              onChange={(e) => set('locality', e.target.value)}
            />
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <TextField
              size="small"
              fullWidth
              label={BASIS_FIELD_LABELS.lithology}
              value={draft.lithology}
              onChange={(e) => set('lithology', e.target.value)}
            />
            <Box sx={{ flex: 1 }}>
              <MeasureField
                label={BASIS_FIELD_LABELS.matrixHardness}
                unit="Mohs"
                min={0.5}
                max={10}
                step={0.1}
                value={draft.matrixHardness}
                onChange={(v) => set('matrixHardness', v)}
                hint={hardnessLabel(draft.matrixHardness).label}
              />
            </Box>
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <TextField
              size="small"
              fullWidth
              label="匣位"
              value={draft.storageBox}
              onChange={(e) => set('storageBox', e.target.value)}
            />
            <Box sx={{ flex: 1 }}>
              <MeasureField
                label="重量"
                unit="g"
                min={1}
                max={200000}
                step={1}
                value={draft.weight}
                onChange={(v) => set('weight', v)}
              />
            </Box>
          </Stack>
          <TextField
            size="small"
            label="尺寸（mm，长×宽×高）"
            value={draft.dimensions}
            onChange={(e) => set('dimensions', e.target.value)}
            helperText={`换算约 ${mmToInch(Number(draft.dimensions.split('×')[0]) || 0)} inch（首边）`}
          />

          {basisChanges.length > 0 ? (
            <Alert severity="warning">
              基础字段变化 {basisChanges.map((f) => BASIS_FIELD_LABELS[f]).join('、')}
              {affectedCount > 0 ? `，将有 ${affectedCount} 道工序立即失效并转入待复核 / 待补` : '，当前工序对照值仍一致'}
              。原操作记录与旧值保留。
            </Alert>
          ) : (
            <Typography variant="caption" color="text.secondary">
              未修改分类 / 层位 / 岩性 / 硬度，保存不会触发工序复核。
            </Typography>
          )}

          <TextField
            size="small"
            label="修订责任人"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button variant="contained" onClick={submit} disabled={saving}>
          保存并复核
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default SpecimenEditDialog;
