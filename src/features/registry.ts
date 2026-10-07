/**
 * 页面注册表 —— 各功能域导出的 `PageDef[]` 在这里按**匹配优先级**顺序拼接。
 *
 * 顺序规则：静态路径在参数路径之前；同一前缀下更具体的路径在前。
 * 新增功能域时把它的 pages 加进 `FEATURE_PAGES` 的正确位置。
 */

import type { PageDef } from "../router/pages.ts";
import { adminCorePages } from "./admin/routes-core.tsx";
import { adminEventPages } from "./admin/routes-events.tsx";
import { adminInfraPages } from "./admin/routes-infra.tsx";
import { authPages } from "./auth/routes.tsx";
import { communityPages } from "./community/routes.tsx";
import { dashboardPages } from "./dashboard/routes.tsx";
import { eventPages } from "./events/routes.tsx";
import { jeopardyPages } from "./jeopardy/routes.tsx";
import { profilePages } from "./profile/routes.tsx";
import { trainingPages } from "./training/routes.tsx";

export const FEATURE_PAGES: PageDef[] = [
	// 认证（静态路径）
	...authPages,

	// 选手工作区
	...dashboardPages,
	...eventPages,
	...jeopardyPages,
	...trainingPages,
	...communityPages,
	...profilePages,

	// 管理控制台（更具体的 admin 路径必须排在 `/admin` 之前由各自文件内部保证）
	...adminEventPages,
	...adminCorePages,
	...adminInfraPages,
];
