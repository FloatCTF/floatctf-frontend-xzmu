/**
 * 题库（Jeopardy）路由表。
 *
 * 顺序规则：**静态路径必须排在参数路径之前**（`/challenges`、`/sets`、`/instances` 在前，
 * `/challenges/:id`、`/sets/:id` 在后），否则 `/sets` 会被 `/sets/:id` 之类的模式抢先匹配。
 * 全部是 root-absolute 路径，配合平台的 SPA fallback 可以深链刷新。
 */

import type { PageDef } from "../../router/pages.ts";
import {
	ChallengeCatalogPage,
	ChallengeDetailPage,
	ChallengeSetDetailPage,
	ChallengeSetsPage,
	InstancesPage,
} from "./pages.tsx";

import "./styles.css";

export const jeopardyPages: PageDef[] = [
	// ── 静态路径 ──
	{ path: "/challenges", auth: "user", title: "题库", render: () => <ChallengeCatalogPage /> },
	{ path: "/sets", auth: "user", title: "题集", render: () => <ChallengeSetsPage /> },
	{
		path: "/instances",
		auth: "user",
		title: "我的实例",
		wide: true,
		render: () => <InstancesPage />,
	},

	// ── 参数路径（必须排在静态路径之后）──
	{
		path: "/challenges/:id",
		auth: "user",
		title: "题目详情",
		render: (props) => <ChallengeDetailPage {...props} />,
	},
	{
		path: "/sets/:id",
		auth: "user",
		title: "题集详情",
		wide: true,
		render: (props) => <ChallengeSetDetailPage {...props} />,
	},
];
