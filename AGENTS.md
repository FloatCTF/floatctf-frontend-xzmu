# AGENTS.md — floatctf-frontend-xzmu 作业手册

> 这是**西藏民族大学 CTF 平台前端**（FloatCTF 可插拔前端，id `xzmu`）的内部作业手册。
> 动手前先读本文件，再读 §2 列出的权威文档。**不要**凭 Default Frontend 的实现猜 API。

## 1. 这个仓库是什么

一个**全新的 FloatCTF 可插拔前端**（不是修改官方 Default 前端）。它完全替换浏览器 UI，
覆盖 [CAPABILITY-MATRIX](../../docs/frontend/CAPABILITY-MATRIX.md) 中**全部 89 项 required 能力**
（选手端 + 管理端）。

- 技术栈：React 19 + TypeScript 5 + Vite 6 + TanStack Query v5 + **自研路由** + **自研 CSS 设计系统**
- 主题：**「民大红 · 鎏金」**，取自 `www.xzmu.edu.cn`（`#712323` / `#b0915d` / `#f8f8f6`）与
  `portal.xzmu.edu.cn`（实测顶栏 `rgb(113,35,35)`）。证据截图在 `docs/design-ref/`。
- 不引入任何组件库（无 Primer / 无 Tailwind / 无 AntD），全部组件在 `src/ui/`。

### 常用命令（在仓库根 `/home/fb0sh/Projects/floatctf` 执行）

```bash
mise exec -- pnpm --filter @floatctf/frontend-xzmu typecheck   # tsc --noEmit
mise exec -- pnpm --filter @floatctf/frontend-xzmu build       # vite build && tsc --noEmit
mise exec -- pnpm --filter @floatctf/frontend-xzmu dev         # dev server :13200
```

**任何改动在交付前必须让上面两条 `typecheck` 与 `build` 都通过。**

## 2. 权威文档（按需查阅，不要凭记忆发明 API）

| 文档 | 用途 |
|---|---|
| `docs/SDK-API-REFERENCE.md` | **240 个 SDK 方法的精确签名 + 147 个 DTO 字段表 + 57 条陷阱**。写任何 API 调用前先查这里。 |
| `docs/CAPABILITY-BEHAVIOR-MAP.md` | **89 项 required 能力的行为语义**：该调什么、关键状态字段、权限边界、破坏性操作、三态、实时。 |
| `FRONTEND-PLAN.md` | 本前端的身份、视觉方向、交互模型、信息架构与路由计划。 |
| `../../docs/frontend/AI-FRONTEND-GUIDE.md` | 平台侧权威手册（依赖边界、mount 契约、验收流程）。 |

### 一定不能踩的 SDK 陷阱（详见 SDK-API-REFERENCE §5）

1. 领域方法返回 **`UniResponse<T>` 信封**，数据在 `.data`。
2. HTTP 200 + `code !== 0` 是**平台业务失败**。本前端已用 `installEnvelopeGuard()` 在
   transport 上把它转成 rejection（见 `src/api/call.ts`），所以 `await` 会正常抛错。
   取数据一律用 `call()` / `callList()` / `unwrap()`，**不要**直接读 `.data`。
3. **柯里化方法**返回的是**函数**而不是 Promise：`client.admin.event_challenges.fetch(id)`、
   `client.admin.event_users.fetch(id)`、`client.admin.event_teams.getTeams(id)`、
   `client.admin.event_challenges.remove(id)`、`client.admin.challenge_sets.getChallengeSet(id)` 等。
   必须再调一次：`client.admin.event_challenges.fetch(id)({ page: 1 })`。
4. 位置参数顺序易混：`instances.launchSingle(challenge_id, event_id)` 与
   `events.launchSingleInstance(event_id, challenge_id)` **顺序相反**。
5. `client.admin.super_admin.patch(id, data)` 用的是 **POST**；`uploads.upload_avatar` 是 **PATCH**。
6. AWD / AWDP 的 config PATCH 支持乐观锁 `expected_updated_at`：拿到详情后回传它，
   否则并发修改会被覆盖（或后端按实现拒绝）。
7. `awd.admin.getEventNetwork` 在**未分配**时后端返回 404 → 查询会 reject，必须当成
   「未分配」而不是「加载失败」。

## 3. 硬规则（违反即返工）

1. **只允许** import：`@floatctf/sdk`、`@floatctf/frontend-runtime`、`@floatctf/react`、
   `@tanstack/react-query`、`react`、`react-dom`、`react-markdown`、`remark-gfm`，
   以及本仓库 `src/**` 的相对路径。
   **禁止** import `frontends/default/*`、`apps/web/*`、`packages/*/src/*`、`@/...`
   或任何逃逸出本仓库的相对路径。
2. **禁止假数据 / 占位数据**。页面上每一条数据都必须来自后端接口。没有数据显示**空态**。
   禁止「示例比分」「示例题目」。
3. **状态判定必须与后端一致**，不得前端自造。用 `src/features/events/status.ts`、
   SDK 枚举（`@floatctf/sdk/entity` 的 `AwdpPhase` / `AwdPhase` / `GameboxStatus` 等）。
   注意 AWDP 有一个 Default 漏掉的 **`preparing_fix`** 过渡态，必须如实展示。
4. **禁止原生 `alert` / `confirm` / `prompt`**，一律用 `useConfirm()` / `useToast()` / `<Modal>`。
5. **错误必须可见**：任何 `useQuery` 都要用 `<QueryBoundary>` 或显式渲染错误态；
   任何 `useMutation` 都要在 `onError` 里 `toast.error(标题, errorText(error))`。
   **不得**白屏、不得静默失败。
6. **破坏性操作**必须 `useConfirm()` 二次确认，并把**真实后果**写进 `consequences`
   （例如重置 GameBox 的免费次数/罚分、删除赛事会回收容器）。
   高风险操作（归档赛事、删除用户、执行 SQL）用 `confirmPhrase` 要求输入确认词。
7. **token 绝不进 URL / query string**。只在 `src/auth/store.ts` 里读写。
8. `Users` 实体带 `password` 字段 —— **任何界面都不得渲染它**。
   `ChallengesListItem.static_flag_value` 只在 admin 接口返回，**绝不可**展示给选手端。

## 4. 目录结构与新增页面

```
src/
├── entry.tsx              # mount(context) —— 制品入口（已实现，勿改签名）
├── dev.tsx                # dev 入口（已实现）
├── api/                   # client.ts(装配) / call.ts(信封) / errors.ts / keys.ts
├── auth/store.ts          # 两个独立 token 作用域
├── router/                # router.tsx(自研路由) / Link.tsx / pages.ts(PageDef 契约)
├── ui/                    # 设计系统：icons/primitives/Table/overlays/Markdown
├── lib/                   # format.ts(格式化) / hooks.ts(useNow/useDebounced)
├── app/                   # App.tsx / AppShell.tsx / nav.ts / live.tsx / CommandPalette.tsx
├── features/
│   ├── registry.ts        # ★ 页面注册表：所有 PageDef 在这里汇总
│   ├── panels.ts          # EventPanelProps 契约
│   ├── auth/  dashboard/  events/  jeopardy/  awd/  awdp/  training/  community/  profile/  admin/
└── styles/                # tokens/base/layout/components/domain.css（index.css 汇总）
```

### 新增一个页面

1. 在 `src/features/<域>/` 下写页面组件。
2. 在同目录的 `routes.tsx` 里导出 `PageDef[]`：

```tsx
export const xxxPages: PageDef[] = [
  { path: "/xxx/:id", auth: "user", title: "标题", render: (props) => <XxxPage {...props} /> },
];
```

`PageDef` 字段（`src/router/pages.ts`）：`path` / `auth`(`"public"|"user"|"admin"`) /
`title` / `wide?` / `render({ params, url })`。
静态路径要排在参数路径之前；`/events/:id` 这类由相应文件内部保证顺序。

3. 在 `src/features/registry.ts` 的 `FEATURE_PAGES` 中按注释分区加入你的数组。

**鉴权不要写在页面里**：`auth: "user" | "admin"` 由 `App.tsx` 的守卫统一处理并携带 `next` 跳转。

### 新增样式

**在自己的功能目录下建 `styles.css` 并在 `routes.tsx` 顶部 `import "./styles.css";`**。
不要改 `src/styles/domain.css`（多人协作会冲突）。Vite 会把所有 CSS 合并成单文件
`assets/frontend.css`（`cssCodeSplit: false`），因此顺序只影响同名类覆盖，请使用唯一类名前缀，
例如 `.xz-awd-*`、`.xz-admin-*`。

## 5. UI 组件 API（`src/ui/`）

### `primitives.tsx`

```tsx
<Button variant="primary|ghost|quiet|gold|danger|danger-ghost" size="sm|md|lg"
        block loading icon="flag" onClick>…</Button>
<IconButton icon="refresh" label="刷新" onClick />          // label 必填（无障碍）
<Card |flat |tight><CardHead title sub icon actions /><CardBody |flush /><CardFoot /></Card>
<Badge tone="neutral|crimson|gold|ok|warn|danger|info|solid" icon>…</Badge>
<Stat label value foot icon gold />
<SectionTitle actions>…</SectionTitle>
<Field label hint error required>{({id,"aria-describedby","aria-invalid"}) => <TextInput {...props}/>}</Field>
<TextInput /> <TextArea /> <Select /> <Checkbox label checked onChange />
<Switch checked onChange label /> <Segmented value options onChange ariaLabel />
<Spinner /> <InlineLoading>…</InlineLoading> <Skeleton width height />
<EmptyState title desc icon actions />
<ErrorState title message retryable onRetry detail />
<Banner tone="info|warn|danger|ok" title actions>…</Banner>
<KeyValue items={[{k,v}]} />
<ProgressBar value max tone /> <Avatar src name size />
<CopyButton value /> <CodeBlock>{text}</CodeBlock> <Secret value />   // 敏感值默认模糊
useClipboard(): [copied, copy]
```

### `Table.tsx`

```tsx
<DataTable columns={[{key,header,render?,numeric?,width?,align?}]} rows rowKey={(r,i)=>id}
           onRowClick? activeKey? empty? compact? />
<Pagination page pageSize total onPageChange onPageSizeChange? />
readMeta(meta, fallbackSize) → {page,pageSize,total}
```

### `overlays.tsx`

```tsx
<QueryBoundary isPending isError error refetch loadingLabel>…</QueryBoundary>  // 首选三态方案
<Modal open onClose title description footer size="md|wide|xl" tone persistent>…</Modal>
<Drawer open onClose title subtitle footer>…</Drawer>                          // 右侧详情抽屉
const confirm = useConfirm();
await confirm({ title, description, consequences, tone:"danger", confirmText, confirmPhrase });
const toast = useToast();
toast.success(title, message?); toast.error(title, message?); toast.warn(...); toast.info(...);
```

### `Markdown.tsx`

```tsx
<MarkdownView>{content}</MarkdownView>                    // 安全渲染（不执行原始 HTML）
<MarkdownEditor value onChange placeholder minHeight onUploaded? />
```

### `icons.tsx`

```tsx
<Icon name="flag" size={18} weight={1.7} />
```
可用图标名见 `src/ui/icons.tsx` 的 `PATHS`（约 90 个，含 `flag/puzzle/sword/shield/target/box/
terminal/server/database/network/trophy/crown/bolt/clock/users/chat/book/beaker/layers/chart` 等）。
**新增图标请直接往 `PATHS` 里加 path 数据**，不要引入图标库。

## 6. 数据层约定

```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { call, callList, unwrap, unwrapNullable } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { qk } from "../../api/keys.ts";
import { errorText } from "../../api/errors.ts";

const client = useClient();
const query = useQuery({
  queryKey: qk.events.detail(eventId),
  queryFn: () => call(client.service.events.get(eventId), "赛事详情"),
});
const list = useQuery({
  queryKey: qk.challenges.list(params),
  queryFn: () => callList(client.service.challenges.fetch(params)),
});

const mutate = useMutation({
  mutationFn: (input: X) => call(client.service.xxx.doSomething(input), "操作结果"),
  onSuccess: (data) => { toast.success("成功"); void queryClient.invalidateQueries({ queryKey: qk.xxx.all }); },
  onError: (error) => toast.error("失败", errorText(error)),
});
```

- `call(promise, what?)` → `Promise<T>`；`callList(promise)` → `{items, meta}`；
  `unwrap(response, what?)` 用于已经 `await` 出信封的场景；`unwrapNullable` 允许 `null`。
- **查询键统一走 `qk`**（`src/api/keys.ts`）。需要新键就往里加，不要在页面里写裸数组。
- 轮询周期沿用 Default 已核实的语义：积分榜/趋势 30s，赛事公告 60s，管理端 dashboard 60s。
- 柯里化方法记得二次调用：`client.admin.event_users.fetch(id)({ page: 1 })`。

## 7. 实时（SSE）

```tsx
import { useBindings } from "../../api/client.ts";
import { useLiveStatus } from "../../app/live.tsx";

const { useAwdEventStream, useAdminAwdEventStream, useAwdpEventStream, useAwdpRunStream } = useBindings();
const stream = useAwdEventStream({ eventId });
// stream.state / stream.lastEvent / …
const { setLive } = useLiveStatus();
useEffect(() => setLive({ label: "AWD 实时", state: String(stream.state ?? "connecting") }), [stream.state, setLive]);
```

- SSE 的 401 **不会**触发 `onUnauthorized`，只会把 state 变成 `"auth_error"` 并停止重连；
  必须把这个状态如实展示出来。
- 连接断开时 hook 内部会降级轮询；**不得**因为断线冻结页面。
- 需要手写流时用 `client.sse.connect({ url, headers: {}, signal, onEvent, onStateChange })`
  —— `headers` / `signal` / `onEvent` 都是**必填**。

## 8. 交付前自查

- [ ] `mise exec -- pnpm --filter @floatctf/frontend-xzmu typecheck` 通过
- [ ] `mise exec -- pnpm --filter @floatctf/frontend-xzmu build` 通过
- [ ] 所有列表/详情都有 **loading / empty / error** 三态
- [ ] 所有 mutation 都有成功提示 + `onError` 可见错误
- [ ] 所有破坏性操作都有 `useConfirm()` 且写明后果
- [ ] 没有假数据、没有 `alert/confirm/prompt`、没有渲染 `password` / `static_flag_value`
- [ ] 新增的查询键加进了 `src/api/keys.ts`
- [ ] 新增的页面加进了 `src/features/registry.ts`
- [ ] 深链可直接刷新（路径都是 root-absolute，平台保证 SPA fallback）
