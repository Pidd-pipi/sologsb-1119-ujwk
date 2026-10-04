# sologsb-1119 化石修复工序档案（gbfossilprep）

面向博物馆化石修复技师的工序留痕工作台：标本从入库、清修、加固到交付逐节点留痕，登记工具与胶种用量，并做修复前后对照。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动（推荐）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：**http://localhost:21819**

停止服务：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| UI | MUI（Material UI）v5 |
| 构建 | Vite 5 |
| 状态管理 | Zustand |
| 路由 | React Router v6（BrowserRouter） |
| 本地存储 | IndexedDB（Dexie 4），影像单独建表，含结构版本号与升级迁移 |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc 类型检查 + vite 构建
```

> 生产环境由 nginx 托管 `dist`，`nginx.conf` 已启用 `try_files $uri $uri/ /index.html;` 与 gzip。

复核联动的逻辑冒烟测试（内存 IndexedDB，需 `npm i -D tsx fake-indexeddb` 后执行）：

```bash
npx tsx scripts/smoke-review.mts
```

## 目录结构

```
sologsb-1119/
├── docker-compose.yml
├── .env.example
├── .env
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── main.tsx
        ├── router/index.tsx
        ├── types/{specimen,procedure,supply,photo}.ts
        ├── stores/{specimen,procedure,supply}Store.ts
        ├── components/common/{ProcedureTimeline,ProcedureReviewDialog,SpecimenCard,SpecimenCardEditDialog,BeforeAfterSlider,MeasureField}.tsx
        ├── hooks/{useSpecimenSearch,usePrepProgress}.ts
        ├── pages/{SpecimenList,SpecimenDetail,ProcedureForm,SupplyList,CompareView}.tsx
        └── utils/{db,review,unitConvert,id}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/specimens` | 标本台账：按号/分类/产地/状态筛选，状态分栏 | Specimen |
| `/specimens/:id` | 标本详情 + 工序时间线 + 影像留痕 | Specimen、PrepProcedure、PrepPhoto |
| `/procedures/new` | 新建工序节点：按类型动态出工具/磨料/胶种字段，序号跳号报错 | PrepProcedure、Specimen |
| `/supplies` | 工具材料台账：按种类分组、批号追溯、低量高亮、领用登记 | SupplyLot |
| `/compare/:specimenId` | 前后对照滑块联看 + 导出对照说明文本 | PrepPhoto、PrepProcedure |

`/` 重定向到 `/specimens`，未匹配路由同样兜底到 `/specimens`。

## 数据存储说明

- 数据库名 `gbfossilprep`，当前结构版本 **v3**（`localStorage['gbfossilprep:db-version']` 记录）。
- 四张表：`specimens`（标本）、`procedures`（修复工序）、`supplies`（工具材料批次 + 领用记录）、`photos`（修复影像 dataUrl 独立表）。
- v1 → v2 迁移：为老数据补齐 `state`、`tools`、`photoBeforeIds/AfterIds`、`issues`、`lowThreshold` 字段并新增索引。
- v2 → v3 迁移：标本卡增加 `revisions` 修订留痕；工序增加 `baseline`（登记时卡片对照值）、`review`（待复核信息）与 `reviewLogs`（复核留痕）。均为对象内新增字段，不涉及索引；历史工序无 `baseline`，运行期按「待补对照值」处理。
- 容器无状态、不挂载命名卷；换浏览器或清空站点数据即回到初始示范数据。
- 首次打开会灌入 2 件示范标本、2 个工序节点、4 个材料批次与 2 张留痕影像，便于直接查看。

## 卡片修订与工序复核联动

清修过程中标本卡的**分类鉴定 / 层位 / 围岩岩性 / 莫氏硬度**常被修正，修订与工序复核的联动规则：

1. **保存即失效**：在标本详情页「修订标本卡」保存后，上述字段一旦变化，该标本下全部已有工序立即失效、状态转为**待复核**，暂不计入完成度与交付校验；仅改其它字段不触发。
2. **旧值与原操作保留**：原工具、磨料、胶种、浓度、耗时、影像等操作记录不改动；每次卡片修订在标本 `revisions`、每次失效 / 补值 / 恢复在工序 `reviewLogs` 追加留痕（含字段旧值→新值、失效前工序状态、修订人）。
3. **负责人确认后恢复**：待复核工序经负责人确认工具 / 胶种适用性（适用 / 需调整工具 / 需更换胶种 / 不适用需返工）后，恢复到失效前的状态（待办 / 已完成 / 已回退），重新计入进度与交付。
4. **失败回滚 + 重试**：卡片保存走单事务（标本 + 工序），任一步写入失败则整体回滚——标本恢复原版本、不产生待复核标记；对话框保持打开并提供「重试保存」。
5. **缺对照值按待补处理**：历史工序没有登记时对照值（`baseline`）时标「待补对照值」，不能标记完成、不能确认复核、不计交付；在复核弹窗补全登记时的卡片值后，若与现状一致即恢复正常，若现状已变则转待复核再确认。
6. **交付闸门**：标本切到「待交付 / 已交付」时，若存在待复核或待补对照值节点会被拒绝并列出节点序号；前后对照页导出的对照说明同步标注未确认节点。

## 功能要点

- **工序序号不跳号**：新建节点时若序号大于「当前最大序号 + 1」直接报错并给出建议序号。
- **工序回退**：已完成节点可回退，回退后计入待办与回退计数。
- **低量高亮**：在库 ≤ 低量阈值的批次整行高亮并标注「低量」，剩余保质期为负时红色标注。
- **批号追溯**：按批号片段检索，行内直接展示该批次的领用明细。
- **前后对照**：滑块拖动联看修复前后影像，支持缩放与标注泡点，可导出/复制对照说明文本。
