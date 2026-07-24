# Mirawind Library 单管理员认证架构调研

- 调研日期：2026-07-24
- 目标：为 M0/M1 的真实认证实现提供可落地方案
- 既定边界：Astro Node 单体、SQLite、唯一管理员、无公开注册、Passkey 为主、密码为备用
- 来源范围：Better Auth 官方文档与官方仓库、Astro 官方文档、W3C WebAuthn 规范

## 结论

推荐采用同源的 Astro Node + Better Auth：

```text
浏览器
  ├─ GET /login
  ├─ /api/auth/* ──────────────┐
  └─ /admin/*、/api/admin/*    │
                                ▼
Astro Node 单体
  ├─ Better Auth handler：认证协议、Cookie、Session、密码哈希、Passkey
  ├─ Astro middleware：读取 Session，建立 request locals
  ├─ Mirawind guard：唯一管理员与资源授权
  └─ SQLite：Better Auth 表 + Mirawind 业务表
```

M0 先用离线 CLI 创建唯一管理员及备用密码；正式 Web 服务始终禁用注册。管理员第一次用密码登录后，在已认证 Session 内登记 Passkey。此后登录页默认使用 Passkey，密码作为备用入口。不要开放“无 Session 的 Passkey 首次注册”，也不要为了单管理员模型引入 Better Auth Admin 插件。

当前 Better Auth 稳定文档标记为 v1.6，官方仓库当前发布线为 v1.6.x；实现时应将 `better-auth` 与 `@better-auth/passkey` 锁定在经过测试的兼容版本，不在迁移或部署时无审查地漂移到 `latest`。[Better Auth Astro 文档（v1.6 Latest）](https://better-auth.com/docs/integrations/astro)；[官方发布页](https://github.com/better-auth/better-auth/releases)

## 1. 包与数据库选择

### 1.1 包名

M0/M1 所需包：

```text
better-auth                         核心服务端与客户端
@better-auth/passkey                Passkey 服务端插件
@better-auth/passkey/client         Passkey 客户端入口
better-sqlite3                      Node SQLite 驱动
```

服务端使用：

```ts
import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";
```

React island 客户端可使用 `better-auth/react`，无框架客户端使用 `better-auth/client`；Passkey 客户端插件来自 `@better-auth/passkey/client`。官方 Passkey 插件内部复用 SimpleWebAuthn，不需要 Mirawind 自行实现 WebAuthn 验证。[Better Auth Passkey 官方文档](https://better-auth.com/docs/plugins/passkey)

### 1.2 SQLite

Better Auth 官方对 Node SQLite 推荐 `better-sqlite3`，可以把连接直接传给内置 Kysely adapter：

```ts
import Database from "better-sqlite3";

database: new Database(databasePath)
```

官方也支持 `node:sqlite`，但截至当前文档仍标为 Release Candidate；M0 更适合选稳定的 `better-sqlite3`。[Better Auth SQLite 官方文档](https://better-auth.com/docs/adapters/sqlite)

如果 Mirawind 业务层最终采用 Drizzle，也可以使用 `better-auth/adapters/drizzle`；但这会把 Better Auth schema 迁移交给项目的 Drizzle migration。对 M0 的单 SQLite 单体，直接使用内置 SQLite adapter 更少一层耦合。

### 1.3 Schema 与迁移

核心认证会使用 `user`、`session`、`account`、`verification` 等表；Passkey 插件还增加 `passkey` 表。若把限流持久化到数据库，还会增加 `rateLimit` 表。[Better Auth 数据库文档](https://better-auth.com/docs/concepts/database)；[Passkey schema](https://better-auth.com/docs/plugins/passkey#schema)；[Rate Limit storage](https://better-auth.com/docs/concepts/rate-limit#storage)

内置 SQLite adapter 同时支持 schema generation 与 migration：

```bash
npx auth@latest generate
npx auth@latest migrate
```

正式项目不应在部署脚本里盲用浮动的 `@latest`。应由锁定依赖对应的 CLI 在 CI 中生成/审核迁移，并在备份后单独执行迁移，再启动应用。每次增加、删除或升级插件后都必须重新比较 schema；Passkey 插件不是“只装包即可”。官方说明只有内置 Kysely adapter 支持直接 `migrate`；Drizzle/Prisma 应先 `generate`，再走各自 ORM 的迁移流程。[Better Auth CLI 与迁移](https://better-auth.com/docs/concepts/database#cli)

## 2. Astro 集成

Astro 使用 Node adapter 并按需渲染，才能在服务端访问 Cookie、数据库和受保护资源。Astro 官方说明 on-demand rendering 适用于 Session、认证 API 和受保护页面；Node 是其官方 adapter 之一。[Astro on-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)

Better Auth 不需要额外的 Astro adapter。将其 Fetch `Request` handler 挂在 catch-all endpoint：

```ts
// src/pages/api/auth/[...all].ts
import type { APIRoute } from "astro";
import { auth } from "@/lib/server/auth";

export const ALL: APIRoute = ({ request }) => auth.handler(request);
```

官方推荐保留默认路径 `/api/auth/*`。[Better Auth Astro 集成](https://better-auth.com/docs/integrations/astro#mount-the-handler)

在 `src/middleware.ts` 中用请求头读取 Session，并放进每次请求独有的 `Astro.locals`：

```ts
const result = await auth.api.getSession({
  headers: context.request.headers,
});

context.locals.user = result?.user ?? null;
context.locals.session = result?.session ?? null;
```

Astro 官方说明 middleware 会拦截页面和 endpoint，`locals` 会传给后续页面/API，且只在该次请求内存活。[Astro middleware](https://docs.astro.build/en/guides/middleware/)；[Better Auth 的 Astro middleware 示例](https://better-auth.com/docs/integrations/astro#auth-middleware)

### 2.1 服务端保护规则

Mirawind 必须在服务端统一保护：

- `/admin/**`
- `/api/admin/**`
- 上传、预览、发布、回滚、删除等所有写操作
- `draft`、`private` 书籍的 HTML、图片、附件与搜索结果

页面请求未登录时重定向 `/login?returnTo=...`；API 请求未登录返回 JSON `401`，已登录但不是唯一管理员返回 `403`。不要把 API 的 `401` 重写成 HTML 登录页。

中间件读取 Session 只是“认证”；书籍状态和资源可见性仍需在具体服务层做“授权”。前端隐藏按钮、React route guard、只保护页面而漏掉 API 都不构成权限边界。

## 3. Better Auth 配置基线

示意配置如下，最终环境变量名与限流数字在实现计划中冻结：

```ts
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";

export const auth = betterAuth({
  appName: "Mirawind Library",
  database: new Database(databasePath),
  baseURL: publicOrigin,
  trustedOrigins: [publicOrigin],

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 16,
  },

  plugins: [
    passkey({
      rpID: passkeyRpId,
      rpName: "Mirawind Library",
      origin: publicOrigin,
      registration: {
        requireSession: true,
      },
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    }),
  ],

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-in/passkey": { window: 60, max: 10 },
    },
  },

  advanced: {
    useSecureCookies: isProduction,
    ipAddress: {
      ipAddressHeaders: ["x-real-ip"],
    },
  },
});
```

这里的重点不是复制具体数值，而是显式配置安全相关默认值，避免升级后行为漂移。Better Auth 官方对 email/password 提供 `enabled`、`disableSignUp`、密码长度和密码哈希配置；默认密码哈希是 `scrypt`。[Better Auth options](https://better-auth.com/docs/reference/options#emailandpassword)；[Better Auth security](https://better-auth.com/docs/reference/security#password-hashing)

单管理员不需要 Admin 插件的角色、封禁、模拟登录或用户管理 endpoint。Mirawind 自己保存唯一 `admin_user_id` 并检查 Session 的 `user.id` 即可；未来真的引入多管理员/角色时，再评估来自 `better-auth/plugins` 的 `admin` 插件。[Better Auth Admin 插件](https://better-auth.com/docs/plugins/admin)

## 4. M0/M1 完整流程

### 4.1 首位管理员初始化

推荐离线、一次性 CLI，而不是公开 `/setup` 页面：

```text
部署者通过 SSH/本机执行 bootstrap-admin
  → 确认数据库没有 Better Auth user
  → 从 TTY 隐藏输入管理员 email、显示名、长随机备用密码
  → 用未挂到 HTTP 的 setup-only Better Auth 实例调用 signUpEmail
  → 将返回的 user.id 写为 Mirawind 唯一 admin_user_id
  → 提示部署者离线保存恢复密码
  → 第二次执行因已有管理员而失败
```

正式运行实例始终 `disableSignUp: true`，且不提供注册页。CLI 不应直接向 `account.password` 写哈希；让 Better Auth 创建账户和凭据，才能沿用库的 password schema 与哈希实现。密码不得放在命令行参数、环境变量、shell history 或日志中。

为了防止运维误配置造成第二个账户，应用层还应有两个独立约束：

1. 所有管理授权必须要求 `session.user.id === admin_user_id`，不能只判断“存在 Session”。
2. 初始化器和任何可能创建 user 的 app-owned path 都必须检查唯一管理员状态；正式配置对 `/sign-up/email` 保持禁用，并用集成测试验证公网调用失败。

### 4.2 第一次登录与 Passkey 登记

1. 管理员访问 `/login`，选择“使用备用密码”。
2. `authClient.signIn.email` 成功后获得数据库 Session 与 HttpOnly Cookie。
3. 如果该用户没有 Passkey，重定向到 `/admin/security/passkeys`，明确建议至少登记两个 Passkey。
4. 已登录状态下调用 `authClient.passkey.addPasskey`；Better Auth 默认要求 Session。
5. 登记完成后列出 Passkey 名称、创建时间和设备线索，允许添加第二把及撤销旧 Passkey。

不要启用 `registration.requireSession: false`。官方的 pre-auth Passkey-first 模式需要自定义签名 context 和 `resolveUser`；Mirawind 已经有离线 bootstrap + 备用密码，没有必要扩大未认证注册面。[Better Auth Passkey registration](https://better-auth.com/docs/plugins/passkey#add-register-a-passkey)

### 4.3 日常登录

登录页优先显示：

```text
[ 使用 Passkey 登录 ]

备用方式
[ 使用密码登录 ]
```

Passkey 登录调用 `authClient.signIn.passkey()`。可以在后续增强 conditional UI，但它要求输入框 `autocomplete` 以 `webauthn` 结尾，并在浏览器支持时预加载 `autoFill: true`；不能把 conditional UI 当成唯一入口。[Better Auth Passkey conditional UI](https://better-auth.com/docs/plugins/passkey#conditional-ui)

密码登录使用固定管理员 email 或要求输入 email 都可以；固定 email 的 UX 更简单，但后端错误响应仍不应暴露更多账户信息。备用密码应为独立、长且随机的恢复凭据，不应与其他站点复用。

### 4.4 Session、路由与登出

Better Auth 默认是传统数据库 Session：Cookie 携带 token，服务端查询 Session 与 user；默认过期为 7 天、`updateAge` 为 1 天。[Better Auth Session 管理](https://better-auth.com/docs/concepts/session-management)

M1 建议不启用 `session.cookieCache`，让 Session 撤销与登出及时反映到下一次受保护请求。SQLite 单实例下，多一次按 token 的索引查询比短时间继续接受已撤销 Session 更容易解释。后续如果测量到瓶颈，再决定短 TTL cache。

登出使用 Better Auth `signOut`，撤销当前 Session 并清 Cookie；返回位置只允许站内相对路径。安全设置页还应允许查看与撤销其他 Session。密码修改时使用 `revokeOtherSessions: true`。[Better Auth Session 撤销](https://better-auth.com/docs/concepts/session-management#revoking-sessions-on-password-change)

### 4.5 恢复边界

M0/M1 推荐明确限定为：

- Passkey 丢失，但备用密码仍在：用密码登录，撤销遗失 Passkey，登记新 Passkey。
- 密码丢失，但仍有 Passkey：可继续用 Passkey 进入管理端，但 M1 不把“已有普通 Session”直接等同于获准重设密码。Better Auth 的标准 `changePassword` 仍要求当前密码；M1 应走服务器离线恢复 CLI，或未来引入经过单独设计的邮件 reset token 流程，完成后撤销其他 Session。
- Passkey 与密码都丢失：不开放公网“找回账户”。由服务器拥有者通过 SSH/控制台运行离线恢复 CLI，重置唯一管理员的备用密码并撤销全部 Session；随后登录并重新登记 Passkey。
- SQLite 数据库和 `BETTER_AUTH_SECRET(S)` 同时丢失：属于灾难恢复，不是登录页面能解决的问题，依赖加密备份和密钥备份。

如果未来要支持邮件密码重置，必须先引入可靠邮件发送、token 生命周期、会话撤销与邮件账户被攻破后的威胁模型。Better Auth支持 `sendResetPassword` 和 reset token，但“库提供 endpoint”不等于 M1 必须开放它。[Better Auth Email/密码重置](https://better-auth.com/docs/concepts/email#password-reset-email)

## 5. Passkey 的部署约束

WebAuthn 的凭据绑定 RP ID；RP ID 必须等于调用 origin 的有效域名，或是其可注册域后缀。生产需要 HTTPS；`http://localhost[:port]` 是本地开发例外。Origin 则包含 scheme/host/port，服务端必须校验预期 Origin。[W3C WebAuthn Level 3：RP ID 与 Origin](https://www.w3.org/TR/webauthn-3/#sctn-rp-id)

因此在首个真实 Passkey 登记前必须冻结：

- 正式登录 origin，例如 `https://library.example.com`
- `rpID`，优先使用最具体、由 Mirawind 完全控制的 host
- 反向代理后的外部 scheme/host

官方 Passkey 配置要求 `origin` 不带结尾 `/`，`localhost` 可用于本地开发；`rpID` 可等于站点域或其合法父域。[Better Auth Passkey options](https://better-auth.com/docs/plugins/passkey#options)

不要为了让多个不确定子域共享 Passkey 而过早把 `rpID` 放宽到根域。W3C 警告：RP ID 范围内能执行恶意脚本的 origin 会破坏 WebAuthn 保证，并建议精确校验 origin、限制第三方脚本、使用 CSP。[W3C WebAuthn 安全考虑](https://www.w3.org/TR/webauthn-3/#sctn-code-injection)

建议允许 platform 和 cross-platform authenticator，不强制只使用当前电脑的生物识别设备；`residentKey: "preferred"`，`userVerification: "required"`。至少登记两个不同故障域的凭据，例如同步 Passkey 加独立安全密钥。

## 6. Cookie、CSRF、来源与代理

### 6.1 Cookie 与 CSRF

Better Auth Cookie 由 secret 签名；生产默认 `HttpOnly`、`Secure`，Session Cookie 默认 `SameSite=Lax`。它还通过非简单请求、Origin/`trustedOrigins` 校验和 Fetch Metadata 防护 CSRF。[Better Auth Cookies](https://better-auth.com/docs/concepts/cookies)；[Better Auth CSRF](https://better-auth.com/docs/reference/security#csrf-protection)

部署要求：

- `BETTER_AUTH_SECRET` 至少 32 字节高熵并作为部署 secret 管理；轮换使用官方 versioned secrets 机制。
- `baseURL` 显式设置为唯一生产 origin，避免从不可信请求头推断。
- `trustedOrigins` 只放精确生产 origin；生产实例不保留 localhost，不用宽泛 wildcard。
- 不设置 `disableCSRFCheck` 或 `disableOriginCheck`；后者同时关闭 URL 校验并造成开放重定向风险。
- 不启用 cross-subdomain cookies，保持 host-only Cookie。
- Astro 的 `security.checkOrigin` 保持默认开启；Better Auth 的检查也保持开启，两层不冲突。

Better Auth 官方特别说明 `disableOriginCheck` 会同时削弱 CSRF 与回调 URL 校验。[Better Auth security](https://better-auth.com/docs/reference/security#disabling-security-checks)

### 6.2 同源与反向代理

认证 API 应与页面保持同源：`https://站点/api/auth/*`。Better Auth 官方指出跨域认证在 Safari ITP 下可能直接丢弃第三方 Cookie，推荐同源反向代理或受控的共同父域；Mirawind 单体没有跨域的必要。[Better Auth Safari/ITP](https://better-auth.com/docs/concepts/cookies#safari-itp-and-cross-domain-setups)

反向代理必须：

- 终止 HTTPS，并只允许代理访问 Node origin。
- 覆盖而不是追加一个可信单值客户端 IP header，例如 `X-Real-IP`。
- 固定外部 host/proto；Astro `security.allowedDomains` 只允许正式域名。
- 不把公网用户自带的 `X-Forwarded-*` 原样信任或透传。

Better Auth 默认不会信任逗号分隔链中的最左 `X-Forwarded-For`，因为它可能由客户端伪造；可指定代理覆盖的单值 header，或精确配置 `trustedProxies`。[Better Auth Rate Limit：连接 IP](https://better-auth.com/docs/concepts/rate-limit#connecting-ip-address)

Astro 也提供 `security.allowedDomains` 防止恶意 `X-Forwarded-Host` 操纵 `Astro.url`，并默认对部分有状态表单请求执行 Origin 检查。[Astro configuration security](https://docs.astro.build/en/reference/configuration-reference/#security)

## 7. 限流

Better Auth 生产默认提供全局限流，且 `/sign-in/email` 有更严格的内置规则；开发环境默认关闭。为了不依赖版本默认值，Mirawind 应显式启用并为密码、Passkey ceremony 与恢复 endpoint 配置规则。[Better Auth Rate Limit](https://better-auth.com/docs/concepts/rate-limit)

单实例 M1 可以使用 `storage: "database"`，使重启不会清空计数；启用后需要创建 `rateLimit` 表。需要注意：官方说明直接调用 `auth.api` 的服务端请求不受客户端限流，因此任何 app-owned bootstrap/recovery CLI 必须自己做调用边界，不能认为 Better Auth 限流会保护离线管理操作。[Better Auth Rate Limit storage](https://better-auth.com/docs/concepts/rate-limit#storage)

限流不是唯一保护：应记录认证成功/失败、安全设置修改、Passkey 添加/删除、Session 撤销和离线恢复事件，但绝不记录密码、Session token、WebAuthn challenge 或完整 Cookie。

## 8. 责任边界

### Better Auth 负责

- 密码 `scrypt` 哈希与验证
- WebAuthn challenge、attestation/assertion 验证及 Passkey 公钥数据
- Session token 生成、Cookie、过期与撤销
- 认证 endpoint 与客户端 SDK
- Origin/CSRF 基础保护
- 认证 endpoint 基础限流
- 认证 schema 和插件 schema

### Mirawind 负责

- “只能有一个管理员”的业务不变量和 `admin_user_id`
- 离线 bootstrap 与离线灾难恢复 CLI
- `/admin/**`、`/api/admin/**` 的统一 guard
- 每本书 `public/private/draft` 的对象级授权
- 登录后的安全设置 UX、至少两把 Passkey 的提醒
- 密钥、SQLite 文件和备份的权限与轮换
- 反向代理可信边界、CSP、TLS 和安全响应头
- 认证审计日志及日志脱敏
- 对禁用注册、CSRF、路由保护、资源泄漏和恢复流程的集成测试

## 9. M0 验收清单

- [ ] 固定正式 origin 与 Passkey RP ID
- [ ] 锁定 `better-auth`、`@better-auth/passkey` 和 SQLite driver 版本
- [ ] 生成并审核核心、Passkey、Rate Limit schema
- [ ] 完成幂等的一次性 `bootstrap-admin` CLI
- [ ] 正式配置 `disableSignUp: true`，公网注册调用测试为失败
- [ ] 密码首次登录后能登记至少两个 Passkey
- [ ] Passkey 登录、密码备用登录和登出均可用
- [ ] `/admin/**` 与 `/api/admin/**` 无 Session 时分别 redirect/401
- [ ] 伪造 Session、第二个用户 Session、过期/撤销 Session 均被拒绝
- [ ] 私人 HTML、图片、附件和搜索结果不因猜 URL 泄漏
- [ ] CSRF 与 Origin 检查未关闭，`trustedOrigins` 为精确 allowlist
- [ ] 代理覆盖可信 IP header，Node origin 不直接暴露
- [ ] Passkey 丢失、密码丢失、全部凭据丢失三条恢复路径经过演练
- [ ] SQLite、数据目录与 secret 有独立备份，恢复过程经过演练

## 10. 仍需产品确认

认证技术路线已经足够进入 M0 设计，但以下恢复产品边界仍需单独冻结：

1. M1 是否完全不发送认证邮件，并把“全部凭据丢失”限定为服务器离线恢复。
2. 是否强制管理员在完成首次设置前登记至少两个 Passkey，还是只强提醒。
3. 正式登录 origin 与 RP ID 的具体值。
4. Session 是否采用默认 7 天滚动过期，还是要求更短时长及敏感操作重新认证。
