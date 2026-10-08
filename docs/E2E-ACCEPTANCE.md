# 端到端验收记录（真实 API）

本文记录 `xzmu` 前端在**本机开发环境**上、对着**真实 FloatCTF API** 完成的端到端验收。
与 `docs/DELIVERY-NOTES.md` 里的「桩数据验收」互补：这里是**真实平台**。

- 日期：2026-10-08
- 平台 HEAD：`main`（FloatCTF 平台仓库）
- 前端版本：`xzmu@0.1.0`
- 数据库：全新 dev 库（48 个迁移从零 apply，bootstrap 数据：2 个内置练习赛事 + `sysadmin`）
- API：本机 `apps/api` 直跑（`FLOATCTF_CONFIG=apps/api/config/development.toml`），`http://127.0.0.1:9090`
- 宿主控制面：`floatctf-helper.service`（官方 `scripts/install.sh --develop` 安装）
- 账号：玩家 `123509714`（本次通过 `POST /api/users` 真实注册，密码为操作者提供的测试口令）；
  管理端 `sysadmin`

## 1. 两种加载路径都验证过

| 路径 | 方式 | 结果 |
|---|---|---|
| **开发直挂** | `pnpm dev` → `http://<lan>:13200`，`dev.tsx` 直接 `mount(context)` | ✅ |
| **生产引导链** | 真实 `apps/web/dist` 引导页 → `GET /api/frontend` → `registry.json` → 版本化制品 → `mount(context)` | ✅ |

生产引导链的验证方式：把平台动态设置 `FRONTEND_ACTIVE` 通过**公共管理端接口**
（`PATCH /api/admin/settings/{id}`）真的改成 `xzmu`，`GET /api/frontend` 随即返回
`active_frontend: "xzmu"`，引导页据此加载本前端的制品。验收后已改回 `default`。

引导链证据（`registry.json` 同时含 `default@1.0.0` 与 `xzmu@0.1.0`）：

```
[acceptance] registry: default@1.0.0 + xzmu@0.1.0
[acceptance] /api → http://127.0.0.1:9090
```

打开引导页根路径后，标题为 `登录 · 西藏民族大学 CTF 平台`（本前端），
而不是 Default 的 `Login | FloatCTF` —— 证明激活生效。

## 2. 路由走查（真实 API，19+13 条全绿）

选手侧 13 条（均渲染出正确中文标题、外壳存活、无错误块）：

```
/                       总览 · 西藏民族大学 CTF 平台
/events                 赛事 · 西藏民族大学 CTF 平台
/challenges             题库 · 西藏民族大学 CTF 平台
/sets                   题集 · 西藏民族大学 CTF 平台
/instances              我的实例 · 西藏民族大学 CTF 平台
/training               训练场 · 西藏民族大学 CTF 平台
/community/announcements 全站公告 · 西藏民族大学 CTF 平台
/community/discussions  讨论区 · 西藏民族大学 CTF 平台
/community/solves       解题流水 · 西藏民族大学 CTF 平台
/community/top          Top15 排行榜 · 西藏民族大学 CTF 平台
/community/writeups     全站题解 · 西藏民族大学 CTF 平台
/community/arsenal      武器库 · 西藏民族大学 CTF 平台
/me                     我的资料 · 西藏民族大学 CTF 平台
```

管理端 18 条（全部 `err:false`、管理导航存活）：

```
/admin /admin/events /admin/challenges /admin/challenge-sets /admin/gameboxes
/admin/network /admin/users /admin/super-admins /admin/announcements /admin/discussions
/admin/weapons /admin/settings /admin/logs /admin/scheduled-tasks /admin/docker
/admin/database /admin/terminal /admin/frontends
```

其中 `/admin/settings`（2383 字符）、`/admin/docker`（2778）、`/admin/logs`（2036）、
`/admin/network`（1168）内容量明显来自真实接口。

## 3. 真实数据（非桩）

- 控制台总览：用户 **2**、赛事 **2**、题目 0、武器 0、公告 0、讨论 0、实例 0、GameBox 0；
  平台版本 **1.0.0**。
- 赛事表列出两个真实内置练习赛事：`AWDPlusPractice`（`awdp` / practice·individual / 隐藏）、
  `JeopardyPractice`（`jeopardy` / practice·individual / 隐藏）。
- 「最近注册」列出 `xzmu-verify` / `123509714`（本次真实注册）与 `testuser` / `1000000`。
- 玩家总览显示真实归属：`训练场 · xzmu-verify`。

## 4. 鉴权与边界

| 场景 | 结果 |
|---|---|
| 未登录访问 `/` | 重定向 `/login?next=%2F` ✅ |
| 未登录访问 `/events` | 重定向 `/login?next=%2Fevents` ✅ |
| 登录成功后回到 `next` | ✅ |
| 深链直接打开 `/events` | 正确渲染「赛事」，非 404 ✅ |
| 深链硬刷新 | 外壳与页面均存活 ✅ |
| `?frontend=default` 破窗 | 加载 Default Frontend（`Login | FloatCTF`，英文）✅ |

## 5. 错误可见性（本轮新增的重要验证）

在**开发直挂**路径（`:13200`）下，`/__floatctf/frontends/registry.json` 并不存在
（该路径由引导页/Caddy 提供，Vite 开发服务器会回落到 `index.html`）。
「前端管理」页因此拿到 `<!DOCTYPE ...>` 而不是 JSON，界面表现：

```
发生未知错误
前端注册表不是合法 JSON：Unexpected token '<', "<!DOCTYPE "... is not valid JSON
Error: 前端注册表不是合法 JSON：…            重试
前端信息读取失败
上方错误块给出了具体原因（注册表地址 / HTTP 状态 / schema 校验错误）。
注册表不可用时 不会显示任何条目，也不会把未知状态当作「空注册表」处理。
```

即：**错误可见、原因具体、可重试、不白屏、不把失败伪装成「空列表」**。
同一页面在**引导链**路径（`:13300`）下正确列出 `default` 与 `xzmu` 并显示当前生效前端。

## 6. 构建与制品

```
pnpm build          → vite build && tsc --noEmit            ✅ 600 modules，0 类型错误
dist/frontend.json  → id=xzmu  version=0.1.0  entry=assets/frontend.js
dist/assets/frontend.js   1,617.90 kB │ gzip 380.83 kB
dist/assets/frontend.css     75.35 kB │ gzip  13.18 kB
scripts/frontend.sh verify  → 制品校验通过：xzmu@0.1.0      ✅
```

## 7. 截图

`docs/evidence/` 下均为**真实 API** 下的截图：

| 文件 | 内容 |
|---|---|
| `player-dashboard-realapi.png` | 选手总览（真实用户 `xzmu-verify`） |
| `player-events.png` | 赛事列表 |
| `player-awdp-training.png` | AWDP 训练 |
| `player-profile.png` | 我的资料 |
| `admin-console-overview.png` | 控制台总览（真实统计 + 两个真实赛事 + 最近注册） |
| `admin-events.png` | 赛事管理 |
| `admin-settings.png` | 动态设置 |
| `admin-docker.png` | 容器运维 |
| `admin-network.png` | 靶场网络 |
| `admin-frontends-bootstrap-path.png` | 前端管理（引导链路径，列出 default + xzmu） |
| `breakglass-default-frontend.png` | `?frontend=default` 破窗后的 Default Frontend |

## 8. 复现步骤

```bash
cd <floatctf 平台仓库>
mise run infra:up
mise run db:migration:apply
cargo build -p floatctf -p floatctf-helper
sudo ./scripts/install.sh --develop --helper-bin "$PWD/target/debug/floatctf-helper"
# 起 API（开发用；等价于 mise run dev 里的 API 部分）
( cd apps/api && FLOATCTF_CONFIG="$PWD/config/development.toml" ../../target/debug/floatctf & )
# 注册玩家账号
curl -sX POST localhost:9090/api/users -H 'Content-Type: application/json' \
  -d '{"username":"123509714","password":"<测试口令>","nickname":"xzmu-verify","email":"a@b.c"}'
cd frontends/floatctf-frontend-xzmu && pnpm dev      # http://<lan>:13200
```
