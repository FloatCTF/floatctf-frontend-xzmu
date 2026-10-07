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
import { mountApp } from "./app/mountApp.tsx";
import sourceManifest from "../floatctf.frontend.json" with { type: "json" };
// 样式：dev 由 Vite 注入；生产构建抽成单文件 CSS，由 bootstrap 按 frontend.json 注入。
import "./styles/index.css";

export function mount(context: FloatCTFMountContext): () => void {
	return mountApp(context);
}

/** 制品自述（仅诊断用；平台以本地注册表为准）。 */
export const manifest = {
	id: sourceManifest.id,
	version: sourceManifest.version,
};

const frontendModule: FloatCTFFrontendModule = { manifest, mount };
export default frontendModule;
