/**
 * 「我的」功能域路由（选手端）。
 *
 * `/me` 必须排在 `/me/writeups` 之前声明（本前端的匹配规则是「模式段数完全相等」，
 * 两者其实不会互相吞掉；这里仍按「静态在前、更具体在前」的统一约定排列）。
 */

import "./styles.css";

import type { PageDef } from "../../router/pages.ts";
import { MePage, MyWriteupsPage } from "./pages.tsx";

export const profilePages: PageDef[] = [
	{ path: "/me", auth: "user", title: "我的资料", render: () => <MePage /> },
	{ path: "/me/writeups", auth: "user", title: "我的题解", render: () => <MyWriteupsPage /> },
];
