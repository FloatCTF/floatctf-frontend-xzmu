# 西藏民族大学 CTF 平台前端（FloatCTF frontend `xzmu`）

一个**全新的 FloatCTF 可插拔前端**：不是官方 Default 前端的换皮，而是一套独立的浏览器应用
——自己的路由、自己的设计系统、自己的交互模型。覆盖
[CAPABILITY-MATRIX](../../docs/frontend/CAPABILITY-MATRIX.md) 中**全部 89 项 `required` 能力**
（选手端 + 管理端），即 **complete** 范围。

- **主题**：`民大红 · 鎏金`，配色取自学校两个真实站点（见 §4）。
- **技术栈**：React 19 + TypeScript 5 + Vite 6 + TanStack Query v5 + 自研 History 路由 + 自研 CSS 设计系统。
- **零组件库**：不使用 Primer / Tailwind / Ant Design；全部 UI 组件在 `src/ui/`。
- **交互模型**：双工作区（训练场 / 控制台）+ 赛事驾驶舱 + 命令面板 + 上下文抽屉。

---

## 1. 快速开始

本仓库是 FloatCTF monorepo 内 `frontends/floatctf-frontend-xzmu` 的独立 git 仓库，
依赖通过 pnpm workspace 解析到 `@floatctf/*` 的本地包。

```bash
# 依赖（在 monorepo 根执行一次）
cd /home/fb0sh/Projects/floatctf && mise exec -- pnpm install

# 类型检查 / 构建（产出 dist/ + 自检过的 frontend.json）
mise exec -- pnpm --filter @floatctf/frontend-xzmu typecheck
mise exec -- pnpm --filter @floatctf/frontend-xzmu build
```

### 本地开发（重要：dev 下本前端要占用 :13000）

FloatCTF 的 `mise run dev` 会把 Vite 起在 **13000**，而 dev Caddy（`http://127.0.0.1:7780`）
把 `/api/**` 之外的**所有**路径（含 `/__floatctf/frontends/*` 与 `/`）都反代到 13000。
默认那个 13000 上是 Default Frontend 的 dev server，因此在 dev 下要看**本前端**，
就让本前端占用同一个端口 —— 这样 Caddy 不需要任何改动，`apiBaseUrl` 仍是同源 `/api`：

```bash
# 终端 1：基础设施 + API（9090）
mise run infra:up
mise run dev:api

# 终端 2：本前端的 dev server，端口与 Caddy 约定一致
mise exec -- pnpm --filter @floatctf/frontend-xzmu dev --port 13000
```

然后打开 **http://127.0.0.1:7780**。

> ⚠️ 若本机同时跑着生产 compose（`/home/fb0sh/floatctf-prod/compose.prod.yml`），
> 开发 API 会与生产 API 争抢宿主 AWD 练习容器（HANDOFF.md 有实测记录）。
> 开 dev 之前先把生产栈停掉。
>
> 注意：dev 下走的是 `index.html → src/dev.tsx → mount(context)` 的**直挂**路径；
> 生产走 `apps/web bootstrap → 本地注册表 → 版本化 ESM 制品`。两者调用**同一个**
> `mount(context)`，因此契约不会分叉（`src/dev.tsx` 与 `src/entry.tsx` 一致）。

## 2. 安装到 FloatCTF 实例

```bash
# 1) 构建 + 打包制品
cd /home/fb0sh/Projects/floatctf/frontends/floatctf-frontend-xzmu
mise exec -- pnpm build
tar -czf /tmp/xzmu-0.1.0.tar.gz -C dist .

# 2) 校验制品（manifest / 契约 / 路径安全）
cd /home/fb0sh/Projects/floatctf
./scripts/frontend.sh verify /tmp/xzmu-0.1.0.tar.gz

# 3) 安装（需要写 $FLOATCTF_HOME/frontends，通常要 sudo）
sudo $FLOATCTF_HOME/frontend.sh install /tmp/xzmu-0.1.0.tar.gz
sudo $FLOATCTF_HOME/frontend.sh list
sudo $FLOATCTF_HOME/frontend.sh info xzmu

# 4) 激活：管理端 → 系统 → 前端管理 → 选择「西藏民族大学 CTF 平台」→ 切换
#    （CLI 不会替你激活；它写的是 settings.FRONTEND_ACTIVE）
```

> **Git-URL 安装说明**：`frontend.sh install <Git URL>` 会在隔离容器里跑
> `pnpm install --frozen-lockfile`。本仓库通过 `workspace:*` 引用尚未发布到 npm 的
> `@floatctf/*`，因此**外部克隆**想用源码构建需要先按
> [AI-FRONTEND-GUIDE §18](../../docs/frontend/AI-FRONTEND-GUIDE.md) 打包 SDK tarball
> （`scripts/package-sdk-dist.sh`）并把依赖改成 `file:` 指向这些 tarball。
> 在 monorepo 内（本仓库当前形态）直接构建即可；上面的**制品安装**路径完全不依赖源码与网络。

## 3. 界面截图

全部截图都在**真实 API + 全新数据库**下采集（详见 [docs/E2E-ACCEPTANCE.md](./docs/E2E-ACCEPTANCE.md)），
原图存于 [`docs/images/`](./docs/images/)。

### 登录

![登录页](./docs/images/login.png)

### 选手端

| 总览 | 赛事 | 题库 |
| :--: | :--: | :--: |
| ![总览](./docs/images/dashboard.png) | ![赛事](./docs/images/events.png) | ![题库](./docs/images/challenges.png) |

| 题集 | 我的实例 | AWDP 训练 |
| :--: | :------: | :-------: |
| ![题集](./docs/images/challenge-sets.png) | ![我的实例](./docs/images/instances.png) | ![AWDP 训练](./docs/images/training.png) |

| 公告 | 讨论区 | 解题流水 |
| :--: | :----: | :------: |
| ![公告](./docs/images/announcements.png) | ![讨论区](./docs/images/discussions.png) | ![解题流水](./docs/images/solves.png) |

| 排行榜 | 题解 | 武器库 |
| :----: | :--: | :----: |
| ![排行榜](./docs/images/top.png) | ![题解](./docs/images/writeups.png) | ![武器库](./docs/images/weapons.png) |

| 我的资料 |
| :------: |
| ![我的资料](./docs/images/profile.png) |

### 管理端（控制台）

| 控制台总览 | 赛事管理 | 题库管理 |
| :--------: | :------: | :------: |
| ![控制台总览](./docs/images/admin-dashboard.png) | ![赛事管理](./docs/images/admin-events.png) | ![题库管理](./docs/images/admin-challenges.png) |

| GameBox 库 | 用户 | 靶场网络 |
| :--------: | :--: | :------: |
| ![GameBox 库](./docs/images/admin-gameboxes.png) | ![用户](./docs/images/admin-users.png) | ![靶场网络](./docs/images/admin-network.png) |

| 动态设置 | 容器运维 | Web 终端 |
| :------: | :------: | :------: |
| ![动态设置](./docs/images/admin-settings.png) | ![容器运维](./docs/images/admin-docker.png) | ![Web 终端](./docs/images/admin-terminal.png) |

| 操作日志 | 计划任务 | 前端管理 |
| :------: | :------: | :------: |
| ![操作日志](./docs/images/admin-logs.png) | ![计划任务](./docs/images/admin-scheduled-tasks.png) | ![前端管理](./docs/images/admin-frontends.png) |

> 「前端管理」一图是走**生产引导链**采集的：注册表里同时列出 `default`（受保护）与本前端
> `xzmu`（生效中），并可直接切换。

## 4. 视觉方向：「民大红 · 鎏金」

配色不是拍脑袋定的，全部来自对两个真实站点的实测（截图存于 `docs/design-ref/`）：

| 来源 | 实测值 | 用途 |
|---|---|---|
| `portal.xzmu.edu.cn` 顶栏 / 左栏（live `getComputedStyle`） | `rgb(113,35,35)` = **`#712323`** | 主色 |
| `portal.xzmu.edu.cn` 次级主色 | `rgb(141,48,51)` = `#8d3033` | hover / 选中 |
| `www.xzmu.edu.cn/style/index.css` | `#481c1c` / `#611212` | 主色深阶 |
| `www.xzmu.edu.cn/style/index.css` | `#b0915d` / `#d9bb64` / `#fbc937` | 鎏金强调 |
| `www.xzmu.edu.cn/style/index.css` | `#f8f8f6` / `#fcf7f0` / `#f3f0e9` | 暖纸底 |
| `portal.xzmu.edu.cn`（live） | `#f9ab22` / `#228b22` / `#3e8b94` / `#da3e37` | 警告 / 成功 / 信息 / 危险 |
| CAS 统一身份认证页 | 深红渐变 + 毛玻璃卡片 + 校徽水印 | 登录页母题 |

**签名元素**：卡片标题为主色小标题 + 下方 24px 宽 2px 主色下划线 —— 信息门户卡片标题的形态。
**字体**：标题用衬线族（思源宋体 / 宋体），UI 用无衬线族（苹方 / 微软雅黑），分数与 flag 用等宽族；
全部走系统字体，**不下载 web font**（离线可用）。
深色模式通过 `prefers-color-scheme` 只替换表面与文字令牌，主色与鎏金保持不变。

## 5. 交互模型（与 Default 不同，这是有意的）

- **两个工作区**：选手「训练场」与管理「控制台」在顶栏一键切换，导航层级互不复用。
- **赛事驾驶舱**：Default 把 AWD / AWDP 拆成一堆页面（overview / gameboxes / scoreboard /
  wireguard / rounds / workbench …），本前端把它们合并成 **`/events/:id`** 一个驾驶舱，
  用 `?tab=` 承载（`overview` / `challenges` / `arena` / `drill` / `scoreboard` / `trend` /
  `announcements` / `instances`），可深链、可刷新。管理端同理：**`/admin/events/:id`** 控制台
  承载配置 / 题目 / 名单 / 战队 / 公告 / 日志 / 实例 / Writeup / 数据 / AWD / AWDP / 网络。
  （平台只规定**能力语义**，不规定用户怎么走到那里 —— AI-FRONTEND-GUIDE §2.3 / §12.2。）
- **命令面板**：`Ctrl/Cmd+K` 跳转任意页面 + 执行高频动作；`/` 聚焦当前页搜索框。
- **右侧抽屉**：列表行详情、判罚、封禁、单条日志都在抽屉里就地完成，不离开列表。
- **破坏性操作**：自研确认对话框，写明**真实后果**；高风险操作（归档赛事、轮换 token、
  批量构建、删除容器 / 网络 / 用户、执行 SQL）要求**逐字输入确认词**。
- **实时状态条**：顶栏常驻显示 SSE 连接状态（`connected` / `reconnecting` / `auth_error` / …）。
  `auth_error` 有独立横幅 —— SSE 的 401 不会触发全局 `onUnauthorized`（SDK 语义）。

## 6. 目录结构

```
src/
├── entry.tsx / dev.tsx        # 制品入口 mount(context) / dev 入口
├── api/                       # client 装配、信封守卫(call.ts)、错误归一化、查询键
├── auth/store.ts              # 两个互相独立的 token 作用域（选手 / 管理端）
├── router/                    # 自研 History 路由 + Link + PageDef 契约
├── ui/                        # 设计系统：icons / primitives / Table / overlays / Markdown
├── lib/                       # 格式化与 hooks
├── app/                       # App 装配 / AppShell / 导航配置 / 命令面板 / 实时状态
├── features/                  # 功能域（registry.ts 汇总页面）
│   ├── auth/ dashboard/ events/ jeopardy/ awd/ awdp/ training/ community/ profile/ admin/
└── styles/                    # tokens → base → layout → components → domain
```

## 7. 文档

| 文档 | 内容 |
|---|---|
| [AGENTS.md](./AGENTS.md) | 作业手册：硬规则、UI 组件 API、数据层与实时约定 |
| [FRONTEND-PLAN.md](./FRONTEND-PLAN.md) | 身份 / 技术 / 视觉 / 交互模型 / 信息架构 / 覆盖计划 |
| [CAPABILITY-COVERAGE.md](./CAPABILITY-COVERAGE.md) | **89 项 required 能力逐行核对**（含证据与偏差说明） |
| [docs/SDK-API-REFERENCE.md](./docs/SDK-API-REFERENCE.md) | 240 个 SDK 方法签名 + 147 个 DTO 字段 + 57 条陷阱 |
| [docs/CAPABILITY-BEHAVIOR-MAP.md](./docs/CAPABILITY-BEHAVIOR-MAP.md) | 89 项能力的行为语义（含后端证据行号） |

## 8. 许可

AGPL-3.0-only（与 FloatCTF 平台一致）。
