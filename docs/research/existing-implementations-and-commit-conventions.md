# 已有实现、代码复用边界与提交约定调研

- 调研日期：2026-07-24
- 目标：判断 Mirawind Archive 是否应尽可能参考现有项目；盘点哪些能力已有实现；
  区分可直接复用、只适合借鉴以及不应复制的代码；核查相关项目是否明确采用
  Conventional Commits。
- 来源约束：仅使用项目官方仓库、官方文档、官方许可证、官方贡献指南和发布配置。
- 仓库检查方式：对下表所列 commit 做浅克隆，检查贡献指南、包配置、CI/发布配置以及
  `commitlint`、`semantic-release`、`release-please`、Conventional Commits 等明确证据。
  “未发现”仅表示该固定版本中没有项目级规则或自动化证据，不根据少量提交标题猜测。

## 结论

应该充分参考已有实现，但不应该把“尽可能参考”理解成“尽可能复制”或选择一个项目
整体 fork。Mirawind 的核心组合——敌对 MinerU ZIP、Markdown + `book.yaml` 权威源、
后台单书编译、不可变发布目录、SQLite `current_version_id` 原子切换、公开/私有资源
统一鉴权——在调研项目中没有现成的完整实现。

建议采用三层复用策略：

1. **直接依赖成熟库**：协议和高风险基础设施继续使用已冻结的 TypeScript/Node 组件，
   例如 Better Auth、zip.js、unified/remark/rehype、KaTeX、Shiki、Sharp、Ajv。完整应用
   不能替代这些受维护的窄依赖。
2. **借鉴可验证的工程模式**：从 MinerU 学输出兼容边界，从 MinerU Document
   Explorer 学内容寻址、增量索引和深读接口，从 mdBook/D2L 学书籍编译和导航，从
   BookStack 学导入验证与附件授权，从 Paperless-ngx 学后台消费和任务运维，从 Kavita
   学阅读器交互，从 Starlight 学 Astro 页面结构、无障碍和响应式布局。
3. **独立实现 Mirawind 的核心状态机**：ZIP 流式安全限制、稳定块 ID、版本化
   `document-manifest.json`、SQLite durable queue、发布指针、崩溃恢复和当前版本过滤没有
   可直接照搬的实现，必须由本项目规格和测试驱动。

许可证也支持这一边界：MIT/Apache-2.0 项目允许在履行 notice 等义务后复用代码；
MPL-2.0 有文件级源代码义务；GPL-3.0 项目不应向当前非 GPL 代码库复制代码；MinerU
当前使用带附加条件的自定义许可证。许可证判断不是法律意见，复制实质性代码前仍应
保留来源记录并复核具体义务。

## 功能矩阵

符号：`●` 已实现较完整的同类能力；`△` 有部分能力或可借鉴模式；`—` 未提供目标能力。

### 导入、编译和发布

| 项目 | ZIP/文件导入 | 语义树或 manifest | 后台编译/任务 | 不可变版本与当前指针 | 对 Mirawind 的主要价值 |
|---|---|---|---|---|---|
| MinerU | △ 生成 Markdown/JSON/ZIP，不负责安全导入自身输出 ZIP | △ `content_list.json`、`middle.json`、3.x `content_list_v2.json`，不是 Mirawind manifest | △ 官方 API 有任务接口，但文档明确任务只在进程内、重启不保留 | — | 输出格式兼容性、真实 fixture 和语义候选 |
| MinerU Document Explorer | △ 索引多格式文档和 Markdown，不负责敌对 MinerU ZIP 导入 | △ 内容哈希、路径到 hash、schema migrations；无出版 manifest 或稳定块 ID | △ 索引命令和 MCP daemon，不是 durable publish worker | — 只有 active 状态，无不可变版本和当前指针 | TypeScript/SQLite 内容寻址、增量索引和深读接口 |
| D2L-Book | — | △ Markdown/Jupyter → RST/Sphinx → HTML/PDF，有目录、数学和交叉引用 | △ CLI 构建，不是 durable worker | — | 教材语义、编号、目录和页面视觉 |
| mdBook | — | △ `SUMMARY.md` + Markdown 书模型、预处理器和渲染器，无稳定块 ID manifest | △ `build/watch/serve`，文件变化时静态重建 | — | 编译阶段、目录格式、链接检查、静态阅读结构 |
| BookStack | △ 自有 portable ZIP 的 `data.json` + `files/` 导入 | △ 数据模型和页面修订，但数据库页面正文是权威源 | △ 可使用 Laravel 队列，不是其核心出版边界 | △ 页面修订，无单书不可变产物和 SQLite 当前指针 | ZIP 先验证后导入、权限复核、失败清理 |
| Paperless-ngx | ● Web/API/消费目录接收文件并保留原件 | △ 提取文本与搜索索引，不是网页书 AST/manifest | ● Celery worker、任务状态和管理界面 | △ document file versions，非原子公开发布指针 | 大文件消费、原件保留、任务可观测性和版本 UX |
| Kavita | △ 扫描服务器目录中的 EPUB/PDF/CBZ 等 | — | △ 后台扫描和分析 | — | 图书扫描反馈与媒体库运维体验 |
| Astro Starlight | — | △ Astro content collection、Markdown/MDX route data，无出版 manifest | △ Astro 构建/预渲染，也支持服务端页面；无 durable book worker | — | 与本项目同为 Astro，适合复用布局和无障碍模式 |

### 搜索、阅读、下载和管理

| 项目 | 搜索 | 阅读器/导航 | 原文件或附件下载 | 认证/管理 | 与冻结架构的主要冲突 |
|---|---|---|---|---|---|
| MinerU | — | — | △ 提供解析结果，不是按书状态授权的原文件下载 | △ API/CLI，不是个人书库管理 | Python/GPU 文档解析器；本项目只接收其输出 |
| MinerU Document Explorer | ● SQLite FTS5 BM25、sqlite-vec、hybrid/rerank | △ `doc_toc`、`doc_read`、`doc_grep` 地址式深读，不是浏览器阅读器 | — | △ CLI/MCP collections，不是 Web 管理或 Passkey | Markdown 目录/分块依赖正则；检索目标不同于中文 trigram 字面搜索，且缺少可见性和 `current_version_id` 隔离 |
| D2L-Book | △ Sphinx 站点搜索 | ● 教材型目录、数学、代码、上一页/下一页 | — | — | Python/Sphinx 静态构建，不支持私有书和动态当前版本 |
| mdBook | ● 内置静态全文搜索 | ● 目录、章节、代码、主题、打印视图 | — | — | Rust 静态站点生成器；整书构建和公开静态资源模型不同 |
| BookStack | ● 权限感知的全局/书内搜索 | ● book/chapter/page 层级、侧栏、前后页 | ● 附件随所属页面权限，并尽量流式传输 | ● 登录、角色、内容管理、修订 | 多用户 PHP/Laravel，正文存数据库，权限模型远超单管理员 |
| Paperless-ngx | ● Tantivy 全文搜索及权限过滤 | △ 文档预览，不是语义教材阅读器 | ● 始终保存原件并提供下载/分享 | ● 多用户、权限、任务管理 | Django + Celery + Redis/Valkey，违反单机 SQLite queue 基线 |
| Kavita | ● 元数据、筛选、库范围搜索 | ● 响应式 EPUB/PDF/图片阅读、目录、进度、批注 | ● 具有 Download 角色和客户端/OPDS 下载 | ● 多用户、角色、OIDC/API key | .NET/Angular + GPL；文件阅读而非 Markdown 语义出版 |
| Astro Starlight | ● 默认 Pagefind 静态全文搜索 | ● 左侧导航、页面提纲、前后页、响应式/无障碍 UI | — | — | Pagefind/内容集合无法直接执行私有权限和 `current_version_id` 过滤 |

## 各项目证据与复用判断

### 1. MinerU

官方 [输出文件文档](https://opendatalab.github.io/MinerU/reference/output_files/) 显示：

- Markdown、图片、`content_list.json` 和 `middle.json` 是解析输出的一部分。
- MinerU 3.0 新增 `content_list_v2.json`，文档明确标记为“development version,
  subject to change”。
- v2 顶层按页组织并使用统一的 `type + content`，但准确的 `type` 集合仍取决于后端和
  输入类型；VLM 与 pipeline 的中间/旧格式也存在差异。

因此不能把单一文件名、目录层级或某版 JSON 当成固定协议。Mirawind 应保留现有的
递归候选发现、相邻资源闭包和人工确认机制，并将用户提供的 2～3 个真实 ZIP 作为
版本兼容 fixture。可以研究 MinerU 的输出 builder 和官方样本，但不要把
`content_list_v2.json` 直接变成 Mirawind 的权威 AST；`document-manifest.json` 仍需由
本项目从 Markdown、`book.yaml` 和编译器版本生成。

当前固定版本
[`79d6d8d`](https://github.com/opendatalab/MinerU/tree/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7)
使用 [MinerU Open Source License](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/LICENSE.md)：
以 Apache-2.0 为基础，但增加商业规模门槛和面向第三方在线服务的显著归属要求。
本项目仅消费 MinerU 输出并不需要复制其 Python/GPU 实现；若未来复制代码，需要单独
评估附加条款。

**Conventional Commits**：未发现 commitlint、Conventional Commits 贡献规则或自动
发布配置；[PR 模板](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/.github/pull_request_template.md)
要求动机、改动、兼容性、测试和文档，但不规定提交格式。

### 2. MinerU Document Explorer

[MinerU Document Explorer](https://github.com/opendatalab/MinerU-Document-Explorer/tree/a7e9c6cc25b7edbf4ebd35aea8e270523a8a3e40)
是 MIT 许可的 TypeScript + SQLite 文档检索工具。官方 README 展示了 BM25、向量和
hybrid search，以及 `doc_toc` → `doc_grep` → `doc_read` 的地址式深读流程。它是本次
调研中与 Mirawind 技术栈最接近、最值得做代码级选择性参考的项目，但定位是
agent-facing document explorer，不是安全导入与出版系统。

值得参考的固定版本代码包括：

- [`src/backends/indexing.ts`](https://github.com/opendatalab/MinerU-Document-Explorer/blob/a7e9c6cc25b7edbf4ebd35aea8e270523a8a3e40/src/backends/indexing.ts)
  的“提取 → 内容哈希 → 缓存/跳过未变化内容 → 写入”流程；
- [`src/db-schema.ts`](https://github.com/opendatalab/MinerU-Document-Explorer/blob/a7e9c6cc25b7edbf4ebd35aea8e270523a8a3e40/src/db-schema.ts)
  的 SQLite schema version 和逐版 migration 组织方式；
- [`src/search.ts`](https://github.com/opendatalab/MinerU-Document-Explorer/blob/a7e9c6cc25b7edbf4ebd35aea8e270523a8a3e40/src/search.ts)
  的 BM25/向量检索接口和结果地址；
- [`src/backends/markdown.ts`](https://github.com/opendatalab/MinerU-Document-Explorer/blob/a7e9c6cc25b7edbf4ebd35aea8e270523a8a3e40/src/backends/markdown.ts)
  的 `doc_toc`、按行 `doc_read`、带上下文 `doc_grep` 合约；
- [`src/chunking.ts`](https://github.com/opendatalab/MinerU-Document-Explorer/blob/a7e9c6cc25b7edbf4ebd35aea8e270523a8a3e40/src/chunking.ts)
  的 Markdown-aware chunking 和重叠窗口测试思路。

复用边界必须明确：

- Markdown TOC 和分块按正则识别标题/断点，并非 AST；Markdown backend 也没有结构化
  element extraction，不能替代 Mirawind 的 unified AST、稳定块 ID 和语义编译器。
- 其短 hash 前缀可用于定位缓存内容，但不能替代 Mirawind 的 opaque generated ID；
  路径或内容变化也不能改变书、页面和块的业务身份。
- `active=1` 过滤不等于“公开/私有授权 + SQLite 当前发布版本”隔离；必须为
  `current_version_id`、旧版本排除和私有内容 404 单独设计查询与测试。
- BM25、向量和 hybrid 的目标是 agent retrieval；Mirawind M1 已冻结的是中文 trigram
  字面检索语义。因此可借鉴接口、fixture 和基准方法，不能逐字复制查询或用向量检索
  替换产品搜索。
- 它没有敌对 ZIP 防线、publication transaction、不可变发布目录和资源授权，不能
  作为整体基础 fork。

许可证是 [MIT](https://github.com/opendatalab/MinerU-Document-Explorer/blob/a7e9c6cc25b7edbf4ebd35aea8e270523a8a3e40/LICENSE)，
适合在保留版权和许可声明后选择性移植小型实现。

**Conventional Commits**：未发现 commitlint 或 Conventional Commits 规则。
[贡献指南](https://github.com/opendatalab/MinerU-Document-Explorer/blob/a7e9c6cc25b7edbf4ebd35aea8e270523a8a3e40/CONTRIBUTING.md)
只要求 changes 使用 clear, focused commits，不规定 `type(scope): description`。

### 3. D2L-Book

[D2L-Book](https://github.com/d2l-ai/d2l-book/tree/2322e565deda1605451bc3976be3f21c731223cc)
是将 Markdown/Jupyter 教材构建成 HTML、PDF、notebook、slides 等产物的 Python 工具。
其代码和文档覆盖目录提取、Sphinx HTML、数学编号、代码 tab、资源复制和链接检查。
这些能力说明 D2L 风格并不只是一套 CSS，而是“配置 → 书结构 → 语义渲染”的编译管线。

适合借鉴：

- 教材目录、章节/小节编号、数学、代码和前后页导航的行为；
- 先转标准结构、再通过 renderer 输出多种表示的阶段划分；
- 构建警告可升级为失败、链接单独校验的质量门。

不宜直接采用：仓库固定版本的最后提交在 2023 年，技术栈为 Python + Sphinx，
构建模型面向静态公开站点，也没有私有资源授权、稳定块 ID 或原子版本切换。

许可证是 [Apache-2.0](https://github.com/d2l-ai/d2l-book/blob/2322e565deda1605451bc3976be3f21c731223cc/LICENSE)。
**Conventional Commits**：固定版本中未发现配置、贡献规则或发布自动化证据。

### 4. mdBook

mdBook 官方指南说明：

- [`SUMMARY.md`](https://rust-lang.github.io/mdBook/format/summary.html) 定义书籍骨架和
  嵌套章节；
- [预处理器](https://rust-lang.github.io/mdBook/format/configuration/preprocessors.html)
  在 renderer 之前修改书模型；
- `build` 生成静态书，`watch/serve` 在源文件变化时重建；
- HTML 输出包含目录、代码高亮、搜索和 404 页面。

应借鉴其小而清晰的“加载书 → 预处理 → 渲染 → 校验”管线、目录作为独立配置、链接和
浏览器 GUI 测试。不能直接使用它替代 Mirawind compiler：mdBook 不识别 MinerU 包、
`book.yaml` 四类内容角色、随机稳定块 ID、版本化 manifest、私有资源或 SQLite 发布
边界。

固定版本
[`4f8c946`](https://github.com/rust-lang/mdBook/tree/4f8c9460977e18974b37bb9a2292219bfa317632)
使用 [MPL-2.0](https://github.com/rust-lang/mdBook/blob/4f8c9460977e18974b37bb9a2292219bfa317632/LICENSE)。
若复制或修改源文件，要处理 MPL 的文件级源代码义务；更适合作为行为和测试设计参考。

**Conventional Commits**：未发现明确规则或工具。
[贡献指南的发布流程](https://github.com/rust-lang/mdBook/blob/4f8c9460977e18974b37bb9a2292219bfa317632/CONTRIBUTING.md#publishing-new-releases)
使用手工 version bump 和整理 changelog，不依赖 Conventional Commits 自动判定版本。

### 5. BookStack

BookStack 已实现书/章/页、Markdown/WYSIWYG 编辑、页面修订、权限感知搜索以及随页面
权限控制的附件。[附件文档](https://www.bookstackapp.com/docs/user/attachments/)
还明确说明下载尽量流式传输，并只允许安全 MIME 类型内联。它对“所有表示都要经过
权限检查”的经验很有价值。

其最新 portable ZIP 导入有三个值得借鉴的具体模式：

- [`ZipExportReader`](https://github.com/BookStackApp/BookStack/blob/4e406c41c4c8060a5795e74c66fb96362e54f400/app/Exports/ZipExports/ZipExportReader.php)
  先寻找并限制 `data.json`，按引用名打开文件 stream；
- [`ZipExportValidator`](https://github.com/BookStackApp/BookStack/blob/4e406c41c4c8060a5795e74c66fb96362e54f400/app/Exports/ZipExports/ZipExportValidator.php)
  在创建业务实体前验证结构并返回字段路径错误；
- [`ZipImportRunner`](https://github.com/BookStackApp/BookStack/blob/4e406c41c4c8060a5795e74c66fb96362e54f400/app/Exports/ZipExports/ZipImportRunner.php)
  执行前重新验证权限、将文件流到随机临时文件，并在失败回滚时清理已保存文件。

但这不是 Mirawind 所需的安全解压器。代码主要信任 ZIP central-directory 的单文件
`size`，没有按实际写出字节执行总量、条目数、目录深度、路径规范化冲突、单条目/整包
解压倍率、像素和耗时限制。因此只能借鉴“描述文件先验证、流式提取、权限复核、失败
清理”的顺序，不能照搬安全边界。

BookStack 的权威正文保存在数据库，且是多用户 PHP/Laravel 应用，不应作为基础 fork。
固定版本
[`4e406c4`](https://github.com/BookStackApp/BookStack/tree/4e406c41c4c8060a5795e74c66fb96362e54f400)
使用 [MIT](https://github.com/BookStackApp/BookStack/blob/4e406c41c4c8060a5795e74c66fb96362e54f400/LICENSE)；
若确有小型算法值得移植，许可证允许在保留版权和许可声明后复用。

**Conventional Commits**：未发现明确规则或工具。
[发布流程](https://github.com/BookStackApp/BookStack/blob/4e406c41c4c8060a5795e74c66fb96362e54f400/dev/docs/release-process.md)
采用日期版本、milestone 和手工发布步骤，不以提交类型生成版本。

### 6. Paperless-ngx

[官方使用文档](https://docs.paperless-ngx.com/usage/) 显示 Paperless-ngx 已实现：

- Web、API 和消费目录接收文件；
- 始终保存未改写的 original，并可另存 archive；
- 文档文件版本同时跟踪底层文件和提取文本，元数据留在 root document；
- 后台消费、OCR、索引、任务状态/错误管理；
- 权限过滤的全文搜索、下载和可过期分享链接。

它最值得借鉴的是“上传请求快速结束、原件先固化、重处理使用工作副本、任务错误可见、
版本与根元数据分开”。不过官方架构使用 Django、Celery 和 Redis/Valkey，搜索使用
Tantivy，直接采用会违反本项目的单 Astro Web、同代码 worker、SQLite durable queue
约束。

固定版本
[`6d249b4`](https://github.com/paperless-ngx/paperless-ngx/tree/6d249b49327fdab58ff915d3f5435e49de742464)
使用 [GPL-3.0](https://github.com/paperless-ngx/paperless-ngx/blob/6d249b49327fdab58ff915d3f5435e49de742464/LICENSE)。
不要把实现代码复制进当前项目；可以基于官方文档和独立测试重新实现相同工程模式。

**Conventional Commits**：未发现 commitlint 或贡献规则。其
[Release Drafter 配置](https://github.com/paperless-ngx/paperless-ngx/blob/6d249b49327fdab58ff915d3f5435e49de742464/.github/release-drafter.yml)
按 PR label 分类并使用 PR 标题生成 changelog，不依赖 Conventional Commit type。

### 7. Kavita

[官方仓库](https://github.com/Kareadita/Kavita/tree/e9192acc73aead074d75447470dfe8debe7b848c)
列出 EPUB、PDF、漫画格式、响应式 reader、元数据搜索/筛选、阅读列表、进度、批注和
下载等能力。[EPUB reader 文档](https://wiki.kavitareader.com/guides/readers/epub/)
展示目录、前后页、阅读设置、进度和内部/外部链接处理；
[OIDC 文档](https://wiki.kavitareader.com/guides/admin-settings/open-id-connect/)
表明其权限包含 Login、Download 和 library access。

这些适合用于阅读器 E2E 验收和交互清单，尤其是移动端、目录、进度恢复和链接安全；
不能复用为 Mirawind 内容层，因为 Kavita 的主对象仍是 EPUB/PDF/CBZ 文件，不生成
Markdown 权威源、语义 HTML、manifest 或不可变网页版本。

许可证是 [GPL-3.0](https://github.com/Kareadita/Kavita/blob/e9192acc73aead074d75447470dfe8debe7b848c/LICENSE)，
技术栈是 .NET/Angular，因此只做行为参考，不复制代码。

**Conventional Commits**：未发现工具或强制规则。
[贡献指南](https://github.com/Kareadita/Kavita/blob/e9192acc73aead074d75447470dfe8debe7b848c/CONTRIBUTING.md)
只要求 meaningful commits 或 squash，并给出 branch 命名例子，没有规定
`type(scope): description`。

### 8. Astro Starlight

Starlight 与 Mirawind 同属 Astro 生态。官方文档提供：

- [侧栏导航](https://starlight.astro.build/guides/sidebar/)：文件系统自动生成、显式分组、
  嵌套组、排序、隐藏项和页面提纲；
- [站内搜索](https://starlight.astro.build/guides/site-search/)：默认 Pagefind，支持排除整页
  或页面局部；
- Markdown/MDX、代码、数学生态、响应式布局、主题切换、组件 override 和无障碍行为。

可以直接使用其公开 npm API，或在 MIT notice 下选择性复用稳定组件/样式模式；不要
依赖私有内部模块。是否引入完整 Starlight integration 应先做小型 PoC，因为 Mirawind
有自定义 `/read/:bookKey/:pageKey`、私有资源、React 管理界面和外部不可变产物目录。
尤其不能用 Pagefind 替代 FTS5：Pagefind 是静态站点索引，无法满足按请求者权限和
SQLite `current_version_id` 过滤。

固定版本
[`ab2792b`](https://github.com/withastro/starlight/tree/ab2792bd38fb90ecbaf54d9956ed6834628a2718)
使用 [MIT](https://github.com/withastro/starlight/blob/ab2792bd38fb90ecbaf54d9956ed6834628a2718/LICENSE)。

**Conventional Commits**：没有 commitlint/Conventional Commits 规则。Starlight 明确
采用 [Changesets](https://github.com/withastro/starlight/blob/ab2792bd38fb90ecbaf54d9956ed6834628a2718/.changeset/config.json)：
用户可见的 package 变更需提交 changeset，发布 workflow 调用
[`changesets/action`](https://github.com/withastro/starlight/blob/ab2792bd38fb90ecbaf54d9956ed6834628a2718/.github/workflows/release.yml)。
这是结构化发布记录，但不是 Conventional Commits。

## 复用决策矩阵

| 级别 | 可采用内容 | 项目 | 条件 |
|---|---|---|---|
| 直接依赖 | 稳定、公开的 Astro/Node 包 API；当前计划中的窄基础库 | Starlight 的公开包（仅在 PoC 证明适配时）及已选 maintained libraries | 锁定版本；检查服务端/客户端边界；保留 license/notice |
| 选择性移植 | 小型、独立、许可证宽松且有测试的组件或算法 | MinerU Document Explorer、Starlight、BookStack（均 MIT）、D2L-Book（Apache-2.0） | 记录源 URL/commit/许可证；改写时补 Mirawind 规格测试 |
| 模式参考 | 输出兼容、内容寻址、深读接口、编译阶段、ZIP 导入顺序、任务 UX、reader UX | MinerU、MinerU Document Explorer、mdBook、BookStack、Paperless-ngx、Kavita | 从需求和测试独立实现，不复制受限代码 |
| 明确不复制 | GPL 项目代码；MinerU 自定义许可代码；MPL 文件进入当前非 MPL 源树；外部队列/搜索/数据库架构 | Paperless-ngx、Kavita、MinerU、mdBook，以及任何引入 Redis/Celery/Tantivy 的实现 | 除非先做许可证和宪法变更 |
| 必须自研 | 流式敌对 ZIP 防线、稳定块 ID 继承、`book.yaml`/manifest schema、immutable versions、SQLite publish pointer、recovery | 无现成项目 | 严格按已有 spec/tasks，以真实 MinerU ZIP 和 crash fixture 验证 |

## Conventional Commits 建议

当前 Mirawind 目录还不是 Git 仓库，也没有 `package.json`、commitlint 配置或 CI，因此
**目前尚未使用 Conventional Commits**。

在上面 8 个产品参考项目的固定版本中，均未发现可执行的 Conventional Commits
门禁。相邻依赖中有一个值得区分的例子：
[Better Auth 的贡献指南](https://github.com/better-auth/better-auth/blob/main/CONTRIBUTING.md#submitting-a-pr)
明确要求 **PR 标题** 使用 Conventional Commits 格式，同时用 Changesets 管理用户可见
的发布记录；其仓库没有用 commitlint 约束每个 commit。Starlight 也使用 Changesets，
但没有声明 Conventional Commits 规则。因此，提交历史里偶尔出现 `feat:` / `fix:`
不能单独证明项目已采用或强制该规范。

建议从初始化 Git 时就采用
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)：

```text
<type>(<optional-scope>): <description>
```

类型建议限定为：

```text
feat fix docs test refactor perf build ci chore revert
```

scope 建议使用稳定领域，而不是目录名：

```text
auth import archive compiler manifest publish reader search worker storage cli schemas docs
```

示例：

```text
feat(import): stream MinerU ZIP into quarantined staging
fix(publish): keep previous version current after FTS failure
test(archive): reject duplicate NFC-normalized paths
docs(decisions): record real MinerU fixture handoff
```

采用理由：

- 官方规范将 `feat`、`fix` 和 `BREAKING CHANGE` 与 SemVer 意图关联，并建议初始开发期也
  按已发布项目对待；
- Agent 和单人维护同样受益于结构化历史，能快速区分规格、测试、行为和构建变更；
- 当前项目有明确领域边界，scope 能让跨 150 个任务的提交历史保持可审计；
- 它不要求自动发布，也不替代 decision log、规格、迁移说明或 changeset。

落地建议：

1. 初始化 Git 后添加 `commitlint.config.mjs`，扩展
   `@commitlint/config-conventional`；官方 [commitlint 入门文档](https://commitlint.js.org/guides/getting-started.html)
   给出了 Node 24 下使用 `.mjs` 的注意事项。
2. 本地 hook 只作为快速反馈；CI 对 PR commit 或 squash 后的 PR 标题执行最终校验，
   避免 hook 被跳过后失去门禁。
3. 采用 squash merge 时，只要求最终合并标题合规；Conventional Commits 官方 FAQ
   明确允许维护者在 squash 时整理最终消息。
4. 暂不引入 semantic-release。M1 是应用而非多包公共库，先保留人工版本/发布决策；
   后续若需要自动 changelog，再单独决定 Changesets、release-please 或
   semantic-release。
5. commit message 只描述代码改动。任何产品或架构决策仍必须先写 decision log，再更新
   spec/plan/tasks，不能用一条 `feat:` 代替治理流程。

## 对 M1 的直接行动建议

1. 在实现 ZIP 解析前，把 MinerU 3.x `content_list_v2.json` 和后端差异加入 fixture
   分类；真实 ZIP manifest 继续记录 MinerU 版本、大小和 SHA-256。
2. 参考 BookStack 的“描述文件先验证 → 文件流式读取 → 权限复核 → 失败清理”，但所有
   实际字节、总量、倍率、路径、特殊文件和图片限制仍按 Mirawind 自己的任务实现。
3. 在实现 search/compiler 前，对 MinerU Document Explorer 做一次 API/test harvesting：
   采用地址式深读合约、内容哈希和未变化索引跳过模式；不要整体复制其 FTS 查询、短
   hash 身份或正则语义编译。
4. compiler 的阶段命名和纯函数边界可参考 mdBook；教材 HTML/导航验收可参考 D2L；
   不引入这两个项目的运行时。
5. worker 管理页参考 Paperless-ngx 的状态、错误和重试 UX，但保持 SQLite queue；
   reader 的移动端、目录和链接 E2E 清单参考 Kavita。
6. Starlight 只做 reader shell PoC 或稳定公开组件复用；搜索继续使用 FTS5，所有资源
   继续走 Astro 授权路由。
7. Git 初始化时采用 Conventional Commits + commitlint；这需要成为新的项目决策和
   实施任务后再落地，不应在没有 decision log 更新的情况下静默加入。
