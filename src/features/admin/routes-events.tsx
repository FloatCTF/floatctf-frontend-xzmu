/**
 * 管理控制台 · 赛事与资产管理域的路由表。
 *
 * 注册进 `src/features/registry.ts` 的 `adminEventPages`。
 * 顺序规则（`src/router/router.tsx` 按声明顺序匹配）：静态路径必须在参数路径之前，
 * 因此 `/admin/events` 先于 `/admin/events/:id`、`/admin/challenge-sets` 先于 `/admin/challenge-sets/:id`。
 *
 * 全部 `auth: "admin"` —— 守卫在 `App.tsx` 统一处理（携带 `next` 跳转），页面内不重复判权。
 */

import "./events.css";

import type { PageDef } from "../../router/pages.ts";
import { AwdBigScreenAdmin } from "../awd/screen.tsx";
import { AdminChallengeSetDetailPage, AdminChallengeSetsPage } from "./events/ChallengeSetsPage.tsx";
import { AdminChallengesPage } from "./events/ChallengesPage.tsx";
import { AdminEventConsolePage } from "./events/EventConsole.tsx";
import { AdminEventListPage } from "./events/EventListPage.tsx";
import { AdminGameboxesPage } from "./events/GameboxesPage.tsx";
import { AdminNetworkPage } from "./events/NetworkPage.tsx";

export const adminEventPages: PageDef[] = [
	{
		path: "/admin/events",
		auth: "admin",
		title: "赛事管理",
		render: () => <AdminEventListPage />,
	},
	{
		// 参数路径中更具体的必须排在前面（大屏先于赛事控制台）。
		path: "/admin/events/:id/awd/screen",
		auth: "admin",
		title: "AWD 数据大屏",
		wide: true,
		render: (props) => <AwdBigScreenAdmin eventId={props.params.id} />,
	},
	{
		path: "/admin/events/:id",
		auth: "admin",
		title: "赛事控制台",
		wide: true,
		render: (props) => <AdminEventConsolePage {...props} />,
	},
	{
		path: "/admin/challenges",
		auth: "admin",
		title: "挑战管理",
		render: () => <AdminChallengesPage />,
	},
	{
		path: "/admin/challenge-sets",
		auth: "admin",
		title: "题集管理",
		render: () => <AdminChallengeSetsPage />,
	},
	{
		path: "/admin/challenge-sets/:id",
		auth: "admin",
		title: "题集题目",
		render: (props) => <AdminChallengeSetDetailPage {...props} />,
	},
	{
		path: "/admin/gameboxes",
		auth: "admin",
		title: "GameBox 库",
		render: () => <AdminGameboxesPage />,
	},
	{
		path: "/admin/network",
		auth: "admin",
		title: "平台网络",
		render: () => <AdminNetworkPage />,
	},
];
