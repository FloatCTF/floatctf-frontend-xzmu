/**
 * 社区功能域路由（选手端）。
 *
 * 顺序规则：**静态路径必须排在参数路径之前** ——
 * `/community/discussions/mine` 在 `/community/discussions/:id` 之前，
 * 否则「我的帖子」会被当成 id 为 `mine` 的帖子详情。
 */

import "./styles.css";

import type { PageDef } from "../../router/pages.ts";
import { DiscussionDetailPage, DiscussionsPage, MyDiscussionsPage } from "./discussions.tsx";
import {
	AnnouncementsPage,
	ArsenalPage,
	SolvesPage,
	TopPage,
	WriteupDetailPage,
	WriteupsPage,
} from "./pages.tsx";

export const communityPages: PageDef[] = [
	// 静态路径
	{
		path: "/community/announcements",
		auth: "user",
		title: "全站公告",
		render: () => <AnnouncementsPage />,
	},
	{
		path: "/community/discussions",
		auth: "user",
		title: "讨论区",
		render: () => <DiscussionsPage />,
	},
	{
		path: "/community/discussions/mine",
		auth: "user",
		title: "我的帖子",
		render: () => <MyDiscussionsPage />,
	},
	{ path: "/community/solves", auth: "user", title: "解题流水", wide: true, render: () => <SolvesPage /> },
	{ path: "/community/top", auth: "user", title: "Top15 排行榜", render: () => <TopPage /> },
	{ path: "/community/writeups", auth: "user", title: "全站题解", render: () => <WriteupsPage /> },
	{ path: "/community/arsenal", auth: "user", title: "武器库", render: () => <ArsenalPage /> },

	// 参数路径（必须排在对应的静态路径之后）
	{
		path: "/community/discussions/:id",
		auth: "user",
		title: "讨论详情",
		render: (props) => <DiscussionDetailPage {...props} />,
	},
	{
		path: "/community/writeups/:id",
		auth: "user",
		title: "题解详情",
		render: (props) => <WriteupDetailPage {...props} />,
	},
];
