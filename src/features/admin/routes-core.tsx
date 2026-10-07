/**
 * 管理控制台 · 核心域路由（`/admin` 及其治理 / 系统页面）。
 *
 * 覆盖能力（CAPABILITY-MATRIX「管理端：总览与内容」+「基础设施、系统与平台设置」）：
 * - `/admin`                Dashboard 聚合总览（+ 系统监控 / 版本）
 * - `/admin/users`          用户管理 CRUD
 * - `/admin/super-admins`   超管账号 CRUD
 * - `/admin/announcements`  全局公告 CRUD
 * - `/admin/discussions`    讨论管理（列表 / 详情抽屉 / 删除 / 评论删除）
 * - `/admin/weapons`        武器库 CRUD + 文件上传
 * - `/admin/settings`       动态设置 CRUD（value / resolved_value 分列展示）
 * - `/admin/logs`           操作日志查询（服务端 filter 表达式 + 本页搜索）
 * - `/admin/scheduled-tasks` 计划任务 CRUD + 手动运行（确认词）
 * - `/admin/frontends`      已安装前端选择器（写 `FRONTEND_ACTIVE`）
 *
 * 全部 `auth: "admin"`（守卫在 `src/app/App.tsx` 统一处理并携带 `next`）。
 * 顺序：`/admin` 放数组首位（精确路径，不会吞掉 `/admin/xxx`，但总览是工作区首页）。
 */

import type { PageDef } from "../../router/pages.ts";
import "./core.css";

import { AdminAnnouncementsPage } from "./core/announcements.tsx";
import { AdminDashboardPage } from "./core/dashboard.tsx";
import { AdminDiscussionsPage } from "./core/discussions.tsx";
import { AdminFrontendsPage } from "./core/frontends.tsx";
import { AdminLogsPage } from "./core/logs.tsx";
import { AdminScheduledTasksPage } from "./core/scheduledTasks.tsx";
import { AdminSettingsPage } from "./core/settings.tsx";
import { AdminSuperAdminsPage } from "./core/superAdmins.tsx";
import { AdminUsersPage } from "./core/users.tsx";
import { AdminWeaponsPage } from "./core/weapons.tsx";

export const adminCorePages: PageDef[] = [
	{
		path: "/admin",
		auth: "admin",
		title: "控制台总览",
		wide: true,
		render: () => <AdminDashboardPage />,
	},
	{
		path: "/admin/users",
		auth: "admin",
		title: "用户管理",
		wide: true,
		render: () => <AdminUsersPage />,
	},
	{
		path: "/admin/super-admins",
		auth: "admin",
		title: "管理员账号",
		wide: true,
		render: () => <AdminSuperAdminsPage />,
	},
	{
		path: "/admin/announcements",
		auth: "admin",
		title: "公告管理",
		wide: true,
		render: () => <AdminAnnouncementsPage />,
	},
	{
		path: "/admin/discussions",
		auth: "admin",
		title: "讨论管理",
		wide: true,
		render: () => <AdminDiscussionsPage />,
	},
	{
		path: "/admin/weapons",
		auth: "admin",
		title: "武器库管理",
		wide: true,
		render: () => <AdminWeaponsPage />,
	},
	{
		path: "/admin/settings",
		auth: "admin",
		title: "动态设置",
		wide: true,
		render: () => <AdminSettingsPage />,
	},
	{
		path: "/admin/logs",
		auth: "admin",
		title: "操作日志",
		wide: true,
		render: () => <AdminLogsPage />,
	},
	{
		path: "/admin/scheduled-tasks",
		auth: "admin",
		title: "计划任务",
		wide: true,
		render: () => <AdminScheduledTasksPage />,
	},
	{
		path: "/admin/frontends",
		auth: "admin",
		title: "已安装前端",
		wide: true,
		render: () => <AdminFrontendsPage />,
	},
];
