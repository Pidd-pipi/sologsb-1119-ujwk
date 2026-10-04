import 'fake-indexeddb/auto';
import { assert } from 'node:console';
import { db } from '../src/utils/db.ts';
import { useSpecimenStore } from '../src/stores/specimenStore.ts';
import { useProcedureStore } from '../src/stores/procedureStore.ts';
import {
  baselineOf,
  diffBaseline,
  procedureGate,
  deliveryBlocked,
} from '../src/utils/review.ts';

let passed = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('✗ ' + msg);
    process.exit(1);
  }
  passed += 1;
  console.log('✓ ' + msg);
};

// 纯函数：diff / gate
const oldB = { taxon: 'A', horizon: 'H1', lithology: '泥岩', matrixHardness: 2.5 };
const newB = { taxon: 'A', horizon: 'H1', lithology: '砂岩', matrixHardness: 4 };
const changes = diffBaseline(oldB, newB);
ok(changes.length === 2 && changes.map((c) => c.field).join() === 'lithology,matrixHardness', 'diff 识别岩性与硬度变化（数值按数值比较）');
ok(diffBaseline(oldB, { ...oldB }).length === 0, '敏感字段无变化时 diff 为空');

// 准备数据
const spec = await useSpecimenStore.getState().add({
  specimenNo: 'T-001',
  taxon: 'A',
  horizon: 'H1',
  locality: '产地',
  lithology: '泥岩',
  matrixHardness: 2.5,
  dimensions: '100×100×100',
  weight: 1000,
  storageBox: 'X',
  status: '修复中',
});

const p1 = await useProcedureStore.getState().add({
  specimenId: spec.id,
  stepType: '清修',
  nodeName: 'n1',
  seq: 1,
  tools: ['气动笔'],
  abrasive: '800 目',
  adhesive: '',
  adhesiveConc: 0,
  durationMin: 30,
  tempC: 20,
  rh: 50,
  photoBeforeIds: [],
  photoAfterIds: [],
  operator: '甲',
  startedAt: Date.now(),
  state: 'done',
  finishedAt: Date.now(),
  baseline: baselineOf(spec),
});
// 历史工序（无 baseline）
const p2 = await useProcedureStore.getState().add({
  specimenId: spec.id,
  stepType: '加固',
  nodeName: 'n2',
  seq: 2,
  tools: ['渗透滴管'],
  abrasive: '',
  adhesive: 'Paraloid B-72',
  adhesiveConc: 5,
  durationMin: 30,
  tempC: 20,
  rh: 50,
  photoBeforeIds: [],
  photoAfterIds: [],
  operator: '乙',
  startedAt: Date.now(),
  state: 'done',
  finishedAt: Date.now(),
});

ok(!procedureGate(p1).baselineMissing && procedureGate(p1).countsAsDone, '有对照值的完成节点计入完成');
ok(procedureGate(p2).baselineMissing && !procedureGate(p2).countsAsDone, '缺对照值的历史节点按待补处理，不计完成');

// 完成守卫：缺对照值节点不能完成（构造一个 pending 无 baseline）
const p3 = await useProcedureStore.getState().add({
  specimenId: spec.id,
  stepType: '清修',
  nodeName: 'n3',
  seq: 3,
  tools: [],
  abrasive: '',
  adhesive: '',
  adhesiveConc: 0,
  durationMin: 10,
  tempC: 20,
  rh: 50,
  photoBeforeIds: [],
  photoAfterIds: [],
  operator: '丙',
  startedAt: Date.now(),
  state: 'pending',
});
let finishErr = '';
try {
  await useProcedureStore.getState().finish(p3.id);
} catch (e) {
  finishErr = e.message;
}
ok(/对照值/.test(finishErr), '缺对照值节点执行完成被守卫拒绝');

// 交付阻断
let blocked = deliveryBlocked(useProcedureStore.getState().items.filter((x) => x.specimenId === spec.id));
ok(/待补/.test(blocked), '存在待补节点时交付校验阻断');

// 卡片修订：改岩性 → 全部工序失效
const result = await useSpecimenStore.getState().saveCardRevision(spec.id, {
  patch: { lithology: '砂岩', matrixHardness: 4 },
  editor: '修订人',
});
ok(result.revision.changes.length === 2, '修订记录保存旧值→新值');
ok(result.affected.length === 3, '该标本下全部 3 个工序受影响');
const after1 = await db.procedures.get(p1.id);
ok(after1.state === 'review' && after1.review.previousState === 'done', '已完成工序转待复核且保留原状态 done');
ok(after1.finishedAt === undefined && after1.tools.includes('气动笔') && after1.adhesive === '', '原操作记录（工具/胶种）保留');
ok(after1.review.changedFields.some((c) => c.field === 'lithology' && c.oldValue === '泥岩'), '旧值保留在复核信息中');
const after2 = await db.procedures.get(p2.id);
ok(after2.state === 'review' && !after2.baseline, '缺对照值历史工序也转待复核，仍标记待补');

// 待复核期间不能完成
finishErr = '';
try {
  await useProcedureStore.getState().finish(p1.id);
} catch (e) {
  finishErr = e.message;
}
ok(/复核/.test(finishErr), '待复核节点执行完成被拒绝');

blocked = deliveryBlocked(useProcedureStore.getState().items.filter((x) => x.specimenId === spec.id));
ok(/待复核/.test(blocked), '待复核期间交付校验阻断');

// 卡片库内版本已更新、修订留痕保留
const specRow = await db.specimens.get(spec.id);
ok(specRow.lithology === '砂岩' && specRow.revisions.length === 1, '标本更新且修订留痕 1 条');

// 同一工序重复修订：累计变化、保留首次失效前状态
await useSpecimenStore.getState().saveCardRevision(spec.id, { patch: { matrixHardness: 5 } });
const after1b = await db.procedures.get(p1.id);
ok(after1b.state === 'review' && after1b.review.previousState === 'done', '重复修订不改变原失效前状态');
ok(after1b.review.changedFields.find((c) => c.field === 'matrixHardness').oldValue === '2.5', '硬度旧值保留为最早 2.5');
ok(after1b.reviewLogs.filter((l) => l.action === 'invalidated').length === 2, '两次失效各留一条痕');

// 负责人确认恢复
const resumed = await useProcedureStore.getState().confirmReview(p1.id, {
  confirmer: '负责人',
  applicability: '需调整工具',
  comment: '换更软磨头',
});
ok(resumed.state === 'done' && typeof resumed.finishedAt === 'number' && !resumed.review, '确认后恢复为原状态 done，带回 finishedAt');
ok(resumed.reviewLogs.at(-1).action === 'resumed' && resumed.reviewLogs.at(-1).applicability === '需调整工具', '复核结论留痕');

// 历史工序补对照值（当前卡片已是 砂岩/5；补登记时旧值 泥岩/2.5 → 仍在 review 中，保持待复核）
const filled = await useProcedureStore.getState().fillBaseline(p2.id, {
  taxon: 'A',
  horizon: 'H1',
  lithology: '泥岩',
  matrixHardness: 2.5,
});
ok(filled.state === 'review' && filled.baseline && filled.review.changedFields.length >= 2, '待复核中补对照值：仍停待复核，变化字段即时算出');
let confirmErr = '';
// 先直接确认一个 baselineMissing 的 pending 节点（p3 在修订后 state=review 且无 baseline）
try {
  await useProcedureStore.getState().confirmReview(p3.id, { confirmer: 'x', applicability: '适用' });
} catch (e) {
  confirmErr = e.message;
}
ok(/待补|对照值/.test(confirmErr), '缺对照值时确认被拒绝（补全前不能当作已确认）');
const filled3 = await useProcedureStore.getState().fillBaseline(p3.id, { taxon: 'A', horizon: 'H1', lithology: '泥岩', matrixHardness: 2.5 });
ok(filled3.state === 'review', 'p3 补对照值后因卡片已变仍处待复核');
const resumed3 = await useProcedureStore.getState().confirmReview(p3.id, { confirmer: '负责人', applicability: '适用' });
ok(resumed3.state === 'pending', '原待办工序确认后恢复 pending，重新进入进度');

// 写库失败回滚：临时让 db.specimens.put 抛错，验证原版本与待复核标记均未产生
const origPut = db.specimens.put.bind(db.specimens);
db.specimens.put = () => {
  throw new Error('磁盘满（模拟）');
};
const beforeFailSpec = (await db.specimens.get(spec.id)).lithology;
const reviewCountBefore = (await db.procedures.where('specimenId').equals(spec.id).toArray()).filter((x) => x.state === 'review').length;
let saveErr = '';
try {
  await useSpecimenStore.getState().saveCardRevision(spec.id, { patch: { lithology: '花岗岩' } });
} catch (e) {
  saveErr = e.message;
}
db.specimens.put = origPut;
ok(/磁盘满/.test(saveErr), '写入失败向上抛出，供页面保留重试入口');
const afterFailSpec = await db.specimens.get(spec.id);
ok(afterFailSpec.lithology === beforeFailSpec, '失败后标本恢复原版本（岩性未被改写）');
const reviewCountAfter = (await db.procedures.where('specimenId').equals(spec.id).toArray()).filter((x) => x.state === 'review').length;
ok(reviewCountAfter === reviewCountBefore, '失败后不产生新的待复核标记');
ok(afterFailSpec.revisions.length === 2, '失败不留修订残痕');

// 恢复后重试入口仍然可用：再保存一次成功
const retry = await useSpecimenStore.getState().saveCardRevision(spec.id, { patch: { lithology: '花岗岩' } });
ok(retry.specimen.lithology === '花岗岩' && retry.affected.length >= 1, '重试保存成功并重新触发失效');

// 边界：新标本上的历史待补工序，补入与当前卡片一致的对照值 → 不触发待复核，随后可正常完成
const spec2 = await useSpecimenStore.getState().add({
  specimenNo: 'T-002',
  taxon: 'B',
  horizon: 'H2',
  locality: '产地2',
  lithology: '灰岩',
  matrixHardness: 3.5,
  dimensions: '10×10×10',
  weight: 100,
  storageBox: 'Y',
  status: '待清修',
});
const p4 = await useProcedureStore.getState().add({
  specimenId: spec2.id,
  stepType: '清修',
  nodeName: 'n4',
  seq: 1,
  tools: ['剔针'],
  abrasive: '',
  adhesive: '',
  adhesiveConc: 0,
  durationMin: 5,
  tempC: 20,
  rh: 50,
  photoBeforeIds: [],
  photoAfterIds: [],
  operator: '丁',
  startedAt: Date.now(),
  state: 'pending',
});
const filled4 = await useProcedureStore.getState().fillBaseline(p4.id, baselineOf(spec2));
ok(filled4.state === 'pending' && filled4.baseline && !filled4.review, '对照值与当前卡片一致：补全后保持待办，不触发复核');
await useProcedureStore.getState().finish(p4.id);
const done4 = await db.procedures.get(p4.id);
ok(done4.state === 'done', '补全对照值后可正常标记完成并计入进度');
ok(procedureGate(done4).countsAsDone && deliveryBlocked([done4]) === '', '补全后的完成节点计入完成且放行交付');

console.log(`\n全部 ${passed} 项断言通过`);
process.exit(0);
