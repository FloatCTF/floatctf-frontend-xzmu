# FloatCTF 前端 `xzmu` 能力覆盖核对（CAPABILITY-COVERAGE）

> 核对对象：[`docs/frontend/CAPABILITY-MATRIX.md`](../../docs/frontend/CAPABILITY-MATRIX.md) 中
> `Required for complete frontend` 列**以 `required` 开头**的行，共 **89 行**。
> 核对范围：本仓库 `src/**` 的真实实现（页面 / 面板 / 路由 / SDK 调用）。
> 目的：证明「本前端是否完整替换 FloatCTF 前端」，**不是**证明它与 Default 的路由一一对应。

## 口径说明

1. **完整性 = 能力覆盖，不是路由对齐。** CAPABILITY-MATRIX 的「How to use this matrix」已明确：
   `Default reference` 列只是语义指针，页面数量、路由路径、导航层级、点击顺序都不是判据。
   本前端可以（也确实）把 Default 的多个页面合并进一个页面，**这不构成缺口**。典型例子：
   - Default 的 AWD 选手端有 `index / gameboxes / scoreboard / wireguard / ssh` 等多个页面，
     本前端把它们**全部**放进 `/events/:id?tab=arena` 一个面板（`src/features/awd/panels.tsx`）；
   - Default 的 AWDP 赛事端有 `-workbench / rounds / scoreboard / trend`，本前端合并进
     `/events/:id?tab=drill`（`src/features/awdp/panels.tsx`）；
   - Default 的赛事管理是一整套子路由，本前端合并进 `/admin/events/:id?tab=` 控制台
     （`src/features/admin/events/EventConsole.tsx`）。
   因此本表「本前端位置」列给出的是 **root-absolute 路由 + 承载组件**，而不是「与 Default 相同的页面」。
2. **判定标准**（沿用 CAPABILITY-MATRIX §How to use 第 2 条）：该能力有**真实后端数据**支撑
   （不是假数据 / 占位），且按后端语义实现权限与状态判定。三态（loading / empty / error）
   由 `QueryBoundary`（`src/ui/overlays.tsx`）统一承载。
3. **✅ / ⚠️ / ❌ 的口径**：
   - ✅ = 在代码里找到了承载该能力的真实实现与 SDK 调用；
   - ⚠️ = 已实现，但存在需要显式声明的限定（见 `## 已知偏差与说明`）；
   - ❌ = 在 `src/**` 里找不到实现（本表**没有** ❌，逐条证据见下）。
4. 本表的「能力」列**逐字复制**自 CAPABILITY-MATRIX 的 `Capability` 列，未做任何改写；
   为便于检索，每行末尾以 `MATRIX:L<n>` 标注它在 CAPABILITY-MATRIX 中的行号。

---

## 逐行核对表

### 平台引导与运行时契约（required 6 行）

| 能力（逐字取自 CAPABILITY-MATRIX） | 覆盖 | 本前端位置（路由 + 标签页/面板） | 核对依据（源码文件:行 或 SDK 调用） |
|---|---|---|---|
| 公开引导元数据 `GET /api/frontend`（`active_frontend` / `platform_version` / `api_contract_version` / `frontend_runtime_version` / `capabilities`） <br>`MATRIX:L34` | ✅ | 无路由（平台 bootstrap 阶段，前端只消费 `mount(context)`） | `src/entry.tsx:21-23`（`mount(context)` 直接使用 bootstrap 解析好的 context）；`src/dev.tsx:16-26`（dev 传同一 `FloatCTFMountContext` 形状）；`src/api/client.ts:49`（`baseUrl: context.apiBaseUrl`） |
| 前端挂载契约 `mount(context)` 与 `FloatCTFMountContext` 字段（`root` / `apiBaseUrl` / `assetBaseUrl` / `frontendId` / `frontendVersion` / `platformVersion` / `apiContractVersion` / `frontendRuntimeVersion` / `capabilities`） <br>`MATRIX:L35` | ✅ | 无路由（制品入口 `src/entry.tsx`） | `src/entry.tsx:21-31`（`mount` + `FloatCTFFrontendModule` 默认导出）；`src/app/mountApp.tsx:15`（`createRoot(context.root)`）；`src/api/client.ts:110-113`（`assetBaseUrl` 解析自带资产） |
| 契约版本常量与兼容性判断 <br>`MATRIX:L36` | ⚠️ | 无路由（构建期 + 平台 bootstrap） | 兼容性在制品 manifest 里**声明**并在构建期校验：`floatctf.frontend.json:8-11`（`compatibility.frontendRuntime/apiContract = "1"`）、`vite.config.ts:35-36`（`parseFrontendManifest(manifest)` 自检）；major 判定与诊断由平台 bootstrap 完成（`packages/frontend-runtime/src/registry.ts:452-457`、`manifest.ts:172-180`）。**前端运行时未再调用** `API_CONTRACT_VERSION` / `isMajorCompatible`（`grep` 全仓无命中），也没有应用内兼容性诊断界面。详见「已知偏差」§7.1 |
| 统一响应封装与成功码 <br>`MATRIX:L39` | ✅ | 全局（数据层，`src/api/`） | `src/api/call.ts:38-50`（`unwrap` 读 `UniResponse.data`）、`:69-76`（`callList` 读 `meta`）、`:27-35`（`installEnvelopeGuard` 用公开的 `floatCTFErrorFromEnvelope` 把 HTTP 200 + `code !== 0` 转成 rejection）；装配点 `src/api/client.ts:68` |
| 统一错误模型 <br>`MATRIX:L40` | ✅ | 全局（错误态与 toast） | `src/api/errors.ts:31-130`（把 `FloatCTFError` 的 `kind` / `httpStatus` / `code` / `platformMessage` 归一成 `ErrorView`，文案优先用后端原文）；渲染入口 `src/ui/overlays.tsx` 的 `QueryBoundary` / `useToast` |
| SSE 传输原语（Bearer 走 `Authorization`，指数退避重连） <br>`MATRIX:L41` | ✅ | `/events/:id?tab=arena`、`/events/:id?tab=drill`、`/training/:runId`、`/admin/events/:id?tab=awd` | `src/features/awd/stream.tsx:110-112`（`useBindings().useAwdEventStream`）；`src/features/awdp/panels.tsx:50-53`（`useAwdpEventStream`）；`src/features/training/pages.tsx:313-317`（`useAwdpRunStream`）；`src/features/admin/events/tab-awd.tsx:153-156`（`useAdminAwdEventStream`）——全部经 `@floatctf/react` 落到 `client.sse.connect` / `connectAdmin` |

### 认证与会话（required 11 行）

| 能力（逐字取自 CAPABILITY-MATRIX） | 覆盖 | 本前端位置（路由 + 标签页/面板） | 核对依据（源码文件:行 或 SDK 调用） |
|---|---|---|---|
| 选手注册 <br>`MATRIX:L49` | ✅ | `/register`（`RegisterPage`） | `src/features/auth/pages.tsx:204`（`client.service.users.register(form)`）；路由 `src/features/auth/routes.tsx:6` |
| 选手登录（签发 JWT） <br>`MATRIX:L50` | ✅ | `/login`（`PlayerLoginPage`） | `src/features/auth/pages.tsx:55`（`client.service.users.login`）、`:59`（登录后 `getMe()`）；路由 `src/features/auth/routes.tsx:5` |
| 当前用户信息（`GET /users/me`） <br>`MATRIX:L51` | ✅ | `/me`（`MePage`）+ 全局会话恢复 | `src/features/profile/pages.tsx:232`（`client.service.users.getMe`）；`src/app/App.tsx:89-93`（`SessionRestore` 用 `getMe` 校验 token） |
| 修改个人资料 <br>`MATRIX:L52` | ✅ | `/me`（资料表单） | `src/features/profile/pages.tsx:246`（`client.service.users.patchMe`）；头像 `:256`（`client.service.uploads.upload_avatar`，optional 行） |
| 忘记密码（发送重置邮件） <br>`MATRIX:L54` | ✅ | `/reset-password`（`ResetRequestPage`） | `src/features/auth/pages.tsx:295`（`client.service.users.resetPassword`）；路由 `src/features/auth/routes.tsx:8-12` |
| 凭 token 重置密码 <br>`MATRIX:L55` | ✅ | `/reset`（`ResetPage`） | `src/features/auth/pages.tsx:373`（`client.service.users.reset({ token, password, confirmed_password })`）；路由 `src/features/auth/routes.tsx:13` |
| 选手登出 <br>`MATRIX:L56` | ✅ | 任意选手页（顶栏账户菜单 / 命令面板） | `src/app/App.tsx:126-130`（`clearScope("user")` + 清空 QueryClient + 跳 `/login`）；入口按钮 `src/app/AppShell.tsx:158`、`:390-395`；token 清除 `src/auth/store.ts:94-96` |
| 管理端登录 <br>`MATRIX:L57` | ✅ | `/admin/login`（`AdminLoginPage`） | `src/features/auth/pages.tsx:136`（`client.admin.login`）；路由 `src/features/auth/routes.tsx:14` |
| 管理端登出 <br>`MATRIX:L58` | ✅ | `/admin/*`（控制台顶栏账户菜单） | `src/app/App.tsx:126-130`（`workspace === "admin"` → `clearScope("admin")` + 跳 `/admin/login`）；`src/auth/store.ts:94-95` |
| 401 统一处理（清对应 token；重新登录的引导方式由前端决定） <br>`MATRIX:L59` | ✅ | 全局（`UnauthorizedBridge`） | `src/api/client.ts:52-58`（`onUnauthorized({ scope })` 只清该 scope 的 token 并回调）；`src/app/App.tsx:65-75`（回调里 `navigate("/login?next=" / "/admin/login?next=")`）；`src/app/App.tsx:135-139`（守卫同样带 `next`） |
| token 注入（选手 / 管理端两个来源） <br>`MATRIX:L60` | ✅ | 全局（`createRuntime`） | `src/api/client.ts:50-51`（`getUserToken` / `getAdminToken` 注入 SDK）；`src/auth/store.ts:16-17`（`xzmu.user.token` / `xzmu.admin.token`）、`:80-86` |

### 选手端：账号与社区内容（required 7 行）

| 能力（逐字取自 CAPABILITY-MATRIX） | 覆盖 | 本前端位置（路由 + 标签页/面板） | 核对依据（源码文件:行 或 SDK 调用） |
|---|---|---|---|
| 全站公告列表 <br>`MATRIX:L67` | ✅ | `/community/announcements`（`AnnouncementsPage`）；总览 `/` 亦有摘要块 | `src/features/community/pages.tsx:105`（`client.service.announcements.fetch`）；`src/features/dashboard/Page.tsx:66` |
| 解题流水（分页 / 筛选） <br>`MATRIX:L69` | ✅ | `/community/solves`（`SolvesPage`） | `src/features/community/pages.tsx:178`（`client.service.solves.fetch(paging.params)`，服务端分页）+ `:196-199`（搜索过滤）+ `:187`（`readMeta`） |
| Top15 用户排行榜 <br>`MATRIX:L70` | ✅ | `/community/top`（`TopPage`）；总览 `/` 亦有 Top 卡片 | `src/features/community/pages.tsx:281`（`client.service.solves.getTop15Users()`）；`src/features/dashboard/Page.tsx:81` |
| 讨论区列表 <br>`MATRIX:L71` | ✅ | `/community/discussions`（`DiscussionsPage`）；`/community/discussions/mine` | `src/features/community/discussions.tsx:225`（`client.service.discussions.fetch(params)`）、`:98`（我的帖子）；路由 `src/features/community/routes.tsx:31-39` |
| 讨论详情 <br>`MATRIX:L72` | ✅ | `/community/discussions/:id`（`DiscussionDetailPage`） | `src/features/community/discussions.tsx:429`（`client.service.discussions.get(id)`）；路由 `src/features/community/routes.tsx:47-52` |
| 发帖 / 编辑 / 删除自己的讨论 <br>`MATRIX:L73` | ✅ | `/community/discussions`（新建）、`/community/discussions/mine`（编辑 / 删除）、`/community/discussions/:id`（编辑 / 删除） | `src/features/community/discussions.tsx:104`、`:236`（`create`）、`:249`、`:484`（`patch`）、`:259`、`:498`（`remove`） |
| 讨论评论 CRUD <br>`MATRIX:L75` | ✅ | `/community/discussions/:id`（评论区） | `src/features/community/discussions.tsx:436`（`getComments`）、`:512`（`createComment`）；`src/features/community/components.tsx:502`（`patchComment`）、`:512`（`deleteComment`） |

### 选手端：赛事与 Jeopardy（required 17 行）

| 能力（逐字取自 CAPABILITY-MATRIX） | 覆盖 | 本前端位置（路由 + 标签页/面板） | 核对依据（源码文件:行 或 SDK 调用） |
|---|---|---|---|
| 赛事列表（含 `hidden` / 家族 / 赛制过滤） <br>`MATRIX:L81` | ✅ | `/events`（`EventListPage`） | `src/features/events/pages.tsx:75`（`client.service.events.fetch()`）；赛制 / 状态 / 仅看我报名的筛选 `:116-136`；`hidden` 徽标 `src/features/events/pages.tsx:641`（驾驶舱头部） |
| 赛事详情（`EventInfo.event` / `joined` / `team_result`） <br>`MATRIX:L82` | ✅ | `/events/:id`（`EventCockpitPage` 概览 + 右栏 `RosterCard`） | `src/features/events/pages.tsx:600`（`client.service.events.get(eventId)`）；消费 `joined` `:259`、`team_result` `:187-190` |
| 加入 / 退出赛事 <br>`MATRIX:L83` | ✅ | `/events/:id`（右栏「参赛资格」卡片） | `src/features/events/pages.tsx:198`（`events.join`）、`:207`（`events.leave`），破坏性退出走 `useConfirm` `:284-291` |
| 战队创建 / 加入 / 退出 <br>`MATRIX:L84` | ✅ | `/events/:id`（右栏「参赛资格」卡片，团队赛制时） | `src/features/events/pages.tsx:216`（`createTeam`）、`:226`（`joinTeam`）、`:236`（`quitTeam`） |
| 赛事公告 <br>`MATRIX:L85` | ✅ | `/events/:id?tab=announcements`（`EventAnnouncementsPanel`） | `src/features/jeopardy/panels.tsx:680`（`client.service.events.getAnnouncements`）；标签注册 `src/features/events/pages.tsx:536-541` |
| 赛事积分榜 <br>`MATRIX:L86` | ✅ | `/events/:id?tab=scoreboard`（`EventScoreboardPanel`，**仅 `family === "jeopardy"` 时注册**） | `src/features/jeopardy/panels.tsx:383`（`client.service.events.getScoreboard`，30s 轮询 `:384`）；赛制门控注册 `src/features/events/pages.tsx:537-544`（在 `if (family === "jeopardy")` 块内，注释给出后端依据 `policy.rs:37-44`） |
| 赛事趋势（分数随时间） <br>`MATRIX:L87` | ✅ | `/events/:id?tab=trend`（`EventTrendPanel`，**仅 Jeopardy**） | `src/features/jeopardy/panels.tsx:550`（`client.service.events.getTrend`）；赛制门控注册 `src/features/events/pages.tsx:545-550` |
| 赛事实例列表 <br>`MATRIX:L88` | ✅ | `/events/:id?tab=instances`（`EventInstancesPanel`，**仅 Jeopardy**；AWD / AWDP 的实例分别在「靶场」/「演练」标签内）+ 单条销毁 | `src/features/jeopardy/panels.tsx:744`（`client.service.events.getInstances`）、`:748`（`instances.destroy`）；赛制门控注册 `src/features/events/pages.tsx:551-557` |
| 题目目录（挑战列表，分页 / 分类筛选） <br>`MATRIX:L90` | ✅ | `/challenges`（`ChallengeCatalogPage`） | `src/features/jeopardy/pages.tsx:123`（`client.service.challenges.fetch(params)`）；路由 `src/features/jeopardy/routes.tsx:22` |
| 题目详情（附件 / 描述 / 分值） <br>`MATRIX:L91` | ✅ | `/challenges/:id`（`ChallengeDetailPage`） | `src/features/jeopardy/pages.tsx:251`（`client.service.challenges.get`）；路由 `src/features/jeopardy/routes.tsx:34` |
| 独立题目实例获取 / 启动 <br>`MATRIX:L92` | ✅ | `/challenges/:id`（题目运行器）；`/sets/:id` 同 | `src/features/jeopardy/pages.tsx:74`（`challenges.getInstance`）、`:85`（`instances.launch`）；题集侧 `src/features/jeopardy/pages.tsx:797` + 复用同一运行器 |
| 独立题目实例销毁 <br>`MATRIX:L93` | ✅ | `/challenges/:id`（题目运行器）、`/instances`（实例列表行内） | `src/features/jeopardy/components.tsx:309`（`instances.destroy`）；`src/features/jeopardy/pages.tsx:503` |
| flag 提交（挑战维度） <br>`MATRIX:L94` | ✅ | `/challenges/:id`（题目运行器） | `src/features/jeopardy/pages.tsx:87`（`client.service.submit.submit({ instance_id, flag })`） |
| 我的实例列表 / 批量销毁 <br>`MATRIX:L95` | ✅ | `/instances`（`MyInstancesPage`） | `src/features/jeopardy/pages.tsx:474`（`instances.fetch(params)`）、`:503`（单条 `destroy`）、`:512`（`instances.bulkDelete`）；路由 `src/features/jeopardy/routes.tsx:24-28` |
| 赛事题目列表（按赛事开放集合） <br>`MATRIX:L100` | ✅ | `/events/:id?tab=challenges`（`EventChallengesPanel`，仅 `family === "jeopardy"` 时出现） | `src/features/jeopardy/panels.tsx:117`（`client.service.events.fetchChallenges(eventId, {})`）；门控 `src/features/events/pages.tsx:499-506` |
| 赛事题目实例获取 / 启动 <br>`MATRIX:L101` | ✅ | `/events/:id?tab=challenges`（题目行内实例面板） | `src/features/jeopardy/panels.tsx:167`（`events.getChallengeInstance`）、`:168`（`events.launchSingleInstance`） |
| flag 提交（赛事维度） <br>`MATRIX:L102` | ✅ | `/events/:id?tab=challenges` | `src/features/jeopardy/panels.tsx:171`（`client.service.submit.submitSingle({ event_id, instance_id, flag })`） |

### 选手端：AWD（required 8 行）

> 全部能力合并在一个面板：`/events/:id?tab=arena`（`src/features/awd/panels.tsx`），标签仅在 `family === "awd"` 时出现（`src/features/events/pages.tsx:507-514`）。

| 能力（逐字取自 CAPABILITY-MATRIX） | 覆盖 | 本前端位置（路由 + 标签页/面板） | 核对依据（源码文件:行 或 SDK 调用） |
|---|---|---|---|
| 赛事状态（`status` / `phase` / `current_round` / `banned` / `score`） <br>`MATRIX:L109` | ✅ | `/events/:id?tab=arena`（`AwdStatusCard`） | `src/features/awd/panels.tsx:61`（`client.awd.player.status`）；相位/封禁判定集中在 `src/features/awd/phase.tsx`（`awdAvailability`） |
| GameBox 列表与我的实例（IP / 容器 / 健康） <br>`MATRIX:L110` | ✅ | `/events/:id?tab=arena`（`AwdGameboxesCard`） | `src/features/awd/components.tsx:319`（`client.awd.player.gameboxes`） |
| GameBox 重置 <br>`MATRIX:L111` | ⚠️ | `/events/:id?tab=arena`（`AwdGameboxesCard` 行内动作 + 二次确认） | `src/features/awd/components.tsx:325`（`client.awd.player.resetGamebox`）、`:333-350`（`useConfirm` 写明「销毁重建 / 消耗免费次数 / 超额扣分」）。**限定**：选手端 DTO 不返回剩余免费次数（`AwdPlayerStatus` / `AwdGameBox` 无该字段，`packages/sdk/src/api/awd.ts:46-55`、`:164-174`），页面只能说明规则、无法显示「还剩几次」（代码内已注明 `components.tsx:342-343`）。详见「已知偏差」§2 |
| flag 提交（攻击得分） <br>`MATRIX:L112` | ✅ | `/events/:id?tab=arena`（`AwdFlagCard`） | `src/features/awd/components.tsx:237`（`client.awd.player.submitFlag`）；仅 attack 相位可用的门控来自 `awdAvailability`（`src/features/awd/phase.tsx`） |
| 积分榜（`attack_score` / `defense_score` / `rank`） <br>`MATRIX:L113` | ✅ | `/events/:id?tab=arena`（`AwdScoresCard`，高亮本队） | `src/features/awd/components.tsx:472`（`client.awd.player.scores`，30s 轮询）；本队高亮 `src/features/awd/panels.tsx:125-129` |
| WireGuard 配置下发 <br>`MATRIX:L114` | ✅ | `/events/:id?tab=arena`（`AwdCredentialsCard`） | `src/features/awd/components.tsx:563`（`client.awd.player.wireguardConfig`），配置文本走 `<CodeBlock>` + `<CopyButton>` |
| 队伍 SSH 凭据（端口 / 密码 / 实例清单） <br>`MATRIX:L115` | ✅ | `/events/:id?tab=arena`（`AwdCredentialsCard`） | `src/features/awd/components.tsx:569`（`client.awd.player.sshConfig`）；密码用 `<Secret>` 默认模糊 `components.tsx:668` |
| 选手端实时流 <br>`MATRIX:L116` | ✅ | `/events/:id?tab=arena`（`AwdStreamNotice` + `AwdFeedCard`，并注入顶栏实时状态条） | `src/features/awd/stream.tsx:110-112`（`useAwdEventStream({ eventId })`，URL 由 hook 内置 `/events/{id}/awd/stream`）；状态条 `:124-131`；7 种状态含 `auth_error` 如实展示（`src/features/awd/components.tsx:66`） |

### 选手端：AWDP 比赛（required 10 行）

> 全部能力合并在一个面板：`/events/:id?tab=drill`（`src/features/awdp/panels.tsx`），标签仅在 `family === "awdp"` 时出现（`src/features/events/pages.tsx:515-522`）。

| 能力（逐字取自 CAPABILITY-MATRIX） | 覆盖 | 本前端位置（路由 + 标签页/面板） | 核对依据（源码文件:行 或 SDK 调用） |
|---|---|---|---|
| 赛事总览（`phase` / 时长配置 / 我的 GameBox / `my_score`） <br>`MATRIX:L122` | ✅ | `/events/:id?tab=drill`（「演练总览」卡片 + `AwdpTimingPanel`） | `src/features/awdp/panels.tsx:59`（`client.awdp.player.overview`）；`my_score` 展示 `:140`；时长面板 `src/features/awdp/components.tsx:460` |
| 实例启动 / 停止 / 重置 / 查询 <br>`MATRIX:L123` | ✅ | `/events/:id?tab=drill`（每张 `AwdpBoxCard` 的动作区） | `src/features/awdp/panels.tsx:104`（`startInstance`）、`:106-109`（`stopInstance`）、`:110`（`resetInstance`）、`:188-190`（`getInstance`） |
| Break 阶段 flag 提交 <br>`MATRIX:L124` | ✅ | `/events/:id?tab=drill`（`AwdpBoxCard` Break 表单） | `src/features/awdp/panels.tsx:101`（`client.awdp.player.submitBreak`） |
| 补丁上传（Fix 阶段） <br>`MATRIX:L125` | ✅ | `/events/:id?tab=drill`（`AwdpBoxCard` Fix 表单） | `src/features/awdp/panels.tsx:102`（`client.awdp.player.uploadPatch`） |
| 手工 Test Check <br>`MATRIX:L126` | ✅ | `/events/:id?tab=drill`（`AwdpBoxCard` 动作） | `src/features/awdp/panels.tsx:103`（`client.awdp.player.testCheck`） |
| 轮次列表 <br>`MATRIX:L128` | ✅ | `/events/:id?tab=drill`（「明细 → 回合」`AwdpRoundsCard`） | `src/features/awdp/panels.tsx:68`（`client.awdp.player.rounds`）；子视图切换 `:204-211` |
| 我的官方评测结果 <br>`MATRIX:L129` | ✅ | `/events/:id?tab=drill`（「明细 → 我的评测」`AwdpEvaluationsCard`） | `src/features/awdp/panels.tsx:74`（`client.awdp.player.evaluations`） |
| 积分榜（矩阵明细 `AwdpScoreboardDetail`） <br>`MATRIX:L131` | ✅ | `/events/:id?tab=drill`（「明细 → 积分榜」`AwdpScoreboardCard`） | `src/features/awdp/panels.tsx:83`（`client.awdp.player.scoreboard`，30s 轮询 `:84`） |
| 趋势 <br>`MATRIX:L132` | ✅ | `/events/:id?tab=drill`（「明细 → 趋势」`AwdpTrendCard`） | `src/features/awdp/panels.tsx:90`（`client.awdp.player.trend`，30s 轮询 `:91`） |
| 选手端实时流 <br>`MATRIX:L133` | ✅ | `/events/:id?tab=drill`（`AwdpLiveNotice` + 顶栏实时状态条） | `src/features/awdp/panels.tsx:53`（`useAwdpEventStream({ eventId })`，`/events/{id}/awdp/stream`）；状态条 `:54`；SSE 只用于失效、数据仍取 REST `:55` |

### 选手端：AWDP Training Ground（练习）（required 6 行）

| 能力（逐字取自 CAPABILITY-MATRIX） | 覆盖 | 本前端位置（路由 + 标签页/面板） | 核对依据（源码文件:行 或 SDK 调用） |
|---|---|---|---|
| 练习 GameBox 目录 + 开始训练（`capability: "awdp"`） <br>`MATRIX:L139` | ✅ | `/training`（`TrainingCatalogPage`） | `src/features/training/pages.tsx:110`（`client.awdp.runs.gameboxCatalog`）、`:114`（`client.awdp.runs.startTraining`）；已有 run 直接跳转的处理见文件头注释 `:9-11` |
| 练习 Run 生命周期（读取 / 开始 / 停止 / 重置 / 结束 / 切阶段 / 重新训练） <br>`MATRIX:L140` | ✅ | `/training/:runId`（`TrainingRunPage`） | `src/features/training/pages.tsx:324`（`getRun`）、`:370`（`startRun`）、`:378`（`stopRun`）、`:388`（`resetRun`）、`:394`（`endRun`）、`:400`（`setPhase`）、`:406`（`restartTraining`，返回新 `run_id` 后跳转） |
| 练习 Run 实例管理 <br>`MATRIX:L141` | ✅ | `/training/:runId`（`AwdpBoxCard` 动作区） | `src/features/training/pages.tsx:433`（`startInstance`）、`:436`（`stopInstance`）、`:439`（`resetInstance`）、`:714`（`getInstance`） |
| 练习 Run 破题 / 补丁 / 自检 / 全量校验 / 源码 <br>`MATRIX:L142` | ✅ | `/training/:runId`（`AwdpBoxCard` 动作区 + 源码下载） | `src/features/training/pages.tsx:430`（`submitBreak`）、`:431`（`uploadPatch`）、`:432`（`testCheck`）、`:441`（`allCheck`，二次确认见 `:14-16`）、`:440`（`sourceUrl`） |
| 练习 Run 轮次 / 评测 / 积分 <br>`MATRIX:L143` | ✅ | `/training/:runId`（「明细」分段：回合 / 评测 / 计分） | `src/features/training/pages.tsx:334`（`rounds`）、`:341`（`evaluations`）、`:348`（`scores` → `AwdpScoresCard`）；分段切换 `:303`、`:744-766` |
| 练习 Run 实时流 <br>`MATRIX:L145` | ✅ | `/training/:runId`（`AwdpLiveNotice` + 顶栏实时状态条） | `src/features/training/pages.tsx:317`（`useAwdpRunStream({ runId, enabled })`，`/service/awdp/runs/{runId}/stream`）；`:318` `useAwdpLiveStrip` |

### 管理端：总览与内容（required 4 行）

| 能力（逐字取自 CAPABILITY-MATRIX） | 覆盖 | 本前端位置（路由 + 标签页/面板） | 核对依据（源码文件:行 或 SDK 调用） |
|---|---|---|---|
| Dashboard 聚合总览（统计 / 需关注项 / 赛事 / 动态） <br>`MATRIX:L151` | ✅ | `/admin`（`AdminDashboardPage`） | `src/features/admin/core/dashboard.tsx:515`（`client.admin.dashboard.summary`）；统计 `:569-576`、需关注项 `:601`、赛事 `:602`、动态（最近解出 / 最近注册）`:603`；路由 `src/features/admin/routes-core.tsx:36` |
| 用户管理 CRUD <br>`MATRIX:L154` | ✅ | `/admin/users`（`AdminUsersPage`） | `src/features/admin/core/users.tsx:184`（`fetch`）、`:198`（`create`）、`:217`（`patch`）、`:236`（`remove`）；`password` 只作为表单输入（`:144`），从不作为数据显示 |
| 挑战管理 CRUD + 导入 / 校验 / 构建 / 扫描 <br>`MATRIX:L155` | ✅ | `/admin/challenges`（`AdminChallengesPage`） | `src/features/admin/events/ChallengesPage.tsx:107`（`fetch`）、`:522-523`（`patch` / `create`）、`:141`（`remove`）、`:151`（`importChallenge`）、`:161`（`checkChallenges`）、`:183`（`buildChallenges`）、`:200`（`scanChallenges`）；`static_flag_value` 一律经 `<Secret>` 模糊展示（`:391-392`） |
| 动态设置 CRUD（含受保护键 `FRONTEND_ACTIVE`） <br>`MATRIX:L162` | ✅ | `/admin/settings`（`AdminSettingsPage`）+ `/admin/frontends`（写入 `FRONTEND_ACTIVE`） | `src/features/admin/core/settings.tsx:230`（`fetch`）、`:242`（`create`）、`:262`（`patch`）、`:282`（`remove`）；受保护键写入 `src/features/admin/core/frontends.tsx:88`（`settings.fetch`）+ `:108`（`settings.patch({ id, value })`） |

### 管理端：赛事管理（required 7 行）

> 全部能力收敛在 `/admin/events/:id?tab=` 控制台（`src/features/admin/events/EventConsole.tsx:44-84`），
> 标签可见性由 `family` 决定；默认标签 `config`（`:109`）。

| 能力（逐字取自 CAPABILITY-MATRIX） | 覆盖 | 本前端位置（路由 + 标签页/面板） | 核对依据（源码文件:行 或 SDK 调用） |
|---|---|---|---|
| 赛事列表 / 创建 / 编辑 / 删除 <br>`MATRIX:L168` | ✅ | `/admin/events`（`AdminEventListPage`） | `src/features/admin/events/EventListPage.tsx:311`（`client.admin.events.fetch`）、`:117-118`（`patch` / `create`）、`:343`（`remove`） |
| 赛事详情读写（含家族 / 赛制 / `hidden`） <br>`MATRIX:L169` | ✅ | `/admin/events/:id?tab=config`（`ConfigTab`） | `src/features/admin/events/EventConsole.tsx:93`（`client.admin.events.get`）；写回 `src/features/admin/events/tab-config.tsx:76`（`client.admin.events.patch`） |
| 赛事题目管理（增删 / 改分 / 开放 / 隐藏） <br>`MATRIX:L171` | ✅ | `/admin/events/:id?tab=challenges`（`EventChallengesTab`） | `src/features/admin/events/tab-challenges.tsx:51`（`event_challenges.fetch`）、`:68`（`add`）、`:80`（`setPoints`）、`:113`（`remove`）、`:100-101`（`hidden` / `open`） |
| 赛事用户管理（增删 / 封禁 / 解封） <br>`MATRIX:L172` | ⚠️ | `/admin/events/:id?tab=users`（`EventUsersTab`） | `src/features/admin/events/tab-members.tsx:46`（`event_users.fetch`）、`:69-76`（`event_users.add`）、`:86`（`delete`）、`:99-100`（`banned` / `unbanned`）。**限定**：SDK `client.admin.event_users.add` 的声明与运行时不符（`packages/sdk/src/api/admin/event_users.ts:26-30` 直接返回 `http.post(...)` 未取 `.data`），本前端显式按 `(await …).data` 取信封 + `floatCTFErrorFromEnvelope` 兜底（代码内已注明 `tab-members.tsx:8-11`）。详见「已知偏差」§6 |
| 赛事战队管理（列表 / 删除 / 封禁 / 解封） <br>`MATRIX:L173` | ✅ | `/admin/events/:id?tab=teams`（`EventTeamsTab`） | `src/features/admin/events/tab-members.tsx:418`（`event_teams.getTeams(eventId)()`）、`:430`（`remove`）、`:443-444`（`banned` / `unbanned`） |
| 赛事公告管理 CRUD <br>`MATRIX:L174` | ✅ | `/admin/events/:id?tab=announcements`（`EventAnnouncementsTab`） | `src/features/admin/events/tab-content.tsx:56`（`event_announcements.fetch`）、`:76`（`create`）、`:74`（`patch`）、`:89`（`remove`） |
| 赛事统一实例列表（challenge + gamebox 归一化） <br>`MATRIX:L177` | ✅ | `/admin/events/:id?tab=instances`（`EventInstancesTab`） | `src/features/admin/events/tab-instances.tsx:33`（`client.admin.instances.listForEvent(eventId, params)` → `AdminInstanceRow[]`） |

### 管理端：AWD 运维（required 8 行）

| 能力（逐字取自 CAPABILITY-MATRIX） | 覆盖 | 本前端位置（路由 + 标签页/面板） | 核对依据（源码文件:行 或 SDK 调用） |
|---|---|---|---|
| AWD 赛事配置（创建 / 读取 / 更新，乐观锁 `expected_updated_at`） <br>`MATRIX:L183` | ✅ | `/admin/events/:id?tab=awd`（`AwdOpsTab` 配置表单） | `src/features/admin/events/tab-awd.tsx:169`（`awd.admin.getStatus`）、`:216`（`updateConfig`）、`:218`（`createEvent`）；乐观锁回传 `:441`（`parseConfigForm(form, status?.updated_at)`）→ `:117-119` |
| 生命周期：deploy / start / pause / resume / finish / archive <br>`MATRIX:L184` | ✅ | `/admin/events/:id?tab=awd`（生命周期动作区） | `src/features/admin/events/tab-awd.tsx:238`（`deploy`）、`:240`（`start`）、`:242`（`pause`）、`:244`（`resume`）、`:246`（`finish`）、`:248`（`archive`，`confirmPhrase` 二次确认 `:281-289`） |
| 凭据轮换与预检（precheck + 历史 `AwdPrecheckRun`） <br>`MATRIX:L185` | ✅ | `/admin/events/:id?tab=awd`（预检历史 + 轮换按钮） | `src/features/admin/events/tab-awd.tsx:175`（`awd.admin.prechecks`，20s 轮询）、`:259`（`precheck`）、`:268`（`rotateTokens`） |
| 分数调整与积分榜 <br>`MATRIX:L186` | ✅ | `/admin/events/:id?tab=awd`（AWD 战队与比分面板） | `src/features/admin/events/tab-awd-assets.tsx:60`（`awd.admin.scores`）、`:69`（`awd.admin.adjustScore`） |
| 战队封禁 / 解封 <br>`MATRIX:L187` | ✅ | `/admin/events/:id?tab=awd`（同面板战队区） | `src/features/admin/events/tab-awd-assets.tsx:251`（`event_teams.getTeams`）、`:259`（`awd.admin.banTeam`）、`:272`（`awd.admin.unbanTeam`） |
| 赛事 GameBox 挂载（列表 / 添加 / 更新 / 移除） <br>`MATRIX:L188` | ✅ | `/admin/events/:id?tab=awd`（赛事 GameBox 区） | `src/features/admin/events/tab-awd-assets.tsx:453`（`listEventGameboxes`）、`:479`（`addEventGamebox`）、`:500`（`updateEventGamebox`）、`:510`（`removeEventGamebox`） |
| GameBox 库管理（导入 / 扫描 / 校验 / 构建 / 隐藏 / 删除 / 更新） <br>`MATRIX:L189` | ✅ | `/admin/gameboxes`（`AdminGameboxesPage`） | `src/features/admin/events/GameboxesPage.tsx:96`（`listGameboxes`）、`:124`（`importGamebox`）、`:134`/`:558`（`updateGamebox`）、`:144`（`hideGamebox`）、`:153`（`removeGamebox`）、`:163`（`scanGameboxes`）、`:181`（`checkGameboxes`）、`:202`（`buildGameboxes`） |
| 赛事网络分配 / 重新分配 <br>`MATRIX:L190` | ✅ | `/admin/events/:id?tab=network`（`EventNetworkTab`） | `src/features/admin/events/tab-network.tsx:63`（`getEventNetwork`，404 按「未分配」处理 `:5-6`）、`:78`（`allocateEventNetwork`）、`:88`（`reallocateEventNetwork`） |

### 管理端：AWDP 运维（required 5 行）

| 能力（逐字取自 CAPABILITY-MATRIX） | 覆盖 | 本前端位置（路由 + 标签页/面板） | 核对依据（源码文件:行 或 SDK 调用） |
|---|---|---|---|
| AWDP 赛事配置读写（时长 / 分值 / 乐观锁） <br>`MATRIX:L199` | ✅ | `/admin/events/:id?tab=awdp`（`AwdpOpsTab`） | `src/features/admin/events/tab-awdp.tsx:59`（`awdp.admin.getConfig`）、`:98`（`updateConfig`）；乐观锁 `:180`（`expected_updated_at: config.updated_at`） |
| 生命周期：start / break-to-fix / finish <br>`MATRIX:L200` | ✅ | `/admin/events/:id?tab=awdp`（阶段控制区） | `src/features/admin/events/tab-awdp.tsx:114`（`start`）、`:116`（`breakToFix`）、`:118`（`finish`） |
| 赛事 GameBox 挂载 / 卸载 / 列表 <br>`MATRIX:L201` | ✅ | `/admin/events/:id?tab=awdp`（GameBox 区） | `src/features/admin/events/tab-awdp.tsx:405`（`listEventGameboxes`）、`:424`（`attachGamebox`）、`:436`（`detachGamebox`） |
| 赛事实例列表 <br>`MATRIX:L202` | ✅ | `/admin/events/:id?tab=awdp`（「赛事实例」卡片） | `src/features/admin/events/tab-awdp.tsx:605`（`client.awdp.admin.listInstances(eventId)`） |
| 积分榜 <br>`MATRIX:L203` | ✅ | `/admin/events/:id?tab=awdp`（积分榜卡片） | `src/features/admin/events/tab-awdp.tsx:689`（`client.awdp.admin.scores(eventId)`） |

### 管理端：基础设施、系统与平台设置（required 0 行）

> 本章在 CAPABILITY-MATRIX 中共 8 行，**全部为 `optional`（3）或 `specialized`（5）**，
> 没有 `required` 行，因此不进入本核对表的 required 计数。为完整性仅记录它们在本前端的落点
> （不属于本表的判定对象，不作为覆盖结论）：
> `/admin/docker`（`src/features/admin/infra/DockerContainers.tsx:63`、`DockerImages.tsx:46`、`DockerNetworks.tsx:63`）、
> `/admin/database`（`src/features/admin/infra/DatabasePage.tsx:376`）、
> `/admin/terminal`（`src/features/admin/infra/TerminalPage.tsx:332`）、
> `/admin/scheduled-tasks`（`src/features/admin/core/scheduledTasks.tsx:309`）、
> `/admin/frontends`（`src/features/admin/core/frontends.tsx:55`）。

---

## 覆盖统计

- **required 总数：89**
- **✅：86**
- **⚠️：3**（`MATRIX:L36` 契约版本常量与兼容性判断；`MATRIX:L111` GameBox 重置；`MATRIX:L172` 赛事用户管理）
- **❌：0**

> 修订记录：初版曾把 `MATRIX:L86` / `L87` / `L88`（赛事积分榜 / 赛事趋势 / 赛事实例列表）记为 ⚠️，
> 原因是这三个通用赛事标签未按赛制门控。该缺陷已修复（见「已知偏差」§5），重跑后三行改判 ✅，
> ⚠️ 由 6 降为 3。

统计口径：只统计本文件「逐行核对表」中**正文数据行**（`| … |`），不含表头与分隔行；
每条能力名称必须能在 CAPABILITY-MATRIX 的 89 条 required 行里逐字找到。

实际执行的统计命令与输出：

```bash
# ① 从 CAPABILITY-MATRIX 提取 required 行（跳过表头 / 分隔行），并核对总数与分章分布
cd /home/fb0sh/Projects/floatctf
python3 - <<'EOF'
import re
from collections import Counter
lines = open('docs/frontend/CAPABILITY-MATRIX.md', encoding='utf-8').read().split('\n')
chap, rows = None, []
for i, l in enumerate(lines, 1):
    if l.startswith('## '): chap = l[3:].strip()
    if l.startswith('|') and '---' not in l:
        c = [x.strip() for x in l.strip().strip('|').split('|')]
        if len(c) >= 7 and c[6].startswith('required'):
            rows.append((i, chap, c[1]))
print('TOTAL', len(rows))
print(Counter(r[1] for r in rows))
EOF
# TOTAL 89
# Counter({'选手端：赛事与 Jeopardy': 17, '认证与会话': 11, '选手端：AWDP 比赛': 10, '选手端：AWD': 8,
#          '管理端：AWD 运维': 8, '选手端：账号与社区内容': 7, '管理端：赛事管理': 7,
#          '平台引导与运行时契约': 6, '选手端：AWDP Training Ground（练习）': 6,
#          '管理端：AWDP 运维': 5, '管理端：总览与内容': 4})
```

```bash
# ② 以 CAPABILITY-MATRIX 的行号为锚，核对本文档「逐行核对表」：
#    行数 = 89、能力名逐字一致、无遗漏、无非 required 混入、无重复、分章分布一致，并统计覆盖列。
cd /home/fb0sh/Projects/floatctf
python3 /tmp/coverage-verify.py     # 脚本全文见「核对方法」§5
```

真实输出（本文件定稿时执行，含标签门控修复后的重跑）：

```
matrix_required = 89
doc_rows        = 89
verdicts        = {'✅': 86, '⚠️': 3}
text_mismatch   = 0 []
missing_lines   = []
non_required    = []
duplicates      = []
chapter_ok      = True
```

## 已知偏差与说明

### 1. 交互模型自由：Default 的多页赛事能力被合并进驾驶舱 / 控制台（不是缺口）

本前端刻意不给 Default 的每个页面配一条路由：

- 选手端：`/events/:id?tab=` —— `overview`（全部赛制）/ `announcements`（全部赛制）/
  `challenges`、`scoreboard`、`trend`、`instances`（仅 `jeopardy`）/ `arena`（仅 `awd`）/
  `drill`（仅 `awdp`），按赛制注册见 `src/features/events/pages.tsx:495-560`。
  Default 的 AWD 五个页面、AWDP 四个页面、赛事子页全部并入对应标签。
- 管理端：`/admin/events/:id?tab=` —— `config` / `challenges` / `users` / `teams` / `announcements` /
  `logs` / `instances` / `writeups` / `data`(jeopardy) / `awd` / `awdp` / `network`
  （`src/features/admin/events/EventConsole.tsx:44-84`）。
- 两个 `?tab=` 都是 root-absolute 可深链、可刷新（`useSearchParam`，
  `src/router/router.tsx`），因此合并**没有牺牲可寻址性**。
- 依据 AI-FRONTEND-GUIDE §「交互模型自由」与 CAPABILITY-MATRIX §How to use 第 1/3 条：
  完整性的判据是 89 项能力是否可用，而不是页面数量。

### 2. AWD「GameBox 重置」无法显示剩余免费次数（代码已如实声明）

FRONTEND-PLAN §4 写的是「重置 GameBox 要显示剩余免费次数与扣分」。实现时发现**选手端根本没有这个数据**：

- `AwdPlayerStatus` 字段为 `status/phase/current_round/round_count/banned/score/final_settlement`
  （`packages/sdk/src/api/awd.ts:164-174`）；
- `AwdGameBox` 字段为 `id/team_id/event_gamebox_id/gamebox_name/status/gamebox_ip/container_name/health_status`
  （同文件 `:46-55`）；均无「剩余免费次数 / 罚分」。
- 因此本前端的处置是：二次确认框写清**真实后果**（销毁重建、消耗免费次数、超额按平台规则扣分），
  并显式说明「选手端接口不返回剩余免费次数，因此本页无法显示还剩几次」
  （`src/features/awd/components.tsx:338-345`），而不是编一个数字。
- 结论：能力已实现（`client.awd.player.resetGamebox` 真实调用），但计划里的那句 UI 承诺
  **不可实现**，按后端真实契约降级为规则说明。故该行记 ⚠️。

### 3. 讨论详情在管理端用右侧抽屉承载（无独立深链 URL）

- 选手端：`/community/discussions/:id` 是独立深链页面（`src/features/community/routes.tsx:47-52`，
  `src/features/community/discussions.tsx:429`），可刷新、可分享。
- 管理端：`/admin/discussions` 的详情是**右侧抽屉**，选中态存在组件 state 而非 URL
  （`src/features/admin/core/discussions.tsx:298` `const [selected, setSelected] = useState(...)`、
  `:219-220` `<Drawer open={row !== null}>`、`:434` `onClose`）。
  即：管理端讨论详情**没有可分享的深链 URL**，刷新后回到列表。
- 该能力在 CAPABILITY-MATRIX 中是 `optional`（`MATRIX:L158`），且抽屉内的数据、评论列表与删除动作
  都打真实接口（`client.admin.discussions.get` / `getComments` / `removeComment`，
  `tab-*` 见 `discussions.tsx:185/64/77`）。属于交互模型选择，**不影响本表 required 判定**。

### 4. `/admin/database` 的「多语句执行」按后端真实契约实现（脚本切分 + 逐条提交）

CAPABILITY-MATRIX 该行的能力名里写的是「多语句执行」（`MATRIX:L213`，**specialized，不是 required**）。
后端契约实际是**单语句**：`POST /api/admin/database/exec_sql` 明确拒绝多语句请求
（`apps/api/src/modules/platform/operations/database.rs:72-81`，`"Multi-statement SQL is not allowed"`）；
非只读语句还需 `/* ADMIN_CONFIRMED */` 前缀（同文件 `:100-106`）+ TOML 开关
`[features].unsafe_sql_admin = true`（同文件 `:37-40`）。本前端的实现与后端一致，
而不是照着能力名的字面做「一次提交整段脚本」：

- 前端把脚本**切分**成语句列表（`planStatements`，含只读 / 高风险判定与确认词门槛，
  `src/features/admin/infra/DatabasePage.tsx`）；
- **逐条**调用 `client.admin.database.exec_sql({ sql })`（`:376`），非只读语句自动补
  `/* ADMIN_CONFIRMED */ ` 前缀（`:370-374`）；
- 任一条失败即**停止**后续语句（`:383-392`），并把每条的结果 / 错误按序号回显（`:396-408`）。
- 结论：能力已实现且与后端契约一致；与 Default「一次提交」的表象差异属前端交互自由，
  但**能力名里的「多语句」并不等于「单请求多语句」**，此处按后端真实语义实现。

### 5. 通用「榜单 / 趋势 / 实例」标签的赛制门控（核对中发现缺陷 → **已修复**，三行改判 ✅）

**核对时发现的问题**：`scoreboard` / `trend` / `instances` 三个标签原先**无条件**推给所有赛制，
而它们走的是通用赛事子资源 `/events/{id}/scoreboard|trend|instances`，后端只在 Jeopardy 家族开放
（`JeopardyPolicy::require_jeopardy_family`，`apps/api/src/modules/event/jeopardy/domain/policy.rs:37-44`；
调用点 `application/scoreboard.rs:19`、`application/trend.rs:18`、`application/instance.rs:173`）。
结果是 AWD / AWDP 赛事驾驶舱会渲染出三个点击后必然报错的标签。

**修复**（`src/features/events/pages.tsx:495-560` 的 `tabsFor(family)`）：这三个标签现在只在
`family === "jeopardy"` 时注册：

- `src/features/events/pages.tsx:537`（`if (family === "jeopardy") {`）→ `:540` scoreboard、
  `:546` trend、`:552` instances；代码注释同时给出后端依据与替代落点（`:530-536`）。
- `overview` 与 `announcements` 仍对所有赛制开放（`:496-498`、`:523-528`）。
- 各赛制的真实落点：AWD 积分榜在 `?tab=arena`（`src/features/awd/components.tsx:472`）、
  AWDP 积分榜 / 趋势在 `?tab=drill`（`src/features/awdp/panels.tsx:83`、`:90`）。
- 复现命令：`sed -n '495,560p' src/features/events/pages.tsx`；`awk`/`grep` 可见
  `scoreboard` 只在 `family === "jeopardy"` 分支内被 `tabs.push`。

**结论**：缺陷已消除，`MATRIX:L86` / `L87` / `L88` 三行由 ⚠️ **改判为 ✅**（不再是「已实现但有说明」）。
本节保留修复记录，供后续核对者对照。

### 6. `client.admin.event_users.add` 的 SDK 声明与运行时不符（已显式绕过）

- SDK 源码 `packages/sdk/src/api/admin/event_users.ts:26-30`：`add` 直接 `return http.post(...)`，
  没有 `return res.data`，因此**运行时拿到的是 AxiosResponse**，而类型声明是 `Promise<UniResponse<null>>`。
- 本前端在该调用点上不能走统一的 `call()`（会读不到信封），改为显式取 `(await …).data`
  并用 `floatCTFErrorFromEnvelope` 判定平台错误（`src/features/admin/events/tab-members.tsx:69-76`，
  文件头 `:8-11` 已注明原因）。
- 能力可用（赛事用户增删 / 封禁 / 解封全部实现），但该行因此记 ⚠️。

### 7. 其它实际偏差

1. **契约版本兼容性只有「声明 + 平台侧判定」，没有前端运行时诊断**：见表格 `MATRIX:L36` 行。
   `floatctf.frontend.json:8-11` 声明 `compatibility`，`vite.config.ts:35-36` 在构建期
   `parseFrontendManifest()` 自检；major 不匹配由平台 bootstrap 判定并给诊断
   （`packages/frontend-runtime/src/registry.ts:452-457`、`manifest.ts:172-180`）。
   本前端**没有**任何页面展示 `apiContractVersion` / `frontendRuntimeVersion`。
   注：`FRONTEND-PLAN.md:133` 原先声称的 `src/app/BootstrapNotice.tsx` **不存在**（`src/app/` 下只有
   `App.tsx` / `AppShell.tsx` / `CommandPalette.tsx` / `live.tsx` / `mountApp.tsx` / `nav.ts`），
   核对后该行**已改为与真实实现一致**的表述（「`src/entry.tsx`（`mount(context)` 消费全部字段）
   + `floatctf.frontend.json` 的 `compatibility`（构建期由 `parseFrontendManifest` 自检，
   major 判定由平台 bootstrap 完成）」）——与本表 `MATRIX:L36` 的依据一致。
   因此该行仍记 ⚠️ 的唯一理由是：**判定与诊断都在平台 bootstrap 侧完成，本前端自身没有运行时
   兼容性检查 / 诊断界面**；能力语义上不存在功能性缺口（不匹配时用户会看到 bootstrap 的诊断 UI）。
2. **FRONTEND-PLAN §6 覆盖表的分章 required 计数与 CAPABILITY-MATRIX 实际不一致**（不是实现缺口，
   是计划文档的数字误差）：计划写「平台 required ×3 / 赛事与 Jeopardy ×18 / AWDP 比赛 ×11 /
   管理端总览 ×3 / 管理端 AWD ×9」，实际为 6 / 17 / 10 / 4 / 8（计划分章合计 88，实际 89）。
   本文件以 CAPABILITY-MATRIX 为准（89 行逐行核对）。
3. **FRONTEND-PLAN §5 把「我的队伍」列为驾驶舱标签之一**，实际实现为驾驶舱**常驻右栏卡片**
   （`RosterCard`，`src/features/events/pages.tsx:175-418`、渲染点 `:686`），
   而不是 `?tab=team`。报名 / 战队操作因此始终可见，属交互自由。
4. **AWDP 的 `preparing_fix` 过渡态被如实展示**（Default 漏掉）：相位标签与操作门控由
   `awdpPhasePolicy` 纯函数统一判定（`src/features/awdp/components.tsx:112-131`），
   `AwdpPhase` 的所有取值都有对应文案，未做「未知态静默忽略」。
5. **`optional` / `specialized` 行的实际落点**（均**不计入**本表的 required 统计，仅登记实情）：
   - **未实现 / 未接线的行**：
     - `MATRIX:L61` 非 401 错误回调（`FloatCTFClientOptions.onError` / `requestConfig`）：
       `createRuntime` 只注入了 `onUnauthorized`（`src/api/client.ts:48-59`），没有接 `onError` 钩子；
       非 401 错误的用户可见处理走统一的 `call()` → `QueryBoundary` → `toast.error` 路径
       （`src/api/errors.ts`、`src/ui/overlays.tsx`），因此**功能语义不缺，缺的是 SDK 的错误回调埋点**。
     - `MATRIX:L89` 赛事 writeup 状态 / PDF 提交（`client.service.events.getOwnWp` +
       `client.service.submit.submitWriteup`）：`grep` 全仓无调用点
       （只留下一个未被使用的查询键 `src/api/keys.ts:27`）。
     - `MATRIX:L130` 我的积分流水：练习侧已渲染（`src/features/training/pages.tsx:348` →
       `client.awdp.runs.scores`，`AwdpScoresCard`）；**赛事侧 `client.awdp.player.scores` 未被调用**，
       赛事页只在总览显示 `my_score`（`src/features/awdp/panels.tsx:140`）——与 Default 的实际做法一致。
     - `MATRIX:L38` 破窗回退（`?frontend=<id>`）：由平台 bootstrap 提供，前端无需实现
       （矩阵该行 `User/Admin` 即标注为 `platform（bootstrap 提供）`）。
   - **其余 optional / specialized 行本前端均已实现**（抽样证据）：本地注册表解析 `L37`
     （`src/features/admin/core/frontends.tsx:51-72`）、头像上传 `L53`（`src/features/profile/pages.tsx:256`）、
     武器库 `L68`（`src/features/community/pages.tsx:552`）、讨论点赞 `L74`
     （`src/features/community/discussions.tsx:457/469`）、题集与题解 `L96`–`L99`
     （`src/features/jeopardy/pages.tsx:741/797/259/371/470`）、Markdown 图片上传 `L103`
     （`src/ui/Markdown.tsx:69`）、AWDP 源码下载 `L127`（`src/features/awdp/panels.tsx:111`）、
     练习 writeup `L144`（`src/features/training/pages.tsx:355/417`）、系统监控与平台版本 `L152`/`L153`
     （`src/features/admin/core/dashboard.tsx:521/527`）、题集 / 公告 / 讨论 / 武器 / 超管 / 日志管理
     `L156`–`L161`、赛事数据大屏 `L170`（`tab-data.tsx:24`）、赛事日志 `L175` 与 writeup 导出 `L176`
     （`tab-content.tsx:237/367/375/383`）、平台网络控制面 `L191`（`NetworkPage.tsx:50-82`）、
     管理端实时流 `L193`（`tab-awd.tsx:153`）、AWDP 数据大屏 `L204`（`tab-awdp.tsx:736`）、
     Docker / SQL 控制台 / Web 终端 `L210`–`L215`、计划任务 `L214`、前端选择器 `L216`、静态制品下载 `L217`。

---

## 核对方法

以下命令均从仓库根 `/home/fb0sh/Projects/floatctf` 执行（脚本走 heredoc，**不写入仓库**）。
本表每一行的证据都可以用相同方式复现。

### 1. 取 required 基准（89 行）

```bash
python3 - <<'EOF'
from collections import Counter
lines = open('docs/frontend/CAPABILITY-MATRIX.md', encoding='utf-8').read().split('\n')
chap, rows = None, []
for i, l in enumerate(lines, 1):
    if l.startswith('## '): chap = l[3:].strip()
    if l.startswith('|') and '---' not in l:
        c = [x.strip() for x in l.strip().strip('|').split('|')]
        if len(c) >= 7 and c[6].startswith('required'):
            rows.append((i, chap, c[1]))
print('TOTAL', len(rows))                      # TOTAL 89
print(Counter(r[1] for r in rows))
EOF
```

### 2. 枚举本前端全部路由

```bash
cd frontends/floatctf-frontend-xzmu/src
for f in features/*/routes*.tsx; do echo "=== $f ==="; grep -n 'path:' "$f"; done
grep -n 'path' features/events/pages.tsx features/training/pages.tsx
```

### 3. 逐域 dump 真实 SDK 调用（本表「核对依据」列的来源）

```bash
cd frontends/floatctf-frontend-xzmu/src
# 选手端
grep -rn 'client\.\(service\|admin\|awd\|awdp\|sse\)' \
  features/community features/jeopardy features/events features/training \
  features/awd features/awdp features/profile features/dashboard --include=*.tsx --include=*.ts
# 管理端
grep -rn 'client\.\(service\|admin\|awd\|awdp\|sse\|adminHttp\)' \
  features/admin --include=*.tsx --include=*.ts
# 实时流
grep -rn 'useAwdEventStream\|useAdminAwdEventStream\|useAwdpEventStream\|useAwdpRunStream' \
  features --include=*.tsx
# 逃生舱（B 类）
grep -rnE 'transport\.|adminHttp|serviceHttp|new WebSocket|fetch\(' \
  src --include=*.ts --include=*.tsx
```

### 4. 驾驶舱 / 控制台的标签页键（用于填「本前端位置」列）

```bash
cd frontends/floatctf-frontend-xzmu/src
sed -n '495,550p' features/events/pages.tsx        # 选手驾驶舱 tabsFor()
sed -n '44,90p'   features/admin/events/EventConsole.tsx   # 管理控制台 tabsFor()
```

### 5. 覆盖判定与计数（对本文档自身执行）

```bash
cd /home/fb0sh/Projects/floatctf
cat > /tmp/coverage-verify.py <<'PY'
import re
from collections import Counter

# ── 基准：CAPABILITY-MATRIX 的 required 行（行号 → 能力名，逐字）
md = open('docs/frontend/CAPABILITY-MATRIX.md', encoding='utf-8').read().split('\n')
req, chap = {}, None
for i, l in enumerate(md, 1):
    if l.startswith('## '): chap = l[3:].strip()
    if l.startswith('|') and '---' not in l:
        c = [x.strip() for x in l.strip().strip('|').split('|')]
        if len(c) >= 7 and c[6].startswith('required'):
            req[i] = (chap, c[1])

# ── 文档：逐行核对表正文行（以 MATRIX:L<n> 行号锚定）
doc = open('frontends/floatctf-frontend-xzmu/CAPABILITY-COVERAGE.md', encoding='utf-8').read().split('\n')
rows, cur = [], None
for l in doc:
    if l.startswith('### '): cur = l[4:].split('（required')[0].strip()
    if l.startswith('|') and '---' not in l and 'MATRIX:L' in l:
        c = [x.strip() for x in l.strip().strip('|').split('|')]
        n = int(re.search(r'MATRIX:L(\d+)', c[0]).group(1))
        rows.append({'chap': cur, 'line': n, 'cap': c[0].split(' <br>')[0].strip(),
                     'v': c[1].split()[0]})

print('matrix_required =', len(req))
print('doc_rows        =', len(rows))
print('verdicts        =', dict(Counter(r['v'] for r in rows)))
wrong = [(r['line'], r['cap']) for r in rows if req.get(r['line'], (None, None))[1] != r['cap']]
print('text_mismatch   =', len(wrong), wrong)
print('missing_lines   =', sorted(set(req) - {r['line'] for r in rows}))
print('non_required    =', sorted({r['line'] for r in rows} - set(req)))
print('duplicates      =', [k for k, v in Counter(r['line'] for r in rows).items() if v > 1])
req_ch, doc_ch = Counter(c for c, _ in req.values()), Counter(r['chap'] for r in rows)
print('chapter_ok      =', req_ch == doc_ch)
PY
python3 /tmp/coverage-verify.py
```

真实输出见下（本文件定稿时执行；标签赛制门控修复后已重跑）：

```
matrix_required = 89
doc_rows        = 89
verdicts        = {'✅': 86, '⚠️': 3}
text_mismatch   = 0 []
missing_lines   = []
non_required    = []
duplicates      = []
chapter_ok      = True
```

说明：`missing_lines = []` 表示 89 条 required 一条不漏；`non_required = []` 表示没有把
optional / specialized 行混进核对表（第 12 章 0 行 required，仅以文字备注其落点）；
`text_mismatch = 0` 表示每行能力名都与 CAPABILITY-MATRIX 对应行**逐字一致**。

### 5.1 标签赛制门控的复现命令（对应「已知偏差」§5）

```bash
cd frontends/floatctf-frontend-xzmu/src
sed -n '495,560p' features/events/pages.tsx
# 可见 `scoreboard`( :540 ) / `trend`( :546 ) / `instances`( :552 ) 都在
# `if (family === "jeopardy") {`( :537 ) 分支内；`announcements`( :523-528 ) 与
# `overview`( :496-498 ) 对所有赛制开放。
```

### 6. 与 Default 无关的依赖边界自检（确认没有违反公共包边界）

```bash
cd frontends/floatctf-frontend-xzmu
grep -rnE "from \"(frontends/default|apps/web|@/|\.\./\.\./\.\./(packages|apps|frontends))" src \
  || echo "no illegal imports"
grep -rhn "from \"@floatctf/" src | sed 's/.*from "//;s/".*//' | sort -u
# no illegal imports
# @floatctf/frontend-runtime
# @floatctf/react
# @floatctf/sdk
# @floatctf/sdk/entity
```

即：本前端只依赖公共包（`@floatctf/sdk`、`@floatctf/frontend-runtime`、`@floatctf/react`），
没有 import `frontends/default/*`、`apps/web/*`、`packages/*/src/*` 或任何私有 alias。
