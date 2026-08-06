# 标题自动编号与去编号调研

- 日期：2026-08-02
- 状态：调研记录，不改变现有产品决策、规格、schema 或运行时行为
- 范围：整本书的正文标题、全书目录、本页提纲、面包屑、页面标题与搜索标题
- 不在范围：公式、图、表、脚注编号；按标题拖拽正文；任意编号模板设计器

## 结论

建议补齐这项功能，但产品上不应设计成两个会改写正文的“自动编号”和“自动去编号”
命令，而应把现有的整书级三态配置暴露为一个可逆控件：

| 界面名称 | 已有配置值  | 行为                                             |
| -------- | ----------- | ------------------------------------------------ |
| 原书编号 | `source`    | 显示导入或管理员确认的 `source_number`           |
| 自动编号 | `generated` | 按最终标题层级只为派生角色为正文的标题生成编号   |
| 无编号   | `none`      | 隐藏独立编号表示，但保留标题、层级和原书编号数据 |

这不是一套需要重新发明的编号系统。当前 `book.yaml` v4、编译核心和产品决策已经具有
这三个模式；缺少的是出版工作台的读写闭环、模式切换测试，以及少数源编号识别边界。

推荐保持以下不变量：

1. 切换模式不改写活动 Markdown，也不删除 `source_number`。
2. 同一个编译期标题表示同时进入正文、目录、提纲、面包屑、页面元数据和搜索。
3. 变更创建新的配置 revision 和 candidate；发布仍只原子晋升 ready candidate。
4. 编号作为真实预生成 HTML 文本输出，而不是仅靠 CSS counter 或客户端脚本显示。
5. 第一版只提供固定十进制正文编号；前置、附录和后置内容均不自动编号，也不增加格式设计器。

因此，这是一个边界清楚、价值较高的出版工作台 closure，通常不需要 `book.yaml`
schema 升级或迁移。若进一步要求“第 1 章”“Part I”、逐级格式、局部重启或逐标题例外，
那才是新的产品决策和编号模型。

## 用户问题应如何定义

“目录正文部分自动编号和自动去编号”至少涉及两个容易混淆的动作：

- 从标题源文本中识别并分离已有编号；
- 决定发布表示显示原编号、生成编号还是不显示编号。

前者属于导入准备和人工校正，后者属于可逆的出版配置。两者必须分开。若切换到
“无编号”时直接用正则批量删除 Markdown 前缀，`2024 研究报告`、`3D 视觉`、版本号、
公式片段或标题本身的一部分都可能被误删，而且再次切回原书编号时无法恢复。

本功能的正确用户故事是：

> 管理员在出版工作台选择整本书的标题编号方式，保存后看到同一 candidate 的正文与
> 所有导航位置一致更新；切回任一模式不会丢失原书标题或编号。

不建议分别设置“目录编号”和“正文编号”。这会允许目录显示 `2.3`、正文却没有 `2.3`
之类的分叉，违反当前“一份编译期标题表示”的产品约束，也会让复制、搜索与可访问名称
不再一致。

## 仓库现状

### 已批准的产品语义

现有权威文档已经批准三态模型：

- D-121 规定标题编号模式为 `source | generated | none`，默认 `source`；正文标题、全书
  目录、本页提纲、面包屑和搜索共用一份编译期标题表示。
- 产品规格 11.2 规定标题编号可以保留源编号、按最终连续层级生成或关闭。
- Feature 011 FR-004 要求一个标题在所有位置共用一个 rich label，并且最多显示一次编号。

仓库来源：[D-121](../decisions/decision-log.md#d-121出版内容编辑与可见性采用单一活动文档模型)、
[产品规格 11.2](../product/product-spec.md#112-标题编号)、
[Feature 011 FR-004](../../specs/011-publishing-editor-closure/spec.md#requirements)。

因此，提供管理入口是对既有决策的闭环，不需要先新增第四种模式。实现前仍应把用户可见
操作和验收同步到当前 feature 规格、任务和 API contract。

### schema 与编译器已经支持

[`book.schema.json`](../schemas/book.schema.json) 已要求：

```yaml
publishing:
  numbering:
    mode: source | generated | none
```

每个结构标题另存可选 `source_number` 和不含独立编号的 `title_markdown`。编译核心
[`heading-presentation.ts`](../../src/modules/publishing/core/publication/heading-presentation.ts)
的现有行为是：

- `source`：取 `source_number`；
- `generated`：当前实现为正文生成 `1`、`1.1`、`1.1.1`，并为附录生成 `A`、`A.1`；
- `none`：编号为 `null`；
- frontmatter 与 backmatter 在 generated 模式下不编号；
- 最终统一产生 `number`、`title` 和 `label`。

真实 `<span class="heading-number">` 只在 `number` 存在时写入标题 DOM；目录、页面标题、
manifest 和搜索也从同一 heading presentation 读取。现有实现方向正确。

### 当前不可由用户操作

闭环缺口是确定的：

1. 草稿 GET 的 `DraftView` 不返回 `publishing.numbering.mode`。
2. 草稿 PATCH 的严格字段只接受 alias、metadata、boundaries 与逐标题 changes；提交编号模式
   会被当作未知字段拒绝。
3. `StructureEditor` 没有 numbering prop、状态、dirty 比较或三态控件。
4. 初次准备始终写入默认 `source`，之后没有正常 HTTP/UI 路径可以切换。
5. 现有核心测试主要覆盖 `generated`；没有检索到 `none` 模式的正文和多消费者回归测试。

仓库来源：[`DraftView`](../../src/web/contracts/publishing.ts)、
[`parseDraftPatch()`](../../src/modules/publishing/adapters/filesystem/config-revisions.ts)、
[`StructureEditor`](../../src/web/components/manage/StructureEditor.tsx)、
[`finalizePreparedDraft()`](../../src/modules/publishing/adapters/worker/finalize-prepared-draft.ts)。

本次只读验证运行了三个相关测试文件，共 18 个测试，全部通过。这证明现有 schema 与
generated 编译链可用，但不能替代缺失的 `source`/`none`、API 和交互证据。

### 暴露控件前必须解决的实现风险

以下问题不是未来格式扩展，而是现有三态实现的正确性边界；前三项必须先写失败测试并
决定预期行为，不能直接把 `generated` 暴露给管理员：

1. **正文从 H2 开始会生成零前缀。** [`generatedNumbers()`](../../src/modules/publishing/core/publication/heading-presentation.ts)
   把 body 的四级 counter 初始化为零，但按全书连续层级验证只要求全书第一个标题为 H1，
   不要求正文从 H1 开始。如果 frontmatter 的 H1 后直接进入 body H2，结果会是 `0.1`。
   应在正文边界归一化相对层级，而不是发布零前缀。
2. **技术标题会被误拆。** 当前十进制正则允许编号与后续字母之间没有分隔，因此
   `8.5英寸软盘` 会被拆成 `source_number: 8.5` 与标题 `英寸软盘`。这证明“看起来像小数”
   不能单独构成高置信编号证据。
3. **富文本编号前缀会重复。** 对 `# **4.4.4** Virtual memory`，可见纯文本会识别出
   `4.4.4`，但 raw `title_markdown` 以 `**` 开头，当前 raw 正则不会删除编号；最终
   `source` label 会同时组合独立编号和仍在富文本中的编号。提取结果必须对可见标题和 raw
   inline AST 建立同一证据，不能一边取编号、另一边保留原前缀。
4. **附录顶层标签曾与产品规格不一致，现已由 D-122 解决。** 产品规格曾写 `Appendix A、B`，
   历史 D-047 写过 `附录 A`、`A.1`，而当前编译器只生成裸 `A`。用户随后明确“只用编号
   正文”，D-122 因而规定 generated 模式不给附录编号；source 模式仍可展示附录原书编号。

### 自动去编号仍有输入边界

准备期
[`splitSourceHeadingTitle()`](../../src/modules/publishing/core/preparation/heading-title.ts)
当前能分离常见形式，包括：

- `第 1 章`、`第一部分`；
- `Chapter 1`、`Part IV`、`Appendix A`；
- `1.2`、`1.2.3`、`A.1`；
- 以空格分隔的裸整数章节号。

但它不是任意人类编号语法的完备解析器。例如 `一、`、圈号、纯罗马数字、某些
`1. 标题` 写法或出版社自定义前缀可能仍留在 `title_markdown` 中。此时 `none` 只能隐藏
已经分离的 `source_number`，不能安全地猜测并删除标题内容。

这不是切换时增加更激进正则的理由。建议统一准备期的编号证据解析，给无法可靠分离的项
保留可定位诊断和现有“标题 / 原书编号”人工校正入口。低置信前缀必须保留原文。

## 一手资料结论

以下链接除 WAI 当前页面外均固定到具体 commit，避免后续文档更新改变本次结论的证据。

### HTML 与 CommonMark 只定义标题结构，不定义出版编号

HTML 标准规定 `h1`-`h6` 的数字表示 heading level，对应嵌套 section 的层级；例如 `h1`
是顶层 section、`h2` 是 subsection。这个数字是语义层级，不是读者看到的章节号。
[WHATWG HTML，固定 commit](https://github.com/whatwg/html/blob/24c5e48bf66ea61bc199ec6338c81258275ba9c6/source#L20187-L20195)

CommonMark 0.31.2 把 ATX heading 定义为 1-6 个 `#` 围出的 inline content，并由 `#` 数量
确定 heading level；规范没有独立的章节编号字段或自动编号开关。因此 `## 1.2 Title` 中的
`1.2` 只是 inline 文本。要支持无损切换，Mirawind 必须在自己的出版模型中分开保存
`display_level`、`source_number` 与 `title_markdown`，输出时才组合。
[CommonMark 0.31.2，固定 commit](https://github.com/commonmark/commonmark-spec/blob/9103e341a973013013bb1a80e13567007c5cef6f/spec.txt#L1096-L1108)

### Pandoc、Docutils、Sphinx 与 LaTeX 都在派生阶段编号

Pandoc 3.10.1 的 `--number-sections` 只要求在 LaTeX、HTML、Docx、EPUB 等输出中给 section
heading 编号，默认不编号；`unnumbered` class 可排除单个标题，`--number-offset` 调整各层
起始值。它把编号作为 writer/output 选项，而不是把数字写回源标题。
[Pandoc User's Guide，固定 commit](https://github.com/jgm/pandoc/blob/d6011e4465d4cb0d0a6fb872dab3ed089f404a75/MANUAL.txt#L1211-L1230)

Docutils 的 `sectnum` 更直接展示了派生模型：初次解析只放入 `pending` 占位节点，随后
transform 才把编号以 `generated` 节点插入 title，并设置 `title['auto'] = 1`；实现优先级
还明确要求它先于目录 transform 执行，使目录识别同一自动编号状态。指令另有 `depth`、
`prefix`、`suffix`、`start`，说明“可逆开关”和“完整模板系统”是两个复杂度层级。
[Docutils 指令文档，固定 commit](https://github.com/docutils/docutils/blob/74f8d2c9d350f9e5875b43b5e20f134c7118b690/docutils/docs/ref/rst/directives.rst#L1222-L1274)
[Docutils `SectNum` transform，固定 commit](https://github.com/docutils/docutils/blob/74f8d2c9d350f9e5875b43b5e20f134c7118b690/docutils/docutils/transforms/parts.py#L18-L67)

Sphinx 9.1.0 要求在顶层 `toctree` 使用 `:numbered:`，子 toctree 自动参与，也可以给出
numbered depth。其 collector 从顶层目录递归计算 tuple 编号，同时把文档 title 的编号提供
给 next/previous/parent related links；若某文档的 section numbers 与旧值不同，则把它加入
`rewrite_needed`。这与 Mirawind “一次编译、所有消费者一起更新”的方向一致。
[Sphinx `toctree :numbered:`，固定 commit](https://github.com/sphinx-doc/sphinx/blob/cc7c6f435ad37bb12264f8118c8461b230e6830c/doc/usage/restructuredtext/directives.rst#L163-L186)
[Sphinx 编号 collector，固定 commit](https://github.com/sphinx-doc/sphinx/blob/cc7c6f435ad37bb12264f8118c8461b230e6830c/sphinx/environment/collectors/toctree.py#L197-L283)

LaTeX2e 内核也区分结构命令和编号表示：无星号 section 命令进入 `\@sect`，由
`secnumdepth` 判断是否递增 counter，并在写 TOC 时按同一条件加入 `\numberline`；星号形式
进入 `\@ssect`，不走该计数和默认 TOC 写入路径。成熟系统允许关闭或局部绕过编号，但不为
切换而破坏标题正文。
[LaTeX2e `secnumdepth` 与星号语义，固定 commit](https://github.com/latex3/latex2e/blob/8a08ba22c73d5d055a24d2b75b4bc747d8adad20/base/ltsect.dtx#L277-L280)
[LaTeX2e `\@startsection`/`\@sect` 与 TOC 传播，固定 commit](https://github.com/latex3/latex2e/blob/8a08ba22c73d5d055a24d2b75b4bc747d8adad20/base/ltsect.dtx#L388-L443)

这些工具支持比本需求更多的 offset、depth、prefix、局部例外，但不能据此推导 Mirawind
第一版也需要模板设计器。共同的、足够支撑本需求的模式是：源结构保留，编号在解析后的
表示或输出阶段生成，并传播给相关消费者。

### CSS counters 能排版，但不应成为本项目权威

CSS Lists Level 3 把 counter 定义为文档树上的数值 tracker；通过 `counter-reset`、
`counter-increment`、`counter-set` 操作，再由 `counter()`/`counters()` 取值。它能生成
多级视觉编号，但规范描述的是 CSS 计算与呈现机制，不是服务端出版 manifest 或搜索模型。
[CSS Lists Level 3，固定 commit](https://github.com/w3c/csswg-drafts/blob/13b14ec48af0219c893713d670cf80d8c014a648/css-lists-3/Overview.bs#L740-L774)

W3C WAI 的 F87 页面已经标记为 **Obsolete**，并明确说明现代 user agent 和 screen reader
对 CSS-generated content 的支持已经改善，不能把它简单表述为必然的 WCAG 失败；但同一
页面仍指出这类内容可能不可选中，且用户覆盖或关闭样式时，非装饰信息可能不可用。因此将
章节号只放在 `::before { content: ... }` 中，复制/选择路径和依赖样式的访问路径仍不可靠。
[W3C WAI F87 当前页面](https://www.w3.org/WAI/WCAG21/Techniques/failures/F87.html)

Mirawind 的编号还必须进入服务端目录、页内提纲、面包屑、页面标题、搜索结果、immutable
manifest 和无 JavaScript 阅读路径。CSS counter 无法给这些消费者提供共同的编译期 label；
若 TypeScript 再复刻一套计数，就会产生两份权威。应继续在 worker 中计算一次，输出真实
`.heading-number` 文本节点；CSS 只负责间距和视觉样式。编号不会改变 `h1`-`h4` 的 HTML
语义层级，只是 heading label 的可选组成部分。

## 方案比较

| 方案                            | 可逆 | 多消费者一致       | 源文件安全 | 适合本项目     |
| ------------------------------- | ---- | ------------------ | ---------- | -------------- |
| 批量正则改写 Markdown           | 否   | 取决于重新解析     | 高误删风险 | 不采用         |
| 仅 CSS counters                 | 是   | 只能保证视觉层     | 不改源     | 不采用         |
| 客户端运行时编号                | 是   | JS/无 JS 分叉      | 不改源     | 不采用         |
| 编译期三态 heading presentation | 是   | 一次计算、共同消费 | 不改源     | 推荐；现有方向 |

## 推荐的产品行为

### 控件

在出版工作台的结构编辑区域提供整书级 segmented control：

`原书编号 | 自动编号 | 无编号`

默认和当前值均来自草稿 `book.yaml`。它属于结构出版设置，不属于单个标题编辑 dialog。
逐标题的“原书编号”字段继续存在，用于 `source` 模式和无损保留；切换到其他模式时不清空。

控件改变后沿用现有保存与冲突模式：标记本地 dirty，统一保存，使用 `If-Match`，成功后
创建新配置 revision 并排一个 `build_candidate`。正式 Reader 预览必须来自 worker 的共同
编译核心，不能在 React 中实现第二套生成算法。

### 模式语义

`source`：

- 只显示已分离并保存的 `source_number`；
- 没有可靠源编号的标题保持无编号；
- 不补齐缺号，也不统一格式。

`generated`：

- 以最终、连续有效的 `display_level` 和内容边界生成；
- frontmatter/appendix/backmatter 不编号；
- body 使用十进制层级；
- 每个 eligible 活动标题参与计数，即使 `include_in_toc=false`。目录可能有数字间隔，但
  正文序列和重新显示该标题后的编号保持稳定；
- 层级或边界改变时必须由同一 candidate 重新计算。

`none`：

- 所有消费者不组合独立 `number`；
- 不修改 `title_markdown`、`source_number`、heading ID、page ID 或 fragment；
- 再切回 source/generated 能恢复相应显示。

### 去编号安全边界

“无编号”只能承诺隐藏已经独立建模的编号，不能承诺从任意历史 Markdown 中自动删除所有
看起来像编号的文本。安全的切换流程是：

1. 保存 `numbering_mode: none`，不写活动 Markdown，不删除结构项中的 `source_number`。
2. worker 从新配置 revision 构建 immutable candidate，并让所有 heading label 消费者都
   得到 `number: null`；锚点、页面 ID、内部链接和正文源保持不变。
3. 只有在准备期以高置信证据把前缀分离为 `source_number` 后，`none` 才会隐藏它；仍嵌在
   `title_markdown` 的 `一、`、版本号或富文本前缀按普通标题内容保留。
4. 对疑似未分离或可见/raw 表示不一致的标题给出诊断并允许人工校正，不能在模式切换时
   运行更激进的正则。
5. 切回 `source` 或 `generated` 只创建后续 revision/candidate；已经发布的版本保持不可变。

因此 UI 文案应是“无编号”，而不是暗示破坏性清洗的“删除编号”。验收也应检查往返可逆和
身份稳定，而不是要求对低置信标题做到 100% 猜测删除。

### 搜索

当前搜索索引写入 `heading.label`，因此模式变更会与 candidate 一起原子重建搜索标题。这能
保证结果显示与 Reader 一致，但切到 `none` 后，纯编号查询（如 `2.3`）不再命中该标题。

是否接受这一行为是尚未决定的产品问题。若希望无论展示模式如何都能按原编号检索，应另行
把 `source_number` 作为非展示检索别名建模，不能偷偷把隐藏编号继续放进公共 label。

## 实现影响

无需改变 schema 的最小闭环：

1. Draft read model 返回严格的顶层 `numbering_mode`。
2. Draft PATCH 严格接受一个三值字段，拒绝未知值和未知嵌套字段。
3. 配置 revision 更新只替换 `publishing.numbering.mode`，保留 `publishing.code` 和结构项。
4. `StructureEditor` 接入服务器值、本地 state、dirty/merge/discard/save 与冲突保留。
5. 保存成功后沿用 candidate rebuild；发布和访问状态不变。
6. 文档同步 feature spec、manage API contract、tasks、quickstart 和产品规格中的管理入口。

API 字段命名应只选一种。推荐使用窄的顶层字段，不把整个 `publishing` 配置对象暴露为可写
contract：

```json
{
  "changes": [],
  "numbering_mode": "generated"
}
```

GET 同样返回 `numbering_mode`。adapter 只把它映射到 `publishing.numbering.mode`，因此不会
意外开放同一 `publishing` 对象下的 `code` 或未来字段。这仍是草稿配置 patch，不新增响应
类；认证、授权、`private, no-store`、no-index、同源写入和 `If-Match` 行为完全沿用现有
draft endpoint。

## 阶段性交付

### 阶段 0：先封住正确性风险

- 为正文首 H2 的 `0.1`、`8.5英寸软盘`、富文本编号前缀写失败测试并修复。
- 按 D-122 删除 generated 模式的附录编号，并同步较低权威规格、实现和测试。
- 补齐三态 core fixture 与跨消费者断言，使 UI 接入前已有稳定语义。

### 阶段 1：完成服务端闭环

- GET/PATCH 加入顶层 `numbering_mode`，保持严格字段、ETag、revision 和 candidate rebuild。
- 覆盖无效枚举、过期 ETag、并发修改、重复提交、授权和响应缓存行为。
- 用真实 candidate 预览验证正文、导航、manifest 和搜索一致，不提供旁路即时预览算法。

### 阶段 2：接入出版工作台

- 增加三态 segmented control，接入 dirty、save、discard、reload 与 412 冲突保留。
- 验证键盘、焦点、窄屏和放大文本；发布仍只能晋升 ready candidate。

### 阶段 3：代表性回归与上线观察

- 小型 fixture 覆盖全部消费者；源编号解析有变化时重跑十五本 reference-v2 exact 门禁。
- 在不改变默认 `source` 的前提下发布入口，记录 build 失败和诊断分布，再决定是否扩展模板、
  offset 或逐标题例外。

## 必要证据

### Core 与 schema

- `source`、`generated`、`none` 三态严格解析，未知值/字段拒绝。
- 连续 H1-H4、层级重置、无编号源标题、front/body/appendix/backmatter 边界。
- 全书首标题为 frontmatter H1、body 从 H2 开始时，输出不得包含 `0.1`。
- generated 模式下 appendix 的编号始终为 `null`。
- `none -> source -> generated` 往返不改变 title/source number/ID。
- 被排除目录的普通活动标题仍按明确规则参与 generated 计数。

### 共同消费者

同一本小型 fixture 对三种模式逐项验证：

- 正文 heading HTML；
- 全书 TOC；
- 本页 outline；
- breadcrumb、page metadata 和上一页/下一页标题；
- manifest/presentation；
- 长短查询搜索结果。

每个位置最多出现一次编号；`none` 不得残留 `.heading-number`。无 JavaScript 页面应得到
相同标签，锚点和内部链接不变。

### API 与 UI

- GET 返回当前模式，PATCH 保存并创建一个新 revision/candidate。
- 无效 mode、未知字段、未认证、其他书、过期 ETag 与重复提交。
- 412 后本地模式选择与其他未保存结构编辑都保留。
- 保存失败不把 UI 显示成已接受；discard/reload 恢复服务器模式。
- 键盘、焦点、移动宽度、放大文本和三段标签不溢出。

### 源编号识别

至少覆盖中文章/篇/部分、英文 Chapter/Part/Appendix、十进制、附录小节，以及年份、版本号、
`3D`、公式、`8.5英寸软盘` 和技术 token 的反例；富文本前缀 `**4.4.4**` 必须保证编号与
raw title 同时分离，或两者都不分离。无法可靠分离时应保留标题并给出诊断，不能为了达到
“全去掉”而扩大误删面。

十五本 reference-v2 默认仍是 `source`，不应因新增 UI 发生差异。若改变编号解析器，则该
解析器属于内容正确性边界，需要在十五本上重新跑 exact；仅暴露已有模式时，小型跨消费者
fixture 加现有最终门禁即可覆盖主要风险。

## 开放产品决策

这些问题不应由 adapter 或 UI 实现顺手决定。按仓库流程，选择必须先进入 decision log，再
同步产品规格、feature spec、contract 和测试。

### `none` 是否保留原编号搜索别名

| 选择             | 结果                                                             | 代价                                                                     |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 不保留           | 搜索与 Reader 可见 label 完全一致；查询 `2.3` 不再命中           | 熟悉纸书编号的用户失去入口                                               |
| 保留非展示 alias | `none` 下仍可按 `source_number` 找到标题，结果只显示无编号 label | 搜索索引需区分 display label 与 hidden alias，并说明隐私、排序和高亮语义 |

最小闭环可以选择“不保留”，但必须明确写入规格和测试；若选择保留，必须新增显式 search alias
字段，不能继续把隐藏编号拼进 `heading.label`。

### 附录自动编号的最终标签

用户已明确“只用编号正文”。D-122 因而选择不在 generated 模式下为附录生成任何标签，
取代产品规格和历史决策中 `Appendix A`、`附录 A` 或裸 `A` 的冲突描述。附录若在源文件中
已有可靠编号，仍可在 source 模式展示；none 模式继续隐藏。

## 暂不扩展

第一版不要同时加入：

- `第 1 章`、`Part I`、中文数字、罗马数字等格式模板；
- 不同层级独立格式、prefix/suffix、start offset 或重启规则；
- 逐标题 generated/none 例外；
- 目录和正文不同模式；
- 在浏览器内即时复刻编译器计数；
- 对低置信前缀执行破坏性批量清理。

这些能力都能以后在真实书籍证据表明确需求时扩展。现有三态模型在上述风险解决后已经足以
覆盖最常见的需求：尊重原书、统一重编号、完整隐藏编号。

## 最终建议

把它排入下一次出版工作台 closure，按“小功能、完整证据”处理：

- 产品不再讨论第四种模式；沿用 D-121 已批准三态；
- 不升级 `book.yaml` v4；
- 先修复三个仍存在的正确性风险并落实 D-122 的正文限定，再补 GET/PATCH contract 和
  segmented control；
- 用 worker candidate 作为唯一预览事实；
- 同一标签覆盖正文、目录、提纲、面包屑、页面元数据和搜索；
- 单独记录并修复源编号识别覆盖，不把它和模式切换混成破坏性正文处理。

这能以很小的数据模型风险补上用户真正缺失的操作，同时保留将来增加出版级编号模板的
空间。
