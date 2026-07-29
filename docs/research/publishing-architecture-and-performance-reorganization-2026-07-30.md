# 出版流水线架构重整与性能优化调研

- 日期：2026-07-30
- 调研范围：上传、分析、草稿准备、草稿预览、发布、已发布阅读；目录与依赖边界、重复计算、事务/恢复边界及性能。
- 证据优先级：本文件以当前源码和本地可读取的 15 本基准产物为事实来源。`specs/006`、决策记录和旧调研只用于发现待核对的意图，不能覆盖相反的运行证据。
- 工作树：调研时 `HEAD` 为 `c176fddfd1e103e7c14d38b823ee2a000f6345fd`，另有三份未跟踪 research 文件；本次不读取或修改它们。

## 结论

当前慢点不是一个可以只靠调大并发或 SQLite 参数解决的问题。流水线有两层问题：

1. 同一配置在 `build_preview` 与 `build_publish` 中各做一次完整的配置化文档编译、资源解析、图片检查、语义渲染和页面组装；发布请求还必须再排队等待第二次构建。
2. 代码目录把纯内容算法、Reader UI、数据库仓储、存储耐久化、worker 协议和 HTTP 服务混在 `compiler`、`services`、`jobs/handlers` 等目录中，形成反向依赖。这使得一次性能修改很容易触到事务、鉴权或渲染输出。

应当先建立可复现的性能与正确性门禁，随后做一次有边界的模块迁移和算法线性化，最后以一次明确切换把两条构建链替换为单一的 `build_candidate`。核心只公开
`BuildCandidateCommand → CompiledBook → AsyncIterable<RenderedPage> → CandidateBuildArtifact`
四个边界，不为每个处理动词建立公共 IR。不能在旧 `build_preview`/`build_publish` 上继续
叠加缓存、兼容分支或转发导出；这只会让目录更乱，且仍保留第二次语义构建。

## 已核对事实

### 当前执行链

| 阶段     | 当前实现                                                                                                                                      | 事实与影响                                                                                                                                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 上传     | `ImportUploadService.store()` 将 ZIP 写入 `.part`、`fsync`、改名，再在 SQLite 事务中创建 import 和 `analyze_import` job。                     | 文件耐久化在 DB 事务之前；进程在改名后、事务前终止会留下未注册上传目录。见 [`src/services/import-upload.ts`](../../src/services/import-upload.ts:128)。                                                                                                                  |
| 分析     | 子进程安全解压并写 `analysis-result.json`；父 worker 持久化候选，随后另行创建 `prepare_draft` job。                                           | `persistAnalyzeImportArtifact()` 与创建下游 job 不是同一事务边界；前者成功、后者未执行会留下 `preparing` import。见 [`src/worker/index.ts`](../../src/worker/index.ts:208)。                                                                                             |
| 准备     | 又一次解压 ZIP，运行 typography、Markdown 解析、版面/PDF/目录证据、资源检查、source regions 与结构提议。                                      | `prepareDraft()` 从同一 `original.zip` 再调用 `extractZipFile()`；分析与准备重复解压。见 [`src/jobs/handlers/analyze-import.ts`](../../src/jobs/handlers/analyze-import.ts:57) 和 [`src/jobs/handlers/prepare-draft.ts`](../../src/jobs/handlers/prepare-draft.ts:121)。 |
| 草稿落盘 | `SourceSnapshotService` 先复制/改名并登记 source；后续单独写 config、analysis、DB revision、preview job 与 preview 行。                       | 一次准备完成跨文件和多次 DB 操作；初始导入路径没有把全部后续状态收在单一事务中。见 [`src/jobs/handlers/prepare-draft.ts`](../../src/jobs/handlers/prepare-draft.ts:578)。                                                                                                |
| 保存草稿 | 管理 PATCH 在 Web 进程读取整份 Markdown、校验 hash，并直接调用 `prepareConfiguredDocument()`，然后落盘并排 preview job。                      | 整本编译落在请求路径，草稿大小直接拉长 PATCH 延迟，违反“构建留给后台”的架构目标。见 [`src/services/config-revisions.ts`](../../src/services/config-revisions.ts:345)。                                                                                                   |
| 预览     | `build_preview` 再读 Markdown/config，完整 `prepareConfiguredDocument()`，重新解析资源/检查图片，渲染每页、写完整 ReaderShell 页面。          | 页面 render 使用无界 `Promise.all`，并在输出阶段重复找 page/heading。见 [`src/jobs/handlers/build-preview.ts`](../../src/jobs/handlers/build-preview.ts:259)。                                                                                                           |
| 发布     | API 仅验证 preview 后排 `build_publish` job；`version-builder` 又完整编译、复制、渲染和建搜索，然后 finalizer 注册 ready version 并 promote。 | “预览与发布一致”目前靠第二次独立构建维持，既慢又扩大不一致和崩溃边界。见 [`src/pages/api/manage/books/[bookId]/publish.ts`](../../src/pages/api/manage/books/[bookId]/publish.ts:96) 与 [`src/compiler/version-builder.ts`](../../src/compiler/version-builder.ts:286)。 |
| 阅读     | Reader 只读取 `current_version_id` 指向的 immutable HTML，未在请求中编译正文。                                                                | 这是应保留的正确边界；但 manifest cache 未 single-flight，page/asset 解析仍线性查找。见 [`src/services/published-book.ts`](../../src/services/published-book.ts:244)。                                                                                                   |

### 基准证据

本地 artifact [` .cache/15-book-performance/canonical/results.json`](../../.cache/15-book-performance/canonical/results.json) 的 15/15 结果为 `passed`。该路径被 gitignore，不能作为提交后的永久性能证据；它仍足以描述此工作树的热点。

| 指标                             |              测得值 | 解释                                                                                                                            |
| -------------------------------- | ------------------: | ------------------------------------------------------------------------------------------------------------------------------- |
| 15 本端到端 wall                 |           901.234 s | 基准报告汇总值，包含 job 外开销。见 [`docs/research/15-book-publishing-performance.md`](15-book-publishing-performance.md:15)。 |
| `analyze_import` DB job 时长总和 |            37.297 s | 相对较小，但其解压与下一阶段重复。                                                                                              |
| `prepare_draft` DB job 时长总和  |           409.815 s | 最大阶段。                                                                                                                      |
| `build_preview` DB job 时长总和  |           196.332 s | 与发布语义工作高度重叠。                                                                                                        |
| `build_publish` DB job 时长总和  |           214.224 s | 发布不应再次支付这部分主要成本。                                                                                                |
| `configured_document` 合计       |           259.021 s | 预览与发布两条链累计，直接证明配置化编译是 P0。                                                                                 |
| `source_regions` 合计            |           116.988 s | 仅一个内容分析子步骤已占明显比例。                                                                                              |
| 进程树峰值 RSS                   | 2,264,260,608 bytes | 页面无界并发保留所有渲染结果是合理首要怀疑点，但需 profile 验证而非假定。                                                       |

这些数字来自当前 artifact 的 `phases` 与 `pipeline_profiles.stages` 字段。它没有完整记录 commit、dirty 状态、机器与重复次数，因此不能直接作为优化前后的正式对比。后续必须把环境指纹、基线 commit、fixture gate、每本结果和统计脚本一起生成到可复验输出中。

### 已确认的重复/超线性工作

| 热点             | 源码证据                                                                                                                         | 优化方向                                                                                                                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source regions   | 每个 node offset 用 `source.slice(0, offset)` 后 `Buffer.byteLength()`，区域又用 `findIndex` 和逐 block 扫 excluded roots。      | 一次扫描建立 UTF-8 byte-offset、block index、区间索引；保留现有字节范围语义。见 [`src/compiler/document/source-regions.ts`](../../src/compiler/document/source-regions.ts:59)。                                                                                                           |
| Typography       | 多个编辑反向应用时反复拼接整个字符串，并为诊断重复计算前缀字节长度。                                                             | 先计算 edits，单次 builder 输出；共享 byte-offset 表。见 [`src/compiler/preprocess/typography.ts`](../../src/compiler/preprocess/typography.ts:759)。                                                                                                                                     |
| 分页和结构提议   | 分页按页扫描所有 block；结构提议在 headings 之间重复扫描/切片。                                                                  | 在 `compileBook()` 内部预先建立 block-to-page、heading range、前缀累积数据，不暴露新的公共 IR。见 [`src/compiler/document/pages.ts`](../../src/compiler/document/pages.ts:73) 与 [`src/compiler/document/structure-proposal.ts`](../../src/compiler/document/structure-proposal.ts:586)。 |
| 页模型           | 预览/发布均用 `page.blockIds.includes()` 嵌套 heading 遍历，逐页 `findIndex()`，再逐页 filter 全量 heading。                     | 构建一次 `blockId -> pageId`、`pageId -> index`、`pageId -> outline` 映射，按既定顺序输出诊断。见 [`src/jobs/handlers/build-preview.ts`](../../src/jobs/handlers/build-preview.ts:308) 和 [`src/compiler/version-builder.ts`](../../src/compiler/version-builder.ts:398)。                |
| 渲染内存与确定性 | 两条构建链都对所有页面 `Promise.all`，将全部 `{ page, rendered }` 保留到写入以后；preview diagnostics 推入顺序可随完成次序改变。 | 有界且有序的 worker pool：每页完成即写入/释放，按 page ordinal 合并诊断。见 [`src/jobs/handlers/build-preview.ts`](../../src/jobs/handlers/build-preview.ts:346) 与 [`src/compiler/version-builder.ts`](../../src/compiler/version-builder.ts:432)。                                      |
| 资源与版本 I/O   | preview 和 publish 都读取、检查、复制全部资源；publish 又递归枚举、hash 已复制文件。                                             | candidate 只作一次安全检查、资产复制及 inventory；之后仅 materialize URL/auth 变体。见 [`src/jobs/handlers/build-preview.ts`](../../src/jobs/handlers/build-preview.ts:271) 与 [`src/compiler/version-builder.ts`](../../src/compiler/version-builder.ts:316)。                           |
| 阅读器 metadata  | cache miss 会各自读取/parse/validate manifest，page/alias 使用 `.find`。                                                         | `VersionArtifactIndex` 做 promise single-flight，并建 page id、alias、resource id map；是否需要 DB 缓存由并发读取测试决定。见 [`src/services/published-book.ts`](../../src/services/published-book.ts:244)。                                                                              |

## 目录和依赖问题

`src/compiler` 不是纯 compiler：[`version-builder.ts`](../../src/compiler/version-builder.ts:14) 直接引入 React ReaderShell 与 storage，同时承担配置解析、版本装配、资源 copy、manifest、search 和版本 marker。相反，DB/storage 层也向上依赖：

- [`src/db/repositories/jobs.ts`](../../src/db/repositories/jobs.ts:15) 依赖 worker protocol；
- [`src/db/repositories/versions.ts`](../../src/db/repositories/versions.ts:3) 依赖 compiler/service DTO；
- [`src/storage/reconcile.ts`](../../src/storage/reconcile.ts:6) 依赖 DB repository 和 service；
- [`src/services/preview-identity.ts`](../../src/services/preview-identity.ts:13) 为取得 identity 常量而依赖 job handlers；
- [`src/worker/protocol.ts`](../../src/worker/protocol.ts:12) 是一个 nullable-field bag，再以 `kind` 分支校验；[`src/worker/job-child.ts`](../../src/worker/job-child.ts:5) 也是所有 job 的大分派器。

因此当前目录名不能代表依赖方向，也无法用规则阻止新的反向 import。目标不是“把文件换个目录”，而是建立可由 lint 检查的单向边界：

```text
pages, web, worker, cli
            ↓
      module application
            ↓
          module core

module adapters ──→ application ports + core
composition     ──→ application + adapters
platform        ──→ no business modules
```

建议目标目录如下。迁移完成后删除 `src/compiler`，而不是遗留转发 export。

```text
src/
  modules/
    publishing/
      core/
        preparation/ # hostile input 后的排版、目录证据与结构提案
        publication/ # compileBook、PagePlan、renderPages 与候选语义
      application/
        commands/
        queries/
        ports/
        public.ts
      adapters/
        sqlite/
        filesystem/
        reader-html/
    reader/
      core/
      application/
      adapters/
    catalog/
    identity/
  entrypoints/
    worker/
    cli/
  composition/
  platform/          # 无业务含义的 sqlite/filesystem/process 原语
  web/               # ReaderShell UI、controllers、presenters 与 contracts
  pages/             # Astro HTTP 入口
```

在迁移第一阶段加入 folder-specific `no-restricted-imports`：core publishing 不得 import DB/storage/jobs/pages/services/worker/components/http；pages 不得直接 import publishing core、DB 或 storage；DB 不得 import worker/services/application。该规则要由 dependency test 验证无跨层 SCC，而非只靠约定。

## 事务与恢复缺口

现有“发布指针切换”本身是较好的局部事务：它在一个 immediate transaction 内检查 lease、draft、predecessor、preview 和 ready version，再更新旧/新 version、`current_version_id`、audit 与 job 完成。见 [`src/services/publication.ts`](../../src/services/publication.ts:45)。问题是它之前的边界过碎，且 worker 传入 `actorUserId: null`，丢失操作人。见 [`src/worker/index.ts`](../../src/worker/index.ts:313)。

需要修复的边界如下：

| 当前断点                                                                                 | 后果                                                                       | 目标原子边界                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ZIP rename 与 upload/import DB commit 之间                                               | 孤立 `tmp/uploads/<id>`；当前 reconcile 只扫描 `staging` 与 version 目录。 | upload reconciliation 扫描并隔离/删除未引用 uploads；接受 upload 时仍保持文件先耐久、再 DB 事务。见 [`src/storage/reconcile.ts`](../../src/storage/reconcile.ts:61)。 |
| analyze candidate 持久化与 prepare job 创建之间                                          | import 可永久停在 `preparing`。                                            | 一个事务：保存候选/状态、创建 prepare job、完成 analyze job。                                                                                                         |
| source snapshot、config/analysis 文件、config revision、preview job/row、import 完成之间 | 可能产生孤立 source/config/analysis，或 DB 指针没有对应 preview。          | 文件先 durable rename；之后一个事务注册 source、config、preview building、job、import/job 完成。reconcile 检查未注册 source/config/analysis。                         |
| PATCH 写 config/analysis 与 DB 事务之间                                                  | crash 留 deterministic 文件，重试可能碰撞；当前 PATCH 还在 Web 编译。      | PATCH 仅作 cheap validation，写 immutable revision，单事务记录 config + building preview + `build_candidate` job；worker 编译。                                       |
| preview rename 与 ready DB 更新，随后 job completion                                     | rename 后 crash 留孤立 preview；ready 后 crash 留 job 状态不一致。         | 由 candidate finalizer 一次性提交 candidate/search/presentation/ready preview/job success；树 fsync/rename 在事务前。                                                 |
| version ready/search 与 pointer promotion                                                | ready version 在失败后无法被正常复用，且发布仍做全量编译。                 | 取消发布 job，改同步 promote ready candidate；状态转换本身幂等。                                                                                                      |

## 目标构建模型：单次 `build_candidate`

用 `build_candidate` 取代 `build_preview` 与 `build_publish`，不再让发布重新编译。核心只保留
一个 `CompiledBook` 整书内存模型；其中的 `PagePlan` 只引用 block 区间和 ID，不复制逐页
文档树。`renderPages(book)` 返回 `AsyncIterable<RenderedPage>`，在最多四页并发下按序写入并
释放路由无关的语义页。`AsyncIterable` 只是背压协议，不是业务实体；byte offset、block/page
map 等 `SourceTextIndex` 也只是 `compileBook()` 的内部索引。child 最终只返回小型、严格的
`CandidateBuildArtifact` 供 parent 持久化和登记。preview/public 从同一逐页结果 materialize
不同 route/auth/cache 外壳。

```text
PATCH (cheap validation, ETag)
  -> immutable config revision + preview=building + build_candidate job [one SQLite tx]
  -> worker: compile source/config once
  -> bounded ordered RenderedPage stream, assets once, search/manifest once
  -> fsync candidate tree; atomic rename to versions/<candidateVersionId>
  -> ready candidate + search + presentation + preview ready + job succeeded [one SQLite tx]
  -> POST publish: synchronous validation and pointer promotion [one SQLite tx]
```

建议 immutable candidate layout：

```text
books/<bookId>/versions/<versionId>/
  book.yaml
  document-manifest.json
  version.json
  source/
  originals/
  derived/search-spool.json
  candidate/render-spool/    # staging-only or removed after materialization
  published/pages/
  published/assets/
  published/styles/
  preview/pages/
  preview/model.json
  preview/diagnostics.json
```

`draft_previews` 应以 `candidate_version_id` 和 semantic digest 引用准备好的 candidate，不能继续把独立 preview 路径当成第二权威。`book_versions` 需要明确 `ready`、`published`、`superseded`、`discarded` 生命周期；同书最多一个可发布 ready candidate，较旧未发布 candidate 先 tombstone、删 search，再延迟回收文件。clean-slate baseline 可以直接更新 schema，但须补 migration baseline fixture 和 recovery tests。

发布 API 变为同步事务：验证 current source/revision、ready preview-candidate linkage、identity/semantic digest、predecessor 和诊断/策略门禁后，原子 promote。重复相同请求应返回同一 published 成功，不建立新 job、不会重复 audit。它不需要 Idempotency-Key，因为状态 CAS 已是幂等边界。

## 分阶段实施计划

### 阶段 A：恢复可信测量与保护线

- 把 15-book runner 输出版本、commit、dirty 状态、机器/Node/lockfile、fixture manifest hash、重复次数、每个 job/stage、RSS 与失败信息；正式比较至少采用交替多轮而不是单次。
- 固化 15/15 reference exact、真实 ZIP hostile cases、取消/清理、preview/public DOM semantic parity、阅读 p95 <= 300 ms、搜索 p95 < 1000 ms。
- 新增算法微基准：source regions、typography、printed TOC、structure proposal、pagination、manifest lookup；测 500/1000/2000/4000 或等比例输入，防止“总时间下降但复杂度仍二次”。

**门禁：** 在同一基准环境下能区分 accepted-to-preview、publish-to-public 与各 stage；reference exact/安全测试全绿。没有这一门禁，不接受“优化了多少”的结论。

### 阶段 B：建立目录边界，但不改变行为

- 创建 `modules/publishing/{core,application,adapters}`、对应 reader 模块、entrypoint、composition
  和 folder import rules；先移动纯 DTO/identity 与 leaf 算法。
- 把 repository 降为 SQL 映射，storage 降为路径/atomic/durability primitives；从 DB/storage 移除 worker/service/compiler import。
- 用 discriminated job input/result union 和 registry dispatch 替换 `FrozenJobInput` nullable bag 与大分派器。
- 同时把 analyze 的 candidate 持久化/next-job/job-success 收成一个事务，给 uploads/source/config/analysis 增加 reconciliation，不改变 preview/publish 产品行为。

**门禁：** import graph 无跨层 SCC；旧路径与新路径逐项 byte/semantic 等价；analyze/prepare crash matrix 通过；没有 core 对 HTTP/UI/DB/storage 的反向 import。

### 阶段 C：线性化内容分析和局部 I/O

- 在 `compileBook()` 内部一次建立 byte offset、block/heading/range/page 索引；这些索引不成为
  公共契约。以单遍 builder 重写 typography edits。
- 线性化 source regions、printed TOC 关系、structure proposal、分页、page model、manifest resource lookup；所有输出顺序固定。
- 资源检查只在安全边界做一次，改为有界 concurrency；此阶段不复用 preview 与 publish 的语义结果。

**门禁：** 15/15 reference v2 exact；每个复杂度基准不再呈近二次增长；每本不得慢于 `max(5%, 1 s)`；取消、诊断 byte range、block ID、目录/拆页真值均不回归。

### 阶段 D：一次性切换到 candidate 构建

- 更新 clean-slate schema：`build_candidate`、candidate linkage、semantic digest、discarded lifecycle；删除 `build_preview`/`build_publish` job kinds 与 API/UI 依赖。
- 一次编译/渲染/资源 copy/search，bounded ordered `RenderedPage` pipeline，materialize preview
  和 public ReaderShell；候选树 durable rename 后一个事务完成所有 ready 状态。
- preview route 只解析 revision-pinned candidate，public route 继续仅从 `current_version_id` 读取；发布改同步 promote。
- 完成后物理删除旧 handler、`version-builder`、旧 preview tree authority、旧 identity 和兼容分支。不要保留 forwarding exports。

**门禁：** preview/public 同 digest、同 normalized DOM、同诊断，差异仅限 URL/auth/cache/index；publish 零 compile/render；before/after fsync/rename/DB-commit crash matrix 不泄露半成品；老版本在构建中始终可读；candidate search 未 promote 前不可见。

### 阶段 E：二级 I/O 与 reader 优化

- 做一次 source inventory/descriptor 跟踪，消除发布阶段重复枚举/hash；assets copy/inspect 使用明确资源预算。
- 增加 reader manifest promise single-flight 和 O(1) page/asset lookup；预览私有资源按 manifest 元数据流式读取。
- 只有在 A-D 的安全/恢复行为均稳定后，才评估分析→准备间复用已经安全解压的 staging；它引入跨 job 生命周期、取消和信任边界，不能作为早期“快速优化”。

**门禁：** 15 本成对 A/B 总 wall 至少下降 30%，最慢五本至少下降 35%，accepted-to-preview 至少下降 25%，publish-to-public 至少下降 90%；任一本不超过阶段 C 的回归阈值；RSS 不恶化超过 `max(5%, 64 MiB)`；reader/search 延迟门禁保持通过。

### 阶段 F：收尾证据与文档收束

- 跑全量 15-book paired benchmark、reference exact、所有 crash boundary、hostile ZIP/image、取消、并发阅读/搜索、format/lint/typecheck/unit/contract/integration/E2E/build。
- 更新产品/spec/plan/tasks 中被源码证据推翻的描述，运行 Spec Kit analyze/converge；不能把未实现目标写成“当前行为”。
- 清理旧目录、旧 artifact、旧 benchmark 输出格式和无消费者的 test fixture 后再次跑 dependency graph。

**门禁：** 无未缓解 CRITICAL；目录只保留目标结构；性能报告可由干净工作树复现。

## 不可混做的切换边界

1. **目录迁移与语义变更分开。** 阶段 B 的 move 必须可比较地保持输出；目录/拆页/预处理规则修复只能在阶段 C 的 reference 与真值门禁下进入。
2. **算法线性化与 candidate 切换分开。** 先在旧行为上证明线性化正确，再删除双构建链；否则无法区分性能回归来自算法还是生命周期切换。
3. **candidate schema 与旧 job 不共存。** 清库基线允许一个干净切换，但切换提交内必须删除旧 job kinds/handlers/API 分支，不能运行时 fallback。
4. **构建 ready 与公开 promote 分开。** candidate 可先 ready；只有同步 CAS promotion 才改变 `current_version_id`。任何 recovery 不得自动把 ready/orphan 公开。
5. **安全解压复用最后处理。** 在跨 job ownership、取消、重启和清理可证之前，不可把 extract staging 当作可靠缓存。

## 建议提交序列

```text
test(benchmarks): make publishing performance gates reproducible
refactor(publishing): establish acyclic module boundaries
refactor(worker): make import finalization transactional and recoverable
perf(publishing): linearize document analysis and page indexing
refactor(publishing): build immutable candidates during preview
refactor(api): promote ready candidates synchronously
perf(publishing): bound rendering and storage io
test(publishing): close candidate recovery and performance gates
```

每个提交都必须独立通过与其阶段对应的门禁；阶段 D 应为唯一允许删除旧 preview/publish 构建链的切换提交。

## 与现有文本的差异记录

- `specs/006` 描述“一条背景编译路径”和 preview/publish 同一阅读体验，但当前实现实际存在独立 `build_preview` 与 `build_publish` 全编译链。见 [`specs/006-clean-slate-publishing/plan.md`](../../specs/006-clean-slate-publishing/plan.md:14)、[`src/jobs/handlers/build-preview.ts`](../../src/jobs/handlers/build-preview.ts:259)、[`src/compiler/version-builder.ts`](../../src/compiler/version-builder.ts:286)。它是目标，非已实现事实。
- 同一计划要求 parsing/rendering 不在请求路径，但 PATCH 当前调用 `prepareConfiguredDocument()`。见 [`specs/006-clean-slate-publishing/plan.md`](../../specs/006-clean-slate-publishing/plan.md:52) 和 [`src/services/config-revisions.ts`](../../src/services/config-revisions.ts:365)。
- 旧性能调研中将某些候选标成后续实验；本文件不把其结论当作约束，只复用它可由 `results.json` 重算的数字。新计划以源码边界和新门禁为准。
