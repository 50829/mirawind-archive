# MinerU 输出 ZIP / 目录结构调研与导入建议

- 调研日期：2026-07-24
- 目标：为 Mirawind Library 的 OQ-001（主 Markdown 识别）提供一手资料和可实现方案
- 来源范围：MinerU 官方文档、官方云 API 文档、官方 GitHub 仓库源码与发行标签

## 结论

不能用“ZIP 根目录下唯一的 `.md`”或某个固定层级识别 MinerU 主正文。官方渠道目前至少存在以下差异：

- MinerU 云端精准解析包使用 `full.md`；
- 开源 CLI/API 使用原文件 stem 命名，如 `book.md`；
- 开源输出通常位于 `book/<parse-mode>/`，但不同版本和下载入口会保留、减少或压平这些层级；
- 一个 ZIP 可能含多份输入文档的结果，也可能因返回参数只包含部分产物；
- 3.0 起增加 `*_content_list_v2.json`，旧包没有它；旧版本的可视化文件名也曾发生变化。

因此建议：

1. 递归枚举 Markdown，以官方命名和相邻伴随文件作为“结构签名”评分；
2. 只有一个通过完整性校验的高置信候选时自动选中；
3. 多个高置信候选时不猜，要求管理员选择；若明显是批处理包，M1 直接提示“一次只导入一本”；
4. Markdown 的链接解析基准始终是该 Markdown 所在目录，而不是 ZIP 根目录；
5. 标题不是主文件的硬性条件，非空正文与引用资源完整性才是硬性条件；
6. `content_list`、`middle`、`model` 只能用于增强置信度，不能作为导入必需项。

## 一手资料：官方输出到底有什么

### 1. 当前开源 MinerU（3.4.4）

本次核对的官方仓库快照为 `3.4.4`。当前代码为不同后端构造不同解析目录：

```text
<output>/
└── <document-stem>/
    ├── auto | txt | ocr/         # pipeline
    ├── vlm/                      # VLM
    ├── hybrid_auto|txt|ocr/      # hybrid
    └── office/                   # DOCX/PPTX/XLSX
```

这由官方 [`output_paths.py`](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/mineru/cli/output_paths.py#L5-L26) 明确定义。输出代码会在解析目录内创建 `images/`，并按开关生成：

```text
<document-stem>.md
<document-stem>_content_list.json
<document-stem>_content_list_v2.json
<document-stem>_middle.json
<document-stem>_model.json
<document-stem>_layout.pdf
<document-stem>_span.pdf
<document-stem>_origin.<原扩展名>
images/
```

文件生成逻辑见官方 [`common.py`](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/mineru/cli/common.py#L186-L191) 和 [`common.py` 的输出函数](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/mineru/cli/common.py#L288-L346)。官方输出格式文档也说明，实际文件集合取决于后端和输入类型，并将 `*.md`、`content_list.json`、`content_list_v2.json`、`middle.json`、`model.json`、`layout.pdf`、`span.pdf` 分别归类；`content_list_v2` 是 3.0 起新增、仍可能调整的格式。[官方输出格式文档](https://opendatalab.github.io/MinerU/reference/output_files/)

Markdown 和 `content_list` 中的本地图片路径按 `images/<hash>.<ext>` 生成。官方示例明确展示了 `img_path: "images/...jpg"`；这与代码把 `images` 目录名传给 Markdown/JSON 生成器一致。[官方 `content_list` 示例](https://opendatalab.github.io/MinerU/reference/output_files/#content-list-content-listjson)

需要注意：这些文件受返回/导出开关控制。当前 FastAPI 的默认值是返回 Markdown，但不默认返回 `middle`、`model`、`content_list` 或图片；开启“客户端生成输出”时，服务端反而返回 `middle`、`model` 和图片而不返回 Markdown，交由客户端生成最终文件。见官方 [`api_request.py`](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/mineru/cli/api_request.py#L162-L203) 与[参数联动逻辑](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/mineru/cli/api_request.py#L226-L251)。因此：

- 合法 MinerU 包未必有所有 JSON 或调试 PDF；
- 只有 `middle/model/images` 而没有 Markdown 的 staged 包也是可能的，但 Mirawind M1 不应自行复刻某一版本的 MinerU 输出生成器；
- 有 Markdown 但调用方没有请求图片时，包内图片可能缺失，必须按 Markdown 实际引用报告错误。

### 2. 当前开源 API ZIP 与 Gradio ZIP 的层级不同

当前开源 FastAPI 创建结果 ZIP 时，成员路径是：

```text
<document-stem>/<parse-dir-name>/<files>
```

例如：

```text
book/vlm/book.md
book/vlm/images/abc.jpg
```

或：

```text
book/auto/book.md
book/auto/images/abc.jpg
```

官方源码将 ZIP 成员名拼为 `pdf_name / basename(parse_dir) / relative_path`，并逐项加入 Markdown、可选 JSON、图片和原文件，见 [`fast_api.py`](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/mineru/cli/fast_api.py#L484-L588)。

但 Gradio 下载会把单份文档的解析目录直接作为压缩根目录，因此常见形态是：

```text
book.md
book_content_list.json
images/abc.jpg
...
```

即没有外层 `book/<parse-mode>/`。官方 [`gradio_app.py`](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/mineru/cli/gradio_app.py#L663-L680) 使用相对解析目录的路径写 ZIP；下载流程传入的正是 `local_md_dir`，[见调用处](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/mineru/cli/gradio_app.py#L1120-L1146)。

这证明即使是同一版本的官方程序，也不能把 ZIP 层级写死。

### 3. MinerU 云端精准解析 ZIP

官方云 API 将精准解析结果作为每份文档各自的 `full_zip_url` 返回。官方说明非 HTML 包中的主要文件为：

```text
full.md
layout.json
*_model.json
*_content_list.json
images/...                 # 正文/JSON 以 images/ 相对路径引用的资源
```

其中 `layout.json` 对应开源输出的 `middle.json`，`full.md` 是 Markdown 正文。HTML 输入则是 `full.md` 和 `main.html` 等不同组合。[MinerU 官方精准 API：结果详细说明](https://mineru.net/doc/docs/index_pro/#_22)

批量任务返回 `extract_result[]`，每个输入文件有自己的 `full_zip_url`，而不是把全部文档强制塞进一个 ZIP。[MinerU 官方精准 API：批量结果](https://mineru.net/doc/docs/index_pro/#_22)

另一个“Agent 轻量解析 API”只返回 `markdown_url`，示例文件名同样是 `full.md`，并不返回完整 ZIP。[MinerU 官方 Agent API 文档](https://mineru.net/apiManage/docs)

因此 `full.md` 是云端包的强信号，但不是开源 CLI 包的通用文件名；反过来，`<stem>.md` 也不是云端包的通用文件名。

MinerU 官方 Ecosystem Python SDK 本身也采用递归遍历 ZIP 的办法，而不依赖固定层级；它识别 `.md`、`*_content_list.json`/`content_list.json`、常见图片以及可选的 DOCX/HTML/LaTeX 导出。[官方 SDK ZIP 解析器](https://github.com/opendatalab/MinerU-Ecosystem/blob/5733c03b3d53cb01c0361bb6acecda3f554c8c12/sdk/python/src/mineru/_zip.py#L13-L64) SDK 的图片模型把 `path` 定义为 ZIP 内相对路径，示例同样是 `images/img_0.png`。[官方 SDK 图片模型](https://github.com/opendatalab/MinerU-Ecosystem/blob/5733c03b3d53cb01c0361bb6acecda3f554c8c12/sdk/python/src/mineru/models.py#L8-L15)

SDK 的递归读取可以作为“路径不可写死”的佐证，但它在单文档云 API 约束下采用任意 `.md` 覆盖结果的简单策略；Mirawind 接受用户上传的任意 ZIP，不能照搬“遍历到最后一个 Markdown 就使用”的做法。

### 4. 历史版本差异

旧版 `magic_pdf-0.10.6` 已经采用：

```text
<output>/<document-stem>/<method>/
├── images/
├── <stem>.md
├── <stem>_middle.json
├── <stem>_model.json
├── <stem>_content_list.json
├── <stem>_origin.pdf
├── <stem>_layout.pdf
├── <stem>_model.pdf
├── <stem>_spans.pdf        # 注意曾使用复数 spans
└── <stem>_line_sort.pdf    # 按配置出现
```

可核对官方发行标签中的 [`magic_pdf/tools/common.py`](https://github.com/opendatalab/MinerU/blob/magic_pdf-0.10.6-released/magic_pdf/tools/common.py)。

到 `mineru-2.0.6`，主目录、`images/`、`<stem>.md`、`content_list/middle/model/origin` 组合仍然存在，但可视化文件已使用 `<stem>_span.pdf`（单数）。见官方发行标签 [`mineru/cli/common.py`](https://github.com/opendatalab/MinerU/blob/mineru-2.0.6-released/mineru/cli/common.py)。

到 `mineru-2.7.6`，pipeline、VLM、hybrid 已经产生不同 parse 目录，仍以 `<stem>.md` 为主正文，伴随文件仍由开关决定；该版本还可能生成 `line_sort.pdf`。见官方发行标签 [`mineru/cli/common.py`](https://github.com/opendatalab/MinerU/blob/mineru-2.7.6-released/mineru/cli/common.py)。

2.x 的“磁盘工作目录”和“API 下载 ZIP”也不一定同层级。例如 `mineru-2.6.8` 的工作目录含 `<document>/<parse-mode>/`，但 FastAPI 打包时移除了 parse-mode 层，生成：

```text
<document-stem>/
├── <document-stem>.md
├── <document-stem>_middle.json
├── <document-stem>_model.json
├── <document-stem>_content_list.json
└── images/
```

见官方 `2.6.8` 发行标签的 [`fast_api.py`](https://github.com/opendatalab/MinerU/blob/mineru-2.6.8-released/mineru/cli/fast_api.py#L217-L257)。同版本的 `content_list_v2` 生成行为也与当前版本不同，[见 `2.6.8 common.py`](https://github.com/opendatalab/MinerU/blob/mineru-2.6.8-released/mineru/cli/common.py#L140-L152)。

3.0 起新增 `content_list_v2`；同时官方变更记录明确提示 VLM 升级曾调整 `middle.json` 与 `content_list.json` 的结构。[官方 Changelog](https://opendatalab.github.io/MinerU/reference/changelog/)

产品层面的含义是：

- 识别主 Markdown 不应依赖 JSON 的具体 schema；
- 清理调试文件时要兼容 `span.pdf` 与旧版 `spans.pdf`、`model.pdf`、`line_sort.pdf`；
- 不应因为没有 `content_list_v2` 就判定包不是 MinerU；
- `middle.json` 内的 `_version_name`、`_backend` 可作为诊断信息，但不应是选择主文件的必需条件。

### 5. 多文件与批处理

当前 CLI 接受单文件或目录输入。目录输入时会枚举其中受支持的文件，并为每个文档建立单独输出目录；同 stem 冲突会被规范化为唯一 stem。见官方 [`client.py`](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/mineru/cli/client.py#L544-L606)。

当前开源 API ZIP 创建器也会遍历 `pdf_file_names`，所以一个 ZIP 可以含多个：

```text
book-a/vlm/book-a.md
book-b/vlm/book-b.md
```

见官方 [`fast_api.py`](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/mineru/cli/fast_api.py#L492-L518)。

因此“ZIP 内多个 Markdown”不一定是杂项文件，也可能是合法的 MinerU 批处理输出。Mirawind M1 只导入一本书时，必须把这种情况识别为多文档包，而不是静默挑一个。

## Mirawind 主 Markdown 识别方案

### 1. 数据模型

导入器先构造候选，不立即选文件：

```text
MarkdownCandidate
  archive_path        ZIP 内规范化路径
  markdown_dir        Markdown 所在目录；链接解析基准
  bundle_root         候选所属文档包的安全边界
  naming_signature    cloud-full | cli-stem | generic
  companions          content-list / middle / model / origin / images
  references          Markdown 实际引用的本地资源
  diagnostics         error / warning / info
  confidence          high | medium | low
```

`markdown_dir` 与 `bundle_root` 是两个概念：

- 所有相对 URL 都以 `markdown_dir` 为基准解析，这是 Markdown 文件位置语义；
- 解析后的目标还必须位于 `bundle_root` 内，这是安全边界；
- 对官方常见包，两者通常相同；外层仅用于包装的目录不是资源基准。

### 2. 安全解包先于内容识别

在读取候选前，对 ZIP central directory 做预检，并在隔离临时目录中解包。至少：

- 拒绝绝对路径、Windows 盘符/UNC 路径、NUL、空路径段以及规范化后的 `..` 越界；
- 拒绝符号链接、硬链接和其他特殊文件类型；
- Unicode 规范化并检查大小写折叠后的重复路径，拒绝覆盖冲突；
- 限制压缩包大小、解压总大小、单文件大小、文件数、目录深度、压缩比和处理时间（具体数值由 OQ-002 冻结）；
- 解包写入全新任务目录，不覆盖已有文件；
- 不相信扩展名，图片、PDF、JSON 等使用 magic bytes/MIME 再校验。

MinerU 自己的当前客户端也会拒绝绝对路径、含 `..` 的成员和解压根之外的目标，可作为最低基线，而不是完整的 Mirawind 安全方案。[官方 `safe_extract_zip`](https://github.com/opendatalab/MinerU/blob/79d6d8d79fb8f3ddba5cc34c07a16f0ec36f56c7/mineru/cli/api_client.py#L1042-L1065)

### 3. 候选枚举和评分

递归枚举所有普通 `.md` 文件，忽略 `__MACOSX/`、AppleDouble `._*` 和系统垃圾文件，但在诊断中记录。不要因目录深度而漏掉候选；深度只受安全上限约束。

建议评分信号如下：

| 信号 | 处理 |
|---|---|
| basename 精确为 `full.md`，且同目录有 `layout.json`、`*_content_list.json` 或 `images/` | 云端高置信 |
| basename 为 `<stem>.md`，同目录有 `<stem>_content_list.json`、`<stem>_middle.json`、`<stem>_model.json`、`<stem>_origin.*` 中任一项 | CLI 高置信 |
| `<stem>.md` 的 stem 同时匹配文档目录名（允许中间夹一层 `auto/txt/ocr/vlm/office/hybrid_*`） | 提高置信 |
| Markdown 的本地资源引用全部能在同一 bundle 中解析 | 提高置信；缺失则产生 error |
| 正文非空且解析后存在至少一个正文块 | 必需 |
| `README.md`、`CHANGELOG.md`、`LICENSE.md`、隐藏目录下的 Markdown | 默认排除或低置信，只可人工选择 |
| 只有一个普通 Markdown，但无任何 MinerU 伴随文件 | medium；可识别为“兼容 Markdown 包”，不要谎称已验证为 MinerU |
| 文件名或路径满足信号，但正文为空/仅空白 | 淘汰 |

不要把“必须含一级标题”设为硬条件。MinerU 可能面对无标题扫描件、页面截取或标题识别失败；标题可用于加分和生成元数据诊断，但不能决定正文是否合法。

也不要简单选择最大 Markdown。批处理包中的两本书都可能是高质量正文，“最大”只会无提示地导错书。

### 4. 自动选择状态机

```text
0 个可用候选
  → 导入失败：
    - ZIP 内没有 Markdown；或
    - 发现 staged middle/model/images，但缺少最终 Markdown：
      “这是未完成的客户端生成包，请在 MinerU 中导出最终 Markdown 后重试”

1 个可用候选
  → 若 high confidence 且无 error：自动选择
  → 若 medium/low：预选但必须由管理员确认

2 个及以上可用候选
  → 按“文档 bundle”分组
  → 多个 bundle：判为批处理/多书包，M1 要求一次选择并仅导入一本，
    或更稳妥地拒绝并提示拆包
  → 同一 bundle 多个候选：列出路径、大小、伴随文件、标题预览和诊断，
    必须人工选择
```

高置信自动选择还必须同时满足：

- 正文 UTF-8 可解码（允许 UTF-8 BOM）且不是空白；
- Markdown AST 可构建；
- 所有必须本地化的图片引用均能安全解析；
- 未发现候选之间的结构歧义；
- 不存在越界路径、路径碰撞或资源类型伪装等安全错误。

### 5. 资源根目录与引用解析

对选中的 Markdown：

1. 使用成熟 Markdown AST 解析链接和图片，不用正则扫描；
2. 同时由 HTML sanitizer 解析 raw HTML 中的 `img/src`、`source/srcset` 等允许属性；
3. 将相对引用以 `markdown_dir` 为基准解析；
4. 去除 fragment/query 后，对路径做一次严格 URL percent-decode 和规范化；
5. 拒绝反斜杠歧义、绝对文件路径、`file:`、`javascript:`、`data:`（若未来允许必须另做大小/MIME策略）和任何逃出 `bundle_root` 的路径；
6. `http:`/`https:` 远程资源按现有产品原则拒绝或进入“显式下载并固化”流程，不能在公开页面直接回源；
7. 校验文件存在、是普通文件、MIME 与允许的图片类型相符，并在解码层检查像素上限；
8. 只把实际引用的资源复制到永久存储，使用内容哈希命名；生成后的正文引用内部资源 ID，不保留不可信相对路径。

官方输出中 Markdown 与 `images/` 位于同一解析目录，引用形式也是 `images/...`，所以 `markdown_dir` 作为解析基准覆盖了云端 `full.md`、压平的 Gradio ZIP 和多层 CLI ZIP，不需要猜测 ZIP 根。

如果第三方重新打包导致 Markdown 使用 `../images/...`：

- 目标仍在明确识别出的 `bundle_root` 内时，可显示 warning 并要求人工确认；
- 无法可靠确定 bundle 边界或目标跨入另一个候选 bundle 时，作为 error 拒绝；
- 不应为了“修好”路径而在整个 ZIP 内按 basename 搜索，因为同名文件可能被错误绑定。

### 6. 伴随 JSON 的用途

`content_list.json` 可用于：

- 佐证候选属于 MinerU；
- 对照 `img_path`，发现 Markdown 未显式呈现但结构数据声明的资源；
- 提供页面、标题层级和 bbox 诊断。

`middle.json`/云端 `layout.json` 可用于读取 `_backend`、`_version_name`（存在时）和更详细诊断。

但内部结构会跨版本和后端变化，所以 M1 应把 Markdown 作为唯一正文源：

- JSON 缺失：warning 或 info，不阻塞；
- JSON 无法解析：warning；若管理员不依赖它仍可继续；
- JSON 指向缺失图片：显示诊断，但是否阻塞应以选中 Markdown 的实际发布需求为准；
- JSON 与 Markdown 内容不一致：不以 JSON 覆盖 Markdown。

### 7. 建议的管理员确认界面

候选列表至少显示：

- ZIP 内完整相对路径；
- 识别类型：MinerU Cloud / MinerU CLI / 普通 Markdown；
- 文件大小、首个标题、正文字符数；
- 同目录检测到的 `images/`、`content_list`、`middle/layout`、`model`、原文件；
- 图片引用总数、缺失数、越界数、远程资源数；
- 自动选择理由或必须人工选择的理由。

人工确认后，把选中 `archive_path`、识别签名、资源基准和导入器版本写入 `document-manifest.json`。重新导入时可以优先匹配上次路径，但仍须重新执行全部安全和完整性校验，不能盲信旧选择。

## 对 OQ-001 的建议答案

建议将 OQ-001 冻结为：

> 导入器递归发现 Markdown，并基于 MinerU Cloud `full.md`、MinerU CLI `<stem>.md`、同目录伴随文件和资源引用完整性识别主正文。只有一个无错误的高置信候选时自动选择；只有一个普通/低置信候选时预选并要求管理员确认；多个候选不得按顺序或大小静默选择。Markdown 所在目录是相对资源解析基准，候选所属 bundle 是路径安全边界。不存在最终 Markdown 时导入失败；若检测到 staged `middle/model/images` 包，提示用户回到 MinerU 生成并导出最终 Markdown。标题不是必需条件，非空可解析正文和引用资源安全完整性是必需条件。

这套规则能够覆盖官方云 ZIP、旧版和新版开源 CLI/API、多层目录、Gradio 压平 ZIP，以及批处理包，同时保持 M1“一次导入一本书”的边界。
