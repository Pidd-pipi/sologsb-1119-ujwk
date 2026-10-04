import { useEffect, useMemo, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import { useSpecimenStore } from '../../stores/specimenStore';
import { useProcedureStore } from '../../stores/procedureStore';
import { MeasureField } from './MeasureField';
import { SPECIMEN_STATUSES, type Specimen } from '../../types/specimen';
import { baselineOf, diffBaseline, procedureGate } from '../../utils/review';
import { hardnessLabel } from '../../utils/unitConvert';

export interface SpecimenCardEditDialogProps {
  specimen: Specimen | null;
  onClose: () => void;
  onSaved?: (affectedCount: number, changedLabels: string[]) => void;
}

/**
 * 标本卡修订对话框。
 * - 分类鉴定 / 层位 / 围岩岩性 / 莫氏硬度变化时，保存后受影响工序立即失效转待复核；
 * - 保存走单事务，失败则标本恢复原版本、不产生待复核标记，表单与重试入口保留；
 * - 非敏感字段（产地、尺寸等）正常保存，不触发复核。
 */
export function SpecimenCardEditDialog({ specimen, onClose, onSaved }: SpecimenCardEditDialogProps) {
  const saveCardRevision = useSpecimenStore((s) => s.saveCardRevision);
  const procedures = useProcedureStore((s) => s.items);

  const [draft, setDraft] = useState<Specimen | null>(null);
  const [editor, setEditor] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (specimen) {
      setDraft({ ...specimen });
      setEditor('');
      setNote('');
      setError('');
      setBusy(false);
    }
  }, [specimen]);

  const affected = useMemo(
    () => (specimen ? procedures.filter((p) => p.specimenId === specimen.id) : []),
    [procedures, specimen],
  );

  if (!specimen || !draft) return null;

  const before = baselineOf(specimen);
  const after = baselineOf(draft);
  const changes = diffBaseline(before, after);
  const pendingReviewCount = affected.filter((p) => procedureGate(p).inReview).length;
  const baselineMissingCount = affected.filter((p) => procedureGate(p).baselineMissing).length;

  const save = async () => {
    if (!draft.specimenNo.trim()) {
      setError('标本号必填');
      return;
    }
    if (!Number.isFinite(draft.matrixHardness) || draft.matrixHardness <= 0) {
      setError('莫氏硬度需为大于 0 的数值');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await saveCardRevision(draft.id, {
        patch: {
          specimenNo: draft.specimenNo.trim(),
          taxon: draft.taxon,
          horizon: draft.horizon,
          locality: draft.locality,
          lithology: draft.lithology,
          matrixHardness: draft.matrixHardness,
          dimensions: draft.dimensions,
          weight: draft.weight,
          storageBox: draft.storageBox,
          status: draft.status,
        },
        editor,
        note,
      });
      onSaved?.(result.affected.length, changes.map((c) => c.label));
      onClose();
    } catch (e) {
      // 事务已整体回滚：库内标本仍是原版本、工序也没有待复核标记；保留表单供重试
      setError(`保存失败，卡片与工序均已恢复原版本（未产生待复核标记），可修改后重试：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!specimen} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>修订标本卡 · {specimen.specimenNo}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {error ? (
            <Alert
              severity="error"
              data-testid="specimen-save-error"
              action={
                <Button color="inherit" size="small" disabled={busy} onClick={save}>
                  重试保存
                </Button>
              }
            >
              {error}
            </Alert>
          ) : null}

          <Alert severity="info">
            修改「分类鉴定 / 层位 / 围岩岩性 / 莫氏硬度」并保存后，该标本下已有工序将立即失效、转待复核；
            原工具 / 胶种等操作记录与旧值保留，负责人重新确认适用性后才恢复并重新计入进度与交付。
          </Alert>

          <TextField
            size="small"
            label="标本号"
            required
            value={draft.specimenNo}
            onChange={(e) => setDraft({ ...draft, specimenNo: e.target.value })}
          />
          <TextField
            size="small"
            label="分类鉴定"
            value={draft.taxon}
            onChange={(e) => setDraft({ ...draft, taxon: e.target.value })}
          />
          <Stack direction="row" spacing={1.5}>
            <TextField
              size="small"
              fullWidth
              label="层位"
              value={draft.horizon}
              onChange={(e) => setDraft({ ...draft, horizon: e.target.value })}
            />
            <TextField
              size="small"
              fullWidth
              label="产地"
              value={draft.locality}
              onChange={(e) => setDraft({ ...draft, locality: e.target.value })}
            />
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <TextField
              size="small"
              fullWidth
              label="围岩岩性"
              value={draft.lithology}
              onChange={(e) => setDraft({ ...draft, lithology: e.target.value })}
            />
            <TextField
              size="small"
              fullWidth
              label="匣位"
              value={draft.storageBox}
              onChange={(e) => setDraft({ ...draft, storageBox: e.target.value })}
            />
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <Box sx={{ flex: 1 }}>
              <MeasureField
                label="围岩莫氏硬度"
                unit="Mohs"
                min={0.1}
                max={10}
                step={0.1}
                value={draft.matrixHardness}
                onChange={(v) => setDraft({ ...draft, matrixHardness: v })}
                hint={hardnessLabel(draft.matrixHardness).label}
              />
            </Box>
            <Box sx={{ flex: 1 }}>
              <MeasureField
                label="重量"
                unit="g"
                min={1}
                max={200000}
                step={1}
                value={draft.weight}
                onChange={(v) => setDraft({ ...draft, weight: v })}
              />
            </Box>
          </Stack>
          <TextField
            size="small"
            label="尺寸（mm，长×宽×高）"
            value={draft.dimensions}
            onChange={(e) => setDraft({ ...draft, dimensions: e.target.value })}
          />
          <TextField
            select
            size="small"
            label="状态"
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value as Specimen['status'] })}
          >
            {SPECIMEN_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction="row" spacing={1.5}>
            <TextField
              size="small"
              fullWidth
              label="修订人（可选）"
              value={editor}
              onChange={(e) => setEditor(e.target.value)}
            />
            <TextField
              size="small"
              fullWidth
              label="修订说明（可选）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Stack>

          <Box>
            {changes.length > 0 ? (
              <Alert severity="warning" data-testid="revision-impact">
                <Typography variant="body2" fontWeight={600}>
                  保存后将有 {affected.length} 个工序立即失效转待复核
                  {pendingReviewCount > 0 ? `（其中 ${pendingReviewCount} 个已在待复核，累计变化不重置）` : ''}
                  {baselineMissingCount > 0 ? `，${baselineMissingCount} 个历史工序还需补对照值` : ''}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                  {changes.map((c) => (
                    <Chip
                      key={c.field}
                      size="small"
                      color="warning"
                      label={`${c.label}：${c.oldValue} → ${c.newValue}`}
                    />
                  ))}
                </Stack>
              </Alert>
            ) : (
              <Typography variant="caption" color="text.secondary">
                敏感字段无变化，本次保存不触发工序复核。
              </Typography>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button variant="contained" onClick={save} disabled={busy} data-testid="specimen-save">
          保存修订
        </Button>
      </DialogActions>
    </Dialog>
  );
}
