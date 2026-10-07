# FRONTEND-PLAN — 西藏民族大学 CTF 平台前端（xzmu）

> 本文件按 [docs/frontend/AI-FRONTEND-GUIDE.md](../../docs/frontend/AI-FRONTEND-GUIDE.md) §11 的模板编写。
> 这是**新的可插拔前端**（类型 B），不是修改 `frontends/default`。

## 1. Identity

- Frontend id: `xzmu`
- Name / version: 西藏民族大学 CTF 平台 / `0.1.0`
- Scope: **complete**（覆盖 [CAPABILITY-MATRIX.md](../../docs/frontend/CAPABILITY-MATRIX.md) 全部 `required` 能力，选手端 + 管理端）

## 2. Technology

- Framework: React 19 + TypeScript 5（`@floatctf/react` 可选 React 绑定）
- Router: **自研 History API 路由**（`src/router/`）。理由：平台不要求任何路由库，自研路由让我们完全掌控
  工作台式的嵌套视图（赛事驾驶舱的 tab 即路由），并去掉一个版本面风险。
- State + auth storage: token 放 `localStorage`（`xzmu.user.token` / `xzmu.admin.token`），
  由 `src/auth/store.ts` 以 React Context + `useSyncExternalStore` 暴露；SDK 只通过
  `getUserToken` / `getAdminToken` 读取，**绝不**写入 URL。
- Styling: 原生 CSS + CSS 自定义属性（`src/styles/`）。**不使用** Primer / Tailwind / 任何组件库；
  设计系统与全部组件为自研。
- Data fetching: TanStack Query v5（`@tanstack/react-query`）+ `@floatctf/react` 提供的
  SSE hook 与 query options 工厂。
- Markdown: `react-markdown` + `remark-gfm`（题目描述 / 讨论 / writeup 渲染，默认不解析原始 HTML）。
- 图标：自研内联 SVG 图标集（`src/ui/icons.tsx`），不引入图标库。

## 3. Visual direction

**设计语言：「民大红 · 鎏金」—— 高校信息门户的仪式感 × CTF 控制台的密度。**

配色取自两处真实站点（`docs/design-ref/` 存有截图证据）：

| 来源 | 实测值 | 用途 |
|---|---|---|
| 信息门户顶栏 / 左栏（live `getComputedStyle`） | `rgb(113,35,35)` = **`#712323`** | 主色（chrome、主按钮、卡片标题） |
| 信息门户顶栏 hover / 次级（live） | `rgb(141,48,51)` = `#8D3033` | 主色浅阶 |
| 校主页 `index.css` | `#481c1c` / `#611212` | 主色深阶（侧栏、auth 背景） |
| 校主页 `index.css` | `#b0915d` / `#d9bb64` / `#fbc937` | 鎏金强调（排名、高亮、徽标） |
| 校主页 `index.css` | `#f8f8f6` / `#fcf7f0` / `#f3f0e9` | 暖纸底（内容区背景） |
| 信息门户（live） | `rgba(0,0,0,0.65)` / `#333` / `#999` | 正文 / 标题 / 次要文本 |
| 信息门户（live） | `#F9AB22` / `#228B22` / `#3E8B94` / `#DA3E37` | 警告 / 成功 / 信息 / 危险 |
| CAS 统一身份认证页 | 半透明毛玻璃面板 + 校徽水印 | 登录页视觉母题 |

- Typography: 标题用衬线族（`"Source Han Serif SC", "Noto Serif SC", STSong, SimSun, serif`）呼应
  校站标题气质；UI 正文用无衬线族（`"PingFang SC", "Microsoft YaHei", "Source Han Sans SC", …`）；
  数字/分数/flag 用等宽族（`ui-monospace, "JetBrains Mono", Consolas, monospace`）。
  全部使用系统字体，**不下载 web font**（离线可用）。
- Spacing: 4px 基准；卡片 6px 圆角（与信息门户卡片一致）；柔和阴影
  `0 3px 16px rgba(113,35,35,0.10)`（把门户的蓝调阴影换成主色调）。
- 签名元素：卡片标题为主色小标题 + 下方 24px 宽 2px 主色下划线（信息门户卡片标题的形态）。
- Responsive: 三档 —— `≥1200px` 左栏 + 内容 + 可选右抽屉；`768–1199px` 左栏收起为图标栏；
  `<768px` 顶栏 + 底部 tab 栏 + 全屏 sheet。
- Motion: 150–200ms `ease-out` 的位移/淡入；尊重 `prefers-reduced-motion`。
- Accessibility: 焦点环用主色 2px outline；全部交互元素可键盘触达；对话框焦点陷阱 +
  `Esc` 关闭 + `aria-modal`；表单错误用 `aria-live`；颜色对比度目标 WCAG AA
  （正文 `#2b2422` on `#fcf7f0` ≈ 13:1；主按钮白字 on `#712323` ≈ 9.4:1）。

## 4. Interaction model

**模型：双工作区（选手「训练场」/ 管理「控制台」）+ 赛事驾驶舱 + 命令面板 + 上下文抽屉。**

- Primary navigation model: 左侧固定纵向导航轨（主色底、白色线性图标 + 中文标签），顶部为
  全局条（品牌 + 工作区切换 + 搜索 + 通知 + 账户）。选手工作区与管理工作区**分离但可一键切换**，
  不共用同一套导航层级。
- Workspace/task model: **能力按「赛事驾驶舱」聚合，而不是按 Default 的页面切分**。
  打开一个赛事 = 进入 `/events/:id` 驾驶舱，全部赛事能力（概览 / 题目 / 靶场 / 演练 / 榜单 / 趋势 /
  公告 / 实例 / 我的队伍）都是驾驶舱内的**标签页**，URL 记在 `?tab=`，可深链、可刷新。
- Desktop interaction: 左栏导航 + 主内容区 + 右侧上下文抽屉（`Inspector`）。列表行点击打开抽屉
  看详情，破坏性操作在抽屉内就地完成或弹对话框；赛事驾驶舱常驻右栏显示实时积分。
- Mobile interaction: 底部 4 项 tab（总览 / 赛事 / 训练 / 我的）+ 顶部标题栏；列表 → 全屏 sheet 详情。
- Keyboard / command palette: `Ctrl/Cmd+K` 打开命令面板（跳转任意路由、切换工作区、执行高频动作）；
  `/` 聚焦当前页搜索框；`g` 前缀序列跳转（`g e` → 赛事，`g c` → 题库）。
- Modal / drawer / panel strategy: 详情 = 右侧抽屉；表单 = 抽屉（短表单）或对话框（≤6 字段）；
  破坏性操作 = 对话框 + 明确的后果文案（重置 GameBox 要显示剩余免费次数与扣分）；
  高风险（归档赛事、删除用户、SQL 执行、终端）需**输入名称/确认词**二次确认。
- Destructive action confirmation: 一律使用自研 `ConfirmDialog`；
  `danger` 变体为红底，`severe` 变体要求输入确认词。**禁止**原生 `alert/confirm/prompt`。
- Realtime update presentation: 顶栏右下角常驻一条「实时链路」状态条（已连接 / 重连中 / 已断开 +
  最近事件时间）；数据变化时对应区块做 600ms 主色高亮闪烁，**不整页刷新**。
- Progressive disclosure: 赛事驾驶舱默认只显示与该赛事 `mode` 相关的标签页；AWD/AWDP 运维的
  高级操作收在「危险区」折叠块内。

## 5. Information architecture

### Sections（选手工作区 · `/`）

| Section | 内容 |
|---|---|
| 总览 `/` | 我的赛事 / 公告 / 待办（未加入的开放赛事、可恢复的实例）/ 全站动态 |
| 赛事 `/events`、`/events/:id?tab=` | 列表 + 赛事驾驶舱（overview / challenges / arena / drill / scoreboard / trend / announcements / instances / team） |
| 题库 `/challenges`、`/challenges/:id` | 全站题目目录 + 题目详情（附件、描述、实例、flag 提交、我的题解） |
| 题集 `/sets`、`/sets/:id` | 训练题集 |
| 训练 `/training`、`/training/:runId` | AWDP 练习 GameBox 目录 + 练习 Run 工作台 |
| 靶场实例 `/instances` | 我的全部实例（题目 + GameBox），批量销毁 |
| 社区 `/community/announcements`、`/community/discussions`、`/community/discussions/:id`、`/community/discussions/mine`、`/community/solves`、`/community/top`、`/community/writeups`、`/community/writeups/:id`、`/community/arsenal` | 公告 / 讨论 / 解题流水 / Top15 / 题解 / 武器库 |
| 我的 `/me` | 资料、改密、头像、我的题解 |

### Sections（管理控制台 · `/admin`）

| Section | 内容 |
|---|---|
| 总览 `/admin` | 聚合统计、需关注项、系统监控、版本 |
| 赛事 `/admin/events`、`/admin/events/:id?tab=` | 列表 + 赛事控制台（config / challenges / users / teams / announcements / logs / instances / data / awd / awdp / network） |
| 题库 `/admin/challenges`、`/admin/challenge-sets`、`/admin/challenge-sets/:id` | 挑战 CRUD / 导入 / 校验 / 构建 / 扫描；题集管理 |
| 靶场资产 `/admin/gameboxes`、`/admin/network` | AWD GameBox 库 + 平台网络控制面 |
| 用户与权限 `/admin/users`、`/admin/super-admins` | 账号治理 |
| 内容 `/admin/announcements`、`/admin/discussions`、`/admin/weapons` | 内容运营与治理 |
| 系统 `/admin/settings`、`/admin/logs`、`/admin/scheduled-tasks`、`/admin/docker`、`/admin/database`、`/admin/terminal`、`/admin/frontends` | 动态设置、日志、计划任务、容器/镜像/网络、SQL 控制台、Web 终端、前端选择器 |

### Route plan

| 路径 | 能力 |
|---|---|
| `/login` `/register` `/reset-password` `/reset` | 认证与会话 |
| `/` | 总览 |
| `/events` `/events/:id` | 赛事列表 / 赛事详情 / 加入退出 / 战队 / 公告 / 积分榜 / 趋势 / 实例 / Jeopardy 题目 / flag 提交 / writeup |
| `/events/:id?tab=arena` | AWD 选手面板（状态 / GameBox / 重置 / 提交 flag / 积分榜 / WireGuard / SSH） |
| `/events/:id?tab=drill` | AWDP 赛事工作台（总览 / 实例生命周期 / break / patch / test check / 轮次 / 评测 / 榜单 / 趋势） |
| `/challenges` `/challenges/:id` | 题目目录 / 详情 / 实例 / 提交 / 我的题解 |
| `/sets` `/sets/:id` | 题集 |
| `/training` `/training/:runId` | AWDP 练习目录 / Run 生命周期 / 破题 / 补丁 / 自检 / 全量校验 / 轮次 / 评测 / 积分 / writeup |
| `/instances` | 我的实例 |
| `/community/*` | 公告 / 讨论 / 评论 / 点赞 / 解题流水 / Top15 / 题解 / 武器库 / 图片上传 |
| `/me` | 资料 / 改密 / 头像 |
| `/admin/*` | 全部管理能力 |

## 6. Capability coverage

结论：**complete**。逐行核对见 [CAPABILITY-COVERAGE.md](./CAPABILITY-COVERAGE.md)（实现完成后填 `done`）。

| Capability（CAPABILITY-MATRIX 章节） | required? | covered? | route |
|---|---|---|---|
| 平台引导与运行时契约 | required ×3 / optional ×4 | ✅ | `src/entry.tsx`（`mount(context)` 消费全部字段）+ `floatctf.frontend.json` 的 `compatibility`（构建期由 `parseFrontendManifest` 自检，major 判定由平台 bootstrap 完成） |
| 认证与会话 | required ×11 / optional ×2 | ✅ | `/login` `/register` `/reset-password` `/reset` `/admin/login` `/me` |
| 选手端：账号与社区内容 | required ×7 / optional ×2 | ✅ | `/community/*` `/me` |
| 选手端：赛事与 Jeopardy | required ×18 / optional ×5 | ✅ | `/events/:id` `/challenges` `/sets` `/instances` |
| 选手端：AWD | required ×8 | ✅ | `/events/:id?tab=arena` |
| 选手端：AWDP 比赛 | required ×11 / optional ×1 | ✅ | `/events/:id?tab=drill` |
| 选手端：AWDP Training | required ×6 / optional ×1 | ✅ | `/training` `/training/:runId` |
| 管理端：总览与内容 | required ×3 / optional ×9 | ✅ | `/admin` `/admin/users` `/admin/challenges` `/admin/settings` … |
| 管理端：赛事管理 | required ×7 / optional ×3 | ✅ | `/admin/events/:id?tab=` |
| 管理端：AWD 运维 | required ×9 / optional ×1 / specialized ×3 | ✅ | `/admin/events/:id?tab=awd` `/admin/gameboxes` `/admin/network` |
| 管理端：AWDP 运维 | required ×5 / optional ×1 | ✅ | `/admin/events/:id?tab=awdp` |
| 管理端：基础设施 / 系统 / 平台 | required ×0 / optional ×3 / specialized ×5 | ✅ | `/admin/docker` `/admin/database` `/admin/terminal` `/admin/frontends` … |

## 7. Auth

- User token strategy: `localStorage["xzmu.user.token"]`；会话恢复时用 `client.service.users.getMe()`
  校验，失败即清 token 并回到 `/login?next=<原路径>`。
- Admin token strategy: `localStorage["xzmu.admin.token"]`，**与选手 token 完全独立的作用域**；
  仅 `/admin/*` 使用，选手态不读取它。
- Unauthorized behaviour: `onUnauthorized({scope})` 按 scope 清除对应 token，并把当前路径写入
  `next`，然后跳 `/login` 或 `/admin/login`；**不**使用原生弹窗，不用整页刷新。
- 登出：清对应 token + 清空该作用域的 QueryClient 缓存 + 跳转到对应登录页。

## 8. Realtime

- AWD: SSE `GET /api/events/{id}/awd/stream`（选手 `connect`；管理 `connectAdmin`），
  经 `@floatctf/react` 的 `useAwdEventStream` / `useAdminAwdEventStream`，
  断线时 hook 内部降级轮询，UI 在顶栏实时状态条上显示 `connecting / connected / reconnecting /
  auth_error / error`。
- AWDP: SSE `GET /api/events/{id}/awdp/stream`（赛事）与 `GET /api/service/awdp/runs/{runId}/stream`
  （练习），经 `useAwdpEventStream` / `useAwdpRunStream`。
- Web 终端：`client.adminHttp.post("/terminal/session")` 取一次性 HttpOnly ticket cookie +
  原生 `WebSocket` 到 `{adminBase}/terminal/ws`，自定义 `{type:"resize"}` 与二进制帧处理。
  **这是 CAPABILITY-MATRIX 记录的 B 类逃生舱**，遵循 AI-FRONTEND-GUIDE §5.4 在代码与交付说明中标注。
- 本地前端注册表：同源 `fetch(DEFAULT_REGISTRY_URL)` + `parseRegistry`（同样是 B 类逃生舱）。

## 9. Artifact

- Entry: `assets/frontend.js`（`src/entry.tsx`，导出 `mount`）
- Styles: `assets/frontend.css`（单文件 CSS，`cssCodeSplit: false`）
- Build script: `build`（`vite build && tsc --noEmit`）；`build:artifact` = 仅 `vite build`
- outputDir: `dist`（内含 `frontend.json`，构建期用 `parseFrontendManifest` 自检）
- 构建期 `base: "./"`，资产一律经 `context.assetBaseUrl` 解析。
