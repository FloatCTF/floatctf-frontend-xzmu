/**
 * AWD 功能域路由 —— 目前只有 kiosk 数据大屏。
 *
 * 注册进 `src/features/registry.ts` 的 `FEATURE_PAGES`（紧跟在 `eventPages` 之后）。
 * 大屏是**只读**页面（无 mutation、无二次确认），鉴权仍交给 `App.tsx` 的守卫。
 */

import type { PageDef } from "../../router/pages.ts";
import { AwdBigScreenPlayer } from "./screen.tsx";

export const awdPages: PageDef[] = [
	{
		path: "/events/:id/awd/screen",
		auth: "user",
		title: "AWD 数据大屏",
		wide: true,
		render: (props) => <AwdBigScreenPlayer eventId={props.params.id} />,
	},
];
