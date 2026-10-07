/**
 * 导航配置 —— 交互模型的一部分，由本前端自主设计（不复制 Default 的页面层级）。
 *
 * 模型：**两个工作区**。
 * - 选手「训练场」：总览 / 赛事 / 题库 / 训练 / 社区 / 我的
 * - 管理「控制台」：总览 / 赛事 / 资产 / 用户 / 内容 / 系统
 *
 * 赛事相关能力不再散落成一堆页面，而是收进 `/events/:id` 驾驶舱（`?tab=`）。
 */

import type { IconName } from "../ui/icons.tsx";

export interface NavItem {
	to: string;
	label: string;
	icon: IconName;
	/** 精确匹配（用于工作区首页 `/` 与 `/admin`）。 */
	exact?: boolean;
	/** 前缀匹配时用于判断当前项（默认用 `to`）。 */
	matchPrefix?: string;
}

export interface NavGroup {
	label: string;
	items: NavItem[];
}

export const PLAYER_NAV: NavGroup[] = [
	{
		label: "训练场",
		items: [
			{ to: "/", label: "总览", icon: "home", exact: true },
			{ to: "/events", label: "赛事", icon: "flag" },
			{ to: "/challenges", label: "题库", icon: "puzzle" },
			{ to: "/sets", label: "题集", icon: "layers" },
			{ to: "/instances", label: "我的实例", icon: "box" },
			{ to: "/training", label: "AWDP 训练", icon: "target" },
		],
	},
	{
		label: "社区",
		items: [
			{ to: "/community/announcements", label: "公告", icon: "bell" },
			{ to: "/community/discussions", label: "讨论区", icon: "chat" },
			{ to: "/community/solves", label: "解题流水", icon: "bolt" },
			{ to: "/community/top", label: "排行榜", icon: "crown" },
			{ to: "/community/writeups", label: "题解", icon: "book" },
			{ to: "/community/arsenal", label: "武器库", icon: "sword" },
		],
	},
	{
		label: "账号",
		items: [{ to: "/me", label: "我的资料", icon: "user" }],
	},
];

export const ADMIN_NAV: NavGroup[] = [
	{
		label: "控制台",
		items: [
			{ to: "/admin", label: "总览", icon: "chart", exact: true },
			{ to: "/admin/events", label: "赛事", icon: "flag" },
			{ to: "/admin/challenges", label: "题库管理", icon: "puzzle" },
			{ to: "/admin/challenge-sets", label: "题集管理", icon: "layers" },
			{ to: "/admin/gameboxes", label: "GameBox 库", icon: "box" },
			{ to: "/admin/network", label: "靶场网络", icon: "network" },
		],
	},
	{
		label: "治理",
		items: [
			{ to: "/admin/users", label: "用户", icon: "users" },
			{ to: "/admin/super-admins", label: "管理员", icon: "shield" },
			{ to: "/admin/announcements", label: "公告", icon: "bell" },
			{ to: "/admin/discussions", label: "讨论", icon: "chat" },
			{ to: "/admin/weapons", label: "武器库", icon: "sword" },
		],
	},
	{
		label: "系统",
		items: [
			{ to: "/admin/settings", label: "动态设置", icon: "settings" },
			{ to: "/admin/logs", label: "操作日志", icon: "clipboard" },
			{ to: "/admin/scheduled-tasks", label: "计划任务", icon: "clock" },
			{ to: "/admin/docker", label: "容器运维", icon: "server" },
			{ to: "/admin/database", label: "SQL 控制台", icon: "database" },
			{ to: "/admin/terminal", label: "Web 终端", icon: "terminal" },
			{ to: "/admin/frontends", label: "前端管理", icon: "layers" },
		],
	},
];

/** 移动端底部导航（选手工作区）。 */
export const PLAYER_MOBILE_NAV: NavItem[] = [
	{ to: "/", label: "总览", icon: "home", exact: true },
	{ to: "/events", label: "赛事", icon: "flag" },
	{ to: "/challenges", label: "题库", icon: "puzzle" },
	{ to: "/me", label: "我的", icon: "user" },
];

/** 移动端底部导航（管理工作区）。 */
export const ADMIN_MOBILE_NAV: NavItem[] = [
	{ to: "/admin", label: "总览", icon: "chart", exact: true },
	{ to: "/admin/events", label: "赛事", icon: "flag" },
	{ to: "/admin/users", label: "用户", icon: "users" },
	{ to: "/admin/settings", label: "设置", icon: "settings" },
];
