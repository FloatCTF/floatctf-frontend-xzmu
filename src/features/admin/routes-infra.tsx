/**
 * 管理控制台 · 基础设施功能域的路由（替换占位实现）。
 *
 * 三条路由（全部 `auth: "admin"`，鉴权由 `App.tsx` 的守卫统一处理）：
 * - `/admin/docker`   Docker 运维：容器 / 镜像 / 网络三个视图（同一路由内用 `<Segmented>` 切换，
 *                     因为侧栏只挂了一个入口）
 * - `/admin/database` SQL 控制台：高权限逃生工具，执行前二次确认，高风险语句要求输入 EXECUTE
 * - `/admin/terminal` Web 终端：`client.adminHttp` + 原生 `WebSocket` 逃生舱（见页面内声明）
 *
 * 样式只写在本目录的 `infra.css`（类名前缀 `.xz-inf-`），不修改 `src/styles/*`。
 */

import type { PageDef } from "../../router/pages.ts";
import { AdminDatabasePage } from "./infra/DatabasePage.tsx";
import { AdminDockerPage } from "./infra/DockerPage.tsx";
import { AdminTerminalPage } from "./infra/TerminalPage.tsx";
import "./infra.css";

export const adminInfraPages: PageDef[] = [
	{
		path: "/admin/docker",
		auth: "admin",
		title: "容器运维",
		wide: true,
		render: () => <AdminDockerPage />,
	},
	{
		path: "/admin/database",
		auth: "admin",
		title: "SQL 控制台",
		wide: true,
		render: () => <AdminDatabasePage />,
	},
	{
		path: "/admin/terminal",
		auth: "admin",
		title: "Web 终端",
		wide: true,
		render: () => <AdminTerminalPage />,
	},
];
