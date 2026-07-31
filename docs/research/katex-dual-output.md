# KaTeX 双输出、源码体积与无障碍调研

- 日期：2026-07-26
- 当前复核：2026-07-31；技术结论仍有效，仓库证据已更新到 publication core 与
  `semantic-html-v5-katex-0.18.1`
- 状态：调研记录，不改变 D-103 或运行时决策
- 针对版本：KaTeX 0.18.1
- 范围：解释 `.katex-html` 与 `.katex-mathml` 为什么同时存在，比较官方
  `output` 模式，并评估 Mirawind Library 可采用的处理方式
- 来源：KaTeX 官方文档与 0.18.1 源码、W3C/WHATWG 标准、浏览器与 Google
  一方文档，以及本仓库 Chromium 实测

## 结论

当前页面源码中的 `.katex-html` 和 `.katex-mathml` 不是重复执行渲染或
rehype/Astro 的缺陷，而是 KaTeX `output: "htmlAndMathml"` 的预期结果。KaTeX
把同一棵解析树生成两种表示：

- `.katex-html` 是 KaTeX 自己定位和排版的视觉表示；
- `.katex-mathml` 包含结构化 MathML 和原始 TeX `annotation`，用于无障碍语义，
  也被 KaTeX 的复制插件使用。

KaTeX 官方把 `htmlAndMathml` 定义为默认值，并明确说明 HTML 用于视觉渲染、
MathML 用于 accessibility。[KaTeX options](https://katex.org/docs/options.html#output)
在 0.18.1 的实现中，双输出分支确实依次创建 MathML 和 HTML 子树。
[KaTeX `buildTree.ts` 0.18.1](https://github.com/KaTeX/KaTeX/blob/v0.18.1/src/buildTree.ts#L33-L52)

Mirawind 又在 publication core 中显式指定了该模式，而不是偶然落入默认值：
[`src/modules/publishing/core/publication/render-math.ts`](../../src/modules/publishing/core/publication/render-math.ts#L40)。
`render-document.ts` 对每个公式调用这一函数并接纳其受信任关闭的 KaTeX 标记；当前没有
第二条 `rehype-katex` 或旧 compiler 渲染链。因此只要这个选项不变，查看 Elements、页面
源代码或完整 DOM 时就必然能看到两棵表示树，但这仍是一次公式渲染。

这套结构已经做到“视觉一次、无障碍一次”，但没有做到“任意文本抽取器只读
一次”。Chromium 实测中，CSS 正确加载时页面只显示 `.katex-html`，accessibility
snapshot 也只有一个 `math` 节点；但是 `textContent` 和 `innerText` 都会读到
MathML 字符、TeX annotation 和 HTML 字符。截图中 Gemini 一类工具若直接抽取
DOM 文本而不采用浏览器无障碍树或公式感知规则，因而可能看到重复公式。这是
“DOM/AI 抽取冗余”，不是用户视觉上的双重公式。

在不修改已接受产品决策的前提下，建议短期保留 `htmlAndMathml`，把验收目标定为：

1. MathML 始终在 DOM 和无障碍树中存在；
2. MathML 不参与视觉布局，HTML 视觉表示只出现一次；
3. 本站自己控制的正文、搜索、复制或 AI 抽取逻辑对 `.katex` 做公式感知抽取，
   优先取一个规范表示，不能对整个公式调用裸 `textContent`；
4. 对传输体积使用 HTTP 压缩和合理拆页，但承认这不会减少解压后的页面源码或
   DOM 节点。

若产品目标升级为“响应 HTML 中每条公式也只能有一棵表示”，唯一直接的 KaTeX
官方输出模式是 `output: "mathml"`。它在当前浏览器实测中既可见又保留一个
`math` 无障碍节点，并显著缩小公式标记，但它把视觉排版交给浏览器原生 MathML，
不再满足 D-103 当前要求的“KaTeX HTML 可见”。采用前必须先修改决策、产品规范、
feature spec 和 renderer contract，再补齐跨浏览器、字体、打印、复制与辅助技术
证据。

`output: "html"` 不是本项目可接受的解决办法。KaTeX 0.18.1 给 `.katex-html`
设置了 `aria-hidden="true"`；本地 Chromium 实测的 accessibility snapshot 为空。
它会删除项目明确要求保留的 MathML，直接违反 D-103 和 FR-019。
[KaTeX `buildHTML.ts` 0.18.1](https://github.com/KaTeX/KaTeX/blob/v0.18.1/src/buildHTML.ts#L384-L405)

## 为什么会有两种表示

### HTML 视觉树

KaTeX 的 HTML builder 生成大量 `<span>`，通过 KaTeX CSS、字体、尺寸和相对定位
复现 TeX 排版，最外层类名是 `.katex-html`。该节点被标为
`aria-hidden="true"`，因此它应当可见，但不应作为第二份内容暴露给辅助技术。
[KaTeX `buildHTML.ts` 0.18.1](https://github.com/KaTeX/KaTeX/blob/v0.18.1/src/buildHTML.ts#L397-L405)

### MathML 语义树

MathML builder 把表达式转换为 `<math><semantics>...</semantics></math>`，并在
`<annotation encoding="application/x-tex">` 中附带原始 TeX。组合输出时外层类名
是 `.katex-mathml`；只有 `mathml` 单输出时外层类名才直接是 `.katex`。
[KaTeX `buildMathML.ts` 0.18.1](https://github.com/KaTeX/KaTeX/blob/v0.18.1/src/buildMathML.ts#L275-L331)

`annotation` 不是第三套视觉公式，而是 MathML `semantics` 内的替代表示。不过它
确实占响应字节，也会被不理解 MathML 语义的 DOM 文本抽取器读到。KaTeX 官方
Copy-TeX 插件会删除相邻 HTML 树，再把 `.katex-mathml` 中的 TeX annotation
转换为带定界符的复制文本，所以任意删除 annotation 还会改变官方复制行为。
[KaTeX `katex2tex.ts` 0.18.1](https://github.com/KaTeX/KaTeX/blob/v0.18.1/contrib/copy-tex/katex2tex.ts#L15-L47)

### CSS 只解决视觉重复

KaTeX 官方 CSS 使用绝对定位、`clip-path: inset(50%)`、`1px` 宽高和
`overflow: hidden` 把 `.katex-mathml` 保留给屏幕阅读器但移出视觉布局。
[KaTeX `katex.scss` 0.18.1](https://github.com/KaTeX/KaTeX/blob/v0.18.1/src/styles/katex.scss#L48-L60)
KaTeX 的 troubleshooting 文档还专门用 `.katex-mathml` 检测样式表是否成功
加载；这说明 MathML 意外可见通常是 CSS 缺失或版本不匹配，而不是应删除
MathML。[KaTeX troubleshooting](https://katex.org/docs/issues.html#troubleshooting)

本仓库已内联同类关键规则：
[`src/modules/publishing/core/publication/render-assets.ts`](../../src/modules/publishing/core/publication/render-assets.ts#L8)，并在
Playwright 中分别验证 MathML 被裁剪、HTML 可见和 ARIA 属性：
[`tests/e2e/publishing-quality.spec.ts`](../../tests/e2e/publishing-quality.spec.ts#L64)。
所以当前截图所示的“源码同时存在”不表示这项 CSS 修复失败。

CSS 无法减少 HTML 响应、DOM 节点或 `textContent`。WHATWG DOM 对
`textContent` 的定义会收集后代文本；`aria-hidden` 管的是 accessibility API，
不是 DOM 文本 API。[DOM Standard: `textContent`](https://dom.spec.whatwg.org/#dom-node-textcontent)
[WAI-ARIA 1.2: `aria-hidden`](https://www.w3.org/TR/wai-aria-1.2/#aria-hidden)
因此给任一子树增加更多隐藏样式，最多改变视觉或无障碍映射，不会解决“查看
源码冗余”或通用 DOM 抽取重复。

## 三种官方输出模式

KaTeX 只公开三个 `output` 值，没有“HTML + MathML 但不带 annotation”或
“两种表示但只让 `textContent` 返回一份”的第四种模式。
[KaTeX options](https://katex.org/docs/options.html#output)
[KaTeX `Settings.ts` 0.18.1](https://github.com/KaTeX/KaTeX/blob/v0.18.1/src/Settings.ts#L197-L209)

| 模式            | 输出结构                       | 视觉排版            | 无障碍                                          | DOM 抽取           | 对本项目                             |
| --------------- | ------------------------------ | ------------------- | ----------------------------------------------- | ------------------ | ------------------------------------ |
| `htmlAndMathml` | MathML + TeX annotation + HTML | KaTeX HTML/CSS/字体 | MathML；HTML 被 `aria-hidden`                   | 裸文本抽取可能重复 | 当前模式，符合既有决策               |
| `html`          | 仅 KaTeX HTML                  | KaTeX HTML/CSS/字体 | 0.18.1 实测无 `math`；HTML 自身被 `aria-hidden` | 不重复             | 违反 MathML 要求，不可采用           |
| `mathml`        | 仅 MathML + TeX annotation     | 浏览器原生 MathML   | 实测一个 `math`                                 | 不重复             | 技术候选，但需先变更决策和渲染器契约 |

`mathml` 并不是“保留现在的 KaTeX 视觉效果，只删掉一份隐藏代码”。KaTeX
0.18.1 的分支会直接返回 MathML builder 的结果，不调用 HTML builder。
[KaTeX `buildTree.ts` 0.18.1](https://github.com/KaTeX/KaTeX/blob/v0.18.1/src/buildTree.ts#L40-L49)
MathML 在现代浏览器中已经广泛可用；MDN 将其列为自 2023 年 1 月起跨浏览器
可用。[MDN MathML](https://developer.mozilla.org/en-US/docs/Web/MathML)
但原生 MathML 的最终字形、间距和伸展运算符依赖浏览器与具有 OpenType MATH
能力的字体。MDN 明确指出良好 MathML 渲染需要合适的 Unicode 覆盖和 Open Font
Format 特性，并推荐专用数学字体。
[MDN Fonts for MathML](https://developer.mozilla.org/en-US/docs/Web/MathML/Guides/Fonts)

## 本地实测

以下结果使用仓库当前 KaTeX 0.18.1。字节数是单条 `renderToString` 未压缩 UTF-8
标记，不包含页面壳、CSS 和字体：

| 样例       | `htmlAndMathml` | `html` | `mathml` | 相对默认模式                   |
| ---------- | --------------: | -----: | -------: | ------------------------------ |
| 简式 `x^2` |           836 B |  604 B |    225 B | HTML 少 27.8%；MathML 少 73.1% |
| 复杂同余式 |          3544 B | 2762 B |    775 B | HTML 少 22.1%；MathML 少 78.1% |

这些数字说明源码冗余是真实的，但不是固定“两倍”：HTML 定位树通常比 MathML
树更大，复杂度不同会改变比例。HTTP gzip/Brotli 可以压缩重复标签，从而减少
线上的传输字节，但浏览器解压后仍会构造完整双树，所以不能解决 DOM 规模和 AI
抽取重复。[RFC 9110 Content-Encoding](https://www.rfc-editor.org/rfc/rfc9110#section-8.4)

对公式 `j n \equiv k n \pmod m` 的 Chromium 行为如下：

| 输出            | `textContent` / `innerText`                   | Accessibility snapshot |
| --------------- | --------------------------------------------- | ---------------------- |
| `htmlAndMathml` | 包含 MathML 字符、TeX annotation 和 HTML 字符 | 一个 `math`            |
| `html`          | 只有 HTML 字符                                | 空                     |
| `mathml`        | MathML 字符与 annotation，无 HTML 树          | 一个 `math`            |

这与 KaTeX 源码一致：HTML 子树的 `aria-hidden="true"` 把它从 accessibility
API 隐藏；WAI-ARIA 规定 `aria-hidden="true"` 的元素对 accessibility API
隐藏。[WAI-ARIA 1.2: `aria-hidden`](https://www.w3.org/TR/wai-aria-1.2/#aria-hidden)
MathML 子树没有该属性，并保留结构化 `<math>`。

## 影响评估

### 无障碍

`htmlAndMathml` 是 KaTeX 官方默认且明确面向 accessibility 的模式。当前实测的
无障碍树只有一个 `math`，并不存在屏幕阅读器必然朗读两遍的证据。相反，
`html-only` 在当前版本中没有可访问公式，是确定性的回归。

`mathml-only` 保留了本项目要求的 MathML，因此从目标语义上优于 `html-only`；
但不能只凭一个 Chromium accessibility snapshot 宣称完整无障碍等价。还需覆盖
Firefox、Safari、Linux 部署目标及实际辅助技术的公式导航、朗读、编号、混合
CJK、表格/矩阵和错误回退。

### 浏览器、复制与外部 AI

双输出的主要价值是：浏览器视觉统一由 KaTeX HTML/CSS/字体负责，而 MathML
单独承担语义。代价是普通 DOM 文本工具会看到多个文本来源。本站自己控制的
抽取器可以把 `.katex` 视为原子节点，选择：

- 搜索和纯文本：使用编译器已有的权威 LaTeX/规范化公式文本；
- 可访问结构：使用 `<math>`，跳过 `.katex-html`；
- 复制 TeX：使用 `annotation[encoding="application/x-tex"]`，跳过其余后代。

这会修复本站受控功能中的重复，但无法强迫 Gemini 等第三方浏览器工具采用同一
规则。若必须让所有未知 DOM 抽取器都只看到一份，保留双树在逻辑上就无法保证，
只能改为单树输出。

### SEO

公式已在服务端预渲染，无需 JavaScript 才出现。Google Search 官方说明，经典
服务端 HTML 可直接被处理，并会使用 rendered HTML 建立索引。
[Google Search: JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics#how-googlebot-processes-javascript)

但 KaTeX、MathML 标准和 Google Search 文档都没有承诺：

- `htmlAndMathml` 会提高公式排名；
- 同一公式的 HTML/MathML 表示会造成 duplicate-content 惩罚；
- `mathml-only` 会被所有搜索或 AI 系统按同样方式理解。

因此不能以未经验证的 SEO 推断作为删除 MathML 的依据。更可靠的做法是维持
服务端语义内容、规范 URL 和正文结构，并用 Google URL Inspection/实际索引
结果验证需要关心的公开页面。Google 也明确建议检查 rendered HTML，而不是
从页面源结构臆测索引结果。
[Google Search: inspect rendered HTML](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics#web-components)

### 源码、网络和内存

`htmlAndMathml` 的确增加静态产物、未压缩响应和 DOM 节点数；密集公式教材会
累积这一成本。HTTP 压缩只缓解网络，不能缓解解压后 DOM。是否值得改变渲染器
应以代表性和压力图书测量以下指标，而不应从单条公式外推：

- 每页公式标记的 raw、Brotli 和总响应字节；
- DOM node 数、解析时间、样式/布局时间和峰值内存；
- 300 ms 服务端响应目标是否受静态文件尺寸影响；
- 浏览器 AI/复制/搜索的实际抽取质量；
- 跨浏览器视觉和辅助技术回归。

## 可行方案

### A. 维持当前决策，修正抽取边界（建议短期采用）

继续使用 `htmlAndMathml`。保持并测试当前关键 CSS、版本化 KaTeX CSS/字体和
renderer identity。对本站控制的纯文本、搜索、复制和未来 AI 接口，不再对公式
容器使用裸 `textContent`，而是从权威公式源或单一选定表示生成文本。

优点：

- 完全符合 D-103、product spec 7.7 和 spec 004 FR-019；
- 保留当前经过验收的 KaTeX 视觉排版与 MathML 无障碍；
- 不改变不可变版本或 renderer contract。

限制：

- 页面源代码仍有双树；
- 无法修复未知第三方扩展的通用 DOM 抽取；
- 只能通过压缩、分页和抽取规则缓解，不满足“源码必须只有一份”的新目标。

### B. 切换为 `mathml-only`（真正减少源码，但先做产品决策）

把后台预渲染改为 `output: "mathml"`，以浏览器原生 MathML 同时承担视觉和语义。
这保留 MathML、移除 `.katex-html`，是三个官方输出中唯一同时满足“单树”和
“保留结构化数学语义”的模式。

这不是当前决策下的实现修补。D-103 明确要求 HTML 表示可见并把 KaTeX CSS/字体
纳入同一 renderer identity：
[`docs/decisions/decision-log.md`](../decisions/decision-log.md#L805)；
product spec 同样规定 KaTeX HTML、CSS 和字体：
[`docs/product/product-spec.md`](../product/product-spec.md#L375)。
spec 004 虽然要求保留 MathML，但其 renderer asset 和证据体系也建立在现有双
表示上：
[`specs/004-publishing-quality/spec.md`](../../specs/004-publishing-quality/spec.md#L221)。

实施前至少需要：

1. 新增产品决策，明确从“KaTeX HTML 视觉 + MathML 语义”迁移到“KaTeX 转换 +
   原生 MathML 视觉/语义”；
2. 同步 product spec、active feature spec、renderer-assets contract 和测试；
3. 提升 renderer identity，重新发布生成新不可变版本，不原地改写旧书；
4. 选定并本地提供适合原生 MathML 的 MATH 字体，验证缓存、许可和完整性；
5. 在 Chromium、Firefox、Safari 上比较代表性公式、编号、换行、打印、复制、
   CJK/RTL、矩阵、伸展符号和压力书；
6. 使用实际辅助技术验证，而不只检查 DOM 或 accessibility snapshot；
7. 重新测量源码、Brotli、DOM、内存和阅读性能后再决定收益是否足够。

### C. `html-only` 或手工裁剪（不建议）

`html-only` 可以减少约 22% 至 28% 的样例标记，却删除 MathML，并且当前 HTML
子树被 `aria-hidden`，不符合无障碍要求。给 HTML 另加 `aria-label` 或 KaTeX
`render-a11y-string` 也不是现有需求的等价替代：它不保留结构化 MathML，而且
KaTeX 该 contrib 的源码自己承认部分输出不具有正确数学语义。
[KaTeX `render-a11y-string.ts` 0.18.1](https://github.com/KaTeX/KaTeX/blob/v0.18.1/contrib/render-a11y-string/render-a11y-string.ts#L1-L14)

在 `htmlAndMathml` 输出后手工删除 `.katex-mathml`、`annotation` 或
`.katex-html` 也不是 KaTeX 文档化的输出模式。它会让项目依赖 KaTeX 内部 DOM
结构，并可能破坏无障碍、Copy-TeX、CSS 和版本升级。若目标确实是单树，应通过
公开的 `output: "mathml"` 和新的 renderer identity 明确实现，而不是在生成后
做脆弱裁剪。

## 建议决策

当前问题应拆成两个不同的问题：

- **视觉/无障碍正确性**：现状符合设计；保持双树和关键 CSS，不删除 MathML。
- **源码与第三方 AI 抽取冗余**：现状确实存在；本站受控抽取器应公式感知，
  网络侧启用压缩。若用户把“响应源码单树”提升为硬性产品要求，则先批准
  `mathml-only` 的决策变更和验证范围，再进入实现。

不应直接改成 `html-only`。在当前高权威文档未变更前，也不应直接改成
`mathml-only`。最小合规结论是保留当前输出；真正消除源码双表示的长期方向是
原生 MathML 单树，而不是删除无障碍内容。
