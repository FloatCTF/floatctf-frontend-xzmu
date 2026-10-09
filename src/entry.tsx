/**
 * 制品入口 —— 实现 FloatCTF 前端运行时契约。
 *
 * bootstrap（`@floatctf/frontend-runtime`）只负责：解析注册表、注入样式、动态 import
 * 本模块并调用 `mount(context)`。**其余全部在这里**——React、路由、数据层、设计系统、
 * 页面与导航，全部由本前端自己拥有。
 *
 * 与 Default Frontend 无任何代码依赖：本文件只 import 公共包
 * （`@floatctf/sdk` / `@floatctf/frontend-runtime` / `@floatctf/react`）与自身源码。
 */

import type {
	FloatCTFFrontendModule,
	FloatCTFMountContext,
} from "@floatctf/frontend-runtime";
import logo from "./assets/xzmu-logo.png";
import { mountApp } from "./app/mountApp.tsx";
import sourceManifest from "../floatctf.frontend.json" with { type: "json" };
// 样式：dev 由 Vite 注入；生产构建抽成单文件 CSS，由 bootstrap 按 frontend.json 注入。
import "./styles/index.css";

/**
 * 覆盖浏览器标签图标。
 *
 * 平台引导页（`apps/web`）在 `<head>` 里固定写死了外壳的 `/favicon.ico`，
 * 而前端制品 manifest 目前没有 `icon` 字段（`manifest.ts` 是严格白名单，
 * 多写字段会被拒绝），所以"换主题 → 标签图标跟着变"必须由前端在自己的
 * 生命周期里接管：挂载时把 rel=icon / apple-touch-icon 指向本前端的校徽。
 * 同一个标签页切回其它前端时，对方的 mount 会再覆盖一次；本文件不做清理，
 * 避免与后续挂载互相踩。
 */
function applyFavicon(href: string): void {
	const head = document.head;
	for (const el of Array.from(
		head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]'),
	)) {
		el.remove();
	}
	for (const rel of ["icon", "apple-touch-icon"]) {
		const link = document.createElement("link");
		link.rel = rel;
		link.type = "image/png";
		link.href = href;
		head.appendChild(link);
	}
}

export function mount(context: FloatCTFMountContext): () => void {
	applyFavicon(logo);
	return mountApp(context);
}

/** 制品自述（仅诊断用；平台以本地注册表为准）。 */
export const manifest = {
	id: sourceManifest.id,
	version: sourceManifest.version,
};

const frontendModule: FloatCTFFrontendModule = { manifest, mount };
export default frontendModule;
