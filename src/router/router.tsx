/**
 * 自研 History API 路由。
 *
 * 为什么自研：平台**不要求**任何特定路由库（AI-FRONTEND-GUIDE §8），而本前端的
 * 核心交互是「赛事驾驶舱」——同一个页面内多标签、多子视图共享赛事上下文。
 * 自己持有路由表比套用某个库的层级模型更直接，也少一个版本面风险。
 *
 * 平台侧保证（SPA fallback）：除 `/api/**` 与 `/__floatctf/**` 外的任意路径都会回退到
 * bootstrap 的 index.html，因此 root-absolute 路径（`/events/3`）可以直接深链刷新。
 */

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from "react";

export interface RouteMatch {
	/** 路由模式，如 `/events/:id`。 */
	pattern: string;
	/** 解析出的路径参数。 */
	params: Record<string, string>;
	/** 当前路径与查询串。 */
	url: URL;
}

interface RouterValue {
	location: RouteMatch;
	navigate: (to: string, options?: { replace?: boolean }) => void;
	back: () => void;
}

const RouterContext = createContext<RouterValue | null>(null);

/** 极简的 history 订阅（不引入路由器依赖）。 */
const listeners = new Set<() => void>();
let currentUrl = typeof window === "undefined" ? "/" : window.location.href;

function emit(): void {
	for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
	window.addEventListener("popstate", () => {
		currentUrl = window.location.href;
		emit();
	});
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot(): string {
	return currentUrl;
}

/** 按模式匹配路径；支持 `:param` 与尾部 `*` 通配。 */
export function matchPath(
	pattern: string,
	pathname: string,
): Record<string, string> | null {
	const patternParts = pattern.split("/").filter(Boolean);
	const pathParts = pathname.split("/").filter(Boolean);

	let pi = 0;
	const params: Record<string, string> = {};

	for (; pi < patternParts.length; pi += 1) {
		const pp = patternParts[pi];
		if (pp === "*") {
			params["*"] = pathParts.slice(pi).map(decodeURIComponent).join("/");
			return params;
		}
		const actual = pathParts[pi];
		if (actual === undefined) return null;
		if (pp.startsWith(":")) {
			params[pp.slice(1)] = decodeURIComponent(actual);
			continue;
		}
		if (pp !== actual) return null;
	}

	// 模式已匹配完；路径若无剩余段则命中（否则视为不匹配，交给更具体的模式）。
	return pathParts.length === pi ? params : null;
}

/** 按声明顺序找到第一个命中的路由。 */
export function resolveRoute<T>(routes: readonly T[], pathname: string): { route: T; params: Record<string, string> } | null {
	for (const route of routes) {
		const pattern = (route as { path?: string }).path;
		if (!pattern) continue;
		const params = matchPath(pattern, pathname);
		if (params) return { route, params };
	}
	return null;
}

export function RouterProvider({ children }: { children: ReactNode }) {
	const href = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	const location = useMemo<RouteMatch>(() => {
		const url = new URL(href, typeof window === "undefined" ? "http://localhost" : window.location.origin);
		return { pattern: "", params: {}, url };
	}, [href]);

	const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
		const url = new URL(to, window.location.origin);
		const next = `${url.pathname}${url.search}${url.hash}`;
		const now = `${window.location.pathname}${window.location.search}${window.location.hash}`;
		if (next === now) return;
		if (options?.replace) window.history.replaceState(null, "", next);
		else window.history.pushState(null, "", next);
		currentUrl = window.location.href;
		emit();
	}, []);

	const back = useCallback(() => {
		window.history.back();
	}, []);

	const value = useMemo<RouterValue>(
		() => ({ location, navigate, back }),
		[location, navigate, back],
	);

	return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouterValue(): RouterValue {
	const value = useContext(RouterContext);
	if (!value) throw new Error("路由 hook 必须在 <RouterProvider> 内使用");
	return value;
}

export function useLocation(): RouteMatch {
	return useRouterValue().location;
}

export function useNavigate(): RouterValue["navigate"] {
	return useRouterValue().navigate;
}

export function useSearchParams(): URLSearchParams {
	return useLocation().url.searchParams;
}

/**
 * 读写单个查询参数（用于驾驶舱的 `?tab=`）。
 * 写入时保留其它参数，并使用 `replace` 避免污染历史记录。
 */
export function useSearchParam(key: string): [string | null, (value: string | null) => void] {
	const { location, navigate } = useRouterValue();
	const value = location.url.searchParams.get(key);

	const setValue = useCallback(
		(next: string | null) => {
			const params = new URLSearchParams(location.url.search);
			if (next === null || next === "") params.delete(key);
			else params.set(key, next);
			const query = params.toString();
			navigate(`${location.url.pathname}${query ? `?${query}` : ""}`, { replace: true });
		},
		[key, location.url.pathname, location.url.search, navigate],
	);

	return [value, setValue];
}

/** 页面标题：路由变化时更新 document.title（可访问性与浏览器历史体验）。 */
export function useDocumentTitle(title: string | undefined): void {
	useEffect(() => {
		if (typeof document === "undefined") return;
		const previous = document.title;
		if (title) document.title = `${title} · 西藏民族大学 CTF 平台`;
		return () => {
			document.title = previous;
		};
	}, [title]);
}

/** 组件内可用的“当前路径”（不含查询串）。 */
export function usePathname(): string {
	return useLocation().url.pathname;
}

/** 一个极简的“路由是否变化”key，用于给页面组件加 key 强制重挂载。 */
export function useRouteKey(): string {
	const location = useLocation();
	return `${location.url.pathname}${location.url.search}`;
}

/** 只在客户端渲染一次的挂载标记（避免 SSR 场景下的闪烁；此处用于动画）。 */
export function useMounted(): boolean {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	return mounted;
}
