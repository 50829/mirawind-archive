# Mirawind M1 schemas

本目录冻结 M1 的三个独立版本化格式：

- `book.schema.json`：长期保存、可导入导出的 `book.yaml` 权威配置
- `document-manifest.schema.json`：每个不可变发布版本的派生 manifest
- `version.schema.json`：内部不可变版本的完整性和文件哈希标记

三者均使用 JSON Schema Draft 2020-12。YAML 在验证前必须解析为 JSON
兼容数据模型；不得使用 YAML 自定义 tag、对象构造器、锚点合并造成的重复
键或其他可执行扩展。

## 版本与未知字段

- M1 的三个 `schema_version` 均从整数 `1` 开始，但彼此独立。
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
- 目录、标题、层级、角色、拆页和编号配置

`book.yaml` 不得包含：

- Markdown 正文副本
- session、密码或 Passkey
- 笔记、高亮、批注、书签和阅读进度
- 后台任务、发布状态或服务器绝对路径

`document-manifest.json` 是可重建产物，不是可编辑正文。它保存当前版本页面、
块、源位置、规范化可见文本、指纹和资源映射，以支持渲染、搜索、诊断和
后续稳定 ID 继承。

## 两层验证

导入和发布必须依次执行：

1. JSON Schema 结构验证。
2. `x-semantic-validations` 中列出的跨字段与文件系统语义验证。

第二层包括层级连续性、引用完整性、路径边界、ID 唯一性、页面覆盖和图片
总像素数等无法仅靠 JSON Schema 可靠表达的规则。

## 示例

`examples/book.v1.yaml` 展示最小但完整的 M1 配置。示例 ID 和哈希只用于
说明格式，不得作为生产默认值。
