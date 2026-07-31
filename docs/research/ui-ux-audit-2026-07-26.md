# Mirawind Library UI/UX 审计与修复基准

- 调研日期：2026-07-26
- 当前复核：2026-07-31；第 10.2 节状态列是当前判断，详细复现正文保留原始审计现场
- 目标：以项目冻结规格和一手标准为基准，审计当前公开页面、当前代码构建和真实 MinerU
  导入预览，形成可执行、可复查的修复优先级。
- 来源边界：外部依据仅采用 W3C/WAI 与 Chrome/web.dev 等一手资料。
- 建议基线：以 **WCAG 2.2 Level AA** 作为可访问性审计底线；Level AAA 与其他一手资料中的建议单独标记为“增强”，不得混同为 AA 硬性失败。
- 项目约束优先级：项目 Constitution、决策日志、产品规格和当前 feature 规格高于通用建议；本文不产生新的产品决策。

## 结论

原始审计发现仍有保留价值，但不能再整体视为当前缺陷清单。006～010 已完成 clean switch、
ReaderShell 的结构与排版、可搜索和虚拟化的出版工作台、移动图书详情、共享管理壳及匿名
管理增强启动边界。第 10.2 节列出的 UI-001～UI-012 当前均已解决或退役。

010 已按以下顺序关闭最后一组问题：

1. **阅读与 CSS 缺陷。** 恢复正文 `h1`–`h4` 可见层级，并修复两处无效的
   `var(--color-white)-space` 属性。
2. **图书详情。** 移动详情改为全屏覆盖，复用封面/占位封面，并把最多 200 项的
   数据投影整理为可浏览而有界的目录预览。
3. **管理壳与私有增强。** 统一四个管理路由的导航层级，并为匿名
   书库设计不破坏公共缓存字节一致性的管理增强启动方式。
4. **导入与任务反馈。** 文件选择只显示一次名称；收到上传后持续展示来源、阶段和诚实
   百分比；任务卡以操作和书名/ZIP 为主，内部 ID 仅保留在技术详情中。

不应误判为当前缺陷的范围：

- 精选书架、完整 Twilight 首页仍属于 M5；当前首页简洁不是本轮阻断项。
- 文件夹拖拽、批量管理、阅读设置、高亮和笔记仍在后续里程碑。
- 真实样本首个派生页面内容很少、图片很小，属于源内容/分页结果；本报告只在它影响管理
  比较流程时记录 UI 问题，不据此要求渲染器放大原图或合并页面。

本项目的 UI/UX 审计不能只做截图点评。最低有效审计应同时覆盖：

1. 真实路由与关键状态，而非只检查静态首页；
2. 键盘、触控、缩放、无 JavaScript、辅助技术和错误路径；
3. WCAG 2.2 A/AA 的可判定要求；
4. 阅读器特有的中文排版、教材结构、公式、表格、图片、脚注和锚点导航；
5. 路由弹窗的焦点与历史恢复；
6. Core Web Vitals 与项目自身更严格的未缓存阅读响应 p95 目标；
7. 自动工具加人工操作，而非以 Lighthouse/axe 一次扫描代替审计。

优先级最高的检查面应是：

- 固定顶部栏、抽屉和 dialog 是否遮挡焦点或锚点；
- `/books/:bookKey` 路由 dialog 的打开、关闭、直接访问、后退和焦点恢复；
- 阅读器多组导航的语义、层级、当前位置、普通链接降级和窄屏抽屉；
- 320 CSS px、200% 文字缩放和 400% 页面缩放下是否丢内容或产生整页横向滚动；
- 登录、搜索、上传、结构预览与发布表单的标签、错误、状态通知和可恢复性；
- 正文行宽、行高、主题对比、图表/代码局部横向滚动和公式单一视觉表示；
- LCP、INP、CLS 以及返回书库时滚动位置/触发控件焦点是否稳定。

## 1. 已有项目约束

以下是审计必须继承的已有约束，不应作为本轮重新讨论的开放设计题：

### 1.1 架构与请求路径

- 阅读正文是预生成的语义 HTML；Markdown 解析、AST、KaTeX、高亮、图片处理和索引不得在读者请求中运行。
- 公开阅读页面在单机、公共缓存未命中时，服务端响应 p95 必须不超过 300 ms。
- 公开页面必须保持完整 SSR 和渐进增强；公共书库、详情、阅读和翻页在无 JavaScript 时仍可使用。
- 管理增强与私人状态通过独立、已认证、`private, no-store` 的响应加载。

依据：

- [Mirawind Library Constitution](../../.specify/memory/constitution.md)
- [产品规格：阅读器、缓存、性能](../product/product-spec.md)
- [D-052、D-079 至 D-081、D-100](../decisions/decision-log.md)

### 1.2 页面与交互模型

- `/library` 是完整书库；首页不是完整管理界面。
- 书籍封面进入阅读，书名或菜单打开路由驱动详情。
- `/books/:bookKey` 直接请求必须输出书库背景与已打开的语义 dialog；从书库进入和返回要恢复 URL、滚动位置与触发控件焦点。
- 宽屏阅读器为固定顶栏、左全书目录、中正文、右页内提纲；中等宽度可收右栏，窄屏使用原生 dialog 抽屉。
- 全书目录、面包屑和页内提纲在发布期生成；客户端只增强展开和滚动状态，不重新推断结构。
- 普通链接、层级和正文不能依赖 JavaScript；当前页祖先分支默认展开。
- 移动端不依赖左右滑动翻页；桌面左右方向键在输入、编辑器和代码交互区不得触发翻页。

依据：

- [产品规格：书库、详情与阅读器](../product/product-spec.md)
- [D-009、D-010、D-100、D-105](../decisions/decision-log.md)
- [当前 feature 规格 FR-034、FR-035](../../specs/004-publishing-quality/spec.md)

### 1.3 内容与视觉系统

- 正文必须使用 `h1`–`h4`、段落、列表、引用、表格、脚注、代码、公式、图片与题注等语义 DOM。
- 公式视觉上只出现一次，同时保留 MathML 供辅助技术使用。
- 超宽表格、代码和必要的宽图可以在自身容器内横向滚动，不能让普通正文整页横向滚动。
- 业务 UI 使用 Tailwind CSS v4 全局主题以及 `stone`、`emerald`、`amber`、`red`、`white`、`black` 官方 token；不得另建页面级色板。
- 书库卡片不显示阅读进度或大量元数据。
- 1～2 个字符的搜索只覆盖书名、作者和章节标题，界面必须明确提示范围。

依据：

- [产品规格：语义 HTML、搜索和阅读内容](../product/product-spec.md)
- [D-086、D-103 至 D-106](../decisions/decision-log.md)

### 1.4 当前范围边界

审计报告应把“已有功能缺陷”和“未来里程碑尚未交付”分开：

- M2a 已完成根目录书库与阅读闭环；完整嵌套文件夹、拖拽和批量管理属于后续 M2。
- 阅读进度、书签、阅读设置、高亮与批注属于 M3。
- 展示首页与精选书架属于 M5，产品规格也允许当前先不实现。
- 不应把这些尚未进入当前范围的能力缺失直接记为当前 UI 回归。

依据：[产品规格：交付里程碑](../product/product-spec.md)

## 2. 审计口径与证据方法

### 2.1 规范层级

| 层级                           | 含义                   | 缺陷处理                                                   |
| ------------------------------ | ---------------------- | ---------------------------------------------------------- |
| 项目 MUST / 已接受决策         | Mirawind 已冻结的行为  | 不满足即产品缺陷；若实现与高权威文档冲突，先同步低权威产物 |
| WCAG 2.2 A/AA                  | 建议采用的可访问性底线 | 记录对应成功标准、页面、状态、复现步骤与证据               |
| WCAG 2.2 AAA / WAI 建议        | 增强目标               | 记为“增强”，不可伪装成 AA 不合规                           |
| Core Web Vitals / 项目性能目标 | 体验与性能门槛         | 分别报告现场数据、实验室数据及测试环境                     |
| 主观视觉偏好                   | 不属于规范或冻结决策   | 只有在影响任务完成、理解、可读性或一致性时才作为 UX 发现   |

[WCAG 2.2](https://www.w3.org/TR/WCAG22/) 定义了规范成功标准；Understanding 文档是解释性材料。W3C 的
[WCAG-EM](https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/) 要求先定义范围、探索关键页面/功能、选择代表性样本、评估并报告。本文建议沿用这一结构，但不声称本次抽样等同于整站合规认证。

### 2.2 自动化不能替代人工

W3C 明确指出，评估工具不能自动检查全部可访问性问题，且可能产生误报或误导；它们只能辅助判断，仍需要人工审查：
[Selecting Web Accessibility Evaluation Tools](https://www.w3.org/WAI/test-evaluate/tools/selecting/)。

每个关键页面至少需要以下四类证据：

1. DOM/可访问树证据：标题、landmark、名称、角色、状态、表格关系、图片替代文本；
2. 操作证据：纯键盘、触控、缩放、无 JavaScript、后退/前进、错误恢复；
3. 视觉证据：不同视口、主题、文本长度、内容密度下的截图或录像；
4. 性能证据：可复现的 trace、网络条件、设备/CPU 条件、指标与百分位。

### 2.3 推荐样本

至少覆盖：

| 页面/流程                 | 必测状态                                                                          |
| ------------------------- | --------------------------------------------------------------------------------- |
| `/library`                | 匿名公共 SSR、管理员增强后、空书库、长标题/无封面、加载失败                       |
| `/books/:bookKey`         | 从书库打开、直接访问、关闭、浏览器后退、窄屏全屏 dialog、无 JS                    |
| `/read/:bookKey/:pageKey` | 首页面、长页面、深层目录、当前分支、图片/表格/代码/公式/脚注密集页、上一页/下一页 |
| `/search`                 | 空查询、1～2 字、3 字以上、无结果、多结果、异步加载/错误                          |
| `/login`                  | Passkey、备用密码、错误、重试、密码管理器/粘贴                                    |
| `/manage` 与出版预览      | 上传、进度、候选确认、长诊断、错误、取消/重试、发布成功/冲突                      |

每个代表性页面至少在这些条件下复测：

- 1280 px 以上宽屏；
- 768–1024 px 中等宽度；
- 320 CSS px 窄屏或等效 400% 缩放；
- 200% 文字缩放；
- 键盘；
- 粗指针触控；
- JavaScript 关闭；
- 浅色与深色（若该页面支持）；
- 一种桌面屏幕阅读器组合和一种移动端屏幕阅读器组合。

## 3. WCAG 2.2 与原生语义检查表

### 3.1 页面结构、语言与导航

| 审计动作                        | 通过条件                                                                                              | 依据                                                                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 检查 `<html lang>` 及异语言片段 | 页面主语言可编程确定；明显的异语言段落按需标记                                                        | [WCAG 3.1.1 Language of Page](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html)                                                                |
| 比对视觉标题与 heading outline  | 真正标题使用 `h1`–`h4`；层级反映内容结构；向下进入子层级时不无故跳级                                  | [WAI Headings](https://www.w3.org/WAI/tutorials/page-structure/headings/)                                                                                       |
| 检查 landmark                   | 页面有一个主要 `main`；顶层 `header`、`nav`、`aside`、`footer` 按实际用途形成 landmark                | [APG Landmark Regions](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/)                                                                             |
| 检查多组导航名称                | 全站导航、全书目录、页内提纲、前后页导航能够区分；多个 `nav` 使用独特可访问名称                       | [APG Navigation Landmark](https://www.w3.org/WAI/ARIA/apg/patterns/landmarks/examples/navigation.html)                                                          |
| 跳过重复区域                    | 键盘用户能快速跳到正文；skip link 聚焦后可见，目标不会被固定顶栏遮挡                                  | [WCAG 2.4.1 Bypass Blocks](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html)                                                                      |
| 检查页面标题与当前位置          | 每个路由有描述性 `<title>`；当前位置使用文本/结构且在适合处使用 `aria-current="page"` 或 `"location"` | [WCAG 2.4.2 Page Titled](https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html)、[ARIA `aria-current`](https://www.w3.org/TR/wai-aria-1.2/#aria-current) |
| 检查链接目的                    | 脱离局部视觉线索后，链接仍能从自身文本或可编程上下文理解；避免成排无差别“详情”“更多”                  | [WCAG 2.4.4 Link Purpose](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html)                                                             |

### 3.2 原生 HTML 优先

W3C 的 ARIA 第一规则是：如果原生 HTML 元素或属性已经提供所需语义与行为，就使用原生能力，不要用 `div` 加角色重新实现。ARIA 角色本身不会自动带来键盘行为。错误 ARIA 可能比没有 ARIA 更糟：

- [ARIA in HTML / First Rule of ARIA](https://www.w3.org/TR/html-aria/)
- [APG Read Me First](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/)

检查项：

- 导航目的地使用 `<a href>`，动作使用 `<button>`，不要让可点击 `div`/`span` 承担核心操作。
- 不重复声明与原生元素相同的 role，不用 ARIA 覆盖强原生语义。
- 只在原生 HTML 不足时添加 ARIA，且状态必须与视觉状态同步。
- 普通站点/书籍导航不要套用 `menu`/`menubar`；APG 指出普通导航并不具备这类复杂控件所承诺的交互。
- 图标按钮必须有可访问名称；若按钮有可见文字，可访问名称应包含该文字，保证语音输入可按可见标签操作。

### 3.3 键盘、焦点与快捷键

| 审计动作                | 通过条件                                                                         | 依据                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 全流程只用键盘          | 所有功能可用键盘完成，除非底层功能本质依赖自由路径输入                           | [WCAG 2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html)                              |
| 检查 Tab/Shift+Tab 顺序 | 顺序与视觉和任务逻辑一致；不靠正 `tabindex` 人工拼顺序                           | [WCAG 2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html)                        |
| 检查焦点可见            | 所有可键盘操作元素都有持续、可辨识的焦点指示，不清除 outline                     | [WCAG 2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)                    |
| 检查固定层与抽屉        | 接收焦点的控件不被固定顶栏、底栏、通知或非模态浮层完全遮住                       | [WCAG 2.4.11 Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) |
| 检查焦点陷阱            | 非模态区域能继续离开；模态 dialog 只在打开期间约束焦点，并可关闭                 | [WCAG 2.1.2 No Keyboard Trap](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap.html)              |
| 检查阅读器方向键        | 左右键仅在允许上下文翻页；输入、textarea、编辑器、代码交互区和组合键状态不被劫持 | 项目产品规格 §7.2                                                                                             |
| 检查锚点跳转            | hash 目标、搜索结果目标和脚注目标进入可见区域；固定顶栏不盖住目标标题或焦点      | WCAG 2.4.11 与项目阅读导航约束                                                                                |

建议把 WCAG 2.4.13 的焦点外观作为增强目标：焦点指示至少相当于 2 CSS px 周长区域，并与非聚焦状态达到 3:1 对比。它是 AAA，不应误报为 AA：
[Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)。

### 3.4 Dialog、抽屉与展开分支

#### 路由 dialog

按 [APG Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) 检查：

- 打开后焦点进入 dialog 内的合适位置；
- `Tab` 和 `Shift+Tab` 在 dialog 打开期间在内部循环；
- `Escape` 能关闭；
- 关闭后焦点回到触发控件；若控件已不存在，进入合理的后续位置；
- dialog 有可访问名称，优先关联可见标题；
- 背景在模态期间不可交互且视觉上被遮罩；
- 有可见的关闭按钮；
- 长内容 dialog 初始聚焦标题或顶部静态节点，不能因为聚焦首个底部操作而把开头滚出视口；
- 只有真正阻止背景交互时才声明模态语义。

Mirawind 还必须额外验证：

- 从书库打开、关闭和浏览器后退都恢复原 URL、滚动位置与触发控件焦点；
- 直接访问 `/books/:bookKey` 后关闭会回到 `/library`；
- 无 JavaScript 时详情、开始阅读和返回书库仍可使用；
- 移动端全屏样式不破坏上述语义；
- 不会同时把背景中的重复卡片控件留在可聚焦顺序中。

#### 目录分支

如果使用原生 `<details>/<summary>`，优先接受浏览器提供的展开语义和键盘行为，不重复伪造 role。若使用自定义 disclosure，则按
[APG Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) 检查：

- 控件是可聚焦按钮；
- `Enter` 与 `Space` 均能切换；
- `aria-expanded` 与真实显示状态同步；
- 可选 `aria-controls` 指向实际内容；
- 展开按钮与普通页面链接的目标和点击区域不会含混；
- 收起分支时，焦点不能遗留在已经隐藏的后代；
- 当前页祖先分支初始展开，但其他分支仍可独立操作。

### 3.5 图片、表格、公式、代码与脚注

#### 图片与图注

- 信息图片有表达当前语境意义的简洁 `alt`；
- 装饰或与邻近文字完全重复的图片使用空 `alt`；
- 功能图片的替代文本表达动作或目的地；
- 复杂图的关键信息在页面其他位置提供，而不是把整段说明硬塞入 `alt`；
- `figure`/`figcaption` 关系清楚，图名位于图下；
- 灯箱打开、缩放、平移和关闭均可键盘操作；关闭恢复到原图；
- 不能把封面或装饰图片的文件名暴露为替代文本。

依据：[WAI Images alt Decision Tree](https://www.w3.org/WAI/tutorials/images/decision-tree/)。

#### 表格

- 数据表使用 `<table>`、`<th>`、`<td>`，不是视觉上模拟的 div 网格；
- 简单表头使用 `scope="row"` / `"col"`；复杂表明确关联；
- 表名使用 `<caption>` 或等价可编程关系，且视觉位置符合项目“表名在上”要求；
- 窄屏下表格自身容器滚动，表格外正文继续回流；
- 不能用 `overflow: hidden` 截断；
- 横向滚动容器可聚焦/可被键盘操作，并有可理解的上下文。

依据：

- [WAI Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/)
- [WAI Tables Tips and Tricks](https://www.w3.org/WAI/tutorials/tables/tips/)

#### 公式

- 每个有效公式只有一个视觉表示；
- KaTeX MathML 仍在可访问树中，视觉 HTML 不被重复朗读；
- 公式编号和正文引用可理解、可导航；
- 失败公式只显示一次原始 LaTeX，并提供可理解的失败说明；
- CSS/字体失败时不能出现重叠、重复或大幅布局偏移；
- 用真实屏幕阅读器检查行内、块级、编号公式，而不只检查 DOM 是否存在 MathML。

项目依据：[D-103](../decisions/decision-log.md) 与
[renderer asset contract](../../specs/004-publishing-quality/contracts/renderer-assets.md)。

#### 代码与脚注

- 代码保持文本语义、可选中、可复制；长行在局部容器滚动；
- 复制按钮有具体名称和可见焦点，复制成功属于可编程状态消息；
- 脚注正文与列表双向链接，返回链接有具体目的；
- 脚注浮层不能只依赖 hover；键盘可触发；
- hover/focus 附加内容必须可关闭、可悬停、并持续到用户移开、关闭或信息失效。

依据：[WCAG 1.4.13 Content on Hover or Focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)。

## 4. 视觉、对比与阅读排版

### 4.1 对比与非颜色线索

| 检查                                          | AA 判定                                                      |
| --------------------------------------------- | ------------------------------------------------------------ |
| 普通文字与背景                                | 至少 4.5:1                                                   |
| 大字与背景                                    | 至少 3:1；WCAG 的大字约为 24 CSS px，或约 18.5 CSS px 且粗体 |
| 控件边界、图标、焦点、选中/展开等必要视觉状态 | 与相邻颜色至少 3:1                                           |
| 错误、状态、当前项                            | 不能只靠颜色区分；同时使用文字、图标、形状、下划线或结构     |
| placeholder、hover/focus 中出现的文字         | 同样适用文字对比要求                                         |

依据：

- [WCAG 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [WCAG 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [WCAG 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)

审计不能只测默认状态。至少测：

- 浅色与深色；
- 默认、hover、focus、active、selected、disabled；
- 错误、warning、success；
- dialog 遮罩后的焦点；
- 公开卡片与管理员增强状态叠加；
- `stone` 低对比辅助文字和 `emerald` 交互色在实际背景上的组合。

Tailwind token 合规不等于对比自动合规，仍需测实际前景/背景组合。

### 4.2 缩放、文字间距和截断

- 200% 文字缩放时不能丢失内容或功能：
  [WCAG 1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)。
- 用户把行高设为 1.5 倍、段后距设为 2 倍字高、字距设为 0.12 倍、词距设为 0.16 倍时，不能截断、重叠或丢功能。该标准要求的是**允许覆盖后不破坏**，不是要求默认采用全部数值：
  [WCAG 1.4.12 Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)。
- 卡片标题、按钮、导航项不能靠固定高度裁切；若使用省略号，完整内容必须可在聚焦或激活后取得。
- 字号、字体和长中文书名变化时，图标不能覆盖文字，按钮不能挤出视口。

### 4.3 正文行宽、行高与中文排版

WCAG 2.2 的增强级
[1.4.8 Visual Presentation](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html)
提供了适合阅读器的检查基准：

- 用户可取得不超过 80 个西文字符或 40 个 CJK glyph 的行宽；
- 用户可取得至少 1.5 的行距；
- 文本可以放大至 200%，而无需逐行左右滚动；
- 用户可取得非两端对齐的呈现。

这些是 AAA/增强目标，不是 AA 硬性失败。对中文还要结合 W3C
[Requirements for Chinese Text Layout](https://www.w3.org/International/clreq/)：
中文书籍正文常采用两端对齐，汉字间距、标点禁则与中西混排处理也不同于西文。因此审计应：

- 把“默认中文排版是否稳定、标点是否悬孤、混排空格是否一致”与“用户能否获得非两端对齐/较窄行宽”分开记录；
- 不把西文排版建议机械解释为中文正文默认必须左对齐；
- 在窄屏和放大时检查中西混排长 token、URL、公式和行内代码是否导致整页溢出；
- 使用正确 `lang`，让字体、断行、语音与语言相关样式有可靠依据。

可操作的阅读体验检查：

- 默认正文行宽是否在长时间阅读时可跟踪，且宽屏不会无限拉长；
- 中文密集页、英文密集页和中英数字混排页分别抽样；
- 段落、列表、引用、教材语义容器之间的节奏是否清楚；
- 左右导航字号可以小于正文，但在缩放和低对比下仍可读；
- 正文宽度优先于两侧栏；中等宽度收起右栏后不留下无意义空洞；
- 用户更换字体或系统字体 fallback 后，不出现 CLS、截断或公式错位。

## 5. 触控、响应式与运动

### 5.1 回流

[WCAG 1.4.10 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
要求纵向阅读内容在等效 320 CSS px 宽度下不丢信息/功能，也不要求二维滚动。表格、必要图形等具有二维语义的局部内容可以例外，但例外只属于该局部内容。

检查：

- 320 CSS px 下页面主视口只有纵向阅读滚动；
- 全书目录、页内提纲、设置和详情改为抽屉/叠层后仍可取得；
- 表格、代码、超宽图在独立容器滚动，表外正文不随之横向滚动；
- 搜索框、分页、表格标题等不因表格例外而被截出视口；
- 400% 页面缩放时重跑同一组测试；
- 固定顶栏不占据过多窄屏高度，不遮住正文、焦点或锚点；
- 横竖屏均可操作，除非方向是内容本质要求。

### 5.2 目标尺寸

- WCAG 2.2 AA 底线：指针目标至少 24×24 CSS px，或满足规范中的间距/等价/行内等例外：
  [2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)。
- 增强目标：高频、重要、靠近屏幕边缘或后果难撤销的控件以 44×44 CSS px 为目标：
  [2.5.5 Target Size (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)。

Mirawind 应重点量测：

- 移动端顶部栏图标；
- dialog 关闭；
- 目录展开与相邻页面链接；
- 页内提纲项目；
- 上一页/下一页；
- 搜索清除和提交；
- 书籍卡片菜单；
- 上传取消、重试、发布与危险操作；
- 脚注返回和代码复制。

不能只量视觉图标尺寸，应量真实 hit area。

### 5.3 拖拽、手势与 hover

- 任何作者实现的拖拽都需要无需拖拽的单指针替代；仅有键盘替代仍不足以满足该项：
  [WCAG 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)。
- 键盘也必须能完成同等任务，见 WCAG 2.1.1。
- 未来文件夹移动/排序若实现拖拽，应同时提供“移动到…”、上移/下移或等价按钮。
- 阅读翻页不能只靠滑动；产品已明确移动端不依赖左右滑动。
- 任何 hover 才出现的关键操作在触控与键盘上都必须可发现、可触发。

### 5.4 动画

- 自动开始、持续超过 5 秒并与其他内容并行的移动/闪烁/滚动内容必须可暂停、停止或隐藏：
  [WCAG 2.2.2 Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html)。
- 交互触发的非必要运动可关闭属于 AAA 增强目标：
  [WCAG 2.3.3 Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)。
- 页面切换、dialog/抽屉、灯箱和书架装饰动效应尊重
  [`prefers-reduced-motion`](https://web.dev/articles/prefers-reduced-motion)。
- 骨架屏和加载动画不能掩盖真实阻塞，也不能导致正文加载后大幅跳动。

## 6. 表单、搜索、登录与管理任务

WAI 的 [Forms Tutorial](https://www.w3.org/WAI/tutorials/forms/) 将表单拆为标签、分组、说明、验证与通知。审计应逐字段和逐流程操作，不只看 DOM。

### 6.1 标签与说明

- 每个输入有持久、描述目的的标签，优先使用 `<label for>`；
- placeholder 不替代标签；
- 搜索图标按钮、密码显示按钮、清除按钮等有具体可访问名称；
- 可见标签文字包含在可访问名称中；
- checkbox/radio 的标签可点击，扩大实际目标；
- 相关选项使用 `<fieldset>/<legend>` 或等价原生分组；
- 必填、格式、大小和安全限制在输入前或标签附近说明，不等提交失败后才揭示；
- 必填不能只用红色或星号，且 `required` 状态可编程确定。

依据：[WAI Labeling Controls](https://www.w3.org/WAI/tutorials/forms/labels/)。

### 6.2 错误与状态

- 错误文字明确说明发生了什么以及如何修正；
- 字段错误与对应控件建立可编程关系；
- 多错误表单在顶部提供错误摘要，项目链接到对应控件；
- 提交失败后焦点进入错误摘要或第一个合理错误位置，同时不丢失已输入数据；
- 客户端校验不能替代服务端校验；
- 异步保存、上传、搜索、构建、取消和发布状态不抢焦点，但能由辅助技术感知；
- `role="alert"` 只用于紧急错误，不把普通状态全部设为 assertive；
- 成功、无结果、搜索中、上传百分比和任务完成都需要可理解的文本，不只改变 spinner 或颜色。

依据：

- [WAI Validating Input](https://www.w3.org/WAI/tutorials/forms/validation/)
- [WAI User Notifications](https://www.w3.org/WAI/tutorials/forms/notifications/)
- [WCAG 4.1.3 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)

### 6.3 登录与重新认证

[WCAG 3.3.8 Accessible Authentication (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html)
要求认证不能强迫用户仅靠记忆、解题或抄写，除非提供合规替代或辅助机制。对 Mirawind：

- Passkey 入口应清楚表达用途、状态和失败后的下一步；
- 备用密码允许密码管理器自动填充与粘贴，不能拦截 paste；
- 使用合适的 `autocomplete` 值和原生 `type="password"`；
- 登录错误不泄露不必要的安全信息，但必须让管理员知道如何重试；
- 最近重新认证和最后一把 Passkey 删除警告要明确，不依赖颜色；
- 重新认证 dialog 遵循完整 dialog 焦点规则；
- 不加入 CAPTCHA、记忆题或人为拆分且不支持整串粘贴的输入。

### 6.4 搜索

- 输入有“搜索”标签，提交可通过按钮和 Enter 完成；
- 1～2 字查询的受限范围在结果前清楚提示；
- “搜索中”“无结果”“N 个结果”作为状态可感知；
- 结果链接名称包含书名/章节等必要上下文；
- 命中片段不靠颜色单独表达；
- 从结果进入锚点后，目标可见且能继续键盘导航；
- 返回结果页后查询、筛选、滚动和焦点合理恢复。

### 6.5 上传、预览与发布

- 文件选择、拖放、取消、重试均有非拖拽路径；
- 2 GiB 等限制在选择前可见，错误显示实际限制和下一步；
- 上传与后台构建是两个阶段，状态文案不能混为一个不确定 spinner；
- 进度条有可访问名称、当前值与状态文本；
- 长诊断按有界分组呈现，可键盘导航，不只靠颜色表示 severity；
- 批量接受/撤销印刷目录处理的后果可理解且可逆；
- 预览的页数、当前页、上一页/下一页和诊断位置清晰；
- 发布冲突或 stale preview 保留旧版本并说明需要重新预览；
- 危险操作明确目标和后果，默认焦点避免落在最危险动作。

项目依据：

- [Management preview contract](../../specs/004-publishing-quality/contracts/management-preview.md)
- [当前 feature spec](../../specs/004-publishing-quality/spec.md)

## 7. 性能体验基准

### 7.1 指标

Chrome/web.dev 当前 Core Web Vitals 建议在移动端与桌面端分别取第 75 百分位：

| 指标 | “Good” 门槛 | 审计意义                                           |
| ---- | ----------: | -------------------------------------------------- |
| LCP  |     ≤ 2.5 s | 首屏主要正文、封面或标题何时真正显示               |
| INP  |    ≤ 200 ms | 点击、键盘与触控后的整体响应                       |
| CLS  |       ≤ 0.1 | 字体、图片、管理增强、目录和公式加载是否让页面跳动 |

依据：[web.dev Core Web Vitals](https://web.dev/articles/vitals)。

TTFB 不是 Core Web Vital；web.dev 给出的通用粗略目标是 0.8 s 以内，但 Mirawind 已有更严格、更具体的**未缓存公开阅读响应 p95 ≤ 300 ms** 产品目标，应分别报告，不能用 0.8 s 通用值放宽项目要求：
[Optimize TTFB](https://web.dev/articles/optimize-ttfb)。

### 7.2 路由与场景

性能采样至少包含：

- `/library` 公共 SSR 冷/暖访问；
- 从书库打开详情及关闭返回；
- 直接访问详情；
- 阅读首页面与图片/公式密集页；
- 阅读翻页、展开目录、打开抽屉、页内提纲滚动更新；
- 搜索首次与后续查询；
- 管理增强加载；
- 后台重建并发时的公开阅读。

必须区分：

- 服务端响应时间与浏览器 LCP；
- 首次导航与站内后续导航；
- 公共缓存命中与未命中；
- 实验室 trace 与真实用户百分位；
- 移动端受限 CPU/网络与桌面环境。

### 7.3 可操作检查

- LCP 图片/字体/正文应能从初始 HTML 或早期资源发现；不要用 JavaScript 才插入首要内容。
- 首屏/LCP 图片不要 `loading="lazy"`；视口外图片再使用原生 lazy loading。
- 每个图片提供尺寸或稳定宽高比，避免 CLS。
- 响应式图片使用 `srcset`/`sizes` 或等价派生资源，避免窄屏下载远超显示需要的原图。
- 管理增强插入公开书库时预留空间，不能让用户即将点击的卡片突然移位。
- 本地字体和 KaTeX 字体加载失败/切换时不应重叠或产生大幅跳动。
- 只发送当前交互所需 JavaScript；公开正文和普通导航不等待 hydration。
- 用 Chrome trace 查找超过 50 ms 的长任务；目录展开、滚动监听、灯箱和预览分页不能持续阻塞主线程。
- 滚动监听避免反复强制同步布局；验证长页 INP 和滚动流畅度。
- 返回书库时滚动与焦点恢复不能依赖昂贵的全量重渲染。

依据：

- [Optimize LCP](https://web.dev/articles/optimize-lcp)
- [Browser-level image lazy loading](https://web.dev/articles/browser-level-image-lazy-loading)
- [Optimize long tasks](https://web.dev/articles/optimize-long-tasks)
- [Optimize INP](https://web.dev/articles/optimize-inp)
- [Optimize CLS](https://web.dev/articles/optimize-cls)

## 8. 路由级快速验收清单

### 8.1 `/library`

- [ ] 一个清楚的页面主标题与 `main`
- [ ] 书籍卡片标题、封面和菜单的语义/目标不混淆
- [ ] 封面能按普通链接进入阅读
- [ ] 书名/菜单能按产品模型进入详情
- [ ] 卡片不显示阅读进度和过量元数据
- [ ] 长标题、无作者、无封面、单本与大量图书均不破版
- [ ] 管理增强加载不改变公共 SSR 的语义权威或造成显著 CLS
- [ ] 320 px、200% 文字缩放、键盘与触控通过
- [ ] 无 JS 仍能浏览公开书库和进入阅读/详情

### 8.2 `/books/:bookKey`

- [ ] 服务端直接请求返回可理解的完整页面与已打开详情
- [ ] dialog 有可见标题、可访问名称和关闭按钮
- [ ] 打开、Tab 循环、Escape、关闭焦点恢复正确
- [ ] 背景模态期间不可交互
- [ ] 从书库关闭恢复 URL、滚动和触发控件
- [ ] 直接访问关闭回到 `/library`
- [ ] 移动端全屏仍符合 dialog 语义
- [ ] 目录预览、开始阅读和下载名称具体
- [ ] 无 JS 可查看详情、开始阅读、返回书库

### 8.3 `/read/:bookKey/:pageKey`

- [ ] 顶栏固定但不遮焦点、hash 目标或正文
- [ ] 全书目录、正文、页内提纲 landmark 可区分
- [ ] 目录树层级与正文 heading 层级一致
- [ ] 当前页祖先分支默认展开
- [ ] 展开控制键盘可用，目标页面仍是普通链接
- [ ] 当前页面与当前页内位置使用正确 `aria-current`
- [ ] 页内滚动增强失效时 hash 和目录仍可用
- [ ] 上一页/下一页有具体名称并可键盘/触控操作
- [ ] 左右键不劫持输入、编辑器和代码交互
- [ ] 320 px 时正文优先，两侧导航进入抽屉
- [ ] 普通正文不产生横向滚动；表格/代码/宽图局部滚动
- [ ] 图片、表格、公式、代码、脚注语义通过
- [ ] 40 CJK glyph 行宽等增强阅读目标单独报告
- [ ] 无 JS 仍可目录导航、翻页和访问锚点

### 8.4 `/search`

- [ ] 表单标签、Enter 提交、清除和按钮名称正确
- [ ] 1～2 字范围提示明确
- [ ] loading/无结果/结果数可由辅助技术感知
- [ ] 命中不只靠颜色
- [ ] 结果链接目的具体
- [ ] 进入目标时标题/块不被固定栏遮住
- [ ] 返回后查询、滚动与焦点合理恢复

### 8.5 `/login`

- [ ] Passkey 是首要且用途清楚的操作
- [ ] 备用密码有持久标签和可见错误
- [ ] 自动填充、密码管理器与粘贴不被阻止
- [ ] 失败后提供安全但可执行的下一步
- [ ] 重新认证/删除最后 Passkey 的警告和 dialog 可操作
- [ ] 键盘、触控目标、缩放与状态通知通过

### 8.6 `/manage` 与预览

- [ ] 上传限制、阶段、进度、取消和重试清楚
- [ ] 拖放有文件选择替代
- [ ] 长任务状态不靠一个永久 spinner
- [ ] 错误摘要、字段错误和长诊断可定位
- [ ] source region 的接受/撤销可理解、可逆
- [ ] typography 统计不泄露完整私人正文
- [ ] 多页预览有清楚当前位置与导航
- [ ] stale preview、冲突与发布失败不暗示旧版已变化
- [ ] 危险操作使用明确目标、后果和较安全的初始焦点

## 9. 发现记录格式与严重性

建议每条发现记录：

```text
ID:
页面/流程:
状态/身份:
视口/缩放/主题:
输入方式/辅助技术:
规范或项目条款:
实际结果:
预期结果:
复现步骤:
用户影响:
证据:
严重性:
建议修复方向:
是否超出当前里程碑:
```

严重性建议：

- **CRITICAL**：核心阅读、登录、发布或安全边界对一类用户完全不可完成；或实现与 Constitution/冻结产品决策冲突。
- **HIGH**：WCAG A/AA 明确失败，或关键流程在键盘、触控、缩放、无 JS、错误路径中不可完成。
- **MEDIUM**：任务仍可完成但明显困难、易误操作、缺乏状态/恢复，或 Core Web Vital/项目性能目标未达。
- **LOW**：一致性、排版与增强级可用性问题，不阻断任务。
- **ENHANCEMENT**：WCAG AAA、44×44、40 CJK glyph 行宽、减少交互运动等明确增强目标。

不要只写“看起来不舒服”。发现必须能落到任务、规范、已冻结产品行为或可测性能上。

## 10. 本地页面发现

### 10.1 本次实际覆盖

本次不是整站 WCAG 合规认证，而是面向当前修复优先级的代表性审计：

- 对正在运行的 `http://127.0.0.1:4321` 检查首页、公开书库、两本当前公开图书的
  详情与阅读页，以及登录页；视口为 1440×900 和 360×800。
- 在独立端口和隔离数据目录中重新构建当前代码，以 E2E 当前版本检查同一批页面，避免把
  “旧不可变图书版本”误判成“当前编译器仍然输出旧界面”。
- 上传登记样本 `real-mineru-e80477ff22ac`：MinerU 3.4.4、97 页、2.6 MiB。测试体本身
  3.1 秒完成登录、上传、分析和预览；包含应用构建、启动和测试的总过程为 11.7 秒。该
  数字只说明本次样本顺利跑通，不作为产品性能基准。
- 对两套运行页面执行 axe-core 4.12.1 的 WCAG 2 A/AA、2.1 AA 与 2.2 AA 规则；自动
  扫描发现一项当前阅读器严重级 `target-size` 问题。其余人工发现说明了为什么 axe
  零报告不能替代真实任务审计。
- 截图与真实书正文仅保存在本机临时目录，没有加入仓库或本文，避免把样本内容变成新的
  可分发资产。

未覆盖：

- 屏幕阅读器实机组合、200% 文字缩放、400% 页面缩放、320 px、深色阅读主题；
- Core Web Vitals 现场数据和并发重建下的浏览器 trace；
- 失败上传、取消、重试、stale preview、发布冲突和危险操作的完整人工旅程；
- 图片灯箱、复杂表格、代码复制与脚注浮层的代表性真实页面。

### 10.2 发现总表

| ID     | 原始发现                            | 当前状态 | 2026-07-31 复核                                                         | 严重性 |
| ------ | ----------------------------------- | -------- | ----------------------------------------------------------------------- | ------ |
| UI-001 | 公开图书使用不同代际阅读器          | 已退役   | clean switch 不保留旧阅读链；这是原数据现场，不是当前代码兼容任务       | -      |
| UI-002 | 目录 disclosure 只有 20×28 px       | 已解决   | 桌面为 32×32 px，移动端为 44×44 px                                      | -      |
| UI-003 | 长目录前没有 skip link              | 已解决   | `ReaderShell` 首个链接跳到 `#main-content`                              | -      |
| UI-004 | 正文 `h1`–`h4` 没有可见层级         | 已解决   | 共享 ReaderShell CSS 提供连续层级、安全换行，并复用已有锚点偏移         | -      |
| UI-005 | 移动详情不是全屏覆盖                | 已解决   | 35rem 以下使用完整动态视口原生 dialog，桌面保持有界                     | -      |
| UI-006 | 详情忽略封面及占位封面              | 已解决   | 详情复用 `coverUrl`，图片下方保留稳定标题字符占位                       | -      |
| UI-007 | 详情直接渲染最多 200 项目录         | 已解决   | 详情只渲染前 16 项、显示总数，并链接到完整 ReaderShell 目录             | -      |
| UI-008 | 管理预览是超长全书表单              | 已解决   | 当前为虚拟化结构列表、单项编辑、sticky ReaderShell 预览和移动模式切换   | -      |
| UI-009 | 导入暴露 ID 且不展示限制            | 已解决   | 书名选择器、限制、真实进度、取消和共享管理导航均已就位                  | -      |
| UI-010 | 页面重复壳层和样式                  | 已解决   | 四个管理路由使用唯一共享 Astro 壳；独立产品页面继续保留各自构图         | -      |
| UI-011 | 两处无效 `var(--color-white)-space` | 已解决   | 详情描述和 Passkey `.sr-only` 均改为有效 `white-space`                  | -      |
| UI-012 | 匿名书库请求管理 API                | 已解决   | 匿名只取得 private/no-store 的 false capability，不再请求受保护管理投影 | -      |

### 10.3 详细发现与复现

以下内容保留 2026-07-26 的现场、影响与当时修复建议，作为历史证据。它不会覆盖 10.2 的
当前状态；标记为已解决或已退役的条目不应重新生成实现任务。

#### UI-001：当前公开图书没有完成阅读器代际收口

**实际结果**

- 当前 4321 的第一本公开图书仍使用旧版扁平目录和旧阅读器 HTML。360×800 视口下没有
  “目录 / 本文 / 搜索 / 下载”移动工具栏，243 个目录链接直接出现在正文之前，页面测得
  `scrollHeight = 10,228 px`。
- 另一当前公开图书已有移动工具栏，但仍使用旧色板、扁平目录，并把印刷目录标题纳入
  导航。两本当前图书因发布时间不同而呈现不同产品能力。
- 隔离环境中由当前代码生成的新书已经有层级目录、当前位置面包屑、页内提纲和移动
  dialog 抽屉，说明主要差异来自不可变旧版本未正常重新发布，不是需要在请求时兼容解析。

**用户影响**

移动读者打开旧书后先看到长达数屏甚至上百屏的目录，核心正文虽然存在但很难到达；同一
站点的书籍还会表现成两套产品。

**修复方向**

按 D-103 的正常后台重新发布流程为当前公开图书生成新不可变版本，不得原地改旧目录。
增加“当前版本 renderer/compiler identity”管理可见性和一次性升级清单；升级前后做
移动入口、印刷目录排除、层级目录和现有 URL 的验收。

#### UI-002：目录展开控件不满足 WCAG 2.2 最小目标尺寸

**实际结果**

当前 `src/styles/reader.css` 把 `.reader-toc summary` 设为 `w-5 h-7`。浏览器实际量得
20×28 px，axe 的 WCAG 2.2 `target-size` 规则报告：

> Target has insufficient size (20px by 28px, should be at least 24px by 24px)

同时它与相邻页面链接的安全点击空间直径也只有 20 px，不能使用 spacing 例外。

**用户影响**

粗指针、手抖或低精度输入用户容易误触链接而不是展开分支，尤其目录密集时会意外离开
当前页。

**修复方向**

把 disclosure 的真实 hit area 提升到至少 24×24 px，并保持它与普通目的链接为两个清楚
目标；高频移动控件以 44×44 px 作为增强目标。新增 WCAG 2.2 `target-size` 到现有 E2E
axe 标签，当前测试只覆盖到 WCAG 2.1。

#### UI-003：长目录缺少 bypass link

**实际结果**

`ReaderShell` 虽然给正文 `<main>` 设置了 `id="main-content"`，但页面没有指向它的
skip link。桌面版全书目录位于正文之前；无 JavaScript 降级也保留完整目录。旧公开书
达到 243 个目录链接，新阅读器即使折叠视觉分支，DOM 中仍先出现目录导航。

**用户影响**

键盘用户每次翻页都必须重复经过顶栏和大量目录目标才能进入正文，属于 WCAG 2.4.1 的
重复内容绕过问题。

**修复方向**

在页面首个可聚焦位置增加“跳到正文”，默认视觉隐藏、聚焦后清楚显示；确认目标
`scroll-margin` 不被固定顶栏遮住。对上一页/下一页后的初始焦点策略另做人工验证。

#### UI-004：语义标题没有视觉标题层级

**实际结果**

Tailwind Preflight 会重置标题默认样式，而 `.reader-document` 只设置了 serif、16 px 和
`leading-loose`，没有恢复 `h1`–`h4`。当前构建实测：

| 元素 | font-size | font-weight | line-height | block margin |
| ---- | --------: | ----------: | ----------: | -----------: |
| h1   |     16 px |         400 |       32 px |         0 px |
| p    |     16 px |         400 |       32 px |         0 px |

`h2` 在截图中同样与普通段落几乎不可区分。

**用户影响**

屏幕阅读器仍可取得语义，但视觉读者无法扫读章节层级；教材页变成均匀文字流，右侧提纲和
正文结构的对应关系也难以辨认。

**修复方向**

在共享 reader stylesheet 中给生成正文建立克制但明确的 `h1`–`h4` 字号、字重、行高、
段前/段后距和锚点偏移；抽样中文、英文、双语长标题及公式旁标题，避免只恢复浏览器默认
样式。

#### UI-005～UI-007：详情不是有效的移动全屏“预览”

**实际结果**

- 360×800 下 dialog 位于 `(19, 59.7)`，尺寸约 `322×680.7`，四周仍有遮罩和圆角，不是
  产品规格要求的移动全屏覆盖。
- 窄屏 media query 把 header 改成 block，关闭链接落到大标题下方，再到作者/元数据；
  首屏操作层级松散。
- `BookDetails` 接收到的 `coverUrl` 从未渲染；没有封面时也没有复用书库卡片的稳定首字
  占位。
- 服务层最多提供 200 个 TOC 预览项，组件逐项全部渲染。当前 243 项图书显示“前
  200 / 243 项”，dialog 中测得 212 个可见控件；“下载”位于长目录之后。

**用户影响**

移动详情没有形成清楚的全屏任务上下文；读者缺失最强的图书识别线索。对长教材，
“目录预览”实质上变成滚动负担，开始阅读、简介和下载无法快速比较。

**修复方向**

移动端使用真正的 viewport 覆盖和固定/粘性标题操作区；桌面与移动都显示真实封面或稳定
占位。目录默认只展示少量一级/二级结构与总数，提供明确“查看完整目录/从此处阅读”，
而不是把数据契约的 200 项上限直接当作界面默认值。

#### UI-008：真实书预览无法持续“结构—正文”对照

**实际结果**

97 页真实样本只产生 20 个标题，但当前预览页面已经达到 9,481 px。DOM 顺序为：

1. 全部“目录提议”；
2. 页面选择、预处理、诊断、发布；
3. 每个标题一张完整编辑表单；
4. 最后才是“正文效果” iframe。

桌面虽是左右两栏，但正文面板不 sticky；编辑靠后的标题时正文早已离开视口。850 px
以下两栏变一栏且保持上述 DOM 顺序，移动用户必须先穿过全部结构编辑表单才首次看到
正文。页面选择器也位于完整标题清单之后。

**用户影响**

管理员无法边修改标题层级/分页边观察对应正文，保存前的关键出版判断退化成记忆与长距
滚动；标题数增加后问题线性恶化。

**修复方向**

- 桌面采用真正的 master-detail：可搜索/折叠的紧凑结构树、单个当前节点编辑器、粘性
  正文预览与明确当前页。
- 移动端先给出页面选择和正文预览，再把结构编辑放入分段/抽屉；提供“返回当前标题”。
- 保存动作和未保存状态保持可见；诊断按 severity 和页面/标题定位。
- 用 20、200、2,000 个标题 fixture 设定 DOM 节点数、首次到达正文所需操作和滚动距离
  的有界验收，而不只验证数组长度上限。

#### UI-009：导入页暴露实现细节，缺少任务导向

**实际结果**

- 初始桌面页预留双列，但右侧状态尚不存在，导致上传卡片占左侧不到一半宽度，页面大面积
  空白；下方管理导航只是“后台任务·Passkey 安全设置”文本行。
- “更新已有书籍”要求管理员手填内部数字 ID。用户必须离开当前任务查 ID，填错还可能选中
  错误目标。
- 上传前只写“一次上传一个 ZIP”，没有展示 2 GiB 上限、预期 MinerU 包、后台阶段和
  取消/恢复含义。文件控件保持浏览器原生外观，与其余界面层级断开。

**用户影响**

首次导入缺乏方向；重新导入存在选错书的高后果风险；限制只在失败后出现会浪费大型文件
上传时间。

**修复方向**

建立共享管理 header/sidebar 或紧凑 tab，把“导入—任务—安全”作为明确位置。更新目标用
按标题/封面搜索的图书选择器，内部仍提交 opaque/稳定 ID；上传前显示主要限制与阶段，
选择后显示文件名、大小和清除动作。

#### UI-010～UI-011：Tailwind token 已统一，组件系统尚未统一

**实际结果**

- `src/styles/global.css` 仅声明字体、box sizing 和 `color-scheme`；首页、登录、书库、
  详情、导入、任务、安全和预览仍各自在 Astro 文件中重建 body、标题、导航、按钮和
  卡片规则。
- 首页“查看书库”和登录“使用 Passkey 登录”使用 amber 作为主要操作，而 D-106 规定
  emerald 为主要交互、amber 为提示/焦点；书库和管理又使用 emerald。
- 自动颜色迁移误伤两个合法 CSS 属性：
  `var(--color-white)-space: pre-line` 和
  `var(--color-white)-space: nowrap`。它们都是无效属性，因此详情描述不再保留预期
  换行，`.sr-only` 也丢失原定的 nowrap。

**用户影响**

页面单看未必都难用，但跨页面像多个小产品；同一颜色没有稳定动作语义。无效属性还说明
当前 style-token 门禁只防颜色字面量，没有防机械替换造成的 CSS 语法损坏。

**修复方向**

先建立共享 page shell、nav、button、field、card、status、dialog 和 typography primitives，
再逐页迁移；不要再做无语法感知的字符串颜色替换。增加生成 CSS 解析/构建断言和针对
`white-space` 等属性的回归测试。

#### UI-012：匿名书库产生预期中的错误请求

**实际结果**

`AdminLibraryEnhancement` 在所有 `/library` 客户端加载后请求
`/api/manage/library`。匿名响应按契约返回 `401`，组件静默忽略，但浏览器控制台每次都会
记录 “Failed to load resource: 401”。桌面与移动均可复现。

**用户影响**

当前视觉不受影响，但每个匿名访客都承担无价值请求；控制台噪声会掩盖真正资源错误，也给
未来性能与可观测性制造误报。

**修复方向**

保持公共 HTML 字节不随 Cookie 变化的前提下，让管理增强只在可靠的私有 bootstrap
信号之后加载，或为匿名探测定义无错误、无内容的响应模式；不能把管理员状态重新塞进
公共可缓存 HTML。

### 10.4 已验证的正向基础

以下基础应保留，不需要因视觉改版重写：

- 书库卡片、封面阅读链接、标题详情链接均是普通语义链接；无 JavaScript 仍可走完整主
  路径。
- 详情使用原生 `<dialog>`，有可见标题、关闭入口；现有自动化已覆盖 Escape、Back、
  滚动位置与触发控件焦点恢复。
- 当前阅读器的目录树使用原生 `<details>/<summary>`，目的地仍为普通链接；移动抽屉使用
  原生 dialog 并恢复触发控件焦点。
- 登录表单使用正确 email/password 类型和 autocomplete，Passkey 是首要入口，备用密码
  可由密码管理器填写。
- 本次 4321 页面在 1440 和 360 宽度均未出现整页横向滚动；当前构建的移动阅读工具四个
  按钮均为 44 px 高。
- 除 UI-002 外，本次抽样的 axe WCAG 2.2 A/AA 自动规则没有报告其他 violation；这只代表
  自动可判定子集，不抵消 UI-001、UI-003～UI-012 的人工发现。

### 10.5 建议交付顺序

1. **Reader typography and CSS correctness**：UI-004、UI-011。范围小、证据直接，不需要
   顺带重做阅读器或增加旧版本兼容。
2. **Details closure**：UI-005～UI-007。用 360 px、长标题、无封面和长目录做一次完整详情
   交互验收，不把 200 项存储上限继续当作默认展示数量。
3. **Shell and private enhancement**：UI-009、UI-010、UI-012。先定义公共缓存 HTML 与私有
   管理启动信号的边界，再逐页迁移共享壳层，避免为了消除一次 `401` 泄露管理员状态或让
   公共 HTML 随 Cookie 变化。

若进入实现，应按项目规定重新走 Spec Kit：

- UI-004～UI-007、UI-011 可作为现有规格的明确 defect slice；
- UI-009、UI-010、UI-012 涉及共享壳层和公共/私有响应边界，应先形成独立 feature spec；
- 已解决和已退役条目不写 absence-only 测试，也不恢复旧阅读链。

## 11. 一手来源索引

### W3C/WAI 规范与方法

- [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/)
- [WCAG-EM Overview](https://www.w3.org/WAI/test-evaluate/conformance/wcag-em/)
- [Selecting Web Accessibility Evaluation Tools](https://www.w3.org/WAI/test-evaluate/tools/selecting/)
- [ARIA in HTML](https://www.w3.org/TR/html-aria/)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [APG Modal Dialog Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [APG Disclosure Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
- [APG Landmark Regions](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/)
- [WAI Page Structure: Headings](https://www.w3.org/WAI/tutorials/page-structure/headings/)
- [WAI Forms Tutorial](https://www.w3.org/WAI/tutorials/forms/)
- [WAI Images Tutorial](https://www.w3.org/WAI/tutorials/images/)
- [WAI Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/)
- [Requirements for Chinese Text Layout](https://www.w3.org/International/clreq/)

### Chrome/web.dev 性能资料

- [Core Web Vitals](https://web.dev/articles/vitals)
- [Optimize LCP](https://web.dev/articles/optimize-lcp)
- [Optimize INP](https://web.dev/articles/optimize-inp)
- [Optimize CLS](https://web.dev/articles/optimize-cls)
- [Optimize TTFB](https://web.dev/articles/optimize-ttfb)
- [Optimize long tasks](https://web.dev/articles/optimize-long-tasks)
- [Browser-level image lazy loading](https://web.dev/articles/browser-level-image-lazy-loading)
- [`prefers-reduced-motion`](https://web.dev/articles/prefers-reduced-motion)
