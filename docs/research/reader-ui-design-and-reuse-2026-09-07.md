# 阅读界面设计与复用调研

- 日期：2026-09-07。
- 状态：完成第一方资料、浏览器观察与当前源码分析；这是设计建议，不是已批准的实现决策。
- 方法：只核对项目官方网站、官方文档、官方仓库 README、源码和许可证。下文区分上游事实与针对 Mirawind 的工程判断，不把“流畅”“高性能”“无障碍”等官网描述当作本项目已验证的质量证据。
- 范围：Readest、Foliate、Readwise Reader、D2L、Sphinx Book Theme、Astro Starlight，以及相应阅读引擎和交互组件库。

## 结论

“成熟阅读产品”“可嵌入阅读引擎”“文档网站主题”和“无样式交互组件”是四种不同东西，不能因为它们都有目录和正文就互相替换。

本项目可以借成熟阅读器的导航层级、排版参数组织、工具显隐与内容密度，但没有必要为了改善外观把已经预生成的语义 HTML 重新交给 EPUB 引擎。优先保留 Astro、React、Tailwind 和自有阅读路由，建立统一的阅读排版与控件外观；复杂弹层、菜单、设置控件需要成熟行为基础时，在 Radix Primitives 与 React Aria 中选择一套按需使用。

我的视觉建议是：**书库向 Readest 的封面主导布局靠近，阅读页向 Foliate 的正文优先靠近，教材导航借 D2L / Sphinx Book Theme，管理工作台借 Readwise 的低装饰信息密度。** 不是把四个产品的皮肤拼在一起，而是让同一字体、间距、控件与颜色秩序服务三种不同任务。

问题不在于缺少一种流行组件库，而在于缺少明确的视觉主次。大型标题、圆角白卡、阴影和绿色实心按钮分别成立，处处一起使用却会使每个区域都像重点。静默设计不是把说明删光后留下更多空白，而是用位置、比例和状态让人自然知道看哪里、做什么。

Starlight 是最接近现有技术栈的整壳备选，而且官方确实支持自定义动态页面，不能以“只能静态 Markdown”排除它。是否值得引入，取决于关闭默认搜索、接入逐书目录和页面提纲、统一主题后，还剩多少可复用能力。这应由小型验证回答，而不是先重写阅读管线。

## 观察范围

本次实际在浏览器中打开 Readest Web 书库、Readest 官网、Foliate 官方截图、Readwise 官方产品展示、D2L 中文线性代数章节、Sphinx Book Theme 示例页和 Starlight 页面指南。没有登录第三方账号、没有上传本项目图书，也没有把第三方营销页本身当作阅读界面模板。

Readest 的观察限于实际书架及公开资料；不据此声称已经测试其全部阅读功能。Foliate 与 Readwise 的视觉判断来自官网展示图，不是本机安装后的完整体验。Readwise 的 CDN 图片单独打开被浏览器阻止，观察使用官网已显示的产品图，未下载或绕过限制。

本机 `127.0.0.1:4322` 在此次检查时没有监听进程，工作区另有正在进行的 IR 重构。因此本项目分析依据当前源码，并参考此前本任务看到的实际页面；本轮未启动服务、触发迁移或重新发布图书。以下尺寸为源码证据或设计候选，不冒充本轮实机测量。

## 成熟视觉参考

| 参考                                                                                                               | 真正值得借鉴                                                                     | 在 Mirawind 怎么用                                                       | 不应照搬                                                                       |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| [Readest Web](https://web.readest.com/) / [官网](https://readest.com/zh)                                           | 书封是主要视觉对象；紧凑搜索工具栏；低装饰的书架；操作图标弱于封面与书名         | 纵向完整封面、封面外的短元数据、网格与操作密度分离                       | 每张书都套大容器、把云同步/跨平台功能顺带引入、直接复制 AGPL 应用代码          |
| [Foliate](https://johnfactotum.github.io/foliate/)                                                                 | 正文画布完整，窄侧栏从属于正文，控件视觉克制；字体、间距与页边距共同决定阅读感   | 中文与西文排版基线、轻量固定工具栏、弱化侧栏的底色和选中态               | 双页小说排版套所有教材；自动隐藏顶栏（与当前固定显示约定冲突）；仿真翻书动画   |
| [Readwise Reader](https://readwise.io/read)                                                                        | 官方案例中的紧凑资料列表，缩略图/标题/次级元数据的清楚分层，侧边检查器与内容分工 | 管理列表、任务列表、当前项检查器；把操作放在对象附近，把技术信息放入详情 | 官网渐变宣传页、为每个对象常驻一排按钮、把 SaaS 同步服务当作可复用模板         |
| [D2L 线性代数章节](https://zh.d2l.ai/chapter_preliminaries/linear-algebra.html)                                    | 全书目录 / 正文 / 本页提纲各司其职；编号、公式、代码与正文同处连续阅读流         | 保留当前三栏教材结构，先设计长标题、公式、图注和跨章定位                 | 较重的双层蓝色顶栏、课程/Notebook/GitHub 等与本站任务无关的链接                |
| [Sphinx Book Theme 示例](https://sphinx-book-theme.readthedocs.io/en/stable/reference/special-theme-elements.html) | 面向科学内容的正文宽度、宽图表、边注及导航层级；页面区块不依赖浮动卡片分割       | 借复杂内容的版式规则，而不只借一页干净段落；宽内容不挤坏全页布局         | Bootstrap / Python / Sphinx 构建链；默认技术文档徽章与工具全集；忽略其维护模式 |
| [Starlight 页面指南](https://starlight.astro.build/guides/pages/)                                                  | 全站壳、目录、提纲、移动切换与主题组织一致，正文和导航有明确层级                 | 同栈整壳方案的对照组，也可只参考组件边界与响应方式                       | 默认紫色文档站外观、通用卡片组件堆叠、默认搜索包，以及再次处理已编译正文       |

这里的“成熟”指存在完整产品/长期内容场景可供观察，不保证每个项目的所有公共 API 都稳定，也不保证维护活跃。尤其 Foliate 应用成熟不等于 foliate-js API 稳定；Sphinx Book Theme 的维护状态见后文。

Foliate 的[官方完整阅读截图](https://johnfactotum.github.io/foliate/screenshot.webp)尤其适合对照“书的画布”与“围绕书的工具”：可以借鉴这种主次关系，不必借它的双页模式和平台窗口样式。

## 当前界面的问题

以下“原因”和“方向”是设计判断，不是把个人偏好写成缺陷标准。

| 当前证据                                                                                                                            | 为什么看起来像拼装界面                                                                       | 建议方向                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/pages/library/index.astro:109` 的书库标题是 `clamp(3.5rem, 10vw, 7rem)`                                                        | 常用工具页用到了约 56–112 px 的展示型标题尺度，空状态时比书本更抢眼                          | 书库标题从 28–32 px 的稳定尺度试起，让封面、书名和可用空间承担主视觉，不按视口连续放大字号                   |
| 同文件 `:142` 的封面是 `4 / 3`，`:151` 使用 `object-fit: cover`                                                                     | 把书封当作横幅缩略图，常见竖版教材的文字和构图会被裁掉；更像博客文章卡片                     | 容器以约 `2 / 3` 为候选比例，图片 `contain` 保留实际封面；横版原图也完整显示，不强行拉伸                     |
| 同文件卡片同时有边框、16 px 圆角、较大阴影、两项文字动作                                                                            | 每本书都像一个通用服务卡，而不是可辨识的出版物；封面点击与“开始阅读”重复占位                 | 封面和标题直接作为入口，书架项不加厚外框；详情/管理等次要动作降级，但保持键盘和触屏可发现                    |
| `src/styles/global.css` 与 `reader.css` 分别定义字体；只声明 Inter / Georgia / Noto 字体名，本次在产品源码没有找到对应 `@font-face` | 同一个字体名在不同系统不保证真的存在，尤其中文依赖回退；西文衬线与中文回退未做成一组排版设计 | 明确 UI 字体与正文的中西文字体组合，决定系统字体还是本地字体资源，并在 Linux / Windows / 移动端检查实际回退  |
| `reader.css:190` 是 16 px、两倍行高的正文基线；`:230` 给所有 h2 加横线；各级标题又分用粗体、颜色、边线                              | 不是没有排版规则，而是同时使用太多层级信号，正文与导航缺乏统一的疏密节奏                     | 先用字号、字重、段前后距构建秩序；正文标题减少装饰，图注、公式、代码分别有稳定节奏，不让每一节看起来像新卡片 |
| `manage-classes.ts:15` 把“面板”固定为圆角、边框、白底、24 px 内边距；工作台正文与检查器复用它                                       | 单个面板没问题，但放到整页三栏会层层吃掉空间，形成“卡片装卡片”的后台模板感                   | 工作台改为相邻的结构区、连续正文画布和检查器；靠分栏边界、底色与间距区分，不把每个页面区块都做成漂浮卡片     |

这也解释了为什么此前清除重复文案后仍没有变得精致：删除文字只减少了噪声，并没有重建封面比例、字号层级、正文密度与操作权重。换一个主题色不会解决这四件事。

## 建议的视觉语言

### 一个系统，三种密度

**书库：像书架，不像文章列表。** 用完整真实封面提供颜色与识别，书名和作者放在封面外；封面阴影只表达书本边缘，不给外层重复加影。无封面时可以设计克制的排字封面，使用真实书名/作者而非一个超大的首字，但必须承认它是生成封面，不伪造出版封面。匿名公开书库与授权后的管理视图共享视觉规则，不把私人数据写进公共缓存 HTML。不要为了填满页面添加假进度、推荐语或无数据的统计。

**阅读器：像连续的教材正文，不像套在卡片里的预览。** 保留轻量固定顶栏、全书目录与本页提纲；正文白底、主文字深色，侧栏字号和选中背景弱于正文。当前章展开，目录缩进保持克制；深层目录的搜索/折叠依赖既有功能，不增添第二套结构导航。图、表、公式和代码允许有独立的宽内容规则，但不能用整页横向溢出来换空间。封面式大标题不延续到正文每一节。

**出版工作台：像文档编辑器，不像展示型控制台。** 保留现有结构 / 正文 / 当前项三栏分工，减少整页外框、重复标题和宽内边距。主动作只突出当前真正可执行的保存/发布；检查器的字段和辅助动作比正文更安静。读者端与预览端使用同一套正文排版，但不重复导航，也不把管理端控件样式带进阅读正文。

### 可供首轮对比的参数

这些是设计试验起点，不是上游精确测量值、强制标准或新的静态样式测试契约。

- 页面标题先试 28–32 px，工作台标题 18–20 px；导航与元数据 13–14 px；正文先对比 18 px 与 20 px。
- 中文正文先试每行约 32–40 个汉字，西文约 60–75 个字符；按真实字体字宽和混排效果调整，不能把 `ch` 当成汉字宽度。
- 正文行高先对比 1.7–1.85；标题段前留白明显大于段后。公式与行内代码的基线、图注与正文的距离单独检查。
- 默认使用白色画布、`stone` 灰阶和极少量 `emerald` 交互色。不要靠大面积米色制造“纸张感”，也不把任意品牌色放到每个标题和每颗按钮上。
- 保持 D-106 的唯一 Tailwind 颜色权威；需要换色系时应先更新决策，而不是在页面里暗加一组颜色变量。字体、间距、半径也应由共享主题组织，但不必引入重型设计系统框架。
- 无外框的页面分栏；小控件圆角约 4–6 px，确需框定的独立项/弹窗不超过既有约定。桌面控件视觉可紧凑，触摸命中区仍要充分，不能靠缩小点击区域换“精致”。
- 动效只用于解释状态变化，避免页面逐卡浮入、装饰渐变、光晕和不必要的磨砂层；键盘焦点和触屏操作不能依赖 hover。

中文字体可评估 [Adobe 思源宋体](https://github.com/adobe-fonts/source-han-serif)，其[官方 LICENSE](https://github.com/adobe-fonts/source-han-serif/blob/release/LICENSE.txt)是 SIL OFL 1.1。若采用本地字体，要同时处理字体许可、保留字体名条件、WOFF2 分片/子集、加载回退和体积预算；只在 CSS 中写一个名字不算完成，也不要预加载一整套大型 CJK 字库。

### 三条路线的取舍

| 路线                                        | 优点                                                     | 代价                                                                                       | 判断                                 |
| ------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| 自有轻量壳 + 统一排版，借上述产品的设计原则 | 最贴合教材、既有预生成模型与权限边界；保留现有功能和路由 | 必须认真完成字体、控件层级和三类页面的设计，不能只修几处颜色                               | 推荐主线                             |
| Starlight 整壳 + 授权搜索与动态目录接入     | 直接获得成熟页面骨架和响应式组织                         | 生成时机、Astro 版本、默认搜索、主题与既有壳需要适配；覆盖过多时收益变小                   | 用一页做对照验证，再决定；当前不安装 |
| Readest / Thorium / EPUB 引擎整体替换       | 获得另一个完整产品或阅读运行模型                         | 许可、身份、定位、授权、客户端分页和构建模型都要重新接；不能自然改善本项目独特的校对工作台 | 不作为此次视觉改版路线               |

## 从调研进入设计

下一步最有价值的产出不是全站换肤，也不是新的长流程文档，而是**同一套视觉规则下的三个真实内容画面**：书库、长教材阅读页、正在编辑一个标题的出版工作台。先在现有技术栈做有限的视觉对照，再确定是否需要 Starlight 或额外控件库；本次尚未实施这些样板。

画面应使用长中文书名、英文长标题、缺封面、公式、表格、代码和很长的目录。不要用几个短占位段落证明教材排版“已经完成”。已有固定顶栏、移动抽屉、公共缓存与授权、虚拟目录、不可变发布等行为不因视觉改版自动改变。阅读偏好、进度、批注、收藏夹等未完成能力也不能用假数据填入设计后直接当作本次范围。

验收重点是正文是否先被看见、封面是否完整、长标题是否溢出、工具是否抢眼，以及真实阅读/编辑路径、键盘焦点、320–1440 px 布局与文字缩放。保留交互、数据与性能验证，不恢复固定中文文案、CSS 类或整段 HTML 一致性断言。改动嵌入不可变 HTML 的壳结构时，通过正常重建/发布交付，不原地重写旧版本。

## 本项目边界

当前工作区 `package.json` 为 Astro 7.1.3、React 19.2.8、Tailwind 4.3.3，已经使用 Lucide 和 TanStack Virtual。参考本地 [package.json](../../package.json)。

本次判断以宪章 4.1.0 与 D-138 的目标为准：MinerU v2 JSON ZIP -> 自有 IR -> worker 预生成 HTML、导航和资源映射 -> 服务端逐请求授权 -> 阅读器。IR 不是 EPUB，`book.json` 也不是 Readium Web Publication Manifest。第三方引擎不会直接理解自有 IR。

必须保留的边界见 [宪章](../../.specify/memory/constitution.md)、[决策日志](../decisions/decision-log.md)和[产品规格](../product/product-spec.md)：

- 公开正文是可定位、可搜索、可直接读取的语义 HTML，不用 iframe 或 Canvas 替代主正文。
- 解析、公式渲染、图片处理和索引在 worker，不移入访问阅读页面的请求或客户端初始化。
- HTML、图片、附件和搜索结果继续经过授权；私人内容不能进入公开静态目录或公开搜索包。
- 不可变发布版本与 SQLite 当前指针不变；页面、块、目录和链接继续用本项目稳定身份。
- D-106 要求统一 Tailwind 主题，不能叠加另一个独立颜色系统；D-109/D-135 要求静默界面。
- 引用外部深色模式、自动隐藏工具栏等只表示参考对象具备该能力，不意味着此次自动批准这些产品变化。

工作区正在进行 IR 重构。调研时部分旧 feature 文档、schemas README 和 IR 设计文档开头仍描述切换前 Markdown/book.yaml 基线；本次不修改这些并行工作的文件，也不把旧描述当作未来架构。

## 复用矩阵

| 对象              | 上游是什么                                                     | 核实的代码许可                                             | 对 Mirawind 的建议粒度                                        |
| ----------------- | -------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Readest           | React/Next.js + Tauri 完整跨平台阅读产品，使用 foliate-js      | AGPL-3.0-or-later                                          | 视觉与交互参考，不直接复制整应用                              |
| Foliate           | GJS + GTK4 + libadwaita + WebKitGTK 的 GNOME 应用              | GPL-3.0-or-later                                           | 视觉与交互参考，不移植 GTK 壳                                 |
| foliate-js        | 原生 JavaScript/Web Components 电子书解析、分页和辅助库        | MIT；vendored 依赖另行核查                                 | 不作为当前主阅读器；将来有明确独立能力需求再评估单模块        |
| Thorium Reader    | Electron + React + TypeScript 完整桌面阅读器                   | BSD-3-Clause                                               | 借目录、阅读设置、书库/阅读分工；不搬桌面运行架构             |
| Readium Web       | TypeScript publication 模型与 navigator SDK                    | BSD-3-Clause                                               | 可适配 EPUB/Web Publication 的阅读 SDK，当前无须引入          |
| epub.js           | JavaScript EPUB 解析与浏览器渲染库                             | package 声明 BSD-2-Clause；实际文件含 FreeBSD 项目补充声明 | 不替换当前 IR/HTML renderer，也不是成熟产品 UI 模板           |
| Sphinx Book Theme | Python/Sphinx 科学说明与交互图书主题，基于 PyData Sphinx Theme | BSD-3-Clause                                               | 教材版式与导航参考，不引入 Python/Sphinx 构建链；注意维护模式 |
| Astro Starlight   | Astro 文档网站框架和页面布局                                   | MIT                                                        | 最值得验证的整壳备选；也可只研究导航和正文样式组织            |
| Radix Primitives  | 无样式 React 交互基础组件                                      | MIT                                                        | 可按需直接依赖，保持本项目 Tailwind 外观                      |
| React Aria        | 无样式 React 组件与 hooks                                      | Apache-2.0                                                 | Radix 的替代选项，复杂集合、表单、跨输入交互时尤其值得比较    |

许可事实的固定源码与说明见下文。许可证表不是法律意见，也不把官网品牌、截图、书籍封面、图标包或字体自动视作相同许可。

## Readest 与 Foliate

### Readest

官方 README 把它描述为 Foliate 的现代重写，技术栈为 Next.js 16、Tauri v2。当前应用 package 进一步确认 React 19、Tailwind 4、daisyUI、Radix 和 foliate-js 均存在。其官方架构文档明确列出浏览器/原生宿主/服务端三个边界，以及云端同步、认证、对象存储等服务，而非一个能直接安装到 Astro 的阅读主题。

- [固定 README](https://github.com/readest/readest/blob/2e021e4c30c8180a1c06ea1dcd516a18e246cbbb/README.md)
- [固定应用 package.json](https://github.com/readest/readest/blob/2e021e4c30c8180a1c06ea1dcd516a18e246cbbb/apps/readest-app/package.json)
- [固定架构说明](https://github.com/readest/readest/blob/2e021e4c30c8180a1c06ea1dcd516a18e246cbbb/apps/readest-app/docs/architecture.md)
- [官方 Web 应用](https://web.readest.com/)

工程判断：同用 React/Tailwind 不等于能把 UI 整体复制过来。Readest 的文件加载、位置、书库、同步和宿主能力均有自己的模型，替换它们不是“套模板”。其依赖 daisyUI 也不证明 Mirawind 需要再引入 daisyUI；本项目已明确拥有全局主题。

许可须写作 **GNU Affero General Public License v3.0 or later / AGPL-3.0-or-later**：README 明确允许 v3 或后续版本，[LICENSE](https://github.com/readest/readest/blob/2e021e4c30c8180a1c06ea1dcd516a18e246cbbb/LICENSE)为 AGPL v3 正文。不能因为其 foliate-js、React 或 Tailwind 是宽松许可，就把 Readest 自身代码当作 MIT。直接复制或改造需先确认整体许可义务，尤其网络交互下的对应源码提供义务；本次建议独立实现参考到的通用设计模式。

### Foliate 与 foliate-js 必须分开看

Foliate 应用依赖 GJS、GTK4、libadwaita 和 WebKitGTK，不是 Web React 组件库。官方 AppStream 元数据明确 `GPL-3.0-or-later`，不应只根据 GitHub 自动徽章简写为“GPL-3.0”。

- [依赖与官方截图](https://github.com/johnfactotum/foliate/blob/67b6676d3f936c5edea91d4d903385ef39dd25c0/README.md)
- [明确的项目许可声明](https://github.com/johnfactotum/foliate/blob/67b6676d3f936c5edea91d4d903385ef39dd25c0/data/com.github.johnfactotum.Foliate.metainfo.xml.in)
- [COPYING](https://github.com/johnfactotum/foliate/blob/67b6676d3f936c5edea91d4d903385ef39dd25c0/COPYING)

独立的 foliate-js 则是 **MIT**。官方 README 明确：原生 ES modules，无构建步骤；解析器、分页器与辅助模块分开；renderer 是 Web Components；`view.js` 是装配入口。演示 `reader.html` 不属于核心库，预期由使用方修改或替换。

尤其需要保留上游自己说明的成熟度边界：它用于 Foliate 稳定版本，不等于它的公共 API 稳定；README 明确称 API 可能随时变化，目前没有 release，建议以 git submodule 使用。其主渲染流程还要求认真配置 CSP，README 专门警告 iframe/blob 内容和可执行脚本风险。

- [接口、API 状态、分页与安全说明](https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/README.md)
- [MIT LICENSE](https://github.com/johnfactotum/foliate-js/blob/78914aef4466eb960965702401634c2cb348e9b1/LICENSE)
- [官方演示](https://johnfactotum.github.io/foliate-js/reader.html)

工程判断：foliate-js 可以通过 book interface 接受非 EPUB 内容，因此不能简单说“完全不兼容”。但若为它再生成另一套 sections、renderer 定位和客户端分页机制，只为改变外观，会新增与既有 page/block 身份及普通 HTML 路由的衔接成本。其 text-walker/overlayer 等小模块将来可能有独立用途，但本次不为尚未实施的批注/TTS 预先加依赖。

## Thorium 与 Readium

Thorium 是完整桌面应用，不是 Readium Web npm SDK 的另一个名字。官方 README 明确技术栈为 TypeScript、Electron、React、Redux、Saga、i18next，运行结构为主进程、书库窗口与一个或多个阅读窗口，基于 Readium Desktop toolkit。其官方截图和用户文档适合观察导航、设置与阅读器的信息分组。

- [Thorium 技术栈、架构与截图](https://github.com/edrlab/thorium-reader/blob/f74c991d3b08f3ff7fe9b88956dd44dd397aad9d/README.md)
- [Thorium BSD-3-Clause LICENSE](https://github.com/edrlab/thorium-reader/blob/f74c991d3b08f3ff7fe9b88956dd44dd397aad9d/LICENSE)
- [官方网站](https://www.thoriumreader.com/)

BSD-3-Clause 允许在保留许可条件下修改与再分发，不意味着其生产级 LCP/DRM 组件也包含在开源代码里；README 明确后者需要额外组件与合作。Mirawind 没有这项需求，不能把它误列为可免费继承的能力。

Readium Web 的官方 TypeScript 仓库发布 `@readium/shared`、`@readium/navigator`、`@readium/navigator-html-injectables`，提供 publication 模型、导航与内容注入控制。当前源码既有 `EpubNavigator`，也有 `WebPubNavigator`；后者同样由 frame pool 管理 iframe、定位和样式/行为注入。

- [Readium Web 包与职责](https://github.com/readium/ts-toolkit/blob/893a5cc362605ad19f1be1d905159c1b7282c68d/README.md)
- [EpubNavigator](https://github.com/readium/ts-toolkit/blob/893a5cc362605ad19f1be1d905159c1b7282c68d/navigator/src/epub/EpubNavigator.ts)
- [WebPubNavigator](https://github.com/readium/ts-toolkit/blob/893a5cc362605ad19f1be1d905159c1b7282c68d/navigator/src/webpub/WebPubNavigator.ts)
- [Readium Web BSD-3-Clause LICENSE](https://github.com/readium/ts-toolkit/blob/893a5cc362605ad19f1be1d905159c1b7282c68d/LICENSE)

工程判断：它不是“只认 EPUB”的库，可为已有 HTML publication 提供导航；但不负责把 Mirawind IR 编译成正确正文。接入需要建立 publication/locator 与 page/block 的映射，并重新处理嵌入阅读、授权资源、CSP、焦点与搜索跳转。现有宪章已选择普通语义 HTML 主正文，不建议为了视觉效果引入这套运行模型。

## epub.js

官方定位是浏览器 EPUB 渲染库，包含默认/连续加载管理器、分页/滚动模式和 hooks，使用 iframe 渲染章节；README 推荐服务端净化，并指出启用 `allowScriptedContent` 会使 sandbox 不安全。它提供渲染能力，不提供可直接套用的完整成熟 UI 系统。

- [固定 README 与 iframe 安全说明](https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/README.md)
- [package.json](https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/package.json)
- [实际 license 文件](https://github.com/futurepress/epub.js/blob/eee359d0790002115a1156a9833c54f4bcd44c1d/license)
- [官方示例](https://futurepress.github.io/epub.js/examples/)

许可核实细节：package.json 声明 **BSD-2-Clause**，README 称 Free BSD。实际文件除两条再分发条件外还有 FreeBSD Project 观点免责声明，GitHub 此时自动识别为 `NOASSERTION`。复用应保留原始文件全文，不能为了统一表格擅自删掉补充声明或只依赖 GitHub 自动标签。

工程判断：即使未来有 EPUB 能力，本项目 D-138 当前只接受 MinerU v2；为 UI 改造引入 epub.js 既不能代替 IR renderer，也不能自然解决自有教材结构和服务器权限模型。其存在时间较长不能代替对本项目兼容性、可访问性及性能的实测。

## Sphinx Book Theme

本项目 D-010 已选 D2L 风格的教材阅读结构，因此应同时观察真正面向科学说明、图表、代码和长目录的文档主题，而不是只看 EPUB 产品。Sphinx Book Theme 是这一类候选，但本节不声称当前 D2L 站点就使用该主题。

官方 README 的定位是交互式图书主题，列出 Bootstrap 5、灵活正文布局与 Jupyter Notebook 内容支持；安装方式为 `pip install sphinx-book-theme`，通过 Sphinx `conf.py` 的 `html_theme` 启用。当前 `pyproject.toml` 声明 Python >=3.11、Sphinx >=8.2 和 `pydata-sphinx-theme==0.20.0`。它不是可以直接装入 Astro 的 npm 阅读组件。

- [官方文档与真实主题页面](https://sphinx-book-theme.readthedocs.io/en/latest/)
- [固定 README](https://github.com/executablebooks/sphinx-book-theme/blob/9fded6e25000960e6d986d4cd9d56268753c24c6/README.md)
- [Python/Sphinx 依赖与主题入口](https://github.com/executablebooks/sphinx-book-theme/blob/9fded6e25000960e6d986d4cd9d56268753c24c6/pyproject.toml)
- [BSD-3-Clause LICENSE](https://github.com/executablebooks/sphinx-book-theme/blob/9fded6e25000960e6d986d4cd9d56268753c24c6/LICENSE)

维护状态需要明确：调研快照的官方 README 首段注明 **Maintenance Mode**，表示仍尽力接受修复，但缺乏专门的评审合并资源，不太可能继续新增功能。不能只凭“成熟主题”就认定它是积极演进的优先依赖。

工程判断：值得借鉴的是科学教材的内容宽度、左目录/右提纲、边注与宽图表关系，以及顶部工具区的信息分组。直接移植会引入 Sphinx/Python、模板上下文、Bootstrap/PyData 样式和第二套构建过程，与现有 worker 的自有 IR 编译和 Tailwind 主题重复。可按许可选择性参考独立样式或结构，但本项目不需要为了换外观输出 Sphinx 源文件再构建一次。

## Astro Starlight

这是同栈且最值得认真比较的选项，而不是完整电子书系统。官方提供文档页面、导航、页内提纲、搜索、布局、主题及组件覆盖。

关键事实：官方 `StarlightPage` 可包装自定义页面，明确提到动态内容；可逐页传入 `sidebar` 与 `headings`，不要求正文必须来自 `src/content/docs`。因此可以由已授权的 Mirawind 页面传入既有正文与派生导航，不必把书搬进 Git 内容集合。

- [官方页面指南与 StarlightPage](https://starlight.astro.build/guides/pages/)
- [上述指南固定源码](https://github.com/withastro/starlight/blob/dba20640bac11cbf3a9eb69ae3816b380fb6e3e8/docs/src/content/docs/guides/pages.mdx)
- [组件覆盖机制](https://starlight.astro.build/guides/overriding-components/)
- [Tailwind v4 集成](https://starlight.astro.build/guides/css-and-tailwind/)
- [MIT LICENSE](https://github.com/withastro/starlight/blob/dba20640bac11cbf3a9eb69ae3816b380fb6e3e8/LICENSE)

整壳引入仍有五个实际问题：

1. 默认搜索为 Pagefind 静态索引。不能把私人书籍放入可公开下载的索引后再靠 UI 隐藏，也不能替代当前版本过滤的 FTS5。需要关闭默认搜索 UI/生成路径，接现有授权搜索。[官方搜索说明](https://starlight.astro.build/guides/site-search/)
2. 本项目已有 KaTeX/Shiki 预生成产物；不能再次通过 Starlight 的 Markdown/Expressive Code 管线重编译正文。主题接入应只消费已有结果。
3. Starlight 自带布局和 `--sl-*` 设计变量。官方可连接 Tailwind，但实际接入仍需证明不会成为第二套颜色权威，不会重复标题、导航、页脚或内容边距。[样式指南](https://starlight.astro.build/guides/css-and-tailwind/)
4. 调研时上游 main 的 `0.42.0` 声明 Astro `^7.2.10`、`@astrojs/markdown-remark ^7.3.0`，高于工作区 7.1.3/7.2.1。不能直接假设最新版即装即用；必须选兼容版本或显式升级验证。这里是上游快照，不声称它已在 npm 发布。[固定 package.json](https://github.com/withastro/starlight/blob/dba20640bac11cbf3a9eb69ae3816b380fb6e3e8/packages/starlight/package.json)
5. 本项目 [render.ts](../../src/web/features/reader/render.ts) 使用 React `renderToStaticMarkup` 生成 `ReaderShell`，供后台出版装配使用，不是每个阅读请求都运行 `.astro` 页面组件。`StarlightPage.astro` 不能直接传给这个函数；需要改变后台装配方式，或改为请求时渲染外壳。后者触及预生成产物契约，必须单独评估，不能作为“同栈所以可直接替换”的隐含前提。

建议的验证范围是一条隔离 reader 页面：保留原资源 URL、正文 HTML 和稳定锚点，注入单书目录和页内提纲，替换搜索，观察长中文标题、宽公式、移动目录与最终客户端负担。若最终需覆盖大多数导航/标题/正文组件，继续维护轻量自有壳通常更清晰。当前没有运行该 PoC，不声称已经验证成功。

## Radix 与 React Aria

### Radix Primitives

官方定位是低层、无样式 React primitives，处理 focus management、键盘导航与部分 WAI-ARIA 模式，支持渐进采用及服务端渲染。当前 Dialog package 的 peerDependencies 明确覆盖 React 19。

- [定位与无样式说明](https://www.radix-ui.com/primitives/docs/overview/introduction)
- [服务端渲染说明](https://www.radix-ui.com/primitives/docs/guides/server-side-rendering)
- [React 19 peerDependencies](https://github.com/radix-ui/primitives/blob/f7ecd5ab16f5e1e820eb5786a1419a98a2d594ae/packages/react/dialog/package.json)
- [MIT LICENSE](https://github.com/radix-ui/primitives/blob/f7ecd5ab16f5e1e820eb5786a1419a98a2d594ae/LICENSE)

适合 Mirawind 的是 Dialog、Popover、Dropdown Menu、Tooltip、Slider、Switch、Tabs 等有真实交互复杂度的局部控件。普通按钮、链接、布局不必全部包装。SSR 支持不意味着打开弹层不需要客户端脚本，仍应只 hydrate 必要的 React island。

在当前架构里，这个建议首先面向已交互化的管理端。ReaderShell 是预生成标记，读者端行为由 [reader-runtime.js](../../src/web/features/reader/reader-runtime.js) 增强；把 Radix/React Aria 组件放进去并不会自动带上运行能力。已经可靠的原生 `dialog`/`details` 不必重写；确需引入客户端组件时，要明确挂载边界、额外脚本量及无 JavaScript 行为。

它不附送“好看的设计”。采用的是交互行为，不应把 Radix Themes、某个 shadcn 默认外观或示例页面自动当成本项目视觉系统。

### React Aria

必须区分同仓库里的 React Spectrum 与 React Aria：前者是 Adobe Spectrum 设计系统实现，后者是无样式组件/hooks。React Aria 官方支持 `className`、Tailwind utilities、data attributes 和 render props；当前 react-aria-components 包许可为 Apache-2.0，peerDependencies 覆盖 React 19。

- [官方库定位区别](https://github.com/adobe/react-spectrum/blob/4dd44e0f400636a87a9ad4390903e78c5ae6113c/README.md)
- [样式与 Tailwind 集成](https://react-aria.adobe.com/styling)
- [当前组件包与 React peers](https://github.com/adobe/react-spectrum/blob/4dd44e0f400636a87a9ad4390903e78c5ae6113c/packages/react-aria-components/package.json)
- [Apache-2.0 LICENSE](https://github.com/adobe/react-spectrum/blob/4dd44e0f400636a87a9ad4390903e78c5ae6113c/LICENSE)

工程判断：目录树、可选择集合、复杂设置字段、触摸/鼠标/键盘一致性变成主要负担时，这条路线有价值。但不能仅因组件齐全就替换现有虚拟目录与所有表单。Radix 和 React Aria 应先选一套覆盖当前痛点，避免同类弹层和控件各自有不同状态、焦点及 styling 约定。

这两套库都不决定正文的字体、行长、留白与标题秩序，也不会把 UI 自动变得美观。它们的直接收益是减轻交互细节的自行实现成本，让视觉设计建立在行为稳定的控件之上。

## 许可与验证边界

- 固定 commit 用于可复核事实，不代表推荐直接依赖 main/develop，也不证明 npm 或应用商店发布版本与该快照相同。
- MIT/BSD/Apache 的直接复制或修改仍需保留相应 copyright、LICENSE/NOTICE 等义务；具体复制文件还需检查局部授权。
- GPL/AGPL 不是“禁止复用”，但不应在没有明确许可决策时把这些代码混入现有项目。技术可用性和许可适合度分开判断。
- 项目根许可证不自动证明网站截图中的书籍、封面、商标、图标包和字体可随本项目再分发。Readest 官方 README 自身也单列了第三方库和字体。
- 通用布局与交互原则可以独立实现；这不等于像素级复制品牌、照搬源码或重新分发参考截图。
- 本文没有修改或安装任何运行依赖，没有测量第三方性能，也没有对第三方可访问性作认证。实施时仍需用本项目真实中文教材、公式、图表和长目录进行桌面/移动、缩放、键盘、焦点及授权闭环验证。
