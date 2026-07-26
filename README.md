# Mirawind Library

Mirawind 是一个自托管、单管理员的语义化在线图书馆。当前出版闭环接受“一本书一个
MinerU ZIP”，在后台安全解包、构建真实阅读预览、编译并建立搜索索引，再以不可变
版本原子发布；读者可以从 `/library` 浏览当前公开版本、查看 `/books/:bookKey`
详情，再进入带目录、提纲、搜索、下载和移动抽屉的阅读器。读者请求始终读取已经
发布的版本。管理员还可以在私有书库中永久删除单本图书；接受后立即隐藏并由 worker
清理，没有回收站或恢复入口。

当前架构固定为一台 Linux 主机、一个 Astro Web 进程、一个同代码库 worker、
SQLite WAL 和本地持久化存储。不要横向扩容 Web/worker，也不要自行加入 Redis、
另一种数据库或对象存储。

## 快速开始

开发环境需要 Node.js 24、pnpm 11.9 和带 FTS5 trigram 的 SQLite（项目使用
`better-sqlite3` 自带版本）。

### 本地 Docker 一键启动

只安装 Docker Engine 和 Compose plugin 即可：

```bash
./docker/local.sh
```

第一次运行会创建权限为 `0600` 的本地 `.env`、构建镜像、初始化 Docker
volume、执行迁移，并在当前终端安全询问管理员邮箱、显示名称和备用密码。以后
再次运行同一命令会保留管理员、图书和已发布版本并直接启动。

打开 <http://localhost:4321/login> 登录。常用管理命令：

```bash
./docker/local.sh status
./docker/local.sh logs
./docker/local.sh stop
```

本地启动仍保持一个 Web 进程和一个独立 worker 进程，只是由一个 Compose
项目统一管理；浏览器只能通过回环地址访问。生产部署继续使用下方经过 Caddy
保护的 HTTPS 拓扑。

### 本机 Node.js 启动

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:migrate
pnpm mirawind admin bootstrap --data-dir /srv/mirawind/data
```

管理员初始化命令必须在交互式 TTY 中运行；密码不会通过参数、环境变量或日志
传递。开发时分别启动两个进程：

```bash
pnpm dev:web
pnpm dev:worker
```

生产环境推荐 Docker Compose：

```bash
docker compose -f docker/compose.yaml build
docker compose -f docker/compose.yaml run --rm data-init
docker compose -f docker/compose.yaml run --rm migrate
docker compose -f docker/compose.yaml run --rm --no-deps web \
  node dist/processes/cli/index.js admin bootstrap \
  --data-dir /var/lib/mirawind
docker compose -f docker/compose.yaml up -d
```

先在 `.env` 中设置真实 HTTPS 域名、RP ID、允许的主机名和至少 32 字节的随机
认证密钥。首次启动的 `data-init` 和 `migrate` 是一次性服务；长期运行的只有
Web、worker 和 Caddy。

## 验证

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm benchmark:library --output-json docs/audits/m2a-library-performance.json \
  --output-markdown docs/audits/m2a-library-performance.md
```

真实 MinerU 3.4.4 样本放在 Git 与 Docker 构建上下文都忽略的
`tests/fixtures/mineru/real/`，通过不含书名的清单登记并校验哈希：

```bash
pnpm fixtures:verify-real --dir "$PWD/tests/fixtures/mineru/real"
```

## 文档

- [产品规格](docs/product/product-spec.md)
- [决策日志](docs/decisions/decision-log.md)
- [M1 架构](docs/architecture/m1-architecture.md)
- [运行配置](docs/operations/configuration.md)
- [部署与升级](docs/operations/deployment.md)
- [恢复与事故处理](docs/operations/recovery.md)
- [本地 Docker 预览规格](specs/002-local-docker-preview/spec.md)
- [M1 Feature Spec](specs/001-mineru-public-publishing/spec.md)
- [M1 验收流程](specs/001-mineru-public-publishing/quickstart.md)
- [书库与阅读闭环规格](specs/003-library-reading-loop/spec.md)
- [永久删除规格](specs/005-permanent-book-deletion/spec.md)
- [出版与阅读闭环规格](specs/006-clean-slate-publishing/spec.md)

Markdown 与版本化 `book.yaml` 是出版权威；AST、HTML、
`document-manifest.json`、资源和搜索索引都是可重建派生物。SQLite 中的
`current_version_id` 是唯一的当前版本指针；`book_version_presentations` 只是
从当前不可变 `book.yaml` 与 manifest 重建的有界展示投影，不是新的编辑权威。
