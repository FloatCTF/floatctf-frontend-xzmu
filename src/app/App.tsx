/**
 * 应用装配：Provider 顺序、鉴权守卫、路由匹配、会话恢复。
 *
 * 守卫语义（与后端权限模型一致）：
 * - `public`：任何人可访问（登录 / 注册 / 重置）；
 * - `user`：需要**选手** token；缺失时跳 `/login?next=<原路径>`；
 * - `admin`：需要**管理端** token（平台只有 SuperAdmin 一种管理角色）；
 *   缺失时跳 `/admin/login?next=<原路径>`。
 *
 * 两个作用域的 token 与跳转目标**互相独立** —— 管理端 401 不会把选手踢下线。
 */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { unwrap } from "../api/call.ts";
import {
	RuntimeContext,
	setUnauthorizedHandler,
	type AppRuntime,
	useClient,
} from "../api/client.ts";
import { clearScope, setMe, useAuth } from "../auth/store.ts";
import type { PageDef } from "../router/pages.ts";
import { RouterProvider, resolveRoute, useLocation, useNavigate } from "../router/router.tsx";
import { ConfirmProvider, ToastProvider } from "../ui/overlays.tsx";
import { Button, EmptyState } from "../ui/primitives.tsx";
import { AuthShell } from "../features/auth/AuthShell.tsx";
import { FEATURE_PAGES } from "../features/registry.ts";
import { AppShell, type Workspace } from "./AppShell.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { LiveProvider, type LiveStripState } from "./live.tsx";

/** 当前路径属于哪个工作区（用于选择导航与外壳）。 */
function workspaceOf(pathname: string): Workspace {
	return pathname === "/admin" || pathname.startsWith("/admin/") ? "admin" : "player";
}

function isAuthPath(pathname: string): boolean {
	return (
		pathname === "/login" ||
		pathname === "/register" ||
		pathname === "/reset-password" ||
		pathname === "/reset" ||
		pathname === "/admin/login"
	);
}

function NotFound() {
	const navigate = useNavigate();
	return (
		<EmptyState
			icon="search"
			title="页面不存在"
			desc="该地址没有对应的页面。它可能已被移除，或链接拼写有误。"
			actions={
				<Button variant="primary" icon="home" onClick={() => navigate("/")}>
					回到总览
				</Button>
			}
		/>
	);
}

/** 401 之后把用户送回登录页，并携带 `next` 以便登录后回到原处。 */
function UnauthorizedBridge() {
	const navigate = useNavigate();
	useEffect(() => {
		setUnauthorizedHandler((scope, next) => {
			const target = scope === "admin" ? "/admin/login" : "/login";
			navigate(`${target}?next=${encodeURIComponent(next)}`, { replace: true });
		});
		return () => setUnauthorizedHandler(null);
	}, [navigate]);
	return null;
}

/**
 * 会话恢复：有选手 token 但还没校验过时，用 `/users/me` 验证并填充资料。
 * 校验失败（token 过期 / 被撤销）时清 token 并引导重新登录，不静默失败。
 */
function SessionRestore() {
	const client = useClient();
	const { userToken, sessionChecked } = useAuth();
	const navigate = useNavigate();

	useEffect(() => {
		if (!userToken || sessionChecked) return;
		let cancelled = false;
		client.service.users
			.getMe()
			.then((response) => {
				if (cancelled) return;
				setMe(unwrap(response, "用户资料"));
			})
			.catch(() => {
				if (cancelled) return;
				setMe(null);
				clearScope("user");
				const next = `${window.location.pathname}${window.location.search}`;
				if (window.location.pathname !== "/login") {
					navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true });
				}
			});
		return () => {
			cancelled = true;
		};
	}, [client, userToken, sessionChecked, navigate]);

	return null;
}

function RoutedApp({ runtime }: { runtime: AppRuntime }) {
	const { url } = useLocation();
	const { userToken, adminToken } = useAuth();
	const navigate = useNavigate();
	const [live, setLive] = useState<LiveStripState | null>(null);

	const workspace = workspaceOf(url.pathname);
	const match = useMemo(() => resolveRoute<PageDef>(FEATURE_PAGES, url.pathname), [url.pathname]);

	// 实时状态条**由面板自己拥有**：面板在 effect 里 `setLive(...)`，并在 cleanup 里
	// `setLive(null)`。这里**不能**再按 pathname 清一次 —— effect 是自下而上执行的，
	// 父组件的清理会排在子面板的设置之后，反而会把刚写好的状态清掉（实测：首次进入
	// 有 SSE 的页面时顶栏状态条为空）。路由切换时的清理由面板 unmount 完成。

	const logout = useCallback(() => {
		clearScope(workspace === "admin" ? "admin" : "user");
		runtime.queryClient.clear();
		navigate(workspace === "admin" ? "/admin/login" : "/login", { replace: true });
	}, [navigate, runtime.queryClient, workspace]);

	// 守卫：未登录访问受保护页面 → 重定向（携带 next）。
	useEffect(() => {
		if (!match) return;
		if (match.route.auth === "user" && !userToken) {
			navigate(`/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`, { replace: true });
		} else if (match.route.auth === "admin" && !adminToken) {
			navigate(`/admin/login?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`, { replace: true });
		}
	}, [match, userToken, adminToken, navigate, url.pathname, url.search]);

	const content: ReactNode = (() => {
		if (!match) return <NotFound />;
		const { route, params } = match;
		// 鉴权未通过：本帧不渲染受保护内容（effect 会完成跳转）。
		if (route.auth === "user" && !userToken) return null;
		if (route.auth === "admin" && !adminToken) return null;
		return route.render({ params, url });
	})();

	const liveValue = useMemo(() => ({ live, setLive }), [live]);

	// 页面标题：这里在**渲染期**先写入路由声明的标题，而页面自身的 `useDocumentTitle`
	// 在 effect 中执行（晚于渲染）因而可以覆盖它 —— 于是「路由给兜底标题、页面给精确标题」
	// 的优先级天然成立（例如 `/events/:id` 显示真实赛事名而不是「赛事驾驶舱」）。
	if (typeof document !== "undefined" && match?.route.title) {
		document.title = `${match.route.title} · 西藏民族大学 CTF 平台`;
	}

	// 错误边界只包**内容区**：页面渲染异常时外壳（左栏 / 顶栏）仍然可用，
	// 用户可以切到别的页面自救，而不是面对一张白屏（平台硬规则）。
	const guarded = (
		<ErrorBoundary resetKey={`${url.pathname}${url.search}`}>{content}</ErrorBoundary>
	);

	if (isAuthPath(url.pathname)) {
		return (
			<LiveProvider value={liveValue}>
				<AuthShell>{guarded}</AuthShell>
			</LiveProvider>
		);
	}

	return (
		<LiveProvider value={liveValue}>
			<AppShell workspace={workspace} live={live} onLogout={logout}>
				{guarded}
			</AppShell>
		</LiveProvider>
	);
}

export function App({ runtime }: { runtime: AppRuntime }) {
	return (
		<RuntimeContext.Provider value={runtime}>
			<QueryClientProvider client={runtime.queryClient}>
				<RouterProvider>
					<ToastProvider>
						<ConfirmProvider>
							<UnauthorizedBridge />
							<SessionRestore />
							<RoutedApp runtime={runtime} />
						</ConfirmProvider>
					</ToastProvider>
				</RouterProvider>
			</QueryClientProvider>
		</RuntimeContext.Provider>
	);
}
