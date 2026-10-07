# 交付说明（escape hatches / 公共契约缺口 / 验收证据）

> 本文件对应 [AI-FRONTEND-GUIDE §5.4](../../../docs/frontend/AI-FRONTEND-GUIDE.md) 的强制要求：
> **用了哪个逃生舱、为什么、对应哪个后端端点，必须写清**；以及 §20 的验收流程证据。
> 分类口径（A / B / C）见 [CAPABILITY-MATRIX `## Gaps found`](../../../docs/frontend/CAPABILITY-MATRIX.md)。

## 1. 用到的逃生舱（全部为文档化的 class B 公共接口）

| # | 逃生舱 | 位置 | 为什么必须用 | 对应后端端点 |
|---|---|---|---|---|
| 1 | `client.transport.service` / `client.transport.admin`（原始 axios 实例）+ `floatCTFErrorFromEnvelope` | `src/api/call.ts`（`installEnvelopeGuard`） | 平台业务失败是 **HTTP 200 + `code !== 0`**，SDK 传输层不会 reject（`floatCTFErrorFromEnvelope` 在 SDK 内 0 处调用）。不集中处理就会出现「请求失败但界面显示成功」。 | 全站（所有返回 `UniResponse` 的端点） |
| 2 | `client.adminHttp.post(...)` + 原生 `WebSocket` | `src/features/admin/infra/TerminalPage.tsx` | `client.admin.*` **没有**任何终端抽象，SDK 类型层也没有终端 DTO。 | `POST /api/admin/terminal/session`（签发一次性 HttpOnly ticket cookie）→ `GET /api/admin/terminal/ws`（升级 WebSocket；文本帧 `{type:"resize",cols,rows}`，终端数据为二进制帧） |
| 3 | 同源 `fetch(DEFAULT_REGISTRY_URL)` + `parseRegistry` | `src/features/admin/core/frontends.tsx` | 本地前端注册表是**同源静态文件**、不是后端 API，公共 SDK 没有「取数 + 解析」的一行式封装。 | 无（静态文件 `/__floatctf/frontends/registry.json`） |

**未使用的逃生舱**：`client.serviceHttp`（0 处）、`client.sse.connect(...)`（0 处 —— 实时全部走
`@floatctf/react` 的 4 个 hook：`useAwdEventStream` / `useAdminAwdEventStream` /
`useAwdpEventStream` / `useAwdpRunStream`）。

**安全约束遵守情况**：token 只经 `Authorization` 头（`src/auth/store.ts` 是唯一读写点），
**任何** URL / query string 里都不含 token；`Secret` / `CodeBlock` 组件对 SSH 密码与
WireGuard 私钥默认模糊显示。

## 2. 公共契约缺口（逐条，含类别）

### 2.1 class B —— 有逃生舱，能力算完整

| 缺口 | 处置 |
|---|---|
| Web 终端无 SDK 抽象 | 逃生舱 #2 |
| 本地前端注册表无「取数 + 解析」封装 | 逃生舱 #3 |
| 平台业务失败不 reject | 逃生舱 #1 |
| 题目附件下载无公共方法：真实 URL 靠前端拼 `/static/challenges/<safe_name>/<attachment.path>`（该路径约定未进入 SDK 与文档） | 按同一约定实现（与 Default 一致） |
| `client.admin.event_users.add` 声明返回 `UniResponse<null>`，**运行时返回 AxiosResponse**（`packages/sdk/src/api/admin/event_users.ts:26-30` 直接 `return http.post(...)` 未取 `.data`） | 调用点按 `(await …).data` 取信封 + `floatCTFErrorFromEnvelope` 兜底，并在代码注释标注 |

### 2.2 A 类但**类型与运行时不符**（会导致「按类型写就出错」）

| 缺口 | 证据 | 我们的处置 |
|---|---|---|
| `challenges.getInstance` / `events.getChallengeInstance` / `challenges.getMyWriteup` 声明 `UniResponse<T>` | 后端资源不存在时返回 HTTP 200 + `data: null`（`challenge/catalog/player.rs:166-198`、`event/common/api/player.rs:103-120`、`challenge/writeup/mod.rs:14-35`） | 一律用 `unwrapNullable` |
| `users.patchMe` 声明 `UniResponse<Users>` | 后端是 `UniResult<()>` → `ok_none()`（`identity/user/mod.rs:41,85`） | `unwrapNullable` + 失效 `qk.me` 重取权威资料 |
| `EventChallengeResult.id` / `EventInstanceResult.id` 声明必填 | 选手端后端 DTO 不序列化 id（`event/common/application/player_service.rs:60-74`）→ 运行时 `undefined` | 用 `row.challenge.id` / `row.instance.id` |
| `discussions.getComments` 返回类型缺作者字段 | 运行时是 `CommentWithAuthor`（`serde(flatten)` 实体 + `author_nickname` + `author_avatar`，`community/comment/mod.rs:14-20`） | 读取可选扩展字段，取不到回落到 `author_id` 前缀（**不编造昵称**） |
| `NetworkInfo.created` 声明存在 | 后端不返回 → 运行时 `undefined` | **不渲染该列**（不显示假时间） |
| `ScheduledTasks` 实体 `payload: string` / `timeout_secs: string` | 后端请求体期望 JSON value 与 `i32` | 不提交这两个字段（避免类型误导导致的运行时 400） |
| `ChallengesListItem.static_flag_value` 被交叉类型收窄为 `string \| undefined` | 无法类型安全地提交 `null` 清空 | 用窄化断言保留清空语义（已注释） |

### 2.3 影响「状态如实展示」的缺口（已显式降级，不静默）

| 缺口 | 影响 | 我们的处置 |
|---|---|---|
| `client.awd.player.submitFlag` 被抹成 `UniResponse<null>`，后端实际返回 `SubmissionResponse{success, attack_score, victim_loss, first_bonus, was_first_blood}`（`event/awd/api/dto.rs:387-393`） | 选手端无法展示「一血 / 本次得分明细」 | 提交后只 toast + 失效积分榜；**不臆造**字段；在代码注释标注 |
| `AwdPlayerStatus` 无 `free_reset_count`（只在管理端 `AwdEventStatus`） | 无法显示「剩余免费重置次数」 | 重置确认框如实写「消耗免费额度，超出将按平台规则扣分」，**不显示具体次数** |
| `client.awd.admin` 只有 `banTeam` / `unbanTeam`，**没有**「列出 AWD ban 记录」的端点；`awd_team_bans` 也无 admin 列表接口 | 管理端 AWD 战队面板无法如实显示某队当前是否处于 **AWD ban** | 只展示 `event_teams.banned`（赛事级）并明确标注口径差异；`banTeam`/`unbanTeam` 本身能力完整可用。**这是本次审计中唯一「连逃生舱也到不了」的查询缺口**（AWD 运维的「战队封禁/解封」能力行本身仍算完整） |
| `@floatctf/react` 的 SSE hook 只失效**硬编码**查询键（`useAwdpEventStream.ts:58-65` 的 `["awdp-overview", id]` 等、`useAwdEventStream` 的 `["awd-scores", id]` 等） | 与本前端的 `qk` 层级（`["awd","player",id,…]`、`["awdp","event",id,…]`、`["training","run",id]`）不重叠 → hook 的事件失效与断线回退轮询对本前端查询是 **no-op** | 自行实现事件→查询键映射（AWD：`src/features/awd/stream.tsx`）与桥接（AWDP：`useAwdpSseBridge`），并按阶段加兜底轮询（break/fix 20s、preparing_fix 8s）。**建议平台侧**让 hook 接受调用方键前缀，或导出失效键常量 |
| `client.admin.users.fetch` 内部有 `console.log(res.data)`（`packages/sdk/src/api/admin/users.ts:9`） | 会把含 `Users.password` 哈希的整个用户列表打进浏览器控制台 —— 违反平台级「不得泄漏凭据」 | SDK 不在本仓库可写范围，**未修改**；已在本说明中上报 |
| `QueryParams.filter` 的分隔符不是逗号 | 实现按空白 / `&` / `|` 解析（`apps/api/src/api/sea_orm_utils.rs:28-63`），逗号拼接会**静默返回错误结果** | 只发单条件 `filter`，其余在前端过滤。**注意**：`docs/CAPABILITY-BEHAVIOR-MAP.md` §9 写的「逗号分隔（Default 拼法）」是**文档错误** |

### 2.4 class C

**本清单没有 class C**：上述每一项都能由公共方法（A）或文档化的逃生舱（B）触达；
唯一「连逃生舱也到不了」的是 §2.3 里 AWD ban **状态查询**（后端无端点），
它不影响任何 required 能力行的功能完整性，只影响一个附加的状态展示。

## 3. 已知偏差（有意为之）

1. **交互模型**：Default 把赛事能力拆成一堆页面；本前端合并进 `/events/:id?tab=`（选手）与
   `/admin/events/:id?tab=`（管理）。这是平台明确允许的**交互自由**
   （AI-FRONTEND-GUIDE §2.3 / §12.2：「行为相同 ≠ 点击序列相同」）。
2. **管理端讨论详情**用右侧抽屉承载，没有独立深链 URL（选手端有 `/community/discussions/:id`）。
3. **`/admin/database`**：能力表写作「多语句执行」，但后端明确**拒绝**多语句请求
   （且非只读语句需 `/* ADMIN_CONFIRMED */` 前缀 + TOML `[features].unsafe_sql_admin=true`）。
   本前端按**后端真实契约**实现：脚本前端切分 → 逐条提交 → 逐条展示 `SqlResult`；
   高风险语句（`DROP/TRUNCATE/DELETE/UPDATE/ALTER`，含数据修改型 CTE）要求输入 `EXECUTE`。
4. **AWDP 训练** `restartTraining` / `endRun` 的确认文案按**后端真实语义**撰写
   （`restartTraining` 要求 `phase == Ended` 且**新建** run；`endRun` 只停实例并置 `Ended`、
   保留回合与计分历史）—— `CAPABILITY-BEHAVIOR-MAP` 该处的描述与后端实现不一致。
5. **深色模式**：通过 `prefers-color-scheme` 只替换表面 / 文字令牌，主色与鎏金保持不变。
6. **不引入任何组件库**：Primer / Tailwind / AntD / xterm 等一律未使用；终端为最小自研实现，
   页面上如实列出了它的限制（无回滚缓冲、无字形宽度处理等）。

## 4. 验收证据（§20 的 13 步）

见根目录 `README.md §1/§2` 的操作步骤，以及最终交付回复中的逐步结果。
自动化可复现的部分：

| 步骤 | 命令 / 方式 | 结果 |
|---|---|---|
| 构建 | `mise exec -- pnpm --filter @floatctf/frontend-xzmu build` | ✅ `vite build && tsc --noEmit` 通过（599 modules） |
| 产物 manifest | `dist/frontend.json` + 构建期 `parseFrontendManifest` 自检 | ✅ 无 `build` 段、契约 `runtime 1 / api 1` |
| 制品校验 | `./scripts/frontend.sh verify /tmp/xzmu-0.1.0.tar.gz` | ✅ `制品校验通过：xzmu@0.1.0` |
| 平台架构门禁 | `mise run web:architecture` | ✅ OK（未破坏任何平台边界） |
| 能力覆盖（机械核对） | 提取 CAPABILITY-MATRIX 89 条 `required` 行里的全部 `client.*` 方法路径，逐个在 `src/**` 中查找 | ✅ 78 个唯一方法路径，**0 缺失** |
| 制品启动（真实 bootstrap 链路） | 本地复刻 Caddy 角色：`apps/web/dist` + `registry.json` + 版本化制品 + `/api` 反代 | ✅ 登录页正常渲染（校徽走 `context.assetBaseUrl`） |
| 深链刷新 | 直接访问 `/community/discussions/mine` 并加载 | ✅ SPA fallback + 路由命中 + 守卫跳 `/login?next=…` |
| 破窗回退 | `/?frontend=default` | ✅ 加载内置 Default 前端，不改设置、不需登录 |
| 错误可见 | 断开 API 后提交登录 | ✅ 页面显示「服务器暂时不可用（HTTP 502），请稍后重试。」 |
