import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import LinearProgress from '@mui/material/LinearProgress';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import AddIcon from '@mui/icons-material/Add';
import CompareIcon from '@mui/icons-material/Compare';
import EditIcon from '@mui/icons-material/Edit';
import { useSpecimenStore } from '../stores/specimenStore';
import { useProcedureStore } from '../stores/procedureStore';
import { usePrepProgress } from '../hooks/usePrepProgress';
import { SpecimenCard } from '../components/common/SpecimenCard';
import { ProcedureTimeline } from '../components/common/ProcedureTimeline';
import { SpecimenCardEditDialog } from '../components/common/SpecimenCardEditDialog';
import { ProcedureReviewDialog } from '../components/common/ProcedureReviewDialog';
import { db } from '../utils/db';
import { PHOTO_STAGE_LABEL, type PrepPhoto } from '../types/photo';
import { SPECIMEN_STATUSES, type SpecimenStatus } from '../types/specimen';
import type { PrepProcedure } from '../types/procedure';

/** /specimens/:id 详情 + 工序时间线 + 影像 */
export default function SpecimenDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const specimen = useSpecimenStore((s) => s.items.find((it) => it.id === id));
  const setStatus = useSpecimenStore((s) => s.setStatus);
  const finish = useProcedureStore((s) => s.finish);
  const rollback = useProcedureStore((s) => s.rollback);
  const procedureItems = useProcedureStore((s) => s.items);
  const progress = usePrepProgress(id);
  const [photos, setPhotos] = useState<PrepPhoto[]>([]);
  const [toast, setToast] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<PrepProcedure | null>(null);
  const [statusError, setStatusError] = useState('');

  // 补对照值 / 确认后 store 内对象会更新，弹窗目标随之刷新（弹窗内补全后可能仍停在待复核）
  useEffect(() => {
    if (!reviewTarget) return;
    const fresh = procedureItems.find((p) => p.id === reviewTarget.id);
    if (fresh && fresh !== reviewTarget) setReviewTarget(fresh);
  }, [procedureItems, reviewTarget]);

  const loadPhotos = useCallback(async () => {
    if (!id) return;
    const rows = await db.photos.where('specimenId').equals(id).toArray();
    rows.sort((a, b) => b.capturedAt - a.capturedAt);
    setPhotos(rows);
  }, [id]);

  useEffect(() => {
    void loadPhotos();
  }, [loadPhotos]);

  if (!specimen) {
    return (
      <Stack spacing={2}>
        <Alert severity="warning">未找到该标本（可能已被删除）。</Alert>
        <Button component={RouterLink} to="/specimens" variant="outlined">
          返回标本台账
        </Button>
      </Stack>
    );
  }

  const beforePhotos = photos.filter((p) => p.stage === 'before');
  const afterPhotos = photos.filter((p) => p.stage === 'after');

  const changeStatus = async (next: SpecimenStatus) => {
    setStatusError('');
    if ((next === '待交付' || next === '已交付') && progress.deliveryBlockReason) {
      setStatusError(progress.deliveryBlockReason);
      return;
    }
    await setStatus(specimen.id, next);
    setToast(`状态已更新为「${next}」`);
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
        <Typography variant="h5" fontWeight={700}>
          标本详情 · {specimen.specimenNo}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          variant="outlined"
          startIcon={<EditIcon />}
          onClick={() => setEditOpen(true)}
          data-testid="edit-specimen-card"
        >
          修订标本卡
        </Button>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate(`/procedures/new?specimenId=${specimen.id}`)}
        >
          追加工序节点
        </Button>
        <Button
          variant="outlined"
          startIcon={<CompareIcon />}
          onClick={() => navigate(`/compare/${specimen.id}`)}
        >
          前后对照
        </Button>
      </Stack>

      {progress.review > 0 || progress.baselineMissing > 0 ? (
        <Alert severity="warning" data-testid="review-banner">
          {progress.review > 0
            ? `${progress.review} 个工序因标本卡修订已失效待复核，暂不计入进度与交付；负责人确认适用性后恢复。`
            : null}
          {progress.review > 0 && progress.baselineMissing > 0 ? ' ' : ''}
          {progress.baselineMissing > 0
            ? `${progress.baselineMissing} 个历史工序缺少卡片对照值，按待补处理，补全并确认前不能当作已确认节点。`
            : null}
        </Alert>
      ) : null}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '380px 1fr' }, gap: 2 }}>
        <Stack spacing={1.5}>
          <SpecimenCard item={specimen} />
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" gutterBottom>
              修复状态
            </Typography>
            <TextField
              select
              size="small"
              fullWidth
              value={specimen.status}
              onChange={(e) => {
                void changeStatus(e.target.value as SpecimenStatus);
              }}
            >
              {SPECIMEN_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            {statusError ? (
              <Alert severity="error" sx={{ mt: 1 }} data-testid="delivery-blocked">
                {statusError}
              </Alert>
            ) : null}
            {progress.deliveryBlockReason ? (
              <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.5 }}>
                交付校验未通过：{progress.deliveryBlockReason}
              </Typography>
            ) : null}
          </Paper>
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
              <Typography variant="subtitle2">工序完成度</Typography>
              <Chip size="small" label={`${progress.done}/${progress.total}`} />
              {progress.review > 0 ? <Chip size="small" color="warning" label={`待复核 ${progress.review}`} /> : null}
              {progress.baselineMissing > 0 ? (
                <Chip size="small" color="error" label={`待补对照值 ${progress.baselineMissing}`} />
              ) : null}
              {progress.gaps.length > 0 ? (
                <Chip size="small" color="error" label={`跳号 ${progress.gaps.join(',')}`} />
              ) : (
                <Chip size="small" color="success" variant="outlined" label="序号连续" />
              )}
            </Stack>
            <LinearProgress variant="determinate" value={progress.percent} sx={{ height: 10, borderRadius: 5 }} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              当前待办：
              {progress.current ? `#${progress.current.seq} ${progress.current.stepType} · ${progress.current.nodeName}` : '全部节点已完成'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              已回退节点 {progress.rolledback} 个 · 完成率 {progress.percent}%（待复核 / 待补节点不计入）
            </Typography>
          </Paper>

          {specimen.revisions && specimen.revisions.length > 0 ? (
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2" gutterBottom>
                标本卡修订留痕（{specimen.revisions.length} 次，旧值保留）
              </Typography>
              <Stack spacing={1}>
                {specimen.revisions
                  .slice(-3)
                  .reverse()
                  .map((rev) => (
                    <Box key={rev.id}>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(rev.at).toLocaleString('zh-CN')}
                        {rev.editor ? ` · ${rev.editor}` : ''} ·{' '}
                        {rev.changes.length === 0
                          ? '仅非敏感字段调整'
                          : `变化：${rev.changes.map((c) => c.label).join('、')} · 影响工序 ${rev.affectedProcedureIds.length} 个`}
                      </Typography>
                      {rev.changes.length > 0 ? (
                        <Stack direction="row" spacing={0.5} sx={{ mt: 0.25 }} flexWrap="wrap" useFlexGap>
                          {rev.changes.map((c) => (
                            <Chip
                              key={c.field}
                              size="small"
                              variant="outlined"
                              label={`${c.label}: ${c.oldValue} → ${c.newValue}`}
                            />
                          ))}
                        </Stack>
                      ) : null}
                    </Box>
                  ))}
              </Stack>
            </Paper>
          ) : null}
        </Stack>

        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              工序时间线
            </Typography>
            <ProcedureTimeline
              items={progress.list}
              onFinish={async (pid) => {
                try {
                  await finish(pid);
                  setToast('节点已完成');
                } catch (e) {
                  setToast((e as Error).message);
                }
              }}
              onRollback={async (pid) => {
                await rollback(pid);
                setToast('节点已回退');
              }}
              onReview={(p) => setReviewTarget(p)}
            />
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} gutterBottom>
              修复影像留痕（{photos.length} 张）
            </Typography>
            {photos.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                暂无影像条目，可在工序录入时挂接。
              </Typography>
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 1.5 }}>
                {photos.map((p) => (
                  <Paper key={p.id} variant="outlined" sx={{ overflow: 'hidden' }}>
                    <Box component="img" src={p.dataUrl} alt={p.caption} sx={{ width: '100%', display: 'block' }} />
                    <Box sx={{ p: 1 }}>
                      <Chip size="small" label={PHOTO_STAGE_LABEL[p.stage]} />
                      <Typography variant="caption" display="block" noWrap title={p.caption}>
                        {p.caption}
                      </Typography>
                    </Box>
                  </Paper>
                ))}
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              修复前 {beforePhotos.length} 张 / 修复后 {afterPhotos.length} 张，全部存于浏览器本地 IndexedDB 影像表。
            </Typography>
          </Paper>
        </Stack>
      </Box>

      <SpecimenCardEditDialog
        specimen={editOpen ? specimen : null}
        onClose={() => setEditOpen(false)}
        onSaved={(affectedCount, changedLabels) => {
          if (changedLabels.length === 0) {
            setToast('标本卡已保存（敏感字段无变化，工序无需复核）');
          } else {
            setToast(`卡片已保存：${changedLabels.join('、')} 已修订，${affectedCount} 个工序转待复核`);
          }
        }}
      />

      <ProcedureReviewDialog
        procedure={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onResumed={(p) => {
          setToast(`工序 #${p.seq} 已通过复核，恢复为「${p.state === 'done' ? '已完成' : p.state === 'rolledback' ? '已回退' : '待办'}」，重新计入进度与交付`);
        }}
      />

      <Snackbar open={!!toast} autoHideDuration={2600} onClose={() => setToast('')} message={toast} />
    </Stack>
  );
}
