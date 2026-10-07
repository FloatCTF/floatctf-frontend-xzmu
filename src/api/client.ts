/**
 * SDK 装配 —— 全应用唯一的客户端实例与 React 绑定。
 *
 * 依赖边界（AI-FRONTEND-GUIDE §4）：本文件只 import 公共包
 * （`@floatctf/sdk` / `@floatctf/frontend-runtime` / `@floatctf/react`）。
 * 不 import frontends/default、apps/web、packages 的内部源码，也不用任何 monorepo 私有 alias。
 */

import type { FloatCTFMountContext } from "@floatctf/frontend-runtime";
import { createFloatCTFReact } from "@floatctf/react";
import { createFloatCTFClient, type FloatCTFClient } from "@floatctf/sdk";
import { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import { getAdminToken, getUserToken, setAdminToken, setUserToken } from "../auth/store.ts";
import { installEnvelopeGuard } from "./call.ts";

export type ReactBindings = ReturnType<typeof createFloatCTFReact>;

export interface AppRuntime {
	context: FloatCTFMountContext;
	client: FloatCTFClient;
	bindings: ReactBindings;
	queryClient: QueryClient;
}

export const RuntimeContext = createContext<AppRuntime | null>(null);

/**
 * 401 之后由本前端决定做什么（SDK 不导航）。装配时注入，避免 API 层直接依赖路由。
 * `next` 让用户重新登录后回到原处。
 */
let onScopeExpired: ((scope: "user" | "admin", next: string) => void) | null = null;

export function setUnauthorizedHandler(
	handler: ((scope: "user" | "admin", next: string) => void) | null,
): void {
	onScopeExpired = handler;
}

function currentPathWithSearch(): string {
	if (typeof window === "undefined") return "/";
	return `${window.location.pathname}${window.location.search}`;
}

/** 创建客户端 + React 绑定 + QueryClient（一次 mount 一套，实例隔离）。 */
export function createRuntime(context: FloatCTFMountContext): AppRuntime {
	const client = createFloatCTFClient({
		baseUrl: context.apiBaseUrl,
		getUserToken,
		getAdminToken,
		onUnauthorized: ({ scope }) => {
			// 先清对应作用域的 token（另一个作用域不受影响），再交给路由层引导登录。
			const next = currentPathWithSearch();
			if (scope === "admin") setAdminToken(null);
			else setUserToken(null);
			onScopeExpired?.(scope === "admin" ? "admin" : "user", next);
		},
	});

	const bindings = createFloatCTFReact({
		client,
		useUserToken: getUserToken,
		useAdminToken: getAdminToken,
	});

	// 平台业务失败是 HTTP 200 + code !== 0：集中转成 rejection，界面才不会「静默成功」。
	installEnvelopeGuard(client);

	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				// 平台数据（分数 / 阶段 / 列表）变化快，但也不该每次聚焦都全量重取。
				staleTime: 15_000,
				gcTime: 5 * 60_000,
				retry: (failureCount, error) => {
					const status = (error as { httpStatus?: number }).httpStatus;
					if (status === 401 || status === 403 || status === 404) return false;
					return failureCount < 2;
				},
				refetchOnWindowFocus: false,
			},
			mutations: {
				retry: false,
			},
		},
	});

	return { context, client, bindings, queryClient };
}

export function useRuntime(): AppRuntime {
	const runtime = useContext(RuntimeContext);
	if (!runtime) throw new Error("useRuntime 必须在 <RuntimeContext> 内使用");
	return runtime;
}

export function useClient(): FloatCTFClient {
	return useRuntime().client;
}

export function useBindings(): ReactBindings {
	return useRuntime().bindings;
}

/**
 * 用 `context.assetBaseUrl` 解析本前端自带资产（AI-FRONTEND-GUIDE §7.2 强制）。
 * 生产制品路径带版本号且 immutable，绝不能硬编码站点根路径。
 */
export function assetUrl(context: FloatCFTMountContextLike, path: string): string {
	const base = context.assetBaseUrl.replace(/\/+$/, "");
	return `${base}/${path.replace(/^\/+/, "")}`;
}

type FloatCFTMountContextLike = Pick<FloatCTFMountContext, "assetBaseUrl">;

/** 文件上传的通用进度签名（`client.transport.*` 提供的 axios 级能力）。 */
export type UploadProgressHandler = (percent: number) => void;
