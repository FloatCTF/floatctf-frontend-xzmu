import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import sourceManifest from "./floatctf.frontend.json" with { type: "json" };

const ENTRY_FILE = "assets/frontend.js";
const STYLE_FILE = "assets/frontend.css";

/**
 * 生产制品入口固定文件名：`frontend.json` 的 `entry` 与 Caddy 的 immutable 缓存策略
 * 都依赖它的确定性。
 */

/** 构建结束后写 `frontend.json`，并用**真实校验器**自检，让「能构建但装不上」在构建期失败。 */
function emitFrontendManifest(): Plugin {
	return {
		name: "floatctf:emit-frontend-manifest",
		apply: "build",
		async closeBundle() {
			const outDir = resolve(__dirname, "dist");
			const styles = existsSync(resolve(outDir, STYLE_FILE)) ? [STYLE_FILE] : [];
			// 制品 manifest **不得**包含 build 段（严格校验会拒绝未知字段）。
			const manifest = {
				schemaVersion: sourceManifest.schemaVersion,
				id: sourceManifest.id,
				name: sourceManifest.name,
				version: sourceManifest.version,
				description: sourceManifest.description,
				author: sourceManifest.author,
				compatibility: sourceManifest.compatibility,
				entry: ENTRY_FILE,
				styles,
			};
			const { parseFrontendManifest } = await import("@floatctf/frontend-runtime");
			const parsed = parseFrontendManifest(manifest);
			if (!parsed.ok) {
				throw new Error(
					`生成的 frontend.json 不满足前端运行时契约：\n${parsed.errors.join("\n")}`,
				);
			}
			if (!existsSync(resolve(outDir, ENTRY_FILE))) {
				throw new Error(`未产出入口文件：${ENTRY_FILE}`);
			}
			mkdirSync(outDir, { recursive: true });
			writeFileSync(
				resolve(outDir, "frontend.json"),
				`${JSON.stringify(manifest, null, 2)}\n`,
			);
		},
	};
}

/** 单元测试跑在开发版 React 下（`React.act` 只在 development 构建导出）。 */
const isTest = Boolean(process.env.VITEST);

export default defineConfig({
	// 生产制品由 bootstrap 从 /__floatctf/frontends/<id>/<version>/ 动态 import，
	// 所有内部引用必须是相对路径（绝不写死站点根）。
	base: "./",
	define: {
		// 制品是**自包含的浏览器应用**：浏览器里没有 `process`，
		// 必须替换掉第三方依赖里的 `process.env.*`。
		...(isTest
			? {}
			: {
					"process.env.NODE_ENV": JSON.stringify("production"),
					"process.env": JSON.stringify({ NODE_ENV: "production" }),
				}),
	},
	plugins: [viteReact(), emitFrontendManifest()],
	server: {
		host: true,
		// 开发时同源代理到 FloatCTF 开发入口（Caddy :7780），
		// 因此 `apiBaseUrl: "/api"` 在 dev 与 prod 语义一致，**不需要**改后端 CORS 配置。
		proxy: {
			// `ws: true` 是必需的：管理端 Web 终端要经 `/api/admin/terminal/ws` 升级协议，
			// Vite 只在 `ws: true`（或 target 为 ws://）时才转发 upgrade 请求。
			"/api": { target: "http://127.0.0.1:7780", changeOrigin: true, ws: true },
			"/public": { target: "http://127.0.0.1:7780", changeOrigin: true },
			"/private": { target: "http://127.0.0.1:7780", changeOrigin: true },
			"/static": { target: "http://127.0.0.1:7780", changeOrigin: true },
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		target: "esnext",
		cssCodeSplit: false,
		lib: {
			entry: resolve(__dirname, "src/entry.tsx"),
			formats: ["es"],
			fileName: () => "assets/frontend.js",
		},
		rollupOptions: {
			output: {
				entryFileNames: ENTRY_FILE,
				// 样式必须与 JS 同处 assets/，bootstrap 注入的是这个确定文件名。
				chunkFileNames: "assets/[name]-[hash].js",
				assetFileNames: (assetInfo) =>
					assetInfo.names?.some((name) => name.endsWith(".css"))
						? STYLE_FILE
						: "assets/[name]-[hash][extname]",
			},
		},
	},
});
