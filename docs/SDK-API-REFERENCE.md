# FloatCTF 前端 SDK API 参考（照抄级）

> 适用对象：用 `@floatctf/sdk` + `@floatctf/frontend-runtime`（React 可选加 `@floatctf/react`）从零写新前端的开发者。
>
> **本文所有签名、字段、URL 均逐字摘自仓库源码**（`packages/sdk/src`、`packages/react/src`、`packages/frontend-runtime/src`），
> 不做任何改写、不补充源码里不存在的符号。每条都附 `文件:行号`。
>
> 版本基线：源码工作区 `/home/fb0sh/Projects/floatctf`（commit `90d071f`）。
> 平台契约：`FRONTEND_RUNTIME_VERSION = "1"`、`API_CONTRACT_VERSION = "1"`。

阅读顺序建议：§0 → §1 → §4 → §5，然后按需查 §2 与 §3。

---

## 0. 客户端装配

### 0.1 `createFloatCTFClient(options)`

源码：`packages/sdk/src/client.ts:120-173`（工厂本身）、`packages/sdk/src/transport.ts:60-78`（options 定义）。

```ts
export function createFloatCTFClient(options: FloatCTFClientOptions = {}): FloatCTFClient
```

参数可省略（`options = {}`），此时全部走默认值。

#### `FloatCTFClientOptions` 完整字段表（`transport.ts:60-78`）

| 字段 | 类型（源码原文） | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `baseUrl` | `string` | 否 | `"/api"`（`DEFAULT_API_BASE_URL`，`transport.ts:44`） | 选手端 API base URL；尾部 `/` 会被去掉（`normalizeBaseUrl`，`transport.ts:131-133`） |
| `adminBaseUrl` | `string` | 否 | `` `${baseUrl}/admin` ``（`transport.ts:220-222`） | 管理端 API base URL |
| `getUserToken` | `() => string \| null \| undefined` | 否 | 无——未提供时**不注入** `Authorization` 头（`transport.ts:140-149`）；SSE 侧默认取 `options.getUserToken?.() ?? null`（`client.ts:136-138`） | 同步纯读，取当前选手 token；非空时注入 `Authorization: Bearer <token>`（`transport.ts:143-149`） |
| `getAdminToken` | `() => string \| null \| undefined` | 否 | 同 `getUserToken`（SSE 默认见 `client.ts:139`） | 同上，管理端作用域 |
| `onUnauthorized` | `(context: UnauthorizedContext) => void` | 否 | 无 | 收到 HTTP 401 时回调；SDK 自身**不跳转、不写 localStorage**（`transport.ts:69-73`、`157-163`） |
| `onError` | `(error: FloatCTFError, scope: FloatCTFAuthScope) => void` | 否 | 无 | 每次请求失败调用（错误已归一化为 `FloatCTFError`，`transport.ts:74-75`、`164`） |
| `requestConfig` | `FloatCTFRequestConfig` = `Omit<AxiosRequestConfig, "baseURL">` | 否 | 无 | 附加到两个 axios 实例的默认配置（`withCredentials` / `timeout` 等）。**`baseURL` 被刻意排除**（`transport.ts:52-58`、`196-199`） |

`UnauthorizedContext`（`transport.ts:46-50`）：

```ts
export interface UnauthorizedContext {
	scope: FloatCTFAuthScope;   // "user" | "admin"
	status: number;             // 401
	error: FloatCTFError;
}
```

`FloatCTFAuthScope = "user" | "admin"`（`transport.ts:41`）。

#### `FloatCTFClient` 返回对象完整属性表（`client.ts:69-103`）

| 属性 | 类型 | 说明 |
|---|---|---|
| `baseUrl` | `string`（readonly） | 选手端权威 base URL（= 请求真正发往的地址） |
| `adminBaseUrl` | `string`（readonly） | 管理端权威 base URL |
| `transport.service` | `AxiosInstance`（readonly） | 选手端底层 axios 实例（逃生舱：拦截器 / 上传进度 / 流式响应） |
| `transport.admin` | `AxiosInstance`（readonly） | 管理端底层 axios 实例 |
| `serviceHttp` | `FloatCTFHttpClient`（readonly） | 选手端 HTTP handle（`get/delete/post/put/patch` + `instance`） |
| `adminHttp` | `FloatCTFHttpClient`（readonly） | 管理端 HTTP handle |
| `service` | `ServiceApi`（readonly） | 选手端领域门面（`ReturnType<typeof createServiceApi>`，`api/index.ts:148-164`） |
| `admin` | `AdminApi`（readonly） | 管理端领域门面（`api/index.ts:112-141`） |
| `awd.player` | `AwdPlayerApi`（readonly） | **就是 `service.awd` 同一个对象**（`client.ts:159`） |
| `awd.admin` | `AwdAdminApi`（readonly） | **就是 `admin.awd` 同一个对象**（`client.ts:160`） |
| `awdp.player` | `AwdpPlayerApi`（readonly） | `createAwdpPlayerApi(serviceTransport.http)`（`client.ts:163`） |
| `awdp.admin` | `AwdpAdminApi`（readonly） | `createAwdpAdminApi(adminTransport.http)`（`client.ts:164`） |
| `awdp.runs` | `AwdpRunApi`（readonly） | `createAwdpRunApi(serviceTransport.http)`——**走选手端 base URL**（`client.ts:165`） |
| `sse.connect` | `(options: FloatCTFSseOptions) => SseConnection` | 选手端 SSE（本实例 base URL + `getUserToken`） |
| `sse.connectAdmin` | `(options: FloatCTFSseOptions) => SseConnection` | 管理端 SSE（admin base URL + `getAdminToken`） |
| `sse.createParser` | `() => SseParser` | 等价于 `createSseParser`（`client.ts:170`） |

`service` / `admin` 的子门面装配见 `api/index.ts:112-138`（admin）与 `148-162`（service）：
`service = { users, events, challenges, instances, submit, solves, weapons, announcements, discussions, uploads, awd }`；
`admin = { login, system, settings, announcements, challenges, discussions, users, events, instances, event_challenges, event_users, event_announcements, event_logs, event_writeups, event_teams, database, scheduled_tasks, weapons, logs, download, docker, dashboard, super_admin, awd }`。

### 0.2 可直接运行的最小装配示例

```ts
import { createFloatCTFClient, UNI_SUCCESS_CODE, FloatCTFError } from "@floatctf/sdk";

// 前端自有 token 存储（SDK 不碰 localStorage；这里只是示例）
let userToken: string | null = null;
let adminToken: string | null = null;

const client = createFloatCTFClient({
  // 同源默认就是 "/api"；跨源/自建 base URL 时显式给
  baseUrl: "/api",
  // 默认即 `${baseUrl}/admin`；仅当管理端部署在不同前缀时才需要
  // adminBaseUrl: "/api/admin",

  getUserToken: () => userToken,
  getAdminToken: () => adminToken,

  // 401 之后做什么完全由前端决定（路由守卫 / 清 token / 弹提示）
  onUnauthorized: ({ scope, status, error }) => {
    console.warn(`[401/${scope}] ${error.displayMessage}`);
    if (scope === "user") {
      userToken = null;
      // 例如：router.navigate("/login")
    } else {
      adminToken = null;
      // 例如：router.navigate("/admin/login")
    }
  },

  onError: (error: FloatCTFError, scope) => {
    // 全局错误日志（不要吞掉；错误必须可见）
    console.error(`[${scope}/${error.kind}]`, error.toJSON());
  },

  requestConfig: { timeout: 20_000, withCredentials: false },
});

// —— 选手端登录并读取赛事列表 ——
async function bootstrap() {
  const login = await client.service.users.login({ username: "alice", password: "s3cret" });
  if (login.code !== UNI_SUCCESS_CODE) throw new Error(login.message);
  userToken = login.data ?? null;

  const events = await client.service.events.fetch({ limit: 20 });
  return events.data ?? [];   // 注意：拿到的整体是 UniResponse<EventInfo[]>，列表在 .data
}

// —— 管理端登录 ——
async function adminLogin() {
  const res = await client.admin.login({ username: "root", password: "p@ss" });
  adminToken = res.data ?? null;
}
```

---

## 1. 调用约定

### 1.1 `UniResponse<T>`（`protocol.ts:24-29`）

```ts
export type UniResponse<T> = {
	code: number;
	message: string;
	data?: T;
	meta?: QueryParams;
};
```

| 字段 | 类型 | 可选 | 含义 |
|---|---|---|---|
| `code` | `number` | 否 | 平台业务码，`0` = 成功（`UNI_SUCCESS_CODE`）；错误用 `AppError` 映射 |
| `message` | `string` | 否 | 平台文案，可直接展示（也可能是英文技术文案） |
| `data` | `T` | **是** | 业务数据；无数据时为 `null` 或**字段缺失**（`protocol.ts:8`） |
| `meta` | `QueryParams` | **是** | **仅列表接口**返回分页元信息（`protocol.ts:9`） |

### 1.2 成功码常量（`protocol.ts:32`）

```ts
export const UNI_SUCCESS_CODE = 0;
```

### 1.3 分页 `meta` 的真实字段 = `QueryParams`（`protocol.ts:14-21`）

```ts
export type QueryParams = {
	offset?: number;
	limit?: number;
	page?: number;
	total?: number;
	filter?: string;
};
```

**`QueryParams` 允许的键只有这 5 个**：`offset`、`limit`、`page`、`total`、`filter`。
没有 `search` / `sort` / `order` / `q` / `keyword` 等键——传这些键 TS 直接报错（`QueryParams` 不是索引签名类型）。
SDK 里所有 `params: QueryParams = {}` 的参数都原样透传为 axios `params`（如 `service/events.ts:20`）。

### 1.4 `FloatCTFError` 全部字段与分支方式（`errors.ts:35-87`）

```ts
export class FloatCTFError extends Error {
	override readonly name = "FloatCTFError";
	readonly kind: FloatCTFErrorKind;
	readonly httpStatus?: number;
	readonly code?: number;
	readonly platformMessage?: string;
	readonly original?: unknown;
	readonly unauthorized: boolean;
	readonly response?: FloatCTFErrorResponse;
	get displayMessage(): string;
	toJSON(): Record<string, unknown>;
}
```

| 字段 | 类型 | 可选 | 含义 |
|---|---|---|---|
| `name` | `"FloatCTFError"` | 否 | 固定值 |
| `kind` | `"http" \| "platform" \| "network" \| "unknown"` | 否 | 错误大类（`errors.ts:17-25`） |
| `httpStatus` | `number` | 是 | HTTP 状态码；**无响应时 `undefined`**（网络层失败） |
| `code` | `number` | 是 | 平台业务码（响应体是 `UniResponse` 时才有） |
| `platformMessage` | `string` | 是 | `UniResponse.message` |
| `original` | `unknown` | 是 | 原始错误（通常是 axios 错误），深度诊断用 |
| `unauthorized` | `boolean` | 否 | 是否认证失败；构造时默认 `httpStatus === 401`（`errors.ts:67`） |
| `response` | `FloatCTFErrorResponse` = `{ status?, statusText?, data?, headers? }` | 是 | 兼容既有 UI 的 axios 形态读取（`errors.ts:28-33`） |
| `displayMessage` | `string`（getter） | — | `platformMessage?.trim() \|\| message`（`errors.ts:72-74`） |
| `toJSON()` | `Record<string, unknown>` | — | `{ name, kind, httpStatus, code, platformMessage, message, unauthorized }`（`errors.ts:76-86`） |

`FloatCTFErrorKind` 分支语义（`errors.ts:17-25`）：

| kind | 触发条件 |
|---|---|
| `"http"` | 服务端返回了非 2xx 的 HTTP 响应（`errors.ts:108`，`status !== undefined`） |
| `"platform"` | HTTP 2xx 但 `code !== 0`——**只由 `floatCTFErrorFromEnvelope` 构造**（`errors.ts:145-155`），传输层不会自动抛 |
| `"network"` | 请求未拿到响应：超时 / 连接被拒 / DNS 失败 / 被取消——由 `toFloatCTFError` 在 axios 错误无 `response` 时产出（`errors.ts:108`） |
| `"unknown"` | 非 axios、非 FloatCTFError 的异常（`errors.ts:130-138`） |

**调用方推荐分支方式**：

```ts
try {
  await client.service.challenges.get(id);
} catch (e) {
  if (e instanceof FloatCTFError) {
    if (e.unauthorized) { /* 登出/跳登录；同时 onUnauthorized 也会被调用 */ }
    else if (e.kind === "network") { /* 离线提示 */ }
    else { showToast(e.displayMessage); }   // http / platform
  } else {
    /* 非 SDK 异常（含 admin.download 自己 throw 的 Error） */
  }
}
```

辅助函数：

```ts
export function toFloatCTFError(error: unknown): FloatCTFError;          // errors.ts:98-139，幂等
export function floatCTFErrorFromEnvelope(envelope: unknown): FloatCTFError | null; // errors.ts:145-155
```

### 1.5 `FloatCTFHttpClient`（`transport.ts:86-117`）

```ts
export interface FloatCTFHttpClient {
	get<T = any, R = AxiosResponse<T>, D = any>(url: string, config?: AxiosRequestConfig<D>): Promise<R>;
	delete<T = any, R = AxiosResponse<T>, D = any>(url: string, config?: AxiosRequestConfig<D>): Promise<R>;
	post<T = any, R = AxiosResponse<T>, D = any>(url: string, data?: D, config?: AxiosRequestConfig<D>): Promise<R>;
	put<T = any, R = AxiosResponse<T>, D = any>(url: string, data?: D, config?: AxiosRequestConfig<D>): Promise<R>;
	patch<T = any, R = AxiosResponse<T>, D = any>(url: string, data?: D, config?: AxiosRequestConfig<D>): Promise<R>;
	readonly instance: AxiosInstance;
}
```

`R` 默认是 `AxiosResponse<T>`（**不是** `T`）。只有领域方法内部做了 `return res.data` 的拆包，直接使用 `serviceHttp` 时必须自己取 `.data`。

---

## 2. 领域方法总表

约定：

- 「签名」列是**源码原文**的调用形态；`参数默认值 = {}` 表示该参数可省略。
- 「后端」列中 `/api` = 选手端 base（默认 `baseUrl`），`/api/admin` = 管理端 base（默认 `${baseUrl}/admin`），`/api/service` = 选手端 base 下的 `/service` 作用域。
  括号内给出 api 源码里的 URL **字面量**，便于对照。
- 「源码」列给出 `文件:行`（相对 `packages/sdk/src/api/`；本节文件都在 `api/` 下，如 `service/events.ts:17`、`awd.ts:575`）。
- 所有方法返回的都是 `UniResponse<T>` 的 **Promise**，除 `client.admin.download.download` 外（它返回 `Promise<void>`）。
- 位置参数（非对象）的方法会明确写出；**没有**"接受对象或位置参数两种形态"的重载，源码里不存在重载。

### 2.1 `client.service.*`（选手端，base `/api`）

#### 2.1.1 `client.service.users` — `service/users.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `getMe` | `getMe(): Promise<UniResponse<Users>>` | `UniResponse<Users>` | `GET /api/users/me`（`/users/me`） | 取当前登录用户资料 | `service/users.ts:7` |
| `patchMe` | `patchMe(data: Partial<Users>): Promise<UniResponse<Users>>` | `UniResponse<Users>` | `PATCH /api/users/me`（`/users/me`） | 局部更新当前用户资料 | `service/users.ts:11` |
| `login` | `login({ username, password }: { username: string; password: string }): Promise<UniResponse<string>>` | `UniResponse<string>`（`data` 即 token） | `POST /api/users/session`（`/users/session`） | 选手端登录，返回 token 字符串 | `service/users.ts:15` |
| `register` | `register({ username, password, nickname, email }: { username: string; password: string; nickname: string; email: string }): Promise<UniResponse<string>>` | `UniResponse<string>` | `POST /api/users`（`/users`） | 注册选手账号 | `service/users.ts:28` |
| `resetPassword` | `resetPassword({ username, email }: { username?: string; email?: string }): Promise<UniResponse<string>>` | `UniResponse<string>` | `POST /api/users/reset_password`（`/users/reset_password`） | 申请重置密码（两个字段都可选，后端至少需其一） | `service/users.ts:47` |
| `reset` | `reset({ token, password, confirmed_password }: { token: string; password: string; confirmed_password: string }): Promise<UniResponse<string>>` | `UniResponse<string>` | `POST /api/users/reset?token=${token}`（模板串 `/users/reset?token=${token}`） | 用重置 token 设置新密码；**token 在 URL 查询串里** | `service/users.ts:60` |

#### 2.1.2 `client.service.events` — `service/events.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<EventInfo[]>>` | `UniResponse<EventInfo[]>` | `GET /api/events`（`/events`） | 选手端赛事列表 | `service/events.ts:17` |
| `join` | `join(event_id: string): Promise<UniResponse<EventUsers>>` | `UniResponse<EventUsers>` | `POST /api/events/{event_id}/join` | 报名（加入）赛事 | `service/events.ts:23` |
| `leave` | `leave(event_id: string): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/events/{event_id}/leave` | 退出赛事 | `service/events.ts:27` |
| `createTeam` | `createTeam({ event_id, name }: { event_id: string; name: string }): Promise<UniResponse<EventTeams>>` | `UniResponse<EventTeams>` | `POST /api/events/{event_id}/team`（body `{ name }`） | 在赛事内创建战队 | `service/events.ts:31` |
| `joinTeam` | `joinTeam({ event_id, team_id }: { event_id: string; team_id: string }): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/events/{event_id}/team/${team_id}/join` | 加入指定战队 | `service/events.ts:43` |
| `quitTeam` | `quitTeam({ event_id, team_id }: { event_id: string; team_id: string }): Promise<UniResponse<null>>` | `UniResponse<null>` | `DELETE /api/events/{event_id}/team/${team_id}` | 退出/解散战队 | `service/events.ts:55` |
| `get` | `get(id: string): Promise<UniResponse<EventInfo>>` | `UniResponse<EventInfo>` | `GET /api/events/{id}` | 赛事详情（含 joined / team_result） | `service/events.ts:67` |
| `fetchChallenges` | `fetchChallenges(id: string, params: QueryParams = {}): Promise<UniResponse<EventChallengeResult[]>>` | `UniResponse<EventChallengeResult[]>` | `GET /api/events/{id}/challenges` | 赛事题目列表（含 my 解出状态） | `service/events.ts:71` |
| `getChallengeInstance` | `getChallengeInstance(event_id: string, challenge_id: string): Promise<UniResponse<Instances>>` | `UniResponse<Instances>` | `GET /api/events/{event_id}/challenges/{challenge_id}/instance` | 取某题在我方的实例 | `service/events.ts:80` |
| `getInstances` | `getInstances(event_id: string): Promise<UniResponse<EventInstanceResult[]>>` | `UniResponse<EventInstanceResult[]>` | `GET /api/events/{event_id}/instances` | 赛事内我的全部实例 | `service/events.ts:89` |
| `launchSingleInstance` | `launchSingleInstance(event_id: string, challenge_id: string): Promise<UniResponse<Instances>>` | `UniResponse<Instances>` | `POST /api/instances/launch`（body `{ challenge_id, event_id }`；**注意不是赛事子路径**） | 启动单题实例（赛事上下文） | `service/events.ts:95` |
| `getScoreboard` | `getScoreboard(event_id: string): Promise<UniResponse<ScoreboardItem[]>>` | `UniResponse<ScoreboardItem[]>` | `GET /api/events/{event_id}/scoreboard` | 赛事计分榜 | `service/events.ts:105` |
| `getTrend` | `getTrend(event_id: string): Promise<UniResponse<TrendItem[]>>` | `UniResponse<TrendItem[]>` | `GET /api/events/{event_id}/trend` | 赛事分数走势 | `service/events.ts:111` |
| `getAnnouncements` | `getAnnouncements(event_id: string): Promise<UniResponse<EventAnnouncements[]>>` | `UniResponse<EventAnnouncements[]>` | `GET /api/events/{event_id}/announcements` | 赛事公告 | `service/events.ts:115` |
| `getOwnWp` | `getOwnWp(event_id: string): Promise<UniResponse<string \| null>>` | `UniResponse<string \| null>` | `GET /api/events/{event_id}/own_wp` | 我提交的 Writeup（URL 或正文，可能 `null`） | `service/events.ts:121` |

#### 2.1.3 `client.service.challenges` — `service/challenges.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<ChallengesListItem[]>>` | `UniResponse<ChallengesListItem[]>` | `GET /api/challenges`（`/challenges`） | 题目目录 | `service/challenges.ts:41` |
| `get` | `get(id: string): Promise<UniResponse<ChallengesListItem>>` | `UniResponse<ChallengesListItem>` | `GET /api/challenges/{id}` | 题目详情 | `service/challenges.ts:47` |
| `getInstance` | `getInstance(id: string): Promise<UniResponse<Instances>>` | `UniResponse<Instances>` | `GET /api/challenges/{id}/instance` | 该题的我的实例 | `service/challenges.ts:51` |
| `getMyWriteup` | `getMyWriteup(challenge_id: string): Promise<UniResponse<ChallengeWriteup>>` | `UniResponse<ChallengeWriteup>` | `GET /api/challenges/{challenge_id}/my_writeup` | 我的题目 Writeup | `service/challenges.ts:55` |
| `createMyWriteup` | `createMyWriteup({ challenge_id, content }: { challenge_id: string; content: string }): Promise<UniResponse<ChallengeWriteup>>` | `UniResponse<ChallengeWriteup>` | `POST /api/challenges/{challenge_id}/my_writeup`（body `{ content }`） | 新建/覆盖我的题目 Writeup | `service/challenges.ts:61` |
| `getWriteup` | `getWriteup(id: string): Promise<UniResponse<UnifiedWriteupDetail>>` | `UniResponse<UnifiedWriteupDetail>` | `GET /api/writeups/{id}` | 统一 Writeup 详情（challenge + gamebox 合并视图） | `service/challenges.ts:76` |
| `getWriteups` | `getWriteups(challenge_id: string): Promise<UniResponse<ChallengeWriteupResult[]>>` | `UniResponse<ChallengeWriteupResult[]>` | `GET /api/challenges/{challenge_id}/writeups` | 某题的公开 Writeup 列表 | `service/challenges.ts:82` |
| `getAllWriteups` | `getAllWriteups(params: QueryParams = {}): Promise<UniResponse<UnifiedWriteupResult[]>>` | `UniResponse<UnifiedWriteupResult[]>` | `GET /api/writeups` | 全局 Writeup 列表 | `service/challenges.ts:88` |
| `getChallengeSets` | `getChallengeSets(): Promise<UniResponse<ChallengeSets[]>>` | `UniResponse<ChallengeSets[]>` | `GET /api/challenge_sets` | 题集列表（**注意：无参数**） | `service/challenges.ts:94` |
| `getChallengeSet` | `getChallengeSet(id: string): Promise<UniResponse<ChallengesListItem[]>>` | `UniResponse<ChallengesListItem[]>` | `GET /api/challenge_sets/{id}` | 题集内题目 | `service/challenges.ts:98` |

#### 2.1.4 `client.service.instances` — `service/instances.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `launch` | `launch(id: string): Promise<UniResponse<Instances>>` | `UniResponse<Instances>` | `POST /api/instances/launch`（body `{ challenge_id: id }`） | 启动挑战实例（不带赛事） | `service/instances.ts:9` |
| `launchSingle` | `launchSingle(challenge_id: string, event_id: string): Promise<UniResponse<Instances>>` | `UniResponse<Instances>` | `POST /api/instances/launch`（body `{ challenge_id, event_id }`） | 启动单题实例（赛事上下文）；**位置参数顺序 = (challenge, event)** | `service/instances.ts:15` |
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<Instances[]>>` | `UniResponse<Instances[]>` | `GET /api/instances` | 我的实例合并列表 | `service/instances.ts:25` |
| `destroy` | `destroy(id: string): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/instances/{id}` | 销毁单个实例 | `service/instances.ts:31` |
| `bulkDelete` | `bulkDelete(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/instances`（body `{ id_list }`，经 `config.data`） | 批量销毁（挑战实例 / AWDP 练习实例） | `service/instances.ts:36` |

#### 2.1.5 `client.service.submit` — `service/submit.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `submit` | `submit({ instance_id, flag }: { instance_id: string; flag: string }): Promise<UniResponse<ChallengeSolves>>` | `UniResponse<JeopardyChallengeSolves>` | `POST /api/submit/flag`（body `{ instance_id, flag }`） | 提交 flag（无赛事上下文的形态） | `service/submit.ts:7` |
| `submitWriteup` | `submitWriteup(file: File, event_id: string, team_id?: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/submit/writeup`（multipart：`writeup_pdf`、`event_id`、可选 `team_id`） | 上传赛事 Writeup PDF；**位置参数** | `service/submit.ts:27` |
| `submitSingle` | `submitSingle({ event_id, instance_id, flag }: { event_id: string; instance_id: string; flag: string }): Promise<UniResponse<ChallengeSolves>>` | `UniResponse<JeopardyChallengeSolves>` | `POST /api/submit/flag`（body `{ event_id, instance_id, flag }`） | 提交 flag（带赛事上下文） | `service/submit.ts:45` |

> `ChallengeSolves` 是 `service/submit.ts:1` 的本地别名：`import type { JeopardyChallengeSolves as ChallengeSolves }`。

#### 2.1.6 `client.service.solves` — `service/solves.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<SolveResult[]>>` | `UniResponse<SolveResult[]>` | `GET /api/solves`（`/solves`） | 解出流水 | `service/solves.ts:17` |
| `getTop15Users` | `getTop15Users(): Promise<UniResponse<TopUser[]>>` | `UniResponse<TopUser[]>` | `GET /api/solves/top15users` | Top15 选手榜 | `service/solves.ts:23` |

#### 2.1.7 `client.service.weapons` — `service/weapons.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<Weapons[]>>` | `UniResponse<Weapons[]>` | `GET /api/weapons`（`/weapons`） | 武器/工具库列表 | `service/weapons.ts:7` |

#### 2.1.8 `client.service.announcements` — `service/announcements.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<Announcements[]>>` | `UniResponse<Announcements[]>` | `GET /api/announcements`（`/announcements`） | 平台公告列表 | `service/announcements.ts:7` |

#### 2.1.9 `client.service.discussions` — `service/discussions.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<DiscussionWithAuthor[]>>` | `UniResponse<DiscussionWithAuthor[]>` | `GET /api/discussions`（`/discussions`） | 讨论列表（含作者、`is_liked`） | `service/discussions.ts:17` |
| `get` | `get(id: string): Promise<UniResponse<DiscussionWithAuthor>>` | `UniResponse<DiscussionWithAuthor>` | `GET /api/discussions/{id}` | 讨论详情 | `service/discussions.ts:23` |
| `create` | `create(data: { title: string; content: string }): Promise<UniResponse<Discussions>>` | `UniResponse<Discussions>` | `POST /api/discussions` | 发帖 | `service/discussions.ts:27` |
| `patch` | `patch(data: Partial<Discussions>): Promise<UniResponse<Discussions>>` | `UniResponse<Discussions>` | `PATCH /api/discussions/${data.id}` | 改帖；**`data.id` 必填**（用于拼 URL） | `service/discussions.ts:34` |
| `remove` | `remove(id: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `DELETE /api/discussions/{id}` | 删帖 | `service/discussions.ts:40` |
| `like` | `like(id: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/discussions/{id}/like` | 点赞 | `service/discussions.ts:44` |
| `unlike` | `unlike(id: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `DELETE /api/discussions/{id}/like` | 取消点赞 | `service/discussions.ts:48` |
| `getComments` | `getComments(id: string, params: QueryParams = {}): Promise<UniResponse<DiscussionComments[]>>` | `UniResponse<DiscussionComments[]>` | `GET /api/discussions/{id}/comments` | 评论列表 | `service/discussions.ts:52` |
| `createComment` | `createComment(discussion_id: string, data: { content: string; parent_id?: string }): Promise<UniResponse<DiscussionComments>>` | `UniResponse<DiscussionComments>` | `POST /api/discussions/{discussion_id}/comments` | 发评论（`parent_id` 支持楼中楼）；**位置参数 + 对象混合** | `service/discussions.ts:61` |
| `patchComment` | `patchComment(discussion_id: string, comment_id: string, data: { content: string }): Promise<UniResponse<DiscussionComments>>` | `UniResponse<DiscussionComments>` | `PATCH /api/discussions/{discussion_id}/comments/{comment_id}` | 改评论 | `service/discussions.ts:71` |
| `deleteComment` | `deleteComment(discussion_id: string, comment_id: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `DELETE /api/discussions/{discussion_id}/comments/{comment_id}` | 删评论 | `service/discussions.ts:82` |

#### 2.1.10 `client.service.uploads` — `service/uploads.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `upload_image` | `upload_image(image_file: File): Promise<UniResponse<string>>` | `UniResponse<string>` | `POST /api/uploads/image`（multipart，字段 `image_file`） | 上传内嵌图片，返回 URL | `service/uploads.ts:6` |
| `upload_avatar` | `upload_avatar(image_file: File): Promise<UniResponse<string>>` | `UniResponse<string>` | `PATCH /api/uploads/avatar`（multipart，字段 `image_file`；**是 PATCH**） | 上传并设置头像 | `service/uploads.ts:16` |

#### 2.1.11 `client.service.awd`（= `client.awd.player`）— `awd.ts:572-623`

见 §2.3。

### 2.2 `client.admin.*`（管理端，base `/api/admin`）

#### 2.2.1 `client.admin.login` — `admin/auth.ts:5`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `login` | `login({ username, password }: { username: string; password: string }): Promise<UniResponse<string>>` | `UniResponse<string>`（token） | `POST /api/admin/session`（`/session`） | 管理员登录（SuperAdmin 认证域，独立于选手 token） | `admin/auth.ts:5` |

#### 2.2.2 `client.admin.system` — `admin/system.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `monitor` | `monitor(): Promise<UniResponse<SystemInformation>>` | `UniResponse<SystemInformation>` | `GET /api/admin/system/monitor`（`/system/monitor`） | 主机/系统监控信息 | `admin/system.ts:7` |
| `version` | `version(): Promise<UniResponse<string>>` | `UniResponse<string>` | `GET /api/admin/system/version`（`/system/version`） | 平台版本字符串 | `admin/system.ts:11` |

#### 2.2.3 `client.admin.settings` — `admin/settings.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(): Promise<UniResponse<SettingsDto[]>>` | `UniResponse<SettingsDto[]>` | `GET /api/admin/settings`（`/settings`） | 全部动态设置（含 `resolved_value`） | `admin/settings.ts:15` |
| `create` | `create(setting: Partial<SettingsDto>): Promise<UniResponse<SettingsDto>>` | `UniResponse<SettingsDto>` | `POST /api/admin/settings` | 新建设置 | `admin/settings.ts:19` |
| `remove` | `remove(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/admin/settings`（body `{ id_list }`） | 批量删除设置 | `admin/settings.ts:25` |
| `patch` | `patch(setting: Partial<SettingsDto>): Promise<UniResponse<SettingsDto>>` | `UniResponse<SettingsDto>` | `PATCH /api/admin/settings/${setting.id}` | 改设置；**`setting.id` 必填** | `admin/settings.ts:29` |

#### 2.2.4 `client.admin.announcements` — `admin/announcements.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<Announcements[]>>` | `UniResponse<Announcements[]>` | `GET /api/admin/announcements` | 公告列表 | `admin/announcements.ts:7` |
| `create` | `create(announcement: Partial<Announcements>): Promise<UniResponse<Announcements>>` | `UniResponse<Announcements>` | `POST /api/admin/announcements` | 发公告 | `admin/announcements.ts:13` |
| `remove` | `remove(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/admin/announcements`（body `{ id_list }`） | 批量删除 | `admin/announcements.ts:19` |
| `patch` | `patch(announcement: Partial<Announcements>): Promise<UniResponse<Announcements>>` | `UniResponse<Announcements>` | `PATCH /api/admin/announcements/${announcement.id}` | 改公告；**`announcement.id` 必填** | `admin/announcements.ts:25` |

#### 2.2.5 `client.admin.challenges` — `admin/challenges.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<ChallengesListItem[]>>` | `UniResponse<ChallengesListItem[]>` | `GET /api/admin/challenges`（`/challenges`） | 题目管理列表 | `admin/challenges.ts:14` |
| `create` | `create(challenge: Partial<ChallengesListItem>): Promise<UniResponse<ChallengesListItem>>` | `UniResponse<ChallengesListItem>` | `POST /api/admin/challenges` | 新建题目 | `admin/challenges.ts:20` |
| `patch` | `patch(challenge: Partial<ChallengesListItem>): Promise<UniResponse<ChallengesListItem>>` | `UniResponse<ChallengesListItem>` | `PATCH /api/admin/challenges/${challenge.id}` | 改题目；**`challenge.id` 必填** | `admin/challenges.ts:26` |
| `remove` | `remove(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/admin/challenges`（body `{ id_list }`） | 批量删除 | `admin/challenges.ts:33` |
| `importChallenge` | `importChallenge(file: File): Promise<UniResponse<ImportChallengeResponse>>` | `UniResponse<ImportChallengeResponse>` | `POST /api/admin/challenges/import`（multipart 字段 `package_zip`，文件名取 `file.name`） | 导入题目 zip 包（meta.toml + src + attachment） | `admin/challenges.ts:40` |
| `checkChallenges` | `checkChallenges(challenge_id_list?: string[]): Promise<UniResponse<ChallengeCheckResult[]>>` | `UniResponse<ChallengeCheckResult[]>` | `POST /api/admin/challenges/check`（body `{ challenge_id_list }`） | 题目完整性检查 | `admin/challenges.ts:53` |
| `buildChallenges` | `buildChallenges(challenge_id_list?: string[]): Promise<UniResponse<BuildChallengeResult[]>>` | `UniResponse<BuildChallengeResult[]>` | `POST /api/admin/challenges/build`（body `{ challenge_id_list }`） | 构建题目镜像 | `admin/challenges.ts:61` |
| `scanChallenges` | `scanChallenges(): Promise<UniResponse<ChallengeScanItem[]>>` | `UniResponse<ChallengeScanItem[]>` | `POST /api/admin/challenges/scan` | 扫描题目目录发现新题 | `admin/challenges.ts:69` |
| `getChallengeSets` | `getChallengeSets(params: QueryParams = {}): Promise<UniResponse<ChallengeSets[]>>` | `UniResponse<ChallengeSets[]>` | `GET /api/admin/challenge_sets` | 题集列表 | `admin/challenges.ts:73` |
| `createChallengeSet` | `createChallengeSet(challenge_set: Partial<ChallengeSets>): Promise<UniResponse<ChallengeSets>>` | `UniResponse<ChallengeSets>` | `POST /api/admin/challenge_sets` | 建题集 | `admin/challenges.ts:79` |
| `deleteChallengeSet` | `deleteChallengeSet(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/admin/challenge_sets`（body `{ id_list }`） | 批量删题集 | `admin/challenges.ts:85` |
| `getChallengeSet` | `getChallengeSet(id: string) => (params: QueryParams = {}) => Promise<UniResponse<ChallengesListItem[]>>` | **柯里化**：先传 id，再传 params | `GET /api/admin/challenge_sets/{id}` | 题集内题目；两个字面量参数分两次调用 | `admin/challenges.ts:93` |
| `removeChallengeFromSet` | `removeChallengeFromSet(id: string) => (id_list: string[]) => Promise<UniResponse<number>>` | **柯里化** | `DELETE /api/admin/challenge_sets/{id}/challenges`（body `{ id_list }`） | 从题集移除题目 | `admin/challenges.ts:103` |
| `addChallengeToSet` | `addChallengeToSet({ set_id, challenge_id_list }: { set_id: string; challenge_id_list?: string[] }): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/challenge_sets/{set_id}/challenges`（body `{ challenge_id_list }`） | 把题目加入题集 | `admin/challenges.ts:111` |
| `patchChallengeSet` | `patchChallengeSet(challenge_set: Partial<ChallengeSets>): Promise<UniResponse<ChallengeSets>>` | `UniResponse<ChallengeSets>` | `PATCH /api/admin/challenge_sets/${challenge_set.id}` | 改题集；**`challenge_set.id` 必填** | `admin/challenges.ts:123` |

#### 2.2.6 `client.admin.users` — `admin/users.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<Users[]>>` | `UniResponse<Users[]>` | `GET /api/admin/users`（`/users`） | 用户列表；**内部有 `console.log(res.data)`**（`admin/users.ts:9`） | `admin/users.ts:7` |
| `create` | `create(user: Partial<Users>): Promise<UniResponse<Users>>` | `UniResponse<Users>` | `POST /api/admin/users` | 新建用户 | `admin/users.ts:12` |
| `patch` | `patch(user: Partial<Users>): Promise<UniResponse<Users>>` | `UniResponse<Users>` | `PATCH /api/admin/users/${user.id}` | 改用户；**`user.id` 必填** | `admin/users.ts:16` |
| `remove` | `remove(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/admin/users`（body `{ id_list }`） | 批量删除 | `admin/users.ts:20` |

#### 2.2.7 `client.admin.events` — `admin/events.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<Events[]>>` | `UniResponse<Events[]>` | `GET /api/admin/events` | 赛事列表（**实体 `Events`，不是 `EventInfo`**） | `admin/events.ts:8` |
| `create` | `create(event: Partial<Events>): Promise<UniResponse<Events>>` | `UniResponse<Events>` | `POST /api/admin/events` | 建赛事 | `admin/events.ts:12` |
| `patch` | `patch(event: Partial<Events>): Promise<UniResponse<Events>>` | `UniResponse<Events>` | `PATCH /api/admin/events/${event.id}` | 改赛事；**`event.id` 必填** | `admin/events.ts:16` |
| `remove` | `remove(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/admin/events`（body `{ id_list }`） | 批量删除 | `admin/events.ts:20` |
| `get` | `get(id: string): Promise<UniResponse<Events>>` | `UniResponse<Events>` | `GET /api/admin/events/{id}` | 赛事详情 | `admin/events.ts:24` |
| `getData` | `getData(id: string): Promise<UniResponse<DataPresent>>` | `UniResponse<DataPresent>` | `GET /api/admin/events/{id}/data` | 数据大屏聚合（Jeopardy 语义） | `admin/events.ts:28` |
| `getReport` | `getReport(event_id: string): Promise<UniResponse<string>>` | `UniResponse<string>` | `GET /api/admin/events/{event_id}/report` | 赛事报表 | `admin/events.ts:32` |
| `exportWriteUps` | `exportWriteUps(event_id: string): Promise<UniResponse<string>>` | `UniResponse<string>` | `GET /api/admin/events/{event_id}/report`（**与 `getReport` 同一路径**） | 导出 Writeup（源码复用同一 URL） | `admin/events.ts:36` |
| `createChallengeSet` | `createChallengeSet({ name, description, challenge_id_list }: { name: string; description?: string; challenge_id_list: string[] }): Promise<any>` | 返回类型未标注（`res.data` 为 `any`） | `POST /api/admin/challenge_sets` | 建题集（与 `challenges.createChallengeSet` 重复入口） | `admin/events.ts:40` |

#### 2.2.8 `client.admin.instances` — `admin/instances.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `listForEvent` | `listForEvent(eventId: string, params: QueryParams = {}): Promise<UniResponse<AdminInstanceRow[]>>` | `UniResponse<AdminInstanceRow[]>` | `GET /api/admin/events/{eventId}/instances` | 赛事归一化实例列表（challenge + gamebox） | `admin/instances.ts:33` |

#### 2.2.9 `client.admin.event_challenges` — `admin/event_challenges.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(event_id: string) => (params: QueryParams = {}) => Promise<UniResponse<EventChallengeResult[]>>` | **柯里化** | `GET /api/admin/events/{event_id}/challenges` | 赛事挂题列表（管理端 `EventChallengeResult`） | `admin/event_challenges.ts:8` |
| `add` | `add({ event_id, challenge_id_list, challenge_id, points }: { event_id: string; challenge_id_list?: string[]; challenge_id?: string; points?: number }): Promise<UniResponse<EventChallenges[]>>` | `UniResponse<JeopardyEventChallenges[]>` | `POST /api/admin/events/{event_id}/challenges` | 挂题（支持单题 `challenge_id` 或批量 `challenge_id_list`） | `admin/event_challenges.ts:19` |
| `setPoints` | `setPoints({ event_id, challenge_id_list, points }: { event_id: string; challenge_id_list: string[]; points: number }): Promise<UniResponse<EventChallenges[]>>` | `UniResponse<JeopardyEventChallenges[]>` | `PATCH /api/admin/events/{event_id}/challenges` | 批量设置分值（两字段均**必填**） | `admin/event_challenges.ts:37` |
| `remove` | `remove(event_id: string) => (id_list: string[]) => Promise<UniResponse<number>>` | **柯里化** | `DELETE /api/admin/events/{event_id}/challenges`（body `{ id_list }`）；内部有 `console.log(id_list)`（`admin/event_challenges.ts:54`） | 取消挂题 | `admin/event_challenges.ts:52` |
| `open` | `open({ event_id, challenge_id_list, challenge_id }: { event_id: string; challenge_id_list?: string[]; challenge_id?: string }): Promise<UniResponse<EventChallenges[]>>` | `UniResponse<JeopardyEventChallenges[]>` | `POST /api/admin/events/{event_id}/challenges/open` | 开放题目 | `admin/event_challenges.ts:64` |
| `hidden` | `hidden({ event_id, challenge_id_list, challenge_id }: { event_id: string; challenge_id_list?: string[]; challenge_id?: string }): Promise<UniResponse<EventChallenges[]>>` | `UniResponse<JeopardyEventChallenges[]>` | `POST /api/admin/events/{event_id}/challenges/hidden` | 隐藏题目 | `admin/event_challenges.ts:82` |

#### 2.2.10 `client.admin.event_users` — `admin/event_users.ts`

| 方法 | 精确调用签名 | 返回（声明） | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(event_id: string) => (params: QueryParams = {}) => Promise<UniResponse<EventUserResult[]>>` | **柯里化** | `GET /api/admin/events/{event_id}/users` | 赛事参与者列表 | `admin/event_users.ts:7` |
| `add` | `add({ event_id, user_id, user_id_list }: { event_id: string; user_id?: string; user_id_list?: string[] }): Promise<UniResponse<null>>` | 声明为 `UniResponse<null>`，**运行时是 AxiosResponse**（见 §5.1） | `POST /api/admin/events/{event_id}/users`（body `{ user_id, user_id_list }`） | 加人（单人或批量） | `admin/event_users.ts:17` |
| `delete` | `delete(event_id: string) => (id_list: string[]) => Promise<UniResponse<number>>` | **柯里化** | `DELETE /api/admin/events/{event_id}/users`（body `{ id_list }`） | 移除参与者 | `admin/event_users.ts:31` |
| `banned` | `banned({ event_id, user_id }: { event_id: string; user_id: string }): Promise<UniResponse<EventUserResult>>` | `UniResponse<EventUserResult>` | `POST /api/admin/events/{event_id}/users/{user_id}/banned` | 封禁用户 | `admin/event_users.ts:39` |
| `unbanned` | `unbanned({ event_id, user_id }: { event_id: string; user_id: string }): Promise<UniResponse<EventUserResult>>` | `UniResponse<EventUserResult>` | `POST /api/admin/events/{event_id}/users/{user_id}/unbanned` | 解封用户 | `admin/event_users.ts:51` |

#### 2.2.11 `client.admin.event_announcements` — `admin/event_announcements.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(event_id: string) => (params: QueryParams = {}) => Promise<UniResponse<EventAnnouncements[]>>` | **柯里化** | `GET /api/admin/events/{event_id}/announcements` | 赛事公告列表 | `admin/event_announcements.ts:7` |
| `create` | `create(event_id: string) => (announcement: Partial<EventAnnouncements>) => Promise<any>` | 返回类型未标注 | `POST /api/admin/events/{event_id}/announcements` | 发赛事公告 | `admin/event_announcements.ts:21` |
| `patch` | `patch(event_id: string) => (announcement: Partial<EventAnnouncements>) => Promise<any>` | 返回类型未标注 | `PATCH /api/admin/events/{event_id}/announcements/${announcement.id}` | 改公告；**`announcement.id` 必填** | `admin/event_announcements.ts:30` |
| `remove` | `remove(event_id: string) => (id_list: string[]) => Promise<any>` | 返回类型未标注 | `DELETE /api/admin/events/{event_id}/announcements`（body `{ id_list }`） | 批量删除公告 | `admin/event_announcements.ts:39` |

#### 2.2.12 `client.admin.event_logs` — `admin/event_logs.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(event_id: string) => (params: QueryParams = {}) => Promise<UniResponse<EventLogs[]>>` | **柯里化** | `GET /api/admin/events/{event_id}/logs` | 赛事操作日志 | `admin/event_logs.ts:7` |

#### 2.2.13 `client.admin.event_writeups` — `admin/event_writeups.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(event_id: string) => (params: QueryParams = {}) => Promise<UniResponse<EventWriteup[]>>` | **柯里化** | `GET /api/admin/events/{event_id}/writeups` | 赛事 Writeup 提交记录 | `admin/event_writeups.ts:7` |

#### 2.2.14 `client.admin.event_teams` — `admin/event_teams.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `getTeams` | `getTeams(id: string) => (): Promise<UniResponse<TeamResult[]>>` | **柯里化**（第二层无参数） | `GET /api/admin/events/{id}/teams` | 战队列表 | `admin/event_teams.ts:7` |
| `remove` | `remove(id: string) => (id_list: string[]): Promise<UniResponse<number>>` | **柯里化** | `DELETE /api/admin/events/{id}/teams`（body `{ id_list }`） | 批量删战队 | `admin/event_teams.ts:13` |
| `banned` | `banned({ event_id, team_id }: { event_id: string; team_id: string }): Promise<any>` | 返回类型未标注 | `POST /api/admin/events/{event_id}/teams/{team_id}/banned` | 封禁战队 | `admin/event_teams.ts:21` |
| `unbanned` | `unbanned({ event_id, team_id }: { event_id: string; team_id: string }): Promise<any>` | 返回类型未标注 | `POST /api/admin/events/{event_id}/teams/{team_id}/unbanned` | 解封战队 | `admin/event_teams.ts:33` |

#### 2.2.15 `client.admin.database` — `admin/database.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `exec_sql` | `exec_sql({ sql }: SqlStatement): Promise<UniResponse<SqlResult>>` | `UniResponse<SqlResult>` | `POST /api/admin/database/exec_sql`（body `{ sql }`） | SQL 控制台执行单条语句 | `admin/database.ts:7` |

#### 2.2.16 `client.admin.scheduled_tasks` — `admin/scheduled_tasks.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<ScheduledTasks[]>>` | `UniResponse<ScheduledTasks[]>` | `GET /api/admin/scheduled_tasks` | 定时任务列表 | `admin/scheduled_tasks.ts:7` |
| `create` | `create(task: Partial<ScheduledTasks>): Promise<UniResponse<ScheduledTasks>>` | `UniResponse<ScheduledTasks>` | `POST /api/admin/scheduled_tasks` | 新建任务 | `admin/scheduled_tasks.ts:13` |
| `patch` | `patch(task: Partial<ScheduledTasks>): Promise<UniResponse<ScheduledTasks>>` | `UniResponse<ScheduledTasks>` | `PATCH /api/admin/scheduled_tasks/${task.id}` | 改任务；**`task.id` 必填** | `admin/scheduled_tasks.ts:19` |
| `remove` | `remove(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/admin/scheduled_tasks`（body `{ id_list }`） | 批量删除 | `admin/scheduled_tasks.ts:25` |
| `run` | `run(task_id: string): Promise<UniResponse<ScheduledTasks>>` | `UniResponse<ScheduledTasks>` | `POST /api/admin/scheduled_tasks/${task_id}/run` | 立即执行一次 | `admin/scheduled_tasks.ts:31` |

#### 2.2.17 `client.admin.weapons` — `admin/weapons.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<Weapons[]>>` | `UniResponse<Weapons[]>` | `GET /api/admin/weapons` | 武器库列表 | `admin/weapons.ts:7` |
| `create` | `create(weapon: Partial<Weapons>): Promise<UniResponse<Weapons>>` | `UniResponse<Weapons>` | `POST /api/admin/weapons` | 新建武器 | `admin/weapons.ts:13` |
| `patch` | `patch(weapon: Partial<Weapons>): Promise<UniResponse<Weapons>>` | `UniResponse<Weapons>` | `PATCH /api/admin/weapons/${weapon.id}` | 改武器；**`weapon.id` 必填** | `admin/weapons.ts:17` |
| `remove` | `remove(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/admin/weapons`（body `{ id_list }`） | 批量删除 | `admin/weapons.ts:21` |
| `upload` | `upload(weapon_id: string, weapon: File): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/weapons/{weapon_id}/upload`（multipart 字段 `weapon`）；**位置参数** | 上传武器文件 | `admin/weapons.ts:25` |

#### 2.2.18 `client.admin.logs` — `admin/logs.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<Logs[]>>` | `UniResponse<Logs[]>` | `GET /api/admin/logs`（`/logs`） | 平台审计日志 | `admin/logs.ts:7` |

#### 2.2.19 `client.admin.download` — `admin/download.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `download` | `download(key: string): Promise<void>` | `Promise<void>`（**不是 `UniResponse`**） | `GET /api/admin/download?key={key}` → 取 `res.data.data` 的预签名 URL → `fetch(url)` → 触发浏览器另存 | 下载对象（Writeup/附件）；内部使用 `document.createElement("a")`，**仅浏览器可用**；HTTP 非 2xx 或 `Content-Type` 含 `xml`/`html` 时 `throw new Error(...)`（`admin/download.ts:12-19`） | `admin/download.ts:5` |

#### 2.2.20 `client.admin.discussions` — `admin/discussions.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<Discussions[]>>` | `UniResponse<Discussions[]>` | `GET /api/admin/discussions` | 讨论列表（**实体 `Discussions`，无作者字段**） | `admin/discussions.ts:7` |
| `get` | `get(id: string): Promise<UniResponse<Discussions>>` | `UniResponse<Discussions>` | `GET /api/admin/discussions/{id}` | 讨论详情 | `admin/discussions.ts:13` |
| `remove` | `remove(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/admin/discussions`（body `{ id_list }`） | 批量删除 | `admin/discussions.ts:17` |
| `getComments` | `getComments(id: string, params: QueryParams = {}): Promise<UniResponse<DiscussionComments[]>>` | `UniResponse<DiscussionComments[]>` | `GET /api/admin/discussions/{id}/comments` | 评论列表 | `admin/discussions.ts:23` |
| `removeComment` | `removeComment(discussion_id: string, comment_id: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `DELETE /api/admin/discussions/{discussion_id}/comments/{comment_id}` | 删评论 | `admin/discussions.ts:32` |

#### 2.2.21 `client.admin.dashboard` — `admin/dashboard.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `summary` | `summary(): Promise<UniResponse<DashboardSummary>>` | `UniResponse<DashboardSummary>` | `GET /api/admin/dashboard/summary`（`/dashboard/summary`） | 管理端总览所需的全部聚合数据 | `admin/dashboard.ts:66` |

#### 2.2.22 `client.admin.super_admin` — `admin/super_admin.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetch` | `fetch(params: QueryParams = {}): Promise<UniResponse<SuperAdmin[]>>` | `UniResponse<SuperAdmin[]>` | `GET /api/admin/super_admin` | 管理员账号列表 | `admin/super_admin.ts:7` |
| `create` | `create(data: Partial<SuperAdmin>): Promise<UniResponse<SuperAdmin>>` | `UniResponse<SuperAdmin>` | `POST /api/admin/super_admin` | 新建管理员 | `admin/super_admin.ts:13` |
| `remove` | `remove(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/admin/super_admin`（body `{ id_list }`） | 批量删除 | `admin/super_admin.ts:19` |
| `patch` | `patch(id: string, data: Partial<SuperAdmin>): Promise<UniResponse<SuperAdmin>>` | `UniResponse<SuperAdmin>` | `POST /api/admin/super_admin/${id}`（**源码用的是 POST，不是 PATCH**） | 改管理员；**位置参数 (id, data)** | `admin/super_admin.ts:25` |

#### 2.2.23 `client.admin.docker` — `admin/docker.ts`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `fetchContainers` | `fetchContainers(params: QueryParams = {}): Promise<UniResponse<FloatDockerContainer[]>>` | `UniResponse<FloatDockerContainer[]>` | `GET /api/admin/docker/containers` | 容器列表 | `admin/docker.ts:51` |
| `stopContainer` | `stopContainer(container_id: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/docker/containers/{container_id}/stop` | 停止容器 | `admin/docker.ts:57` |
| `startContainer` | `startContainer(container_id: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/docker/containers/{container_id}/start` | 启动容器 | `admin/docker.ts:61` |
| `deleteContainer` | `deleteContainer(container_id: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `DELETE /api/admin/docker/containers/{container_id}` | 删除容器 | `admin/docker.ts:67` |
| `fetchImages` | `fetchImages(params: QueryParams = {}): Promise<UniResponse<ImageInfo[]>>` | `UniResponse<ImageInfo[]>` | `GET /api/admin/docker/images` | 镜像列表 | `admin/docker.ts:71` |
| `deleteImage` | `deleteImage(image_id: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `DELETE /api/admin/docker/images/{image_id}` | 删除镜像 | `admin/docker.ts:77` |
| `fetchNetworks` | `fetchNetworks(params: QueryParams = {}): Promise<UniResponse<NetworkInfo[]>>` | `UniResponse<NetworkInfo[]>` | `GET /api/admin/docker/networks` | 网络列表 | `admin/docker.ts:81` |
| `createNetwork` | `createNetwork(network: { name: string; subnet: string; gateway: string; driver?: string }): Promise<UniResponse<NetworkInfo>>` | `UniResponse<NetworkInfo>` | `POST /api/admin/docker/networks` | 建网络（单对象参数，非位置参数） | `admin/docker.ts:87` |
| `deleteNetwork` | `deleteNetwork(network_id: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `DELETE /api/admin/docker/networks/{network_id}` | 删网络 | `admin/docker.ts:96` |

### 2.3 `client.awd.player.*`（= `client.service.awd`，base `/api`）— `awd.ts:572-623`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `status` | `status(eventId: string): Promise<UniResponse<AwdPlayerStatus>>` | `UniResponse<AwdPlayerStatus>` | `GET /api/events/{eventId}/awd/status`（`/events/${eventId}/awd/status`） | AWD 赛事状态（phase / round / ban / score） | `awd.ts:575` |
| `gameboxes` | `gameboxes(eventId: string): Promise<UniResponse<AwdGameBox[]>>` | `UniResponse<AwdGameBox[]>` | `GET /api/events/{eventId}/awd/gameboxes` | 我方 GameBox 列表 | `awd.ts:579` |
| `resetGamebox` | `resetGamebox(eventId: string, instanceId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/events/{eventId}/awd/gameboxes/{instanceId}/reset` | 重置我的 GameBox（消耗免费次数/罚款） | `awd.ts:583` |
| `submitFlag` | `submitFlag(eventId: string, flag: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/events/{eventId}/awd/submissions`（body `{ flag }`） | 提交攻击所得 flag | `awd.ts:592` |
| `scores` | `scores(eventId: string): Promise<UniResponse<AwdScoreRow[]>>` | `UniResponse<AwdScoreRow[]>` | `GET /api/events/{eventId}/awd/scores` | AWD 计分榜 | `awd.ts:601` |
| `wireguardConfig` | `wireguardConfig(eventId: string): Promise<UniResponse<WireGuardConfigResponse>>` | `UniResponse<WireGuardConfigResponse>` | `GET /api/events/{eventId}/awd/wireguard/config` | 下载 WireGuard 客户端配置文本 | `awd.ts:605` |
| `sshConfig` | `sshConfig(eventId: string): Promise<UniResponse<SshAccessResponse>>` | `UniResponse<SshAccessResponse>` | `GET /api/events/{eventId}/awd/ssh-config` | 队伍级 SSH 访问凭据（端口 / 密码 / 实例表） | `awd.ts:616` |

### 2.4 `client.awd.admin.*`（= `client.admin.awd`，base `/api/admin`）— `awd.ts:277-566`

> 顶层注释声明前缀：管理端 `/api/admin/events/{eventId}/awd/...`，创建用 `POST /api/admin/events/awd`（`awd.ts:1-5`）。

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `getStatus` | `getStatus(eventId: string): Promise<UniResponse<AwdEventStatus \| null>>` | `UniResponse<AwdEventStatus \| null>` | `GET /api/admin/events/{eventId}/awd` | AWD 生命周期状态；未配置时 `data` 为 `null` | `awd.ts:279` |
| `createEvent` | `createEvent(body: AwdEventConfigInput & { event_id: string }): Promise<UniResponse<string>>` | `UniResponse<string>` | `POST /api/admin/events/awd`（body 含 `event_id`，**路径里没有 eventId**） | 为赛事开启 AWD | `awd.ts:285` |
| `updateConfig` | `updateConfig(eventId: string, body: AwdEventConfigInput): Promise<UniResponse<AwdEventStatus>>` | `UniResponse<AwdEventStatus>` | `PATCH /api/admin/events/{eventId}/awd` | 改 AWD 配置（**乐观锁：body 可带 `expected_updated_at`**） | `awd.ts:291` |
| `deploy` | `deploy(eventId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awd/deploy` | 部署 AWD 网络与容器 | `awd.ts:298` |
| `start` | `start(eventId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awd/start` | 开始比赛 | `awd.ts:302` |
| `pause` | `pause(eventId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awd/pause` | 暂停 | `awd.ts:306` |
| `resume` | `resume(eventId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awd/resume` | 恢复 | `awd.ts:310` |
| `finish` | `finish(eventId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awd/finish` | 结束比赛 | `awd.ts:314` |
| `precheck` | `precheck(eventId: string): Promise<UniResponse<string>>` | `UniResponse<string>` | `POST /api/admin/events/{eventId}/awd/precheck` | 触发预检 | `awd.ts:318` |
| `prechecks` | `prechecks(eventId: string): Promise<UniResponse<AwdPrecheckRun[]>>` | `UniResponse<AwdPrecheckRun[]>` | `GET /api/admin/events/{eventId}/awd/prechecks` | 预检历史（`error_msg` 是 JSON 文本） | `awd.ts:323` |
| `scores` | `scores(eventId: string): Promise<UniResponse<AwdScoreRow[]>>` | `UniResponse<AwdScoreRow[]>` | `GET /api/admin/events/{eventId}/awd/scores` | AWD 计分榜 | `awd.ts:329` |
| `archive` | `archive(eventId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awd/archive` | 归档赛事数据 | `awd.ts:333` |
| `resetGamebox` | `resetGamebox(eventId: string, instanceId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awd/gameboxes/{instanceId}/reset` | 管理员重置任意 GameBox | `awd.ts:337` |
| `banTeam` | `banTeam(eventId: string, teamId: string, body: { reason?: string }): Promise<UniResponse<string>>` | `UniResponse<string>` | `POST /api/admin/events/{eventId}/awd/teams/{teamId}/ban`（body `{ reason }`） | 手动封禁队伍（需手动解封） | `awd.ts:347` |
| `unbanTeam` | `unbanTeam(eventId: string, teamId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `DELETE /api/admin/events/{eventId}/awd/teams/{teamId}/ban` | 解封队伍（**无 body**） | `awd.ts:361` |
| `rotateTokens` | `rotateTokens(eventId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awd/tokens/rotate` | 轮换内部 token | `awd.ts:371` |
| `adjustScore` | `adjustScore(eventId: string, body: { team_id: string; delta: number; reason: string }): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awd/score/adjust` | 分数调整（审计） | `awd.ts:376` |
| `listGameboxes` | `listGameboxes(params: QueryParams = {}): Promise<UniResponse<GameBoxLibraryDto[]>>` | `UniResponse<GameBoxLibraryDto[]>` | `GET /api/admin/awd/gameboxes`（**平台级，无 eventId**） | GameBox 库列表 | `awd.ts:387` |
| `importGamebox` | `importGamebox(file: File \| Blob): Promise<UniResponse<ImportGameBoxResponse>>` | `UniResponse<ImportGameBoxResponse>` | `POST /api/admin/awd/gameboxes/import`（multipart 字段 `package_zip`） | 导入 GameBox 包（同步构建） | `awd.ts:394` |
| `updateGamebox` | `updateGamebox(gameboxId: string, body: { name?: string; category?: string; description?: string; hidden?: boolean; username?: string \| null; recommended_cpu_millis?: number \| null; recommended_memory_bytes?: number \| null; recommended_pids_limit?: number \| null; healthchecks_json?: string \| null; judge_script_name?: string \| null; judge_script_content?: string \| null; judge_args_json?: string \| null; judge_timeout_secs?: number \| null; judge_retry_interval_secs?: number \| null }): Promise<UniResponse<GameBoxLibraryDto>>` | `UniResponse<GameBoxLibraryDto>` | `PATCH /api/admin/awd/gameboxes/{gameboxId}` | 改 GameBox 库条目（`healthchecks_json` / `judge_args_json` 是 **JSON 文本**，`null` 清空） | `awd.ts:404` |
| `hideGamebox` | `hideGamebox(gameboxId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/awd/gameboxes/{gameboxId}/hide` | 隐藏 GameBox | `awd.ts:428` |
| `removeGamebox` | `removeGamebox(id_list: string[]): Promise<UniResponse<number>>` | `UniResponse<number>` | `DELETE /api/admin/awd/gameboxes`（body `{ id_list }`） | 批量删除（仅未被引用者可删） | `awd.ts:433` |
| `scanGameboxes` | `scanGameboxes(): Promise<UniResponse<GameBoxScanItem[]>>` | `UniResponse<GameBoxScanItem[]>` | `POST /api/admin/awd/gameboxes/scan` | 扫描 GameBox 目录 | `awd.ts:439` |
| `checkGameboxes` | `checkGameboxes(gamebox_id_list?: string[]): Promise<UniResponse<GameBoxCheckResult[]>>` | `UniResponse<GameBoxCheckResult[]>` | `POST /api/admin/awd/gameboxes/check`（body `{ gamebox_id_list }`） | 完整性检查 | `awd.ts:443` |
| `buildGameboxes` | `buildGameboxes(gamebox_id_list?: string[]): Promise<UniResponse<GameBoxBuildResult[]>>` | `UniResponse<GameBoxBuildResult[]>` | `POST /api/admin/awd/gameboxes/build`（body `{ gamebox_id_list }`） | 构建镜像 | `awd.ts:451` |
| `getPlatformNetwork` | `getPlatformNetwork(): Promise<UniResponse<PlatformNetworkSettings>>` | `UniResponse<PlatformNetworkSettings>` | `GET /api/admin/awd/network` | 平台网络设置 + 容量预览 | `awd.ts:460` |
| `updatePlatformNetwork` | `updatePlatformNetwork(body: PlatformNetworkSettingsUpdate): Promise<UniResponse<PlatformNetworkSettingsUpdateResponse>>` | `UniResponse<PlatformNetworkSettingsUpdateResponse>` | `PATCH /api/admin/awd/network` | 部分更新平台网络设置 | `awd.ts:466` |
| `getPlatformNetworkHealth` | `getPlatformNetworkHealth(): Promise<UniResponse<PlatformNetworkHealth>>` | `UniResponse<PlatformNetworkHealth>` | `GET /api/admin/awd/network/health` | Host 观测状态（只读） | `awd.ts:473` |
| `getPlatformNetworkAllocations` | `getPlatformNetworkAllocations(): Promise<UniResponse<PlatformNetworkAllocation[]>>` | `UniResponse<PlatformNetworkAllocation[]>` | `GET /api/admin/awd/network/allocations` | 平台分配账本（只读） | `awd.ts:480` |
| `getEventNetwork` | `getEventNetwork(eventId: string): Promise<UniResponse<EventNetworkInfo>>` | `UniResponse<EventNetworkInfo>` | `GET /api/admin/events/{eventId}/awd/network`（**未分配时后端返回 404**，会 reject） | 赛事网络信息 | `awd.ts:488` |
| `allocateEventNetwork` | `allocateEventNetwork(eventId: string, body: NetworkAllocationRequest): Promise<UniResponse<null>>` | `UniResponse<null>` | `PUT /api/admin/events/{eventId}/awd/network` | 分配赛事网络（`automatic` 默认；`manual` 需两个 CIDR） | `awd.ts:495` |
| `reallocateEventNetwork` | `reallocateEventNetwork(eventId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awd/network/reallocate` | 重新分配（仅未锁定） | `awd.ts:503` |
| `listEventGameboxes` | `listEventGameboxes(eventId: string, params: QueryParams = {}): Promise<UniResponse<EventGameBoxDto[]>>` | `UniResponse<EventGameBoxDto[]>` | `GET /api/admin/events/{eventId}/awd/gameboxes` | 赛事已选 GameBox 列表 | `awd.ts:512` |
| `addEventGamebox` | `addEventGamebox(eventId: string, body: { gamebox_id: string; host_offset?: number; hidden?: boolean; attack_score?: number; judge_down_penalty?: number; first_bonus?: number }): Promise<UniResponse<EventGameBoxDto>>` | `UniResponse<EventGameBoxDto>` | `POST /api/admin/events/{eventId}/awd/gameboxes` | 把 GameBox 加入赛事 | `awd.ts:521` |
| `updateEventGamebox` | `updateEventGamebox(eventId: string, eventGameboxId: string, body: { enabled?: boolean; hidden?: boolean; cpu_millis?: number; memory_bytes?: number; pids_limit?: number; judge_timeout_secs?: number \| null; judge_retry_interval_secs?: number \| null; attack_score?: number; judge_down_penalty?: number; first_bonus?: number }): Promise<UniResponse<EventGameBoxDto>>` | `UniResponse<EventGameBoxDto>` | `PATCH /api/admin/events/{eventId}/awd/gameboxes/{eventGameboxId}` | 改赛事内 GameBox 配置 | `awd.ts:535` |
| `removeEventGamebox` | `removeEventGamebox(eventId: string, eventGameboxId: string): Promise<UniResponse<null>>` | `UniResponse<null>` | `DELETE /api/admin/events/{eventId}/awd/gameboxes/{eventGameboxId}` | 从赛事移除 GameBox | `awd.ts:557` |

### 2.5 `client.awdp.player.*`（base `/api`）— `awdp.ts:344-437`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `overview` | `overview(eventId: string)` → `Promise<UniResponse<AwdpOverview>>` | `UniResponse<AwdpOverview>` | `GET /api/events/{eventId}/awdp` | AWDP 总览（phase / 各阶段时间 / 我的分 / GameBox 列表） | `awdp.ts:346` |
| `startInstance` | `startInstance(eventId: string, egId: string)` → `Promise<UniResponse<AwdpInstance>>` | `UniResponse<AwdpInstance>` | `POST /api/events/{eventId}/awdp/gameboxes/{egId}/instance` | 启动某 GameBox 实例 | `awdp.ts:352` |
| `stopInstance` | `stopInstance(eventId: string, egId: string)` → `Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/events/{eventId}/awdp/gameboxes/{egId}/instance/stop` | 停止实例 | `awdp.ts:358` |
| `resetInstance` | `resetInstance(eventId: string, egId: string)` → `Promise<UniResponse<AwdpInstance>>` | `UniResponse<AwdpInstance>` | `POST /api/events/{eventId}/awdp/gameboxes/{egId}/instance/reset` | 重置实例 | `awdp.ts:364` |
| `getInstance` | `getInstance(eventId: string, egId: string)` → `Promise<UniResponse<AwdpInstance \| null>>` | `UniResponse<AwdpInstance \| null>` | `GET /api/events/{eventId}/awdp/gameboxes/{egId}/instance` | 查实例；无实例时 `data` 为 `null` | `awdp.ts:370` |
| `submitBreak` | `submitBreak(eventId: string, egId: string, flag: string)` → `Promise<UniResponse<BreakSubmitResponse>>` | `UniResponse<BreakSubmitResponse>` | `POST /api/events/{eventId}/awdp/gameboxes/{egId}/break`（body `{ flag }`） | 提交 Break flag；**位置参数** | `awdp.ts:376` |
| `uploadPatch` | `uploadPatch(eventId: string, egId: string, file: File)` → `Promise<UniResponse<PatchSubmitResponse>>` | `UniResponse<PatchSubmitResponse>` | `POST /api/events/{eventId}/awdp/gameboxes/{egId}/patch`（multipart 字段 `patch_file`，**未显式设置 Content-Type**，由 axios 自动带 boundary） | 上传修复补丁；**位置参数** | `awdp.ts:385` |
| `testCheck` | `testCheck(eventId: string, egId: string)` → `Promise<UniResponse<ManualCheckDto>>` | `UniResponse<ManualCheckDto>` | `POST /api/events/{eventId}/awdp/gameboxes/{egId}/test-check` | 手动 Test Check | `awdp.ts:394` |
| `sourceUrl` | `sourceUrl(eventId: string, egId: string)` → `Promise<UniResponse<string>>` | `UniResponse<string>`（预签名 URL 字符串，**不是对象**） | `GET /api/events/{eventId}/awdp/gameboxes/{egId}/source` | 源码下载地址 | `awdp.ts:400` |
| `rounds` | `rounds(eventId: string)` → `Promise<UniResponse<AwdpRoundDto[]>>` | `UniResponse<AwdpRoundDto[]>` | `GET /api/events/{eventId}/awdp/rounds` | 回合列表 | `awdp.ts:406` |
| `evaluations` | `evaluations(eventId: string)` → `Promise<UniResponse<AwdpEvaluationDto[]>>` | `UniResponse<AwdpEvaluationDto[]>` | `GET /api/events/{eventId}/awdp/evaluations` | 评估记录 | `awdp.ts:412` |
| `scores` | `scores(eventId: string)` → `Promise<UniResponse<AwdpScoreRow[]>>` | `UniResponse<AwdpScoreRow[]>` | `GET /api/events/{eventId}/awdp/scores` | 聚合积分榜 | `awdp.ts:418` |
| `scoreboard` | `scoreboard(eventId: string)` → `Promise<UniResponse<AwdpScoreboardDetail>>` | `UniResponse<AwdpScoreboardDetail>` | `GET /api/events/{eventId}/awdp/scoreboard` | 积分榜明细矩阵 | `awdp.ts:424` |
| `trend` | `trend(eventId: string)` → `Promise<UniResponse<AwdpTrendItem[]>>` | `UniResponse<AwdpTrendItem[]>` | `GET /api/events/{eventId}/awdp/trend` | 得分趋势 | `awdp.ts:430` |

### 2.6 `client.awdp.admin.*`（base `/api/admin`）— `awdp.ts:257-336`

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `getConfig` | `getConfig(eventId: string)` → `Promise<UniResponse<AwdpEventConfigDto>>` | `UniResponse<AwdpEventConfigDto>` | `GET /api/admin/events/{eventId}/awdp` | 赛事 AWDP 配置 | `awdp.ts:259` |
| `updateConfig` | `updateConfig(eventId: string, body: AwdpConfigPatchInput)` → `Promise<UniResponse<AwdpEventConfigDto>>` | `UniResponse<AwdpEventConfigDto>` | `PATCH /api/admin/events/{eventId}/awdp` | 改配置（**乐观锁 `expected_updated_at`**） | `awdp.ts:265` |
| `start` | `start(eventId: string)` → `Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awdp/start` | 开始 AWDP | `awdp.ts:272` |
| `breakToFix` | `breakToFix(eventId: string)` → `Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awdp/break-to-fix` | 手动从 Break 进入 Fix | `awdp.ts:278` |
| `finish` | `finish(eventId: string)` → `Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/admin/events/{eventId}/awdp/finish` | 结束 AWDP | `awdp.ts:284` |
| `attachGamebox` | `attachGamebox(eventId: string, gameboxId: string, hidden?: boolean)` → `Promise<UniResponse<AwdpAdminEventGameBoxDto>>` | `UniResponse<AwdpAdminEventGameBoxDto>` | `POST /api/admin/events/{eventId}/awdp/gameboxes`（body `{ gamebox_id, hidden }`） | 挂载 GameBox；**第 3 个参数是可选位置参数** | `awdp.ts:290` |
| `detachGamebox` | `detachGamebox(eventId: string, egId: string)` → `Promise<UniResponse<null>>` | `UniResponse<null>` | `DELETE /api/admin/events/{eventId}/awdp/gameboxes/{egId}` | 卸载 GameBox | `awdp.ts:304` |
| `listEventGameboxes` | `listEventGameboxes(eventId: string, params?: QueryParams)` → `Promise<UniResponse<AwdpAdminEventGameBoxDto[]>>` | `UniResponse<AwdpAdminEventGameBoxDto[]>` | `GET /api/admin/events/{eventId}/awdp/gameboxes` | 赛事 GameBox 列表 | `awdp.ts:310` |
| `listInstances` | `listInstances(eventId: string)` → `Promise<UniResponse<AwdpAdminInstanceDto[]>>` | `UniResponse<AwdpAdminInstanceDto[]>` | `GET /api/admin/events/{eventId}/awdp/instances` | 赛事实例列表 | `awdp.ts:317` |
| `scores` | `scores(eventId: string)` → `Promise<UniResponse<AwdpScoreRow[]>>` | `UniResponse<AwdpScoreRow[]>` | `GET /api/admin/events/{eventId}/awdp/scores` | 计分榜 | `awdp.ts:323` |
| `dataPresent` | `dataPresent(eventId: string)` → `Promise<UniResponse<AwdpDataPresent>>` | `UniResponse<AwdpDataPresent>` | `GET /api/admin/events/{eventId}/awdp/data` | 管理端大屏聚合 | `awdp.ts:329` |

### 2.7 `client.awdp.runs.*`（base **`/api`（选手端）**，URL 自带 `/service` 前缀）— `awdpRuns.ts:160-316`

> 文件头逐条列出了契约路径（`awdpRuns.ts:16-31`）。URL 字面量都是 `/service/...`，经选手端 base（默认 `/api`）解析后为 `/api/service/...`。

| 方法 | 精确调用签名 | 返回 | 后端 | 语义 | 源码 |
|---|---|---|---|---|---|
| `gameboxCatalog` | `gameboxCatalog(params?: QueryParams)` → `Promise<UniResponse<GameBoxCatalogDto[]>>` | `UniResponse<GameBoxCatalogDto[]>` | `GET /api/service/gameboxes`（`/service/gameboxes`；**强制合并 `capability: "awdp"`**，调用方同名参数会被覆盖） | AWDP 练习目录 | `awdpRuns.ts:163` |
| `startTraining` | `startTraining(gameboxId: string)` → `Promise<UniResponse<AwdpRunDto>>` | `UniResponse<AwdpRunDto>` | `POST /api/service/gameboxes/{gameboxId}/awdp/runs` | 开始训练（创建 run） | `awdpRuns.ts:170` |
| `getRun` | `getRun(runId: string)` → `Promise<UniResponse<AwdpRunDto>>` | `UniResponse<AwdpRunDto>` | `GET /api/service/awdp/runs/{runId}` | run 详情 | `awdpRuns.ts:178` |
| `stopRun` | `stopRun(runId: string)` → `Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/service/awdp/runs/{runId}/stop` | 停止 run | `awdpRuns.ts:184` |
| `resetRun` | `resetRun(runId: string)` → `Promise<UniResponse<AwdpRunDto>>` | `UniResponse<AwdpRunDto>` | `POST /api/service/awdp/runs/{runId}/reset` | 重置 run | `awdpRuns.ts:190` |
| `startRun` | `startRun(runId: string)` → `Promise<UniResponse<AwdpRunDto>>` | `UniResponse<AwdpRunDto>` | `POST /api/service/awdp/runs/{runId}/start` | 练习「开始」：回卷 Break + 启动实例 | `awdpRuns.ts:197` |
| `endRun` | `endRun(runId: string)` → `Promise<UniResponse<AwdpRunDto>>` | `UniResponse<AwdpRunDto>` | `POST /api/service/awdp/runs/{runId}/end` | 练习「End」：停实例、清零、回冻结 Break | `awdpRuns.ts:204` |
| `setPhase` | `setPhase(runId: string, phase: "break" \| "fix")` → `Promise<UniResponse<AwdpRunDto>>` | `UniResponse<AwdpRunDto>` | `POST /api/service/awdp/runs/{runId}/phase`（body `{ phase }`） | 手动切换阶段（**只允许这两个字面量**） | `awdpRuns.ts:210` |
| `restartTraining` | `restartTraining(runId: string)` → `Promise<UniResponse<AwdpRunDto>>` | `UniResponse<AwdpRunDto>` | `POST /api/service/awdp/runs/{runId}/restart-training` | 重新开始训练 | `awdpRuns.ts:218` |
| `rounds` | `rounds(runId: string)` → `Promise<UniResponse<AwdpRoundDto[]>>` | `UniResponse<AwdpRoundDto[]>` | `GET /api/service/awdp/runs/{runId}/rounds` | 回合列表 | `awdpRuns.ts:224` |
| `evaluations` | `evaluations(runId: string)` → `Promise<UniResponse<AwdpRunEvaluationDto[]>>` | `UniResponse<AwdpRunEvaluationDto[]>` | `GET /api/service/awdp/runs/{runId}/evaluations` | 评估列表 | `awdpRuns.ts:230` |
| `scores` | `scores(runId: string)` → `Promise<UniResponse<AwdpRunScoresDto>>` | `UniResponse<AwdpRunScoresDto>` | `GET /api/service/awdp/runs/{runId}/scores` | 总分 + 计分明细 | `awdpRuns.ts:236` |
| `getWriteup` | `getWriteup(runId: string)` → `Promise<UniResponse<AwdpRunWriteupDto>>` | `UniResponse<AwdpRunWriteupDto>` | `GET /api/service/awdp/runs/{runId}/writeup` | 我的 run Writeup | `awdpRuns.ts:242` |
| `saveWriteup` | `saveWriteup(runId: string, content: string)` → `Promise<UniResponse<AwdpRunWriteupDto>>` | `UniResponse<AwdpRunWriteupDto>` | `PUT /api/service/awdp/runs/{runId}/writeup`（body `{ content }`） | 保存 run Writeup | `awdpRuns.ts:248` |
| `submitBreak` | `submitBreak(runId: string, gameboxId: string, flag: string)` → `Promise<UniResponse<BreakSubmitResponse>>` | `UniResponse<BreakSubmitResponse>` | `POST /api/service/awdp/runs/{runId}/gameboxes/{gameboxId}/break`（body `{ flag }`） | 提交 Break flag；**位置参数** | `awdpRuns.ts:257` |
| `uploadPatch` | `uploadPatch(runId: string, gameboxId: string, file: File)` → `Promise<UniResponse<PatchSubmitResponse>>` | `UniResponse<PatchSubmitResponse>` | `POST /api/service/awdp/runs/{runId}/gameboxes/{gameboxId}/patch`（multipart 字段 `patch_file`） | 上传补丁 | `awdpRuns.ts:264` |
| `testCheck` | `testCheck(runId: string, gameboxId: string)` → `Promise<UniResponse<ManualCheckDto>>` | `UniResponse<ManualCheckDto>` | `POST /api/service/awdp/runs/{runId}/gameboxes/{gameboxId}/test-check` | 手动检查 | `awdpRuns.ts:273` |
| `allCheck` | `allCheck(runId: string, gameboxId: string)` → `Promise<UniResponse<AllCheckDto>>` | `UniResponse<AllCheckDto>` | `POST /api/service/awdp/runs/{runId}/gameboxes/{gameboxId}/all-check` | 一键官方判定；成功 → 剩余回合计分 + run 结束 | `awdpRuns.ts:280` |
| `sourceUrl` | `sourceUrl(runId: string, gameboxId: string)` → `Promise<UniResponse<string>>` | `UniResponse<string>` | `GET /api/service/awdp/runs/{runId}/gameboxes/{gameboxId}/source` | 源码地址 | `awdpRuns.ts:286` |
| `startInstance` | `startInstance(runId: string, gameboxId: string)` → `Promise<UniResponse<AwdpInstance>>` | `UniResponse<AwdpInstance>` | `POST /api/service/awdp/runs/{runId}/gameboxes/{gameboxId}/instance` | 启动实例 | `awdpRuns.ts:292` |
| `stopInstance` | `stopInstance(runId: string, gameboxId: string)` → `Promise<UniResponse<null>>` | `UniResponse<null>` | `POST /api/service/awdp/runs/{runId}/gameboxes/{gameboxId}/instance/stop` | 停止实例 | `awdpRuns.ts:298` |
| `resetInstance` | `resetInstance(runId: string, gameboxId: string)` → `Promise<UniResponse<AwdpInstance>>` | `UniResponse<AwdpInstance>` | `POST /api/service/awdp/runs/{runId}/gameboxes/{gameboxId}/instance/reset` | 重置实例 | `awdpRuns.ts:304` |
| `getInstance` | `getInstance(runId: string, gameboxId: string)` → `Promise<UniResponse<AwdpInstance \| null>>` | `UniResponse<AwdpInstance \| null>` | `GET /api/service/awdp/runs/{runId}/gameboxes/{gameboxId}/instance` | 查实例 | `awdpRuns.ts:310` |

### 2.8 方法计数（本节口径）

| 分组 | 方法数 | 来源 |
|---|---|---|
| `client.service.*` | 56 | 10 个 service 模块（不含 `service.awd`，它归 AWD 组） |
| `client.admin.*` | 93 | 22 个 admin 模块（含 `login`），不含 `admin.awd` |
| `client.awd.player.*` | 7 | `awd.ts:572-623` |
| `client.awd.admin.*` | 36 | `awd.ts:277-566` |
| `client.awdp.player.*` | 14 | `awdp.ts:344-437` |
| `client.awdp.admin.*` | 11 | `awdp.ts:257-336` |
| `client.awdp.runs.*` | 23 | `awdpRuns.ts:160-316` |
| **合计（唯一方法路径）** | **240** | 见 §6 核对命令 |

> `client.service.awd` 与 `client.awd.player` 是同一对象（`client.ts:159`），`client.admin.awd` 与 `client.awd.admin` 也是同一对象（`client.ts:160`），上表只计一次。

---

## 3. DTO 字段表

所有字段名/类型均逐字摘自源码。`` `?` `` 表示该字段在源码中带 `?`（TypeScript 可选）。

### 3.1 协议 / 传输 / 错误类型

| 类型 | 定义处 | 字段 |
|---|---|---|
| `QueryParams` | `protocol.ts:15-21` | `offset?: number`、`limit?: number`、`page?: number`、`total?: number`、`filter?: string` |
| `UniResponse<T>` | `protocol.ts:24-29` | `code: number`、`message: string`、`data?: T`、`meta?: QueryParams` |
| `FloatCTFAuthScope` | `transport.ts:41` | `"user" \| "admin"` |
| `UnauthorizedContext` | `transport.ts:46-50` | `scope: FloatCTFAuthScope`、`status: number`、`error: FloatCTFError` |
| `FloatCTFRequestConfig` | `transport.ts:58` | `Omit<AxiosRequestConfig, "baseURL">` |
| `FloatCTFClientOptions` | `transport.ts:60-78` | 见 §0.1 |
| `FloatCTFHttpClient` | `transport.ts:86-117` | `get` / `delete` / `post` / `put` / `patch`（泛型签名见 §1.5）、`readonly instance: AxiosInstance` |
| `FloatCTFTransport` | `transport.ts:120-128` | `scope: FloatCTFAuthScope`、`baseUrl: string`、`instance: AxiosInstance`、`http: FloatCTFHttpClient` |
| `FloatCTFErrorKind` | `errors.ts:17-25` | `"http" \| "platform" \| "network" \| "unknown"` |
| `FloatCTFErrorResponse` | `errors.ts:28-33` | `status?: number`、`statusText?: string`、`data?: unknown`、`headers?: unknown` |
| `FloatCTFError` | `errors.ts:35-87` | 见 §1.4 |
| `FloatCTFClient` | `client.ts:69-103` | 见 §0.1 |
| `FloatCTFSseOptions` | `client.ts:62-67` | `Omit<ConnectSseOptions, "url" \| "getToken"> & { url: string; getToken?: () => string \| null }` |

### 3.2 题目 / 赛事 / 榜单（Jeopardy）

| 类型 | 定义处 | 字段（逐字） | 语义 |
|---|---|---|---|
| `ChallengeAttachmentDto` | `types/challengeDto.ts:4-8` | `name: string`、`path: string`、`size?: number` | API 返回的附件元数据（不含 flag） |
| `ChallengesListItem` | `types/challengeDto.ts:16-30` | `Omit<Challenges, "container_port"> & { version?: string; author?: string; solved?: boolean; build_status?: string; image_ref?: string; attachment?: ChallengeAttachmentDto; container_port?: number \| null; recommended_cpu_millis?: number; recommended_memory_bytes?: number; recommended_pids_limit?: number; static_flag_value?: string \| null }` | 题目列表/详情 DTO；`static_flag_value` 仅 admin 返回（secret） |
| `EventInfo` | `types/eventInfo.ts:16-21` | `id: string`、`event: Events`、`team_result?: EventTeamResult`、`joined: boolean` | 选手端赛事条目（**赛事字段在 `.event` 下**） |
| `EventTeamResult` | `types/eventInfo.ts:10-13` | `team: EventTeams`、`members: EventTeamMemberResult[]` | 赛事详情里的战队（含成员） |
| `EventTeamMemberResult` | `types/eventInfo.ts:4-7` | `member_name: string`、`member: EventTeamMembers` | 成员条目 |
| `EventChallengeResult`（选手端） | `types/eventChallenge.ts:4-12` | `id: string`、`challenge: ChallengesListItem`、`current_points: number`、`solved_count: number`、`solved: boolean`、`solved_no: number` | 赛事题目列表条目；`id` 由前端合成（后端不返回） |
| `EventInstanceResult` | `types/eventInstance.ts:4-9` | `id: string`、`instance: Instances`、`challenge_name: string`、`user_nickname: string` | 赛事实例列表条目 |
| `ChallengeScoreboard` | `types/scoreboard.ts:2-6` | `name: string`、`solved: boolean`、`solved_no: number` | 计分榜格子（某主体在某题上的状态） |
| `ScoreboardItem` | `types/scoreboard.ts:9-17` | `id: string`、`no: number`、`name: string`、`avatar?: string`、`score: number`、`solved_count: number`、`challenges: ChallengeScoreboard[]` | 计分榜一行 |
| `TrendPoint` | `types/trend.ts:2-6` | `name: string`、`score: number`、`time: string` | 走势图数据点 |
| `TrendItem` | `types/trend.ts:9-12` | `name: string`、`points: TrendPoint[]` | 一个主体的折线 |
| `TopUser` | `types/top.ts:2-8` | `no: number`、`nickname: string`、`avatar?: string`、`solved_count: number`、`solved_last_at: string` | Top15 条目 |
| `Instances` / `InstancesDto` | `types/instanceDto.ts:7-30` | 见 §3.3 表 | 选手侧实例 DTO（`Instances` 只是 `InstancesDto` 的别名） |
| `ChallengeWriteupResult` | `types/challengeWriteup.ts:4-10` | `id: string`、`nickname: string`、`avatar?: string`、`email: string`、`challenge: Challenges`、`writeup: ChallengeWriteup` | 题目 Writeup 详情 |
| `ChallengeSets`（实体） | `entity/challenge_sets.ts:1-7` | `id: string`、`name: string`、`description?: string`、`created_at: string`、`updated_at: string` | 题集 |
| `DataEventChallenge` | `types/dataPresent.ts:6-12` | `name: string`、`category: string`、`points: number`、`solved_count: number`、`solved_percent: number` | 数据大屏单题聚合 |
| `DataEventChallengeSolve` | `types/dataPresent.ts:15-21` | `user_nickname: string`、`challenge_name: string`、`challenge_category: string`、`created_at: string`、`bonus_points: number` | 最近解出流水 |
| `DataPresent` | `types/dataPresent.ts:24-32` | `event: Events`、`user_count: number`、`team_count: number`、`solved_recent_15: DataEventChallengeSolve[]`、`event_challenges: DataEventChallenge[]`、`scoreboard_top10: ScoreboardItem[]`、`trend: TrendItem[]` | 数据大屏聚合响应 |

### 3.3 选手端杂项 DTO

| 类型 | 定义处 | 字段（逐字） | 语义 |
|---|---|---|---|
| `InstancesDto`（别名 `Instances`） | `types/instanceDto.ts:7-30` | `id: string`、`status: string`、`flag: string`、`content: string \| null`、`challenge_id: string \| null`、`event_id: string`、`team_id?: string \| null`、`user_id: string`、`identifier: string`、`created_at: string`、`updated_at: string`、`destroy_at: string \| null`、`challenge_title?: string \| null`、`event_title?: string \| null`、`user_name?: string \| null`、`run_id?: string \| null`、`gamebox_id?: string \| null`、`gamebox_title?: string \| null` | 挑战 + AWDP 练习归一化实例；AWDP 练习实例的 `challenge_id` 为 `null` |
| `UnifiedWriteupResult` | `service/challenges.ts:13-22` | `id: string`、`writeup_type: "challenge" \| "gamebox"`、`nickname: string`、`avatar?: string \| null`、`email: string`、`content_id: string`、`content_name: string`、`updated_at: string` | 全局 Writeup 列表条目 |
| `UnifiedWriteupDetail` | `service/challenges.ts:25-37` | `id: string`、`writeup_type: "challenge" \| "gamebox"`、`content_id: string`、`content_name: string`、`category?: string \| null`、`nickname: string`、`avatar?: string \| null`、`email: string`、`content: string`、`created_at: string`、`updated_at: string` | 单条 Writeup 详情（gamebox 的 `id` 即 `run_id`） |
| `DiscussionWithAuthor` | `service/discussions.ts:9-13` | `Discussions & { author_nickname: string; author_avatar?: string; is_liked: boolean }` | 讨论 + 作者 + 我的点赞状态 |
| `SolveResult` | `service/solves.ts:9-13` | `JeopardyChallengeSolves & { nickname: string; avatar?: string; challenge_name: string }` | 解出记录 + 解题者信息 |

### 3.4 AWD DTO（`api/awd.ts`）

| 类型 | 定义处 | 字段（逐字） | 语义 |
|---|---|---|---|
| `AwdEventStatus` | `awd.ts:9-28` | `event_id: string`、`status: string`、`phase: string`、`round_count: number \| null`、`round_duration_secs: number`、`initial_score: number`、`free_reset_count: number`、`extra_reset_penalty: number`、`judge_max_concurrency: number`、`judge_default_timeout_secs: number`、`judge_retry_interval_secs: number`、`archive_retention_hours: number`、`planned_start_at: string \| null`、`verified_at: string \| null`、`started_at: string \| null`、`updated_at: string`、`final_settlement: boolean` | 管理端 AWD 生命周期状态 |
| `AwdEventConfigInput` | `awd.ts:30-44` | `expected_updated_at?: string`、`round_count?: number`、`round_duration_secs?: number`、`initial_score?: number`、`free_reset_count?: number`、`extra_reset_penalty?: number`、`judge_max_concurrency?: number`、`judge_default_timeout_secs?: number`、`judge_retry_interval_secs?: number`、`archive_retention_hours?: number`、`planned_start_at?: string`、`clear_planned_start?: boolean` | 配置补丁（**乐观锁字段 `expected_updated_at`**） |
| `AwdGameBox` | `awd.ts:46-55` | `id: string`、`team_id: string`、`event_gamebox_id: string`、`gamebox_name: string`、`status: string`、`gamebox_ip: string`、`container_name: string`、`health_status: string` | 选手端 GameBox |
| `GameBoxLibraryDto` | `awd.ts:57-79` | `id: string`、`name: string`、`safe_name: string`、`category: string`、`description: string`、`hidden: boolean`、`version: string \| null`、`build_status: string \| null`、`package_digest: string \| null`、`image_ref: string \| null`、`image_repo_digest: string \| null`、`username: string \| null`、`cpu_millis: number \| null`、`memory_bytes: number \| null`、`pids_limit: number \| null`、`healthchecks_json: unknown \| null`、`judge_script_name: string \| null`、`judge_script_content: string \| null`、`judge_args_json: unknown \| null`、`judge_timeout_secs: number \| null`、`judge_retry_interval_secs: number \| null` | GameBox 库条目 |
| `ImportGameBoxResponse` | `awd.ts:81-83` | `gamebox: GameBoxLibraryDto` | 导入响应 |
| `GameBoxScanItem` | `awd.ts:86-92` | `safe_name: string`、`name: string \| null`、`version: string \| null`、`status: "added" \| "skipped" \| "error"`、`message: string` | 扫描结果行 |
| `GameBoxCheckResult` | `awd.ts:95-101` | `id: string`、`gamebox_name: string`、`is_ok: boolean`、`docker_image: boolean`、`package_dir: boolean` | 完整性检查结果行 |
| `GameBoxBuildResult` | `awd.ts:104-108` | `gamebox_name: string`、`is_ok: boolean`、`message: string` | 构建结果行 |
| `EventGameBoxDto` | `awd.ts:110-128` | `id: string`、`gamebox_id: string`、`gamebox_name: string`、`gamebox_safe_name: string`、`gamebox_version: string \| null`、`host_offset: number`、`enabled: boolean`、`hidden: boolean`、`cpu_millis: number`、`memory_bytes: number`、`pids_limit: number`、`judge_timeout_secs: number \| null`、`judge_retry_interval_secs: number \| null`、`attack_score: number`、`judge_down_penalty: number`、`first_bonus: number`、`created_at: string` | 赛事内 GameBox 配置 |
| `GameBoxConfigPayload` | `awd.ts:131-136` | `name?: string`、`category?: string`、`description?: string`、`hidden?: boolean` | **`@deprecated`**：手动建配置已移除，改用包导入 |
| `AwdScoreRow` | `awd.ts:138-145` | `team_id: string`、`team_name: string`、`attack_score: number`、`defense_score: number`、`total_score: number`、`rank: number` | AWD 计分榜行 |
| `AwdPrecheckRun` | `awd.ts:152-161` | `id: string`、`event_id: string`、`status: string`、`trigger?: string \| null`、`revision?: number \| null`、`error_msg?: string \| null`、`started_at?: string \| null`、`completed_at?: string \| null` | 预检记录；`error_msg` 为 JSON 文本 `{"errors":[{component,error}],"notes":[{component,note}]}` |
| `AwdPlayerStatus` | `awd.ts:164-174` | `event_id: string`、`status: string`、`phase: string`、`current_round: number \| null`、`round_count: number \| null`、`banned: boolean`、`score: number \| null`、`final_settlement: boolean` | 选手端 AWD 状态 |
| `WireGuardConfigResponse` | `awd.ts:176-178` | `config: string` | WireGuard 客户端配置文本 |
| `PlatformNetworkSettings` | `awd.ts:183-201` | `gamebox_pool: string`、`gamebox_event_prefix: number`、`gamebox_team_prefix: number`、`wireguard_pool: string`、`wireguard_event_prefix: number`、`wireguard_team_prefix: number`、`wireguard_port_min: number`、`wireguard_port_max: number`、`wireguard_public_endpoint: string \| null`、`updated_at: string`、`gamebox_event_capacity: number`、`gamebox_team_capacity_per_event: number`、`gamebox_hosts_per_team: number`、`wireguard_event_capacity: number`、`wireguard_team_capacity_per_event: number`、`wireguard_port_capacity: number` | 平台网络设置 + 容量预览 |
| `PlatformNetworkSettingsUpdate` | `awd.ts:204-214` | `gamebox_pool?: string`、`gamebox_event_prefix?: number`、`gamebox_team_prefix?: number`、`wireguard_pool?: string`、`wireguard_event_prefix?: number`、`wireguard_team_prefix?: number`、`wireguard_port_min?: number`、`wireguard_port_max?: number`、`wireguard_public_endpoint?: string \| null` | PATCH 请求体（全可选） |
| `PlatformNetworkSettingsUpdateResponse` | `awd.ts:217-225` | `Partial<Pick<PlatformNetworkSettings, "gamebox_pool" \| "wireguard_pool" \| "wireguard_public_endpoint" \| "updated_at">> & { note?: string }` | PATCH 响应（只回少量字段） |
| `PlatformNetworkHealth` | `awd.ts:228-240` | `nftables: string`、`wireguard: string`、`docker: string`、`firewall_runtime: string`、`floatctf_table: string`、`docker_firewall_backend: string \| null`、`firewalld: string`、`ipv4_forwarding: string \| null`、`ipv6_policy: string`、`capability_supported: boolean`、`notes: string[]` | Host 观测状态（只读） |
| `PlatformNetworkAllocation` | `awd.ts:243-251` | `event_id: string`、`event_title: string \| null`、`kind: string`、`cidr: string`、`allocated_at: string`、`released_at: string \| null`、`active: boolean` | 平台分配账本行 |
| `EventNetworkInfo` | `awd.ts:254-266` | `event_id: string`、`allocation_mode: string`、`gamebox_cidr: string`、`wireguard_cidr: string`、`infrastructure_subnet: string`、`flagserver_ip: string`、`judgeserver_ip: string`、`wireguard_interface_name: string`、`wireguard_listen_port: number`、`docker_network_name: string`、`locked: boolean` | 赛事网络信息（未分配时 GET 404） |
| `NetworkAllocationRequest` | `awd.ts:269-274` | `allocation_mode?: "automatic" \| "manual"`、`gamebox_cidr?: string`、`wireguard_cidr?: string`、`wireguard_listen_port?: number` | 分配请求体 |
| `SshInstanceInfo` | `awd.ts:627-633` | `id: string`、`gamebox_ip: string`、`username: string`、`container_name: string`、`health_status: string` | SSH 目标实例 |
| `SshAccessResponse` | `awd.ts:635-639` | `port: number`、`password: string`、`instances: SshInstanceInfo[]` | 队伍级 SSH 凭据（**含密码，按凭据处理**） |

### 3.5 AWDP DTO（`api/awdp.ts`）

| 类型 | 定义处 | 字段（逐字） | 语义 |
|---|---|---|---|
| `AwdpPhase` | `awdp.ts:13` | `"pending" \| "break" \| "preparing_fix" \| "fix" \| "ended"` | AWDP 阶段 |
| `AwdpEndpoint` | `awdp.ts:15-20` | `protocol: "http" \| "tcp"`、`container_port: number`、`public_host: string`、`public_port: number` | 实例对外端点 |
| `AwdpInstance` | `awdp.ts:22-29` | `instance_id: string`、`runtime_state: string`、`runtime_generation: number`、`reset_count: number`、`endpoints: AwdpEndpoint[]` | AWDP 实例（`reset_count` = 玩家手动 Reset 次数；练习恒 0） |
| `AwdpGameBox` | `awdp.ts:31-42` | `id: string`、`gamebox_id: string`、`name: string`、`category: string`、`enabled: boolean`、`hidden: boolean`、`exposed: [string, number][]`、`broken: boolean`、`instance: AwdpInstance \| null`、`source_code_dir?: string \| null` | 赛事内 GameBox（含我方实例） |
| `AwdpOverview` | `awdp.ts:44-62` | `event_id: string`、`phase: AwdpPhase`、`break_duration_secs: number`、`fix_duration_secs: number`、`fix_round_interval_secs: number`、`total_rounds: number`、`break_score: number`、`fix_round_score: number`、`started_at: string \| null`、`break_ends_at: string \| null`、`fix_started_at: string \| null`、`fix_ends_at: string \| null`、`finished_at: string \| null`、`current_round: number`、`next_action_at: string \| null`、`my_score: number`、`gameboxes: AwdpGameBox[]` | 选手端 AWDP 总览 |
| `BreakSubmitResponse` | `awdp.ts:64-68` | `accepted: boolean`、`scored: boolean`、`already_broken: boolean` | Break 提交结果 |
| `PatchSubmitResponse` | `awdp.ts:70-73` | `status: "applied" \| "failed"`、`error_message?: string \| null` | 补丁提交结果 |
| `ManualCheckDto` | `awdp.ts:75-87` | `evaluation_id: string`、`status: string`、`healthcheck_ok: boolean \| null`、`healthcheck_detail: string[] \| null`、`judge_ok: boolean \| null`、`judge_detail: string \| null`、`exploit_ok: boolean \| null`、`exploit_detail: string \| null` | 手动检查结果（`exploit_*` 不计分，仅诊断） |
| `AllCheckDto` | `awdp.ts:90-100` | `status: string`、`swept: boolean`、`swept_rounds: number`、`target_round: number`、`healthcheck_detail: string \| null`、`judge_detail: string \| null`、`exploit_detail: string \| null` | ALL Check 结果（`patched` → 剩余回合全部计分 + run 结束） |
| `AwdpEventConfigDto` | `awdp.ts:102-120` | `event_id: string`、`phase: AwdpPhase`、`break_duration_secs: number`、`fix_duration_secs: number`、`fix_round_interval_secs: number`、`break_score: number`、`fix_round_score: number`、`total_rounds: number`、`configuration_generation: number`、`updated_at: string`、`started_at: string \| null`、`break_ends_at: string \| null`、`fix_started_at: string \| null`、`fix_ends_at: string \| null`、`finished_at: string \| null`、`current_round: number`、`next_action_at: string \| null` | 管理端 AWDP 配置 |
| `AwdpConfigPatchInput` | `awdp.ts:122-129` | `expected_updated_at?: string`、`break_duration_secs?: number`、`fix_duration_secs?: number`、`fix_round_interval_secs?: number`、`break_score?: number`、`fix_round_score?: number` | 配置补丁（**乐观锁 `expected_updated_at`**） |
| `AwdpAdminEventGameBoxDto` | `awdp.ts:131-146` | `id: string`、`event_id: string`、`gamebox_id: string`、`name: string`、`safe_name: string`、`category: string`、`enabled: boolean`、`hidden: boolean`、`cpu_millis: number`、`memory_bytes: number`、`pids_limit: number`、`awdp_capable: boolean`、`awdp_source_code_dir: string \| null`、`build_status: string \| null` | 管理端赛事 GameBox |
| `AwdpAdminInstanceDto` | `awdp.ts:148-158` | `instance_id: string`、`event_gamebox_id: string`、`gamebox_name: string`、`owner_user_id: string \| null`、`owner_team_id: string \| null`、`runtime_state: string`、`runtime_generation: number`、`container_name: string`、`endpoints: AwdpEndpoint[]` | 管理端实例 |
| `AwdpScoreRow` | `awdp.ts:161-168` | `subject_id: string`、`subject_name: string`、`break_score: number`、`fix_score: number`、`total_score: number`、`rank: number` | 聚合积分榜行 |
| `AwdpScoreboardGameBox` | `awdp.ts:171-175` | `id: string`、`name: string`、`category: string` | 明细矩阵的题（索引与 `rows[].break_status` 对齐） |
| `AwdpScoreboardRound` | `awdp.ts:178-182` | `sequence: number`、`status: string`、`cutoff_at: string` | 明细矩阵的回合 |
| `AwdpScoreboardRow` | `awdp.ts:185-200` | `subject_id: string`、`subject_name: string`、`rank: number`、`break_score: number`、`fix_score: number`、`total_score: number`、`is_me: boolean`、`break_status: boolean[]`、`fix_gamebox_score: number[]`、`fix_round_status: (string \| null)[][]` | 明细矩阵行（`[gamebox]` / `[gamebox][round]` 对齐） |
| `AwdpScoreboardDetail` | `awdp.ts:203-209` | `participant_mode: "individual" \| "team"`、`gameboxes: AwdpScoreboardGameBox[]`、`rounds: AwdpScoreboardRound[]`、`rows: AwdpScoreboardRow[]` | 积分榜明细整体 |
| `AwdpTrendPoint` | `awdp.ts:212-216` | `name: string`、`score: number`、`time: string` | 趋势点 |
| `AwdpTrendItem` | `awdp.ts:218-221` | `name: string`、`points: AwdpTrendPoint[]` | 趋势折线 |
| `AwdpDataGameBox` | `awdp.ts:224-230` | `id: string`、`name: string`、`category: string`、`break_count: number`、`fix_count: number` | 大屏统计卡 |
| `AwdpDataActivity` | `awdp.ts:233-240` | `subject_name: string`、`gamebox_name: string`、`gamebox_category: string`、`action: "break" \| "fix"`、`delta: number`、`created_at: string` | 最近计分动态 |
| `AwdpDataPresent` | `awdp.ts:243-251` | `event: Events`、`user_count: number`、`team_count: number`、`gameboxes: AwdpDataGameBox[]`、`scoreboard_top10: AwdpScoreRow[]`、`trend: AwdpTrendItem[]`、`recent_activity: AwdpDataActivity[]` | 管理端大屏聚合 |
| `AwdpRoundDto` | `awdp.ts:441-447` | `id: string`、`sequence: number`、`starts_at: string`、`cutoff_at: string`、`status: string` | 回合 |
| `AwdpEvaluationDto` | `awdp.ts:449-460` | `id: string`、`instance_id: string`、`event_gamebox_id: string`、`fix_round_id: string \| null`、`round_sequence: number \| null`、`kind: "manual" \| "official"`、`status: string`、`healthcheck_result: string \| null`、`judge_result: string \| null`、`finished_at: string \| null` | 赛事评估记录（**无 `exploit_result`**） |

### 3.6 AWDP Run（练习）DTO（`api/awdpRuns.ts`）

> 文件头声明：run 系 DTO 独立定义，不复用 event 系，以免字段漂移；复用的只有形状完全一致的 `AwdpRoundDto` / `BreakSubmitResponse` / `PatchSubmitResponse` / `ManualCheckDto` / `AwdpPhase` / `AwdpEndpoint`（`awdpRuns.ts:32-34`）。

| 类型 | 定义处 | 字段（逐字） | 语义 |
|---|---|---|---|
| `GameBoxCatalogDto` | `awdpRuns.ts:44-65` | `id: string`、`name: string`、`description: string`、`category: string`、`version: string \| null`、`author?: string \| null`、`updated_at?: string`、`awdp_capable: boolean`、`recommended_cpu_millis: number`、`recommended_memory_bytes: number`、`recommended_pids_limit: number`、`active_training: { run_id: string; phase: AwdpPhase; score: number } \| null`、`solved: boolean` | 安全目录条目（不含 exploit/source 字段） |
| `RunInstanceDto` | `awdpRuns.ts:68-77` | `instance_id: string`、`gamebox_id: string`、`runtime_state: string`、`runtime_generation: number`、`reset_count: number`、`broken: boolean`、`endpoints: AwdpEndpoint[]` | run 内逻辑实例 |
| `AwdpRunDto` | `awdpRuns.ts:80-114` | `run_id: string`、`gamebox_id: string`、`gamebox_name: string`、`gamebox_category: string`、`gamebox_description: string`、`event_id: string \| null`、`phase: AwdpPhase`、`break_duration_secs: number`、`fix_duration_secs: number`、`fix_round_interval_secs: number`、`break_score: number`、`fix_round_score: number`、`total_rounds: number`、`started_at: string \| null`、`break_ends_at: string \| null`、`fix_started_at: string \| null`、`fix_ends_at: string \| null`、`finished_at: string \| null`、`current_round: number`、`next_action_at: string \| null`、`my_score: number`、`fix_round_penalty: number`、`source_code_dir: string \| null`、`instances: RunInstanceDto[]`、`judge_endpoint: { base_url: string; flag_url: string; scope: "gamebox_internal" } \| null` | run 统一 view-model（Practice / Competition 共用引擎） |
| `AwdpRunEvaluationDto` | `awdpRuns.ts:117-130` | `id: string`、`instance_id: string`、`gamebox_id: string`、`fix_round_id: string \| null`、`round_sequence: number \| null`、`kind: "manual" \| "official"`、`status: string`、`healthcheck_result: string \| null`、`judge_result: string \| null`、`exploit_result: string \| null`、`finished_at: string \| null` | run 评估（比赛事版多 `exploit_result`） |
| `ScoreEventDto` | `awdpRuns.ts:133-140` | `id: string`、`score_type: "break" \| "fix"`、`gamebox_id: string`、`fix_round_id: string \| null`、`delta: number`、`created_at: string` | 计分明细（append-only ledger） |
| `AwdpRunScoresDto` | `awdpRuns.ts:142-145` | `total: number`、`history: ScoreEventDto[]` | run 得分 |
| `AwdpRunWriteupDto` | `awdpRuns.ts:148-152` | `run_id: string`、`content: string`、`updated_at: string \| null` | run Writeup（一 run 一份） |

### 3.7 管理端 DTO

| 类型 | 定义处 | 字段（逐字） | 语义 |
|---|---|---|---|
| `SettingsDto` | `admin/settings.ts:9-11` | `Settings & { resolved_value: string }` | 设置（生成实体 + 计算字段） |
| `AdminInstanceRow` | `admin/instances.ts:10-28` | `id: string`、`instance_type: "challenge" \| "gamebox"`、`status: string`、`identifier: string`、`event_id?: string \| null`、`event_title?: string \| null`、`user_id?: string \| null`、`user_name?: string \| null`、`team_id?: string \| null`、`team_name?: string \| null`、`content_title?: string \| null`、`challenge_id?: string \| null`、`gamebox_id?: string \| null`、`runtime_generation?: number \| null`、`created_at: string`、`updated_at: string`、`destroy_at?: string \| null` | 归一化实例行；**列表不返回 flag** |
| `DashboardSummary` | `admin/dashboard.ts:4-61` | `stats: { users: number; events: number; challenges: number; weapons: number; announcements: number; discussions: number; instances: number; gameboxes: number }`、`attention: { failed_tasks: Array<{ task_name: string; task_key: string; error_msg: string \| null; attempt_count: number; max_attempts: number; updated_at: string }>; error_logs_24h: number; awd_alerts: Array<{ event_id: string; title: string; status: string; phase: string }> }`、`events: Array<{ event_id: string; title: string; family: string; purpose: string; participant_mode: string; start_time: string; end_time: string \| null; hidden: boolean; awd: { status: string; phase: string; started_at: string \| null } \| null }>`、`activity: { recent_solves: Array<{ nickname: string; avatar: string \| null; challenge_name: string; solved_at: string }>; recent_signups: Array<{ nickname: string; username: string; avatar: string \| null; created_at: string }> }` | 一次拿全总览聚合；**子结构全是内联匿名类型** |
| `ChallengeCheckResult` | `types/adminChallenge.ts:4-12` | `id: string`、`challenge_name: string`、`is_ok: boolean`、`docker_image: boolean`、`attachment: boolean`、`static_content: boolean` | 题目完整性检查结果 |
| `BuildChallengeResult` | `types/adminChallenge.ts:15-19` | `challenge_name: string`、`is_ok: boolean`、`message: string` | 题目构建结果 |
| `ChallengeScanItem` | `types/adminChallenge.ts:22-28` | `safe_name: string`、`name: string \| null`、`version: string \| null`、`status: "added" \| "skipped" \| "error"`、`message: string` | 题目目录扫描条目 |
| `ImportChallengeResponse` | `types/adminChallenge.ts:31-33` | `challenge: ChallengesListItem` | 题目导入响应 |
| `EventChallenge` | `types/adminEventChallenge.ts:4-9` | `event_id: string`、`challenge_id: string`、`hidden: boolean`、`points: number` | 管理端挂题行 |
| `EventChallengeResult`（admin 版，`types/index.ts:28` 里别名 `AdminEventChallengeResult`） | `types/adminEventChallenge.ts:12-15` | `event_challenge: EventChallenge`、`challenge: Challenges` | 挂题行 + 题目实体 |
| `TeamMemberResult` | `types/adminEventTeam.ts:4-9` | `username: string`、`nickname: string`、`role: EventTeamMemberRole`、`points: number` | 战队成员 |
| `TeamResult` | `types/adminEventTeam.ts:12-17` | `id: string`、`team: EventTeams`、`captain: string`、`members: TeamMemberResult[]` | 战队条目 |
| `EventUserResult` | `types/adminEventUser.ts:4-8` | `id: string`、`user: Users`、`event_user: EventUsers` | 赛事用户条目 |
| `SqlStatement` | `types/database.ts:2-4` | `sql: string` | 单条 SQL 请求 |
| `SqlResult` | `types/database.ts:7-13` | `sql_type: string`、`rows: Record<string, any>[]`、`count: number`、`rows_affected: number`、`elapsed_ms: number` | SQL 执行结果 |
| `DiskInformation` | `types/systemInformation.ts:2-10` | `name: string`、`mount_point: string`、`file_system: string`、`total_space: number`、`available_space: number`、`used_space: number`、`usage_percent: number` | 磁盘信息 |
| `NetworkInterfaceInfo` | `types/systemInformation.ts:13-20` | `name: string`、`ip_addresses: string[]`、`received: number`、`transmitted: number`、`recv_rate: number`、`transmit_rate: number` | 网卡信息 |
| `DockerImageInfo` | `types/systemInformation.ts:23-27` | `id: string`、`repo_tags: string[]`、`size: number` | Docker 镜像摘要 |
| `DockerInformation` | `types/systemInformation.ts:30-35` | `image_count: number`、`images: DockerImageInfo[]`、`running_container_count: number`、`total_disk: number` | Docker 概况 |
| `SystemInformation` | `types/systemInformation.ts:38-54` | `name?: string`、`kernel_version?: string`、`os_version?: string`、`host_name?: string`、`uptime: number`、`total_memory: number`、`used_memory: number`、`total_swap: number`、`used_swap: number`、`avg_temp: number`、`max_temp: number`、`nb_cpu: number`、`disks_info: DiskInformation[]`、`network_interfaces: NetworkInterfaceInfo[]`、`docker_info: DockerInformation` | 管理端系统信息 |
| `FloatDockerContainer` | `admin/docker.ts:4-11` | `id: string`、`name: string`、`status: string`、`image: string`、`ports: string`、`created: number` | 容器摘要（`ports` 是**字符串**） |
| `ContainerInfo` | `admin/docker.ts:13-22` | `id: string`、`names: string[]`、`image: string`、`image_id: string`、`state: string`、`status: string`、`created: number`、`ports: PortInfo[]` | 容器详情 |
| `PortInfo` | `admin/docker.ts:24-29` | `IP?: string`、`PrivatePort: number`、`PublicPort?: number`、`Type: string` | 端口（**PascalCase 字段，唯一例外**） |
| `ImageInfo` | `admin/docker.ts:31-36` | `id: string`、`repo_tags: string[]`、`size: number`、`created: number` | 镜像 |
| `NetworkInfo` | `admin/docker.ts:38-47` | `id: string`、`name: string`、`driver: string`、`scope: string`、`ipam_driver: string`、`subnet?: string`、`gateway?: string`、`created: number` | 网络 |

门面类型（`ReturnType<typeof ...>` 别名，非数据 DTO）：`ServiceApi`、`AdminApi`（`api/index.ts:141,164`）、`AdminLoginFn`（`admin/auth.ts:17`）、以及每个模块的 `XxxServiceApi` / `XxxAdminApi` / `AwdPlayerApi` / `AwdAdminApi` / `AwdpPlayerApi` / `AwdpAdminApi` / `AwdpRunApi`。

### 3.8 SSE 类型

| 类型 | 定义处 | 字段（逐字） | 语义 |
|---|---|---|---|
| `SseEvent` | `sse/parser.ts:14-23` | `event: string`、`data: string`、`id?: string`、`retry?: number` | 一个 SSE 帧；`event` 未指定时为空字符串 |
| `SseParser` | `sse/parser.ts:25-30` | `push(chunk: Uint8Array): SseEvent[]`、`reset(): void` | 增量帧解析器 |
| `SseConnectionState` | `sse/connectSse.ts:20-27` | `"idle" \| "connecting" \| "connected" \| "reconnecting" \| "auth_error" \| "error" \| "closed"` | 连接状态全集（7 个取值） |
| `SseConnectionStatus` | `sse/connectSse.ts:29-34` | `state: SseConnectionState`、`lastEventAt: Date \| null`、`lastError: Error \| null`、`retryCount: number` | 状态快照 |
| `ConnectSseOptions` | `sse/connectSse.ts:36-59` | 见 §4.1 | 底层 SSE 选项 |
| `SseConnection` | `sse/connectSse.ts:61-66` | `close(): void`、`readonly status: SseConnectionStatus` | 连接句柄 |

### 3.9 `@floatctf/react` 契约类型

| 类型 | 定义处 | 字段（逐字） | 语义 |
|---|---|---|---|
| `UseTokenSource` | `tokenSource.ts:8` | `() => string \| null \| undefined` | 前端自有的"读 token" hook |
| `CreateFloatCTFReactOptions` | `index.ts:37-44` | `client: FloatCTFClient`、`useUserToken: UseTokenSource`、`useAdminToken?: UseTokenSource` | 绑定工厂选项；`useAdminToken` 省略 → 复用 `useUserToken`（`index.ts:49`） |
| `FloatCTFReactBindings` | `index.ts:67` | `ReturnType<typeof createFloatCTFReact>` | 绑定对象 |
| `AwdStreamEvent` | `useAwdEventStream.ts:36-41` | `type: string`、`sequence?: number`、`payload?: unknown`、`occurred_at?: string` | AWD 流事件负载（`JSON.parse(ev.data)`） |
| `UseAwdEventStreamOptions` | `useAwdEventStream.ts:43-50` | `eventId: string`、`pollMs?: number`（默认 `15_000`）、`preferStream?: boolean`（默认 `true`）、`enabled?: boolean`（默认 `true`） | AWD 选手流选项 |
| `UseAdminAwdEventStreamOptions` | `useAdminAwdEventStream.ts:25-30` | `eventId: string`、`pollMs?: number`、`preferStream?: boolean`、`enabled?: boolean`（默认同 15000/true/true，`useAdminAwdEventStream.ts:36-39`） | 管理端 AWD 流选项 |
| `AwdpStreamEvent` | `useAwdpEventStream.ts:16-21` | `type: string`、`sequence?: number`、`payload?: unknown`、`occurred_at?: string` | AWDP 流事件负载 |
| `UseAwdpEventStreamOptions` | `useAwdpEventStream.ts:23-28` | `eventId: string`、`pollMs?: number`（默认 `15000`）、`preferStream?: boolean`、`enabled?: boolean` | AWDP 赛事流选项 |
| `UseAwdpRunStreamOptions` | `useAwdpRunStream.ts:20-25` | `runId: string`、`pollMs?: number`（默认 `15000`）、`preferStream?: boolean`、`enabled?: boolean` | AWDP 练习 run 流选项 |

### 3.10 `@floatctf/frontend-runtime` 契约类型

| 类型 | 定义处 | 字段（逐字） | 语义 |
|---|---|---|---|
| `FloatCTFMountContext` | `module.ts:16-34` | `root: HTMLElement`、`apiBaseUrl: string`、`assetBaseUrl: string`、`frontendId: string`、`frontendVersion: string`、`platformVersion: string`、`apiContractVersion: string`、`frontendRuntimeVersion: string`、`capabilities: readonly string[]` | `mount()` 收到的上下文 |
| `FloatCTFFrontendUnmount` | `module.ts:37` | `() => void` | 可选清理函数 |
| `FloatCTFFrontendModule` | `module.ts:40-54` | `manifest?: { id?: string; version?: string }`、`mount(context: FloatCTFMountContext): void \| FloatCTFFrontendUnmount \| Promise<FloatCTFFrontendUnmount \| undefined>` | 制品入口模块 |
| `FloatCTFFrontendImport` | `module.ts:57-59` | `Partial<FloatCTFFrontendModule> & { default?: Partial<FloatCTFFrontendModule> \| FloatCTFFrontendModule }` | 动态 import 的结果形状 |
| `FloatCTFFrontendCompatibility` | `manifest.ts:22-29` | `frontendRuntime: string`、`apiContract: string`、`sdk?: string` | 兼容性声明（整数 major） |
| `FloatCTFFrontendManifest` | `manifest.ts:32-44` | `schemaVersion: number`、`id: string`、`name: string`、`version: string`、`description?: string`、`author?: string`、`compatibility: FloatCTFFrontendCompatibility`、`entry: string`、`styles?: string[]` | `frontend.json` |
| `ManifestParseResult` | `manifest.ts:46-48` | `{ ok: true; manifest: FloatCTFFrontendManifest; warnings: string[] } \| { ok: false; errors: string[] }` | 解析结果 |
| `FloatCTFRegistryVersion` | `registry.ts:28-37` | `version: string`、`name: string`、`description?: string`、`author?: string`、`compatibility: FloatCTFFrontendCompatibility`、`entry: string`、`styles: string[]`、`installedAt: string` | 已安装版本 |
| `FloatCTFRegistryFrontend` | `registry.ts:40-47` | `id: string`、`currentVersion: string`、`protected: boolean`、`versions: Record<string, FloatCTFRegistryVersion>` | 一个前端 ID |
| `FloatCTFRegistry` | `registry.ts:49-53` | `schemaVersion: number`、`updatedAt: string`、`frontends: Record<string, FloatCTFRegistryFrontend>` | `registry.json` |
| `RegistryParseResult` | `registry.ts:55-57` | `{ ok: true; registry: FloatCTFRegistry } \| { ok: false; errors: string[] }` | 注册表解析结果 |
| `ResolvedFrontend` | `registry.ts:383-396` | `id: string`、`version: string`、`name: string`、`description?: string`、`author?: string`、`compatibility: FloatCTFFrontendCompatibility`、`entryUrl: string`、`styleUrls: string[]`、`assetBaseUrl: string` | 解析结果 |
| `ResolveFrontendResult` | `registry.ts:398-400` | `{ ok: true; frontend: ResolvedFrontend } \| { ok: false; errors: string[] }` | — |
| `ResolveFrontendOptions` | `registry.ts:402-409` | `requestedId: string \| null \| undefined`、`frontendBaseUrl: string`、`frontendRuntimeVersion?: string`、`apiContractVersion?: string` | — |
| `FloatCTFBootstrapInfo` | `bootstrap.ts:41-47` | `active_frontend: string`、`platform_version: string`、`api_contract_version: string`、`frontend_runtime_version: string`、`capabilities: string[]` | `GET /api/frontend` 响应 |
| `BootstrapFrontendOptions` | `bootstrap.ts:49-75` | `root: HTMLElement`、`apiBaseUrl?: string`、`registryUrl?: string`、`frontendBaseUrl?: string`、`emergencyHost?: HTMLElement`、`overrideFrontendId?: string \| null`、`fallbackFrontendId?: string`、`fetchImpl?: typeof fetch`、`importModule?: (url: string) => Promise<unknown>`、`loadStyle?: (url: string, doc: Document) => HTMLElement`、`onDiagnostics?: (diagnostics: BootstrapDiagnostics) => void` | bootstrap 选项 |
| `BootstrapFrontendResult` | `bootstrap.ts:77-82` | `mounted: boolean`、`frontendId?: string`、`frontendVersion?: string`、`diagnostics: BootstrapDiagnostics` | bootstrap 结果 |
| `BootstrapDiagnostics` | `emergency.ts:10-23` | `platformVersion?: string`、`apiContractVersion?: string`、`frontendRuntimeVersion?: string`、`activeFrontendId?: string \| null`、`overrideFrontendId?: string \| null`、`attempted: string[]`、`errors: string[]` | 诊断信息（`errors` 与 `attempted` 对位） |
| `PathCheckResult` | `paths.ts:40-43` | `ok: boolean`、`reason?: string` | 相对路径校验结果 |

平台契约常量（`version.ts`）：

| 常量 | 值 | 定义处 |
|---|---|---|
| `FRONTEND_RUNTIME_VERSION` | `"1"` | `version.ts:14` |
| `API_CONTRACT_VERSION` | `"1"` | `version.ts:17` |
| `FRONTEND_REGISTRY_SCHEMA_VERSION` | `1` | `version.ts:20` |
| `FRONTEND_MANIFEST_SCHEMA_VERSION` | `1` | `version.ts:23` |
| `FRONTEND_RUNTIME_FULL_VERSION` | `"1.0.0"` | `version.ts:26` |
| `DEFAULT_FRONTEND_BASE_URL` | `"/__floatctf/frontends"` | `version.ts:29` |
| `DEFAULT_REGISTRY_URL` | `` `${DEFAULT_FRONTEND_BASE_URL}/registry.json` `` | `version.ts:32` |
| `DEFAULT_API_BASE_URL` | `"/api"` | `version.ts:35` |
| `DEFAULT_FRONTEND_ID` | `"default"` | `version.ts:38` |

### 3.11 被上述 DTO 引用的实体模型（来自 `@floatctf/sdk/entity`）

这些类型不是"另一个 DTO"，而是 DTO 的组成部分（`&` 交叉或字段引用），字段同样必须逐字对齐。

| 实体 | 定义处 | 字段（逐字） |
|---|---|---|
| `Challenges` | `entity/challenges.ts:1-30` | `id: string`、`name: string`、`safe_name: string`、`category: string`、`description: string`、`hidden: boolean`、`created_at: string`、`updated_at: string`、`version?: string`、`source_toml?: string`、`spec_json?: string`、`spec_digest?: string`、`package_digest?: string`、`flag_type?: string`、`static_flag_value?: string`、`container_port?: string`、`recommended_cpu_millis: number`、`recommended_memory_bytes: number`、`recommended_pids_limit: number`、`attachment_path?: string`、`attachment_name?: string`、`attachment_size?: string`、`attachment_sha256?: string`、`image_ref?: string`、`image_id?: string`、`image_repo_digest?: string`、`build_status?: string`、`build_error?: string` |
| `Users` | `entity/users.ts:1-10` | `id: string`、`username: string`、`nickname: string`、`password: string`、`email: string`、`created_at: string`、`updated_at: string`、`avatar?: string` |
| `Events` | `entity/events.ts:3-20` | `id: string`、`title: string`、`description?: string`、`hidden: boolean`、`start_time: string`、`rules: string`、`allow_join: boolean`、`flag_prefix?: string`、`end_time?: string`、`created_at: string`、`updated_at: string`、`family: EventFamily`、`purpose: EventPurpose`、`participant_mode: ParticipantMode`、`system_key?: string`、`is_virtual: boolean` |
| `Announcements` | `entity/announcements.ts:1-9` | `id: string`、`title: string`、`content?: string`、`publisher_id: string`、`publisher: string`、`created_at: string`、`updated_at: string` |
| `Weapons` | `entity/weapons.ts:1-11` | `id: string`、`name: string`、`category: string`、`description?: string`、`has_file: boolean`、`download_count: number`、`file_url: string`、`created_at: string`、`updated_at: string` |
| `Discussions` | `entity/discussions.ts:1-11` | `id: string`、`title: string`、`content: string`、`author_id: string`、`view_count: number`、`like_count: number`、`comment_count: number`、`created_at: string`、`updated_at: string` |
| `DiscussionComments` | `entity/discussion_comments.ts:1-9` | `id: string`、`discussion_id: string`、`author_id: string`、`content: string`、`parent_id?: string`、`created_at: string`、`updated_at: string` |
| `JeopardyChallengeSolves` | `entity/jeopardy_challenge_solves.ts:1-11` | `id: string`、`event_id: string`、`challenge_id: string`、`user_id: string`、`team_id?: string`、`obtained_points: number`、`bonus_points: number`、`created_at: string`、`updated_at: string` |
| `ChallengeWriteup` | `entity/challenge_writeup.ts:1-8` | `id: string`、`challenge_id: string`、`user_id: string`、`content: string`、`created_at: string`、`updated_at: string` |
| `ChallengeSets` | `entity/challenge_sets.ts:1-7` | `id: string`、`name: string`、`description?: string`、`created_at: string`、`updated_at: string` |
| `EventTeams` | `entity/event_teams.ts:1-10` | `id: string`、`event_id: string`、`name: string`、`description?: string`、`points: number`、`created_at: string`、`updated_at: string`、`banned: boolean` |
| `EventUsers` | `entity/event_users.ts:1-7` | `event_id: string`、`user_id: string`、`points: number`、`banned: boolean`、`joined_at: string` |
| `EventAnnouncements` | `entity/event_announcements.ts:1-7` | `id: string`、`event_id: string`、`title: string`、`content: string`、`created_at: string` |
| `EventLogs` | `entity/event_logs.ts:3-16` | `id: string`、`event_id: string`、`user_id?: string`、`team_id?: string`、`ip_address?: string`、`level: string`、`action: string`、`details: string`、`created_at: string`、`family: EventFamily`、`purpose: EventPurpose`、`participant_mode: ParticipantMode` |
| `EventWriteup` | `entity/event_writeup.ts:1-7` | `event_id: string`、`user_id: string`、`team_id?: string`、`file_url: string`、`created_at: string` |
| `ScheduledTasks` | `entity/scheduled_tasks.ts:1-25` | `id: string`、`group_id?: string`、`task_name: string`、`description?: string`、`task_key: string`、`trigger_type: string`、`status: string`、`enabled: boolean`、`protected: boolean`、`cron_expr?: string`、`execute_at?: string`、`expires_at?: string`、`payload?: string`、`error_msg?: string`、`last_run_at?: string`、`created_at: string`、`updated_at: string`、`attempt_count: number`、`max_attempts: number`、`timeout_secs?: string`、`last_error?: string`、`locked_at?: string`、`heartbeat_at?: string` |
| `SuperAdmin` | `entity/super_admin.ts:1-8` | `id: string`、`username: string`、`password: string`、`email: string`、`created_at: string`、`updated_at: string` |
| `Logs` | `entity/logs.ts:1-12` | `id: string`、`user_id?: string`、`superadmin_id?: string`、`ip_address?: string`、`category: string`、`action: string`、`level: string`、`message: string`、`details: string`、`created_at: string` |
| `EventTeamMembers` | `entity/event_team_members.ts:3-9` | `event_id: string`、`team_id: string`、`user_id: string`、`role: EventTeamMemberRole`、`joined_at: string` |
| `Settings` | `entity/settings.ts:3-11` | `id: string`、`key: string`、`value: string`、`type: SettingValueType`、`description: string`、`protected: boolean`、`updated_at: string` |

相关枚举（`entity/sea_orm_active_enums.ts`）：

| 枚举 | 取值（逐字） | 行 |
|---|---|---|
| `EventFamily` | `'jeopardy' \| 'awd' \| 'awdp'` | `sea_orm_active_enums.ts:64-68` |
| `EventPurpose` | `'practice' \| 'competition'` | `:70-73` |
| `ParticipantMode` | `'individual' \| 'team'` | `:104-107` |
| `EventTeamMemberRole` | `'captain' \| 'member'` | `:75-78` |
| `SettingValueType` | `'string' \| 'integer' \| 'boolean' \| 'float'` | `:133-138` |
| `AwdEventStatus` | `'draft' \| 'configuring' \| 'deploying' \| 'deployed' \| 'prechecking' \| 'verified' \| 'running' \| 'paused' \| 'network_error' \| 'start_blocked' \| 'finished' \| 'archived' \| 'deploy_failed' \| 'verification_failed'` | `:1-16` |
| `AwdPhase` | `'hardening' \| 'attack' \| 'pause'` | `:28-32` |
| `RoundStatus` | `'active' \| 'completed' \| 'paused'` | `:117-121` |
| `PrecheckStatus` | `'pending' \| 'running' \| 'passed' \| 'failed' \| 'error'` | `:109-115` |
| `ScoreEventType` | `'attack' \| 'victim_loss' \| 'judge_down' \| 'first_bonus' \| 'reset_penalty' \| 'adjustment' \| 'initial_score'` | `:123-131` |
| `AwdpPhase`（实体枚举，注意与 `api/awdp.ts` 的同名 union 并存） | `'pending' \| 'break' \| 'fix' \| 'ended' \| 'preparing_fix'` | `:50-56` |
| `AwdpEvaluationKind` | `'manual' \| 'official'` | `:34-37` |
| `AwdpEvaluationStatus` | `'pending' \| 'running' \| 'no_patch' \| 'service_down' \| 'functional_broken' \| 'vulnerable' \| 'patched' \| 'platform_error'` | `:39-48` |
| `GameboxStatus` | `'pending' \| 'creating' \| 'running' \| 'ready' \| 'resetting' \| 'missing' \| 'orphan' \| 'conflict' \| 'start_failed' \| 'reset_failed' \| 'stopped'` | `:80-92` |

---

## 4. 实时（SSE）

### 4.1 `client.sse.connect` / `client.sse.connectAdmin` 的完整 options

类型：`FloatCTFSseOptions`（`client.ts:62-67`）

```ts
export type FloatCTFSseOptions = Omit<ConnectSseOptions, "url" | "getToken"> & {
	url: string;
	getToken?: () => string | null;
};
```

`ConnectSseOptions`（`sse/connectSse.ts:36-59`）的完整字段与必填性：

| 字段 | 类型（源码原文） | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `url` | `string` | **是** | — | 相对本实例 base URL 的路径（如 `/events/<id>/awd/stream`）或绝对 URL；由 `resolveSseUrl` 拼接（`client.ts:106-112,142`） |
| `headers` | `Record<string, string>` | **是**（`FloatCTFSseOptions` 未放宽） | — | 额外请求头；`Accept: text/event-stream` 由内部补（`connectSse.ts:120-123`） |
| `signal` | `AbortSignal` | **是** | — | 外部分发的取消信号（React cleanup 用） |
| `onEvent` | `(event: SseEvent) => void` | **是** | — | 事件回调 |
| `lastEventId` | `string` | 否 | 无 | 首连/重连时的 `Last-Event-ID`（`connectSse.ts:43,131-133,285`） |
| `onOpen` | `() => void` | 否 | 无 | 连接建立回调 |
| `onError` | `(error: Error) => void` | 否 | 无 | 错误回调 |
| `onStateChange` | `(status: SseConnectionStatus) => void` | 否 | 无 | 状态变化回调 |
| `initialRetryDelayMs` | `number` | 否 | `1000`（`DEFAULT_INITIAL_RETRY_MS`，`connectSse.ts:70`） | 初始重连延迟 |
| `maxRetryDelayMs` | `number` | 否 | `30000`（`DEFAULT_MAX_RETRY_MS`，`connectSse.ts:71`） | 最大重连延迟（指数退避上限） |
| `getToken` | `() => string \| null` | 否 | 选手端 `getUserToken` / 管理端 `getAdminToken`（`client.ts:136-144`） | 每次建连取新鲜 token，覆盖 `Authorization` 头 |

> 抖动因子 `JITTER_FACTOR = 0.3`（`connectSse.ts:72`），退避倍率 ×2（`connectSse.ts:263`）。
> 终止条件：`signal.aborted` / `close()` / 401 / 403 / 非 401/403/429 的 4xx / `Content-Type` 非 `text/event-stream`。

返回：`SseConnection`（`connectSse.ts:61-66,287-292`）——`close(): void` 与只读 getter `status: SseConnectionStatus`（每次读返回副本）。

### 4.2 `SseEvent`（`sse/parser.ts:14-23`）

```ts
export interface SseEvent {
	event: string;   // 事件类型；未指定时为空字符串（SSE 默认 message）
	data: string;    // 多个 data: 行以 \n 拼接
	id?: string;     // 事件 ID
	retry?: number;  // 重连间隔（毫秒）
}
```

`client.sse.createParser()` → `createSseParser(): SseParser`（`parser.ts:36`），`push(chunk: Uint8Array): SseEvent[]` / `reset(): void`。

### 4.3 `SseConnectionState` 全部取值（`sse/connectSse.ts:20-27`）

| 取值 | 何时进入 |
|---|---|
| `"idle"` | 初始值（`connectSse.ts:99`）；React hook 在无 token / `enabled=false` / `preferStream=false` 时也会设（`useAwdEventStream.ts:149,203`） |
| `"connecting"` | 首次发起 fetch 前（`connectSse.ts:149`，`connected === false` 时） |
| `"connected"` | 响应 `ok`、`Content-Type` 正确、拿到 body 后（`connectSse.ts:208-212`） |
| `"reconnecting"` | 进入退避重连（`connectSse.ts:149` 已连接过时 / `scheduleReconnect`，`:266`） |
| `"auth_error"` | HTTP 401 或 403（**停止重连**，`connectSse.ts:164-168`） |
| `"error"` | 非 401/403/429 的 4xx（`:176`）或 `Content-Type` 不符（`:198`）——**不重连** |
| `"closed"` | `close()` 调用（`:281`）或流因 Abort 结束（`:242`） |

`SseConnectionStatus` 还有 `lastEventAt: Date | null`、`lastError: Error | null`、`retryCount: number`（`connectSse.ts:29-34`）。

### 4.4 四条流的真实 URL 模板

| 流 | 相对 URL 模板（源码） | 解析后完整 URL（默认 base） | 认证 | 源码 |
|---|---|---|---|---|
| AWD 选手 | `/events/${eventId}/awd/stream` | `GET /api/events/{eventId}/awd/stream` | 选手 token（`client.sse.connect`） | `react/useAwdEventStream.ts:161`；后端 `apps/api/src/modules/event/awd/api/player.rs:513` |
| AWD 管理 | `/events/${eventId}/awd/stream` | `GET /api/admin/events/{eventId}/awd/stream` | 管理员 token（`client.sse.connectAdmin`） | `react/useAdminAwdEventStream.ts:136`；后端 `apps/api/src/modules/event/awd/api/admin.rs:1111` |
| AWDP 赛事 | `/events/${eventId}/awdp/stream` | `GET /api/events/{eventId}/awdp/stream` | 选手 token | `react/useAwdpEventStream.ts:131`；后端 `apps/api/src/modules/event/awdp/api/player.rs:614` |
| AWDP 练习 run | `/service/awdp/runs/${runId}/stream` | `GET /api/service/awdp/runs/{runId}/stream` | 选手 token | `react/useAwdpRunStream.ts:112`；后端 `apps/api/src/modules/event/awdp/api/training.rs:1153`（scope `/service` 见 `apps/api/src/bootstrap/routes.rs:63`） |

手工接线（不用 React 时）：

```ts
import { connectSse, createSseParser } from "@floatctf/sdk";

const controller = new AbortController();
const conn = client.sse.connect({
  url: `/events/${eventId}/awd/stream`,
  headers: {},                 // 必填，可为空对象
  signal: controller.signal,   // 必填
  onEvent: (ev) => {
    const data = JSON.parse(ev.data) as { type: string; sequence?: number; payload?: unknown };
    // 按 data.type 前缀决定失效/刷新
  },
  onStateChange: (s) => console.log(s.state, s.retryCount, s.lastError),
});
// 清理
controller.abort();
conn.close();
```

### 4.5 `@floatctf/react` 四个 hook 的精确签名与返回值形状

工厂：`createFloatCTFReact(options: CreateFloatCTFReactOptions)`（`react/index.ts:46-65`），返回对象含 `client`、4 个 hook、4 个 query options 工厂、`invalidateAwdQueries`、`AWD_PLAYER_QUERY_KEYS`、`AWD_ADMIN_QUERY_KEYS`。

| hook | 调用签名 | 返回形状（源码逐字解构） |
|---|---|---|
| `useAwdEventStream` | `useAwdEventStream(options: UseAwdEventStreamOptions)` | `{ connected: boolean; connectionState: SseConnectionState; lastEvent: AwdStreamEvent \| null; lastError: Error \| null; invalidateAwd: () => void }`（`useAwdEventStream.ts:213-219`） |
| `useAdminAwdEventStream` | `useAdminAwdEventStream(options: UseAdminAwdEventStreamOptions)` | `{ connected; connectionState; lastEvent: AwdStreamEvent \| null; lastError; invalidateAwd }`（`useAdminAwdEventStream.ts:186-192`） |
| `useAwdpEventStream` | `useAwdpEventStream(options: UseAwdpEventStreamOptions)` | `{ connected; connectionState; lastEvent: AwdpStreamEvent \| null; lastError; invalidateAwdp: () => void }`（`useAwdpEventStream.ts:188-194`） |
| `useAwdpRunStream` | `useAwdpRunStream(options: UseAwdpRunStreamOptions)` | `{ connected; connectionState; lastEvent: AwdpStreamEvent \| null; lastError; invalidateRun: () => void }`（`useAwdpRunStream.ts:161-167`） |

共同行为（四个 hook 一致）：`pollMs` 默认 15000 / `preferStream` 默认 true / `enabled` 默认 true；无 token 或非 `connected` 时启动 REST 轮询 `invalidate*` 兜底，`connected` 后停轮询；`auth_error` 时关闭连接并继续轮询（`useAwdEventStream.ts:129-201`）。

失效的 query key 集合（hook 内部硬编码，不是导出的常量）：

- `useAwdEventStream` / `useAdminAwdEventStream`：`AWD_PLAYER_QUERY_KEYS` / `AWD_ADMIN_QUERY_KEYS`（见 §4.6）。
- `useAwdpEventStream`（1s 节流）：`["awdp-overview", eventId]`、`["awdp-config", eventId]`、`["awdp-rounds", eventId]`、`["awdp-evals", eventId]`、`["awdp-scoreboard", eventId]`、`["awdp-trend", eventId]`、`["eventInfo", eventId]`、`["event", eventId]`（`useAwdpEventStream.ts:58-65`）。
- `useAwdpRunStream`：`["awdp-run", runId]`、`["awdp-run-rounds", runId]`、`["awdp-run-evals", runId]`、`["awdp-run-scores", runId]`、`["gamebox-catalog"]`（`useAwdpRunStream.ts:47-51`）。
- 事件过滤正则：`/awdp\.(score|phase|config|event|patch|manual|round|evaluation|instance)/`（`useAwdpEventStream.ts:30-31`）；run 流 `/awdp\.(score|phase|patch|manual|round|evaluation|instance|run)/`（`useAwdpRunStream.ts:27-28`）；AWD 流按 `type` 前缀 `score./attack./judge./round.` 与包含 `pause|resume|ban|network|precheck` 判断（`useAwdEventStream.ts:98-108`）。

### 4.6 `@floatctf/react` query options 工厂与失效工具

绑定后的调用签名（`queries/index.ts:13-21`）：

| 工厂 | 签名 | queryKey | queryFn | 源码 |
|---|---|---|---|---|
| `eventInfoQueryOptions` | `(id: string) => QueryOptions` | `["eventInfo", id]` | `client.service.events.get(id)` | `queries/eventInfo.ts:15-20` |
| `challengeQueryOptions` | `(id: string) => QueryOptions` | `["challenge", id]` | `client.service.challenges.get(id)` | `queries/challenge.ts:8-13` |
| `challengeInstanceQueryOptions` | `(id: string) => QueryOptions` | `["instance", id]` | `client.service.challenges.getInstance(id)` | `queries/challenge.ts:22-27` |
| `systemInformationQueryOptions` | `() => QueryOptions` | `["system_information"]` | `client.admin.system.monitor()`（**管理端**） | `queries/systemInformation.ts:11-16` |

这些都是 `@tanstack/react-query` 的 `queryOptions(...)` 返回值（含 `queryKey` / `queryFn`），可直接喂给 `useQuery` / `ensureQueryData` / `prefetchQuery`。

失效工具（`awdInvalidation.ts`）：

```ts
export const AWD_PLAYER_QUERY_KEYS = [
	"eventInfo", "event", "awd-gameboxes", "awd-scores", "awd-wg", "awd-ssh",
	"awd-player-status", "announcements",
] as const;                                             // awdInvalidation.ts:13-22

export const AWD_ADMIN_QUERY_KEYS = [
	"event", "eventInfo", "awd-gameboxes", "awd-scores",
	"admin-awd-scores", "admin-awd-status", "admin-awd-prechecks",
] as const;                                             // awdInvalidation.ts:25-33

export function invalidateAwdQueries(
	client: QueryClient,
	eventId: string,
	keys: readonly string[],
): void;                                                 // awdInvalidation.ts:36-44
```

`invalidateAwdQueries` 对每个 key 执行 `client.invalidateQueries({ queryKey: [key, eventId] })`（`awdInvalidation.ts:41-43`）——**页面必须使用 `[key, eventId]` 两段式 queryKey 才能被刷新**。

顶层导出（`react/index.ts:69-81`）：`AWD_ADMIN_QUERY_KEYS`、`AWD_PLAYER_QUERY_KEYS`、`invalidateAwdQueries`、类型 `UseTokenSource`、`AwdpStreamEvent`、`UseAwdpEventStreamOptions`、`UseAwdpRunStreamOptions`、`AwdStreamEvent`、`UseAwdEventStreamOptions`、`UseAdminAwdEventStreamOptions`。

### 4.7 `@floatctf/frontend-runtime` 装配入口（新前端必需）

| 导出 | 签名/说明 | 源码 |
|---|---|---|
| `bootstrapFrontend` | `bootstrapFrontend(options: BootstrapFrontendOptions): Promise<BootstrapFrontendResult>`；**永不抛错**，失败走 `default` 回退并渲染兜底 UI | `bootstrap.ts:143-315` |
| `parseBootstrapInfo` | `parseBootstrapInfo(input: unknown): FloatCTFBootstrapInfo` | `bootstrap.ts:105-130` |
| `normalizeFrontendModule` | `normalizeFrontendModule(imported: unknown): FloatCTFFrontendModule \| null`（容忍 `export function mount` / `export default { mount }` / `export default function mount`） | `module.ts:65-96` |
| `parseFrontendManifest` | `parseFrontendManifest(input: unknown, options?): ManifestParseResult`（未知字段 **fail-closed** 直接失败） | `manifest.ts:86-240` |
| `parseRegistry` | `parseRegistry(input: unknown, options?): RegistryParseResult` | `registry.ts:211-316` |
| `resolveFrontend` | `resolveFrontend(registry, options: ResolveFrontendOptions): ResolveFrontendResult`（用显式 `currentVersion`，绝不按版本号排序） | `registry.ts:420-491` |
| `registerFrontendVersion` | `registerFrontendVersion(registry, entry, makeCurrent = false)`；重复版本直接拒绝 | `registry.ts:335-379` |
| `emptyRegistry` | `emptyRegistry(now: string): FloatCTFRegistry` | `registry.ts:319-325` |
| `listFrontendIds` | `listFrontendIds(registry): string[]` | `registry.ts:494-496` |
| `describeManifestCompatibility` | `describeManifestCompatibility(manifest): string` → `` `runtime ${frontendRuntime} / api ${apiContract}` `` | `manifest.ts:243-248` |
| `renderBootstrapEmergencyUi` | `renderBootstrapEmergencyUi(host: HTMLElement, diagnostics: BootstrapDiagnostics, onRetry?: () => void): HTMLElement`（默认 `onRetry` = `location.reload()`） | `emergency.ts:32-124` |
| `bootstrapFrontend` 的回退链 | `?frontend=<id>`（必须是已安装的安全 ID）→ `active_frontend` → `fallbackFrontendId`（默认 `"default"`） | `bootstrap.ts:218-255` |

新前端的入口契约（`module.ts:16-54`）：

```ts
import type { FloatCTFFrontendModule } from "@floatctf/frontend-runtime";

export function mount(context) {
  // context.root / context.apiBaseUrl / context.assetBaseUrl
  // context.frontendId / frontendVersion / platformVersion
  // context.apiContractVersion / frontendRuntimeVersion / capabilities
  // 在这里创建自己的框架、路由、状态、样式
  return () => { /* 可选：清理 */ };
}
```

---

## 5. TypeError 陷阱与常见错误

> 每条都附源码 `文件:行`。按"踩中概率 × 排查难度"排序，前 5 条见 §5.0。

### 5.0 最重要的 5 条（先看这里）

1. **所有领域方法返回的是 `UniResponse<T>` 信封，不是 `T`**——`await client.service.events.fetch()` 得到 `{ code, message, data?, meta? }`，列表在 `.data`（`protocol.ts:24-29`、`service/events.ts:17-22`）。
2. **`client.admin.event_users.add` 是唯一一个"声明返回 envelope、运行时返回 AxiosResponse"的方法**（`admin/event_users.ts:17-30`，第 26 行直接 `return http.post(...)` 而没有 `.data`），必须写 `(await client.admin.event_users.add({...})).data`。
3. **HTTP 200 但 `code !== 0` 的平台业务失败不会 reject**——传输层从不调用 `floatCTFErrorFromEnvelope`（全仓库只出现在 `index.ts:42` 与测试里），所以 `try/catch` 抓不到，必须自己判 `res.code !== UNI_SUCCESS_CODE`。
4. **柯里化方法与位置参数**：`client.admin.event_challenges.fetch(eventId)` 返回的是**函数**而不是 Promise（`admin/event_challenges.ts:8-17`）；并且 `service.instances.launchSingle(challenge_id, event_id)` 与 `service.events.launchSingleInstance(event_id, challenge_id)` 的**参数顺序相反**（`service/instances.ts:15` vs `service/events.ts:95`）。
5. **SSE 的 options 里 `headers`、`signal`、`onEvent` 都是必填**，`client.sse.connect({ url })` 直接编译不过（`client.ts:62-67` + `connectSse.ts:36-48`）；而且 SSE 的 401 走的是 `fetch`，**不会触发 `onUnauthorized`**（axios 拦截器管不到它，`transport.ts:151-167` vs `connectSse.ts:157-168`）。

### 5.1 返回值 / 信封类

| # | 陷阱 | 证据 |
|---|---|---|
| 1 | 方法返回 `UniResponse<T>` 而非 `T`；判成功要用 `UNI_SUCCESS_CODE`（= 0） | `protocol.ts:24-32`；`service/events.ts:17-22` |
| 2 | `data?: T` 是**可选**的：成功响应也可能 `data === undefined`，用 `?? []` / `?? null` 兜底 | `protocol.ts:27`；`service/events.ts:121-124`（`string \| null`）；`awdp.ts:370-375`（`AwdpInstance \| null`） |
| 3 | `meta` 只在列表接口存在，不要在没有列表语义的响应上读 `meta.total` | `protocol.ts:9,28` |
| 4 | `client.admin.event_users.add` 运行时返回 `AxiosResponse`（要 `.data` 才是 envelope）：源码在声明 `Promise<UniResponse<null>>` 的函数里直接 `return http.post(...)` 而没有 `.data`；`post` 的泛型 `R` 在调用处由上下文返回类型推断（`transport.ts:98-102`、`170-181`），所以 TS 不报错，但运行时值就是 axios 响应对象 | `admin/event_users.ts:26-30`；`transport.ts:98-102` |
| 5 | 平台业务失败（HTTP 200 + `code !== 0`）不会 reject；`floatCTFErrorFromEnvelope` 全仓库无人调用 | `errors.ts:145-155`；grep 结果见 §6.3 |
| 6 | `admin.events.createChallengeSet`、`admin.event_teams.banned`/`unbanned`、`admin.event_announcements.create`/`patch`/`remove` 的返回类型是 `any`（未标注），没有类型保护 | `admin/events.ts:40-55`；`admin/event_teams.ts:21-44`；`admin/event_announcements.ts:21-49` |
| 7 | `admin.super_admin.patch(id, data)` 实际发的是 **POST**，不是 PATCH | `admin/super_admin.ts:25-31` |
| 8 | `service.uploads.upload_avatar` 实际发的是 **PATCH** | `service/uploads.ts:16-25` |
| 9 | `admin.events.exportWriteUps` 与 `getReport` 打在**同一个** `GET /events/{id}/report` 上 | `admin/events.ts:32-39` |
| 10 | `service.submit.submit` 与 `submitSingle` 打在**同一个** `POST /submit/flag`，差别只在 body 是否含 `event_id` | `service/submit.ts:7-19` vs `45-60` |
| 11 | `service.events.launchSingleInstance` 打在 `/instances/launch`（不是赛事子路径），body 字段顺序为 `{ challenge_id, event_id }` | `service/events.ts:95-104` |
| 12 | `client.admin.download.download` 返回 `Promise<void>`（不是 envelope），依赖 `document`/`URL.createObjectURL`，且失败时 `throw new Error`（不是 `FloatCTFError`） | `admin/download.ts:5-26` |
| 13 | `admin.docker` 的 `PortInfo` 字段是 PascalCase（`IP`/`PrivatePort`/`PublicPort`/`Type`），其余 DTO 全是 snake_case；`FloatDockerContainer.ports` 是 `string` | `admin/docker.ts:9,24-29` |
| 14 | `AwdPrecheckRun.error_msg` 是 **JSON 字符串**（`{"errors":[…],"notes":[…]}`），要 `JSON.parse` | `awd.ts:147-161` |
| 15 | `GameBoxLibraryDto.healthchecks_json` / `judge_args_json` 是 `unknown \| null`（读），但 `updateGamebox` 的同名字段是 `string \| null`（写，JSON 文本），写之前要 `JSON.stringify` | `awd.ts:73,76` vs `awd.ts:415-420` |
| 16 | `awdp.ts` 与 `entity/sea_orm_active_enums.ts` **各有一个 `AwdpPhase`**：前者是 `"pending" \| "break" \| "preparing_fix" \| "fix" \| "ended"`，后者是 TS enum（`AwdpPhase.Pending` 等）。混用类型/导入会报错 | `awdp.ts:13`；`entity/sea_orm_active_enums.ts:50-56` |
| 17 | `AwdEventStatus.status` / `phase`、`AwdPrecheckRun.status`、`AdminInstanceRow.status` 等都是 `string`（不是联合），需要自己收窄；只有 `AwdpPhase` / `InstancesDto.instance_type` 等少数是联合 | `awd.ts:10-11`；`admin/instances.ts:12`；`awdp.ts:13` |
| 17b | **字段"在 SDK 类型里不存在"的典型**：`EventInfo` 没有 `title`/`family`（赛事字段都在 `.event` 下，`types/eventInfo.ts:16-21`）；`AdminInstanceRow` 没有 `flag`（注释明说"列表不返回 flag"，`admin/instances.ts:5-9`）；`AwdPlayerStatus` 没有 `round_duration_secs`/`free_reset_count`（这些只在管理端 `AwdEventStatus`，`awd.ts:9-28` vs `awd.ts:164-174`）；`AwdpEvaluationDto` 没有 `exploit_result`（只有 run 版 `AwdpRunEvaluationDto` 有，`awdp.ts:449-460` vs `awdpRuns.ts:117-130`）；`Instances` 是 DTO 别名而不是生成实体 `entity/event_challenge_instance`，字段以接口为准（`types/instanceDto.ts:1-6,29-30`）；`DashboardSummary` 的子结构全是内联匿名类型，没有独立的命名类型可引用（`admin/dashboard.ts:4-61`） | 见左列各条 |

### 5.2 参数形态类（位置参数 / 柯里化 / 必填 id）

| # | 陷阱 | 证据 |
|---|---|---|
| 18 | **柯里化方法**（必须两次调用；只调一次拿到的是函数，`await` 它不会执行请求）：`admin.event_challenges.fetch` / `.remove`、`admin.event_users.fetch` / `.delete`、`admin.event_announcements.fetch/create/patch/remove`、`admin.event_logs.fetch`、`admin.event_writeups.fetch`、`admin.event_teams.getTeams` / `.remove`、`admin.challenges.getChallengeSet` / `.removeChallengeFromSet` | `admin/event_challenges.ts:8,52`；`admin/event_users.ts:7,31`；`admin/event_announcements.ts:7,21,30,39`；`admin/event_logs.ts:7`；`admin/event_writeups.ts:7`；`admin/event_teams.ts:7,13`；`admin/challenges.ts:93,103` |
| 19 | `getTeams(id)` 的第二层**没有参数**，写成 `getTeams(id)(params)` 是类型错误 | `admin/event_teams.ts:7-12` |
| 20 | **位置参数顺序相反**：`instances.launchSingle(challenge_id, event_id)` ↔ `events.launchSingleInstance(event_id, challenge_id)` | `service/instances.ts:15-24`；`service/events.ts:95-104` |
| 21 | `submit.submitWriteup(file: File, event_id: string, team_id?: string)` 是位置参数；字段名是 `writeup_pdf` | `service/submit.ts:27-44` |
| 22 | `admin.weapons.upload(weapon_id, weapon: File)` 是位置参数；`admin.super_admin.patch(id, data)` 是位置参数 | `admin/weapons.ts:25-42`；`admin/super_admin.ts:25-31` |
| 23 | AWD/AWDP 系列大量位置参数：`banTeam(eventId, teamId, { reason? })`、`unbanTeam(eventId, teamId)`、`attachGamebox(eventId, gameboxId, hidden?)`、`updateEventGamebox(eventId, eventGameboxId, body)`、awdp player/runs 的 `(eventId|runId, egId|gameboxId, …)` | `awd.ts:347,361,521,535`；`awdp.ts:290,376,385`；`awdpRuns.ts:257-310` |
| 24 | `patch(Partial<X>)` 系列**必须自带 `.id`**（URL 用它拼接，否则请求 `/xxx/undefined`）：`service.discussions.patch`、`admin.announcements.patch`、`admin.challenges.patch`、`admin.settings.patch`、`admin.weapons.patch`、`admin.users.patch`、`admin.events.patch`、`admin.scheduled_tasks.patch`、`admin.challenges.patchChallengeSet`、`admin.event_announcements.patch(eventId)(announcement)` | `service/discussions.ts:37`；`admin/announcements.ts:29`；`admin/challenges.ts:29,127`；`admin/settings.ts:32`；`admin/weapons.ts:18`；`admin/users.ts:17`；`admin/events.ts:17`；`admin/scheduled_tasks.ts:22`；`admin/event_announcements.ts:33` |
| 25 | 批量删除**不是路径参数**，而是 `DELETE` + body：`remove(id_list: string[])` 内部 `http.delete(url, { data: { id_list } })`；`service.instances.bulkDelete` 同理 | `admin/announcements.ts:19-24`；`admin/challenges.ts:33-38`；`service/instances.ts:36-39`；`admin/super_admin.ts:19-24` |
| 26 | `admin.event_users.add` 的 body 同时含 `user_id` 与 `user_id_list`（都可选，至少给一个）；`admin.event_challenges.add` 同理（`challenge_id` 或 `challenge_id_list` + `points`） | `admin/event_users.ts:17-30`；`admin/event_challenges.ts:19-36` |
| 27 | `awdp.player.uploadPatch` / `awdp.runs.uploadPatch` 用 FormData 但**不显式设置** `Content-Type`（让 axios 带 boundary），而 `service.uploads.*` / `admin.weapons.upload` / `service.submit.submitWriteup` 显式写了 `"Content-Type": "multipart/form-data"`。上传字段名各不相同（见下表），写错就是 400/缺文件 | `awdp.ts:385-393`、`awdpRuns.ts:264-272` vs `service/uploads.ts:9-13`、`admin/weapons.ts:32-40`、`service/submit.ts:38-42` |
| 28 | `service.users.reset` 把 token 放在 **URL 查询串**里（`/users/reset?token=${token}`），未做 `encodeURIComponent`；token 会进日志/Referer | `service/users.ts:69` |
| 29 | `client.awdp.runs.gameboxCatalog(params)` 会**强制覆盖**你传入的 `capability`（`{ ...params, capability: "awdp" }`） | `awdpRuns.ts:163-169` |
| 30 | `admin.event_challenges.remove` / `admin.users.fetch` 内部有 `console.log`（把整页响应/`id_list` 打进控制台，用户对象含 `password` 字段类型） | `admin/event_challenges.ts:54`；`admin/users.ts:9` |
| 31 | `QueryParams` 只有 5 个键（`offset`/`limit`/`page`/`total`/`filter`）：`{ search }`、`{ sort }`、`{ pageSize }` 都是类型错误 | `protocol.ts:15-21` |
| 32 | 上传/导入的 multipart 字段名对照：`package_zip`（`admin.challenges.importChallenge`、`awd.admin.importGamebox`）、`writeup_pdf`（`service.submit.submitWriteup`）、`image_file`（`service.uploads.*`）、`weapon`（`admin.weapons.upload`）、`patch_file`（AWDP patch） | `admin/challenges.ts:44`；`awd.ts:398`；`service/submit.ts:33`；`service/uploads.ts:8,18`；`admin/weapons.ts:30`；`awdp.ts:387`；`awdpRuns.ts:266` |

### 5.3 SSE / React 类

| # | 陷阱 | 证据 |
|---|---|---|
| 33 | `headers`、`signal`、`onEvent` 必填；`client.sse.connect({ url })` 编译失败 | `client.ts:62-67`；`connectSse.ts:36-59` |
| 34 | SSE 的 401/403 **不会**触发 `FloatCTFClientOptions.onUnauthorized`（走 `fetch`，不经 axios 拦截器），只会把 `state` 变成 `"auth_error"` 并停止重连 | `transport.ts:151-167` vs `connectSse.ts:157-168` |
| 35 | `resolveSseUrl` 不检测重复前缀：`baseUrl: "/api"` + `url: "/api/events/1/awd/stream"` 会拼成 `/api/api/events/...` | `client.ts:106-112,142` |
| 36 | `Content-Type` 不是 `text/event-stream`（如被网关缓冲/压缩）会直接 `state = "error"` 且不重连 | `connectSse.ts:196-201` |
| 37 | `lastEventId` 只在**建连时**生效（`buildHeaders` 用的是初始值），后续事件 id 不会自动跟进；需要自己记录并在重连时传入 | `connectSse.ts:131-133,153-155`；`connectSse.ts:285` |
| 38 | `useAwdpEventStream` / `useAwdpRunStream` 的 `lastEvent` 返回 `lastEventRef.current`（ref 变化不触发重渲染）→ 在 render 中读它常常是旧值/`null`；AWD 两个 hook 用 `useState` 才会更新 | `useAwdpEventStream.ts:45,74,191`；`useAwdpRunStream.ts:42,59,164` vs `useAwdEventStream.ts:67,96,216` |
| 39 | `createFloatCTFReact` 的 `useAdminToken` 省略时会**复用** `useUserToken`（把选手 token 发到 admin API） | `react/index.ts:41-49` |
| 40 | 四个 hook 内部调用 `useQueryClient()`，必须在组件内且上层有 `QueryClientProvider` | `useAwdEventStream.ts:26,64` |
| 41 | `invalidateAwdQueries` 只失效 `[key, eventId]` 两段式 key；页面若用别的 key 形态（如 `["awd-scores"]`）SSE 刷新不到它（这正是常量列表存在的理由） | `awdInvalidation.ts:35-44`；注释 `awdInvalidation.ts:5-9` |
| 42 | `eventInfoQueryOptions` **刻意不设** `staleTime: 0`（否则 loader 每次进详情都重新请求并等待、白屏）；别自己覆盖 | `queries/eventInfo.ts:10-14` |
| 43 | `systemInformationQueryOptions` 走的是**管理端** `client.admin.system.monitor()`，需要 admin token | `queries/systemInformation.ts:11-16` |
| 44 | `challengeInstanceQueryOptions` 对非动态题可能 404，注解建议 loader 里 `.catch()` 尽力预取，不要硬 `ensureQueryData` | `queries/challenge.ts:15-21` |

### 5.4 装配 / 配置 / 乐观锁类

| # | 陷阱 | 证据 |
|---|---|---|
| 45 | `requestConfig.baseURL` 被类型排除，而且即使绕过类型也会被客户端权威值覆盖（`baseURL` 放在 spread 之后） | `transport.ts:52-58,194-199` |
| 46 | AWD / AWDP 配置 PATCH 的**乐观锁字段 `expected_updated_at`**：`AwdEventConfigInput.expected_updated_at?`、`AwdpConfigPatchInput.expected_updated_at?`（首次创建可省） | `awd.ts:31-32`；`awdp.ts:122-123` |
| 47 | `awd.admin.updateEventGamebox` / `updateGamebox` 里多个可空字段（`judge_timeout_secs`、`judge_retry_interval_secs`、`healthchecks_json` 等）**显式传 `null` 表示清空**，与"省略 = 不改"语义不同 | `awd.ts:407-422,538-549` |
| 48 | `awd.admin.getEventNetwork` 在赛事网络未分配时后端返回 404（源码注释明说），会 reject 成 `FloatCTFError{kind:"http",httpStatus:404}`，需要 catch | `awd.ts:253`（注释）、`awd.ts:487-493` |
| 49 | `awd.admin.getStatus` 的 `data` 可能是 `null`（赛事未开 AWD），不要直接读 `.status` | `awd.ts:279-284` |
| 50 | SDK 类型里 `Users.password: string`、`SuperAdmin.password: string` 是必填字段——类型允许你读它，但**不要**把它渲染/记录进日志 | `entity/users.ts:5`；`entity/super_admin.ts:4`；`admin/users.ts:9`（console.log 整个响应） |
| 51 | `GameBoxConfigPayload` 已 `@deprecated`（手动建配置入口已移除，改用包导入） | `awd.ts:130-136` |
| 52 | `FloatCTFError.response?.data` 是 `unknown`；要读平台文案请用 `platformMessage` / `displayMessage`，别直接 `(e.response.data as any).message` | `errors.ts:31,71-74` |
| 53 | `onError` 收到的**一定**是归一化后的 `FloatCTFError`（不是原始 axios 错误），但 `FloatCTFError.original` 里才有 axios 错误对象 | `transport.ts:156-166`；`errors.ts:44-45` |
| 54 | `client.service.awd === client.awd.player`、`client.admin.awd === client.awd.admin`——是同一对象，别在两处做状态假设 | `client.ts:158-161` |
| 55 | `bootstrapFrontend` 每次都新 `import()` 入口并把 `root.textContent = ""` 清空后 mount；返回的 unmount 函数会被丢弃（当前每次页面加载只挂载一次） | `bootstrap.ts:294-309` |
| 56 | `parseFrontendManifest` / `parseRegistry` 是 **fail-closed**：未知字段直接 `ok:false`，不会静默忽略 | `manifest.ts:65-75,119-123`；`registry.ts:67-97,232` |

---

## 6. 核对记录

以下命令均在 `/home/fb0sh/Projects/floatctf` 下真实执行，输出为原文摘录。

### 6.1 方法总数（按门面工厂提取对象字面量的顶层键）

脚本 `/tmp/count3.mjs`（扫描 `packages/sdk/src/api/**`，排除 `index.ts`，对每个 `export function create*` 找到其 `return {` 并按括号深度收集深度 1 的 `name:` 键；`createAdminLoginFn` 直接返回 async 函数，计 1）：

```console
$ node /tmp/count3.mjs
admin/announcements.ts	createAnnouncementAdminApi	4	fetch,create,remove,patch
admin/auth.ts	createAdminLoginFn	1	(直接返回 async 函数)
admin/challenges.ts	createChallengeAdminApi	15	fetch,create,patch,remove,importChallenge,checkChallenges,buildChallenges,scanChallenges,getChallengeSets,createChallengeSet,deleteChallengeSet,getChallengeSet,removeChallengeFromSet,addChallengeToSet,patchChallengeSet
admin/dashboard.ts	createDashboardAdminApi	1	summary
admin/database.ts	createDatabaseAdminApi	1	exec_sql
admin/discussions.ts	createDiscussionAdminApi	5	fetch,get,remove,getComments,removeComment
admin/docker.ts	createDockerAdminApi	9	fetchContainers,stopContainer,startContainer,deleteContainer,fetchImages,deleteImage,fetchNetworks,createNetwork,deleteNetwork
admin/download.ts	createDownloadAdminApi	1	download
admin/event_announcements.ts	createEventAnnouncementAdminApi	4	fetch,create,patch,remove
admin/event_challenges.ts	createEventChallengeAdminApi	6	fetch,add,setPoints,remove,open,hidden
admin/event_logs.ts	createEventLogAdminApi	1	fetch
admin/event_teams.ts	createEventTeamAdminApi	4	getTeams,remove,banned,unbanned
admin/event_users.ts	createEventUserAdminApi	5	fetch,add,delete,banned,unbanned
admin/event_writeups.ts	createEventWriteupAdminApi	1	fetch
admin/events.ts	createEventAdminApi	9	fetch,create,patch,remove,get,getData,getReport,exportWriteUps,createChallengeSet
admin/instances.ts	createInstanceAdminApi	1	listForEvent
admin/logs.ts	createLogsAdminApi	1	fetch
admin/scheduled_tasks.ts	createScheduledTaskAdminApi	5	fetch,create,patch,remove,run
admin/settings.ts	createSettingAdminApi	4	fetch,create,remove,patch
admin/super_admin.ts	createSuperAdminApi	4	fetch,create,remove,patch
admin/system.ts	createSystemAdminApi	2	monitor,version
admin/users.ts	createUserAdminApi	4	fetch,create,patch,remove
admin/weapons.ts	createWeaponsAdminApi	5	fetch,create,patch,remove,upload
awd.ts	createAwdAdminApi	36	getStatus,createEvent,updateConfig,deploy,start,pause,resume,finish,precheck,prechecks,scores,archive,resetGamebox,banTeam,unbanTeam,rotateTokens,adjustScore,listGameboxes,importGamebox,updateGamebox,hideGamebox,removeGamebox,scanGameboxes,checkGameboxes,buildGameboxes,getPlatformNetwork,updatePlatformNetwork,getPlatformNetworkHealth,getPlatformNetworkAllocations,getEventNetwork,allocateEventNetwork,reallocateEventNetwork,listEventGameboxes,addEventGamebox,updateEventGamebox,removeEventGamebox
awd.ts	createAwdPlayerApi	7	status,gameboxes,resetGamebox,submitFlag,scores,wireguardConfig,sshConfig
awdp.ts	createAwdpAdminApi	11	getConfig,updateConfig,start,breakToFix,finish,attachGamebox,detachGamebox,listEventGameboxes,listInstances,scores,dataPresent
awdp.ts	createAwdpPlayerApi	14	overview,startInstance,stopInstance,resetInstance,getInstance,submitBreak,uploadPatch,testCheck,sourceUrl,rounds,evaluations,scores,scoreboard,trend
awdpRuns.ts	createAwdpRunApi	23	gameboxCatalog,startTraining,getRun,stopRun,resetRun,startRun,endRun,setPhase,restartTraining,rounds,evaluations,scores,getWriteup,saveWriteup,submitBreak,uploadPatch,testCheck,allCheck,sourceUrl,startInstance,stopInstance,resetInstance,getInstance
service/announcements.ts	createAnnouncementServiceApi	1	fetch
service/challenges.ts	createChallengeServiceApi	10	fetch,get,getInstance,getMyWriteup,createMyWriteup,getWriteup,getWriteups,getAllWriteups,getChallengeSets,getChallengeSet
service/discussions.ts	createDiscussionServiceApi	11	fetch,get,create,patch,remove,like,unlike,getComments,createComment,patchComment,deleteComment
service/events.ts	createEventServiceApi	15	fetch,join,leave,createTeam,joinTeam,quitTeam,get,fetchChallenges,getChallengeInstance,getInstances,launchSingleInstance,getScoreboard,getTrend,getAnnouncements,getOwnWp
service/instances.ts	createInstanceServiceApi	5	launch,launchSingle,fetch,destroy,bulkDelete
service/solves.ts	createSolveServiceApi	2	fetch,getTop15Users
service/submit.ts	createSubmitServiceApi	3	submit,submitWriteup,submitSingle
service/uploads.ts	createUploadsServiceApi	2	upload_image,upload_avatar
service/users.ts	createUserServiceApi	6	getMe,patchMe,login,register,resetPassword,reset
service/weapons.ts	createWeaponsServiceApi	1	fetch
GRAND TOTAL 240
```

分组求和（与 §2.8 一致）：service 56 + admin 93（含 `login`）+ awd.player 7 + awd.admin 36 + awdp.player 14 + awdp.admin 11 + awdp.runs 23 = **240**。

### 6.2 每个方法都出现在本文档中（交叉核对）

对源码里提取出的每一条「方法定义行」（`文件` + `行号`），逐条在本文档中查找 `文件:行` 引用；同时把三类包中所有非门面 `export type|interface` 名称逐条在文档中查找：

```console
$ node /tmp/verify-doc.mjs
METHOD ROWS EXPECTED: 239
METHOD ROWS WITH 文件:行 CITATION IN DOC: 239
MISSING METHOD CITATIONS: (none)
DTO DECLS (non-facade): 147 UNIQUE NAMES: 146
DTO NAMES FOUND IN DOC: 146
MISSING DTO NAMES: (none)
client.admin.login documented: true
```

说明：扫描器按「对象字面量顶层键」识别方法，得到 **239** 行；`client.admin.login` 来自 `createAdminLoginFn`（直接返回 async 函数、没有对象字面量），单独核对为 `true`，因此方法总数 = **240**。DTO 名称去重后 146 个（`EventChallengeResult` 在 `types/eventChallenge.ts` 与 `types/adminEventChallenge.ts` 各导出一次），文档 §3.2 与 §3.7 分别收录了两个不同定义。

### 6.3 关键事实的 grep 证据

```console
$ cd packages/sdk/src && grep -rn "floatCTFErrorFromEnvelope" .
./__tests__/errors.test.ts:6:	floatCTFErrorFromEnvelope,
./__tests__/errors.test.ts:76:describe("floatCTFErrorFromEnvelope", () => {
./__tests__/errors.test.ts:79:		expect(floatCTFErrorFromEnvelope(ok)).toBeNull();
./__tests__/errors.test.ts:83:		const error = floatCTFErrorFromEnvelope({ code: 7, message: "业务失败" });
./__tests__/errors.test.ts:90:		expect(floatCTFErrorFromEnvelope(null)).toBeNull();
./__tests__/errors.test.ts:91:		expect(floatCTFErrorFromEnvelope("text")).toBeNull();
./errors.ts:145:export function floatCTFErrorFromEnvelope(envelope: unknown): FloatCTFError | null {
./index.ts:42:	floatCTFErrorFromEnvelope,
```

→ 传输层（`transport.ts`）没有任何调用点，印证 §5.0-3 / §5.1-5。

```console
$ cd packages/sdk/src/api && grep -rn "return http\.\|return response;\|return res;" . | grep -v "res.data\|response.data"
./admin/event_users.ts:26:	        return http.post(`/events/${event_id}/users`, {
```

→ 全仓库仅此一处"未拆包"的方法，印证 §5.0-2。

```console
$ cd packages/sdk/src && grep -c "floatCTFErrorFromEnvelope\|UNI_SUCCESS_CODE" protocol.ts errors.ts transport.ts
protocol.ts:1
errors.ts:3
transport.ts:0
```

→ `transport.ts` 里 `UNI_SUCCESS_CODE` / `floatCTFErrorFromEnvelope` 出现次数为 **0**，印证平台业务码失败不会被传输层转成错误。

### 6.4 DTO / 契约类型计数

```console
$ node /tmp/dto.mjs
SDK 非门面 DTO 数: 119
frontend-runtime 契约类型数: 19
react 契约类型数: 9
合计: 147
```

口径：`packages/{sdk,react,frontend-runtime}/src` 中 `export type|interface` 的**声明**，排除 `__tests__`、排除 `sdk/src/entity/**`（实体另在 §3.11 单列 20 个模型 + 14 个枚举）、排除 `*Api` / `AdminLoginFn` 这类 `ReturnType` 门面别名（共 42 个）。合计 **147 条声明 / 146 个唯一名称**；重复的只有 `EventChallengeResult`（`types/adminEventChallenge.ts:12` 与 `types/eventChallenge.ts:4`，语义不同、必须按导入来源区分）。

### 6.5 后端路由交叉验证（SSE 四流）

```console
$ grep -rn "stream" apps/api/src/modules/event/awd/api/player.rs apps/api/src/modules/event/awd/api/admin.rs apps/api/src/modules/event/awdp/api/player.rs apps/api/src/modules/event/awdp/api/training.rs | grep "#\[get"
apps/api/src/modules/event/awd/api/player.rs:513:#[get("{event_id}/awd/stream")]
apps/api/src/modules/event/awd/api/admin.rs:1111:#[get("{event_id}/awd/stream")]
apps/api/src/modules/event/awdp/api/player.rs:614:#[get("{event_id}/awdp/stream")]
apps/api/src/modules/event/awdp/api/training.rs:1153:#[get("awdp/runs/{run_id}/stream")]
```

scope 前缀：`/api`（选手）+ `/api/admin`（管理）+ `/api/service`（AWDP Training）见 `apps/api/src/bootstrap/routes.rs:9-12,62-64`。

---

## 附：文档信息

- 覆盖源码：`packages/sdk/src/{index,client,transport,protocol,errors}.ts`、`sdk/src/api/**`、`sdk/src/types/**`、`sdk/src/sse/**`、`packages/react/src/**`、`packages/frontend-runtime/src/{index,version,manifest,registry,module,bootstrap}.ts`。
- 方法：**240**（§2.8）。
- 命名 DTO / 契约类型：**147 条声明 / 146 个唯一名称**（SDK 119 + react 9 + frontend-runtime 19；唯一重复名 `EventChallengeResult`），另单列 20 个实体模型与 14 个枚举（§3.11）。
- 陷阱：**57 条**表格条目（§5.1–§5.4）+ §5.0 里单列的 5 条「最重要」归纳（不重复计数）。


