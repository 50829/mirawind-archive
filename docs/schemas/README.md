# Mirawind M1 + M2a schemas

本目录冻结 M1/M1.1 的三个独立版本化格式：

- `book.v1.schema.json`：冻结的 M1 `book.yaml` v1
- `book.schema.json`：当前 `book.yaml` v2，增加源预处理来源记录和源区域
- `document-manifest.schema.json`：每个不可变发布版本的派生 manifest
- `version.schema.json`：内部不可变版本的完整性和文件哈希标记

三者均使用 JSON Schema Draft 2020-12。YAML 在验证前必须解析为 JSON
兼容数据模型；不得使用 YAML 自定义 tag、对象构造器、锚点合并造成的重复
键或其他可执行扩展。

## 版本与未知字段

- `book.yaml` 支持严格 v1/v2；manifest 与 version marker 仍为独立 v1。
- schema 版本只在格式语义变化时增加，不随书籍内容修改增加。
- `book.yaml.revision` 在每次接受的出版配置修改后单调递增。
- 已知版本中的未知字段一律拒绝，不静默忽略。
- 高于当前程序支持范围的 `schema_version` 一律拒绝发布。
- 旧版本必须通过显式、逐级、可测试的迁移函数升级。
- 迁移在副本上运行，完整验证成功后才能原子替换。

严格拒绝未知字段可以防止拼写错误或新程序生成的配置被旧程序悄悄丢失。
未来新增字段时必须同步增加 schema 版本或提供明确的兼容迁移。

## 权威边界

`book.yaml` 可以包含：

- 可移植元数据
- 主 Markdown 和登记原文件描述
- 已持久化源预处理的 profile、输入/输出摘要与有界计数
- 与规范化主 Markdown 摘要和 UTF-8 字节范围绑定的源区域
- 目录、标题、层级、角色、拆页和编号配置

`book.yaml` 不得包含：

- Markdown 正文副本
- session、密码或 Passkey
- 笔记、高亮、批注、书签和阅读进度
- 后台任务、发布状态或服务器绝对路径

`document-manifest.json` 是可重建产物，不是可编辑正文。它保存当前版本页面、
块、源位置、规范化可见文本、指纹和资源映射，以支持渲染、搜索、诊断和
后续稳定 ID 继承。

## SQLite schema 6 展示投影

M2a 的 SQLite schema 6 新增 `book_version_presentations`。它不是第四个可编辑
文件格式，而是从每个不可变版本中已经验证的 `book.yaml` 与
`document-manifest.json` 派生的有界查询投影。投影冻结当前版本的别名、书名、
可选元数据、封面资源、第一页与最多 200 条目录，并带规范化 SHA-256。

新版本的 ready 行、展示投影和搜索行在同一事务提交；发布事务只有在投影身份
匹配时才推进 `current_version_id` 和当前别名。迁移本身只建空表，worker 启动
后离线回填；公开请求禁止退回读取草稿 `title_cache` 或现场解析 YAML。

## SQLite schema 7 永久删除生命周期

schema 7 为 `books` 增加只增不减的 `deletion_requested_at` 屏障，并新增严格的
`book_deletions` 墓碑表。删除请求提交后，普通书库、详情、阅读、搜索、资源、
原文件和管理修改都只查询屏障为空的图书。

`book_deletions` 故意不外键关联普通 `books` 行，只保留不透明的删除/书籍/操作者/
清理任务身份、时间、受限状态和安全错误码。它没有书名、别名、作者、正文、
文件名、路径或自由 JSON 字段，因此最终删除普通图书行后不构成恢复来源。
带 `book_id` 的既有 `reclaim` 任务表示永久清理；无 `book_id` 的 `reclaim`
任务仍表示版本与隔离目录维护。

## 两层验证

导入和发布必须依次执行：

1. JSON Schema 结构验证。
2. `x-semantic-validations` 中列出的跨字段与文件系统语义验证。

第二层包括层级连续性、引用完整性、路径边界、ID 唯一性、页面覆盖和图片
总像素数等无法仅靠 JSON Schema 可靠表达的规则。

## 示例

`examples/book.v1.yaml` 展示冻结的 M1 配置；`examples/book.v2.yaml` 展示
M1.1 新导入配置。v1 只读迁移为 v2 时加入空 `source_regions` 和
`preserve-v1` 来源记录；新导入默认在接纳正文前应用 `zh-smart-v1`。示例 ID
和哈希只用于说明格式，不得作为生产默认值。
