/**
 * 页面契约 —— 每个功能域导出一组 `PageDef`，由 `src/app/App.tsx` 按声明顺序匹配。
 *
 * 设计要点：
 * - 匹配是**前缀无关的精确/参数匹配**，顺序即优先级（`/events/:id` 与 `/events/new`
 *   这种冲突由声明顺序决定）；
 * - 鉴权声明在页面上（`auth`），守卫统一在 App 层执行，页面内不需要重复判断；
 * - `title` 用于 `document.title` 与面包屑。
 */

import type { ReactNode } from "react";

export interface PageProps {
	/** 路径参数（`:id` 等）。 */
	params: Record<string, string>;
	/** 当前完整 URL（含查询串），驾驶舱的 `?tab=` 从这里读。 */
	url: URL;
}

export type PageAuth = "public" | "user" | "admin";

export interface PageDef {
	path: string;
	auth: PageAuth;
	title: string;
	/** 是否在内容区使用通栏宽度（驾驶舱 / 表格密集型页面用 true）。 */
	wide?: boolean;
	render: (props: PageProps) => ReactNode;
}

/** 功能域导出的路由集合。 */
export interface FeatureRoutes {
	pages: PageDef[];
}
