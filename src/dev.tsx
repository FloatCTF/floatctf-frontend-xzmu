/**
 * 开发入口（由 `index.html` 加载）。
 *
 * 开发模式直接挂载**工作区源码**（保留 Vite HMR），但传入的 `mount(context)`
 * 与生产 bootstrap 调用的是**同一个**函数、同一份 `FloatCTFMountContext` 形状，
 * 因此开发路径与生产路径不会分叉。
 */

import { DEFAULT_API_BASE_URL } from "@floatctf/frontend-runtime";

import { mount } from "./entry.tsx";

const root = document.getElementById("app");

if (root) {
	mount({
		root,
		apiBaseUrl: DEFAULT_API_BASE_URL,
		assetBaseUrl: "/",
		frontendId: "xzmu",
		frontendVersion: "0.1.0",
		platformVersion: "dev",
		apiContractVersion: "1",
		frontendRuntimeVersion: "1",
		capabilities: ["jeopardy", "awd", "awdp", "discussions", "writeups", "web_terminal"],
	});
}
