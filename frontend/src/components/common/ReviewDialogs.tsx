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
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useProcedureStore } from '../../stores/procedureStore';
import { useSpecimenStore } from '../../stores/specimenStore';
import { MeasureField } from './MeasureField';
import { snapshotFromSpecimen, diffBasis } from '../../utils/review';
import { BASIS_FIELD_LABELS, type BasisField, type BasisSnapshot } from '../../types/procedure';

export interface ReviewDialogsProps {
  /** 待确认适用性的工序 id */
  confirmId: string | null;
  /** 待补全对照值的工序 id */
  supplementId: string | null;
  onClose: () => void;
  onToast: (msg: string) => void;
}

const labelOf = (f: BasisField) => BASIS_FIELD_LABELS[f];

/**
 * 工序复核对话框：
 * - 待复核：展示基础字段修订前后差异，责任人确认适用性后按当前值重新立对照值
 * - 待补：缺对照值，补全前不能当成已确认
 */
export function ReviewDialogs({ confirmId, supplementId, onClose, onToast }: ReviewDialogsProps) {
  const procedure = useProcedureStore((s) =>
    s.items.find((it) => it.id === (confirmId ?? supplementId)),
  );
  const specimens = useSpecimenStore((s) => s.items);
  const confirmApplicability = useProcedureStore((s) => s.confirmApplicability);
  const supplementBasis = useProcedureStore((s) => s.supplementBasis);

  const specimen = useMemo(
    () => specimens.find((it) => it.id === procedure?.specimenId),
    [specimens, procedure],
  );
  const currentBasis = useMemo(
    () => (specimen ? snapshotFromSpecimen(specimen) : undefined),
    [specimen],
  );

  const [operator, setOperator] = useState('');
  const [basis, setBasis] = useState<BasisSnapshot | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (procedure) {
      setOperator(procedure.lastConfirmedBy || procedure.operator || '');
      setBasis(currentBasis ?? null);
      setError('');
    }
  }, [procedure, currentBasis]);

  const changes = useMemo(
    () => (procedure && currentBasis ? diffBasis(procedure.basisSnapshot, currentBasis) : []),
    [procedure, currentBasis],
  );

  if (!procedure || !currentBasis || !basis) return null;

  const mode = confirmId ? 'confirm' : 'supplement';

  const handleConfirm = async () => {
    if (!operator.trim()) {
      setError('请填写确认责任人');
      return;
    }
    try {
      await confirmApplicability(procedure.id, operator, currentBasis);
      onToast(`工序 #${procedure.seq} 已确认适用性，恢复进度与交付校验`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认失败，请重试');
    }
  };

  const handleSupplement = async () => {
    if (!operator.trim()) {
      setError('请填写补全责任人');
      return;
    }
    if (!basis.taxon.trim() || !basis.lithology.trim()) {
      setError('分类鉴定与围岩岩性必填');
      return;
    }
    try {
      await supplementBasis(procedure.id, basis, operator);
      onToast(`工序 #${procedure.seq} 对照值已补全，转为已确认`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '补全失败，请重试');
    }
  };

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>
        {mode === 'confirm' ? '确认工序适用性' : '补全工序对照值'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Typography variant="body2" color="text.secondary">
            {procedure.stepType} · #{procedure.seq} {procedure.nodeName}
            {specimen ? `（${specimen.specimenNo}）` : ''}
          </Typography>

          {mode === 'confirm' ? (
            <>
              <Alert severity="warning">
                标本基础字段已修订，原按旧值选择的工具 / 胶种适用性待确认。确认后将按当前值重新立对照值，工序恢复进度与交付校验。
              </Alert>
              {changes.length > 0 ? (
                <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                  {changes.map((c) => (
                    <Stack key={c.field} direction="row" spacing={1} alignItems="center" sx={{ py: 0.25 }}>
                      <Typography variant="body2" sx={{ minWidth: 88 }}>
                        {c.label}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" noWrap sx={{ textDecoration: 'line-through' }}>
                        {String(c.old)}
                      </Typography>
                      <ArrowForwardIcon fontSize="small" color="action" />
                      <Typography variant="body2" noWrap>
                        {String(c.next)}
                      </Typography>
                    </Stack>
                  ))}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  基础字段无差异，确认后即恢复为已确认。
                </Typography>
              )}
              <TextField
                size="small"
                label="确认责任人"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
                helperText="由负责人签字确认工具 / 胶种在当前围岩条件下仍适用"
              />
            </>
          ) : (
            <>
              <Alert severity="error">
                该工序缺少对照值快照，补全前不能当成已确认，也不计入进度与交付校验。请按工序施工时的标本基础字段补全。
              </Alert>
              <Stack direction="row" spacing={1.5}>
                <TextField
                  size="small"
                  fullWidth
                  label={labelOf('taxon')}
                  value={basis.taxon}
                  onChange={(e) => setBasis({ ...basis, taxon: e.target.value })}
                />
                <TextField
                  size="small"
                  fullWidth
                  label={labelOf('horizon')}
                  value={basis.horizon}
                  onChange={(e) => setBasis({ ...basis, horizon: e.target.value })}
                />
              </Stack>
              <Stack direction="row" spacing={1.5}>
                <TextField
                  size="small"
                  fullWidth
                  label={labelOf('lithology')}
                  value={basis.lithology}
                  onChange={(e) => setBasis({ ...basis, lithology: e.target.value })}
                />
                <Box sx={{ flex: 1 }}>
                  <MeasureField
                    label={labelOf('matrixHardness')}
                    unit="Mohs"
                    min={0.5}
                    max={10}
                    step={0.1}
                    value={basis.matrixHardness}
                    onChange={(v) => setBasis({ ...basis, matrixHardness: v })}
                  />
                </Box>
              </Stack>
              <TextField
                size="small"
                label="补全责任人"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        {mode === 'confirm' ? (
          <Button variant="contained" onClick={handleConfirm}>
            确认适用性
          </Button>
        ) : (
          <Button variant="contained" onClick={handleSupplement}>
            补全并确认
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default ReviewDialogs;
