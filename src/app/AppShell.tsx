/**
 * 应用外壳 —— 顶栏 + 左侧导航轨 + 内容区 + 底部移动导航。
 *
 * 交互模型（与 Default Frontend 无关，是本前端自主设计）：
 * - 两个工作区（选手「训练场」/ 管理「控制台」）在顶栏一键切换；
 * - `Ctrl/Cmd+K` 打开命令面板（键盘优先）；
 * - 移动端左栏变为抽屉、底部出现 tab 栏。
 */

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useRuntime } from "../api/client.ts";
import { Link } from "../router/Link.tsx";
import { useLocation, useNavigate } from "../router/router.tsx";
import { Avatar, IconButton } from "../ui/primitives.tsx";
import { useConfirm } from "../ui/overlays.tsx";
import { Icon } from "../ui/icons.tsx";
import logo from "../assets/xzmu-logo.png";
import { useAuth } from "../auth/store.ts";
import {
	ADMIN_MOBILE_NAV,
	ADMIN_NAV,
	PLAYER_MOBILE_NAV,
	PLAYER_NAV,
	type NavGroup,
	type NavItem,
} from "./nav.ts";
import { CommandPalette, useNavigationCommands } from "./CommandPalette.tsx";
import type { LiveStripState } from "./live.tsx";

export type Workspace = "player" | "admin";

function isActive(pathname: string, to: string, exact?: boolean): boolean {
	if (exact) return pathname === to || (to !== "/" && pathname === `${to}/`);
	return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * 导航项链接：普通条目走自研路由；`reloadDocument` 条目渲染真实 `<a href>` 整页加载
 * —— 它指向同源但**不属于本前端路由表**的静态站点（平台在 `/training/` 挂载的教学课程站），
 * 交给自研路由会落到 not-found。
 */
function NavItemLink({
	item,
	className,
	title,
	current,
	children,
}: {
	item: NavItem;
	className: string;
	title?: string;
	current?: boolean;
	children: ReactNode;
}) {
	if (item.reloadDocument) {
		return (
			<a href={item.to} className={className} title={title}>
				{children}
			</a>
		);
	}
	return (
		<Link to={item.to} className={className} title={title} aria-current={current ? "page" : undefined}>
			{children}
		</Link>
	);
}

function NavGroups({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
	return (
		<>
			{groups.map((group) => (
				<div key={group.label}>
					<div className="xz-rail__group">{group.label}</div>
					{group.items.map((item) => (
						<NavItemLink
							key={item.to}
							item={item}
							className="xz-rail__item"
							title={item.label}
							current={isActive(pathname, item.to, item.exact)}
						>
							<span className="xz-rail__icon">
								<Icon name={item.icon} size={17} />
							</span>
							<span className="xz-rail__label">{item.label}</span>
						</NavItemLink>
					))}
				</div>
			))}
		</>
	);
}

function AccountMenu({
	workspace,
	onLogout,
}: {
	workspace: Workspace;
	onLogout: () => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement | null>(null);
	const { me } = useAuth();

	useEffect(() => {
		if (!open) return;
		const onDown = (event: MouseEvent) => {
			if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const displayName = workspace === "player" ? (me?.nickname || me?.username || "未登录") : "管理员";

	return (
		<div ref={ref} style={{ position: "relative" }}>
			<button
				type="button"
				className="xz-row"
				style={{
					background: "transparent",
					border: 0,
					color: "inherit",
					cursor: "pointer",
					padding: "3px 6px",
					borderRadius: 999,
					gap: 8,
				}}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((value) => !value)}
			>
				<Avatar src={workspace === "player" ? me?.avatar : null} name={displayName} />
				<span className="xz-nowrap" style={{ fontSize: 13, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis" }}>
					{displayName}
				</span>
				<Icon name="chevronDown" size={13} />
			</button>
			{open ? (
				<div
					role="menu"
					className="xz-card"
					style={{
						position: "absolute",
						right: 0,
						top: "calc(100% + 8px)",
						width: 208,
						zIndex: 40,
						overflow: "hidden",
						padding: 4,
					}}
				>
					{workspace === "player" ? (
						<Link to="/me" role="menuitem" className="xz-rail__item" style={{ color: "var(--xz-ink)" }} onClick={() => setOpen(false)}>
							<span className="xz-rail__icon" style={{ color: "var(--xz-crimson)" }}>
								<Icon name="user" size={16} />
							</span>
							<span>我的资料</span>
						</Link>
					) : null}
					<Link
						to={workspace === "player" ? "/admin" : "/"}
						role="menuitem"
						className="xz-rail__item"
						style={{ color: "var(--xz-ink)" }}
						onClick={() => setOpen(false)}
					>
						<span className="xz-rail__icon" style={{ color: "var(--xz-crimson)" }}>
							<Icon name={workspace === "player" ? "shield" : "home"} size={16} />
						</span>
						<span>{workspace === "player" ? "管理控制台" : "返回训练场"}</span>
					</Link>
					<button
						type="button"
						role="menuitem"
						className="xz-rail__item"
						style={{ width: "100%", background: "transparent", border: 0, cursor: "pointer", color: "var(--xz-danger)" }}
						onClick={() => {
							setOpen(false);
							onLogout();
						}}
					>
						<span className="xz-rail__icon" style={{ color: "var(--xz-danger)" }}>
							<Icon name="logout" size={16} />
						</span>
						<span>退出登录</span>
					</button>
				</div>
			) : null}
		</div>
	);
}

export type { LiveStripState } from "./live.tsx";

export function AppShell({
	workspace,
	children,
	live,
	onLogout,
	footer,
}: {
	workspace: Workspace;
	children: ReactNode;
	/** 实时链路状态（有 SSE 的页面注入）。 */
	live?: LiveStripState | null;
	onLogout: () => void;
	footer?: ReactNode;
}) {
	const runtime = useRuntime();
	const { url } = useLocation();
	const navigate = useNavigate();
	const confirm = useConfirm();
	const [railState, setRailState] = useState<"expanded" | "collapsed" | "open">("expanded");
	const [paletteOpen, setPaletteOpen] = useState(false);
	const { userToken, adminToken } = useAuth();

	const groups = workspace === "player" ? PLAYER_NAV : ADMIN_NAV;
	const mobileItems = workspace === "player" ? PLAYER_MOBILE_NAV : ADMIN_MOBILE_NAV;

	const commands = useNavigationCommands(
		useMemo(
			() => [
				...(PLAYER_NAV.map((group) => ({ label: `训练场 · ${group.label}`, items: group.items }))),
				...(ADMIN_NAV.map((group) => ({ label: `控制台 · ${group.label}`, items: group.items }))),
			],
			[],
		),
		() => undefined,
	);

	// 全局快捷键：⌘/Ctrl+K 打开命令面板；`/` 聚焦页面搜索框。
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPaletteOpen((value) => !value);
				return;
			}
			const target = event.target as HTMLElement | null;
			const typing =
				target &&
				(target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
			if (!typing && event.key === "/") {
				const search = document.querySelector<HTMLInputElement>("[data-page-search]");
				if (search) {
					event.preventDefault();
					search.focus();
				}
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	// 路由变化时收起移动端抽屉。
	useEffect(() => {
		setRailState((current) => (current === "open" ? "expanded" : current));
	}, [url.pathname]);

	const authed = workspace === "player" ? userToken !== null : adminToken !== null;

	return (
		<div className="xz-root">
			<div className="xz-shell" data-rail={railState}>
				<div className="xz-brand">
					<Link to={workspace === "player" ? "/" : "/admin"} className="xz-row" style={{ color: "inherit", gap: 8 }}>
						<span className="xz-brand__mark">
							{/* 校徽（深色 PNG）在深红底上用 CSS 反相为白色，与信息门户顶栏的白校徽一致。 */}
							<img className="xz-brand__emblem" src={logo} alt="" aria-hidden="true" />
						</span>
						<span className="xz-brand__text">
							<span className="xz-brand__name">西藏民族大学</span>
							<span className="xz-brand__sub">FloatCTF</span>
						</span>
					</Link>
				</div>

				<header className="xz-topbar">
					<IconButton
						icon="menu"
						label="打开导航"
						className="xz-mobilebar"
						onClick={() => setRailState((current) => (current === "open" ? "expanded" : "open"))}
					/>

					<div className="xz-topbar__workspaces" role="tablist" aria-label="工作区">
						<button
							type="button"
							role="tab"
							className="xz-topbar__ws"
							aria-current={workspace === "player"}
							onClick={() => navigate("/")}
						>
							<Icon name="flag" size={14} />
							训练场
						</button>
						<button
							type="button"
							role="tab"
							className="xz-topbar__ws"
							aria-current={workspace === "admin"}
							onClick={() => navigate("/admin")}
						>
							<Icon name="shield" size={14} />
							控制台
						</button>
					</div>

					<button
						type="button"
						className="xz-topbar__search xz-mobilebar"
						style={{ flex: "0 1 auto" }}
						onClick={() => setPaletteOpen(true)}
						aria-label="打开命令面板"
					>
						<Icon name="search" size={15} />
						<span className="xz-truncate">搜索或跳转…</span>
					</button>

					<div className="xz-topbar__right">
						{live ? (
							<span className="xz-live" data-state={live.state} title={live.detail}>
								<span className={["xz-dot", live.state === "connected" ? "xz-dot--pulse" : null].filter(Boolean).join(" ")} />
								{live.label}
							</span>
						) : null}
						<button
							type="button"
							className="xz-topbar__search"
							style={{ flex: "0 0 auto", maxWidth: "none", display: "none" }}
							onClick={() => setPaletteOpen(true)}
						>
							<Icon name="search" size={15} />
							<span className="xz-topbar__kbd">⌘K</span>
						</button>
						<IconButton
							icon="search"
							label="命令面板（⌘K）"
							onClick={() => setPaletteOpen(true)}
						/>
						<IconButton
							icon={railState === "collapsed" ? "chevronRight" : "chevronLeft"}
							label={railState === "collapsed" ? "展开导航" : "收起导航"}
							className="xz-mobilebar"
							onClick={() => setRailState((current) => (current === "collapsed" ? "expanded" : "collapsed"))}
						/>
						<AccountMenu workspace={workspace} onLogout={onLogout} />
					</div>
				</header>

				<nav className="xz-rail" aria-label={workspace === "player" ? "选手导航" : "管理导航"}>
					<NavGroups groups={groups} pathname={url.pathname} />
					<div className="xz-rail__foot">
						{footer ?? (
							<>
								<div>西藏民族大学 CTF 平台</div>
								<div>前端 xzmu · v{runtime.context.frontendVersion}</div>
							</>
						)}
					</div>
				</nav>

				<main className="xz-main">
					{live ? (
						<div className="xz-livebar">
							<span className="xz-livebar__title">实时链路</span>
							<span>{live.label}</span>
							{live.detail ? <span className="xz-muted">{live.detail}</span> : null}
						</div>
					) : null}
					<div className="xz-main__scroll" key={url.pathname}>
						{!authed && workspace === "player" ? null : children}
					</div>
				</main>

				<nav className="xz-bottomnav" aria-label="快捷导航">
					{mobileItems.map((item) => (
						<NavItemLink
							key={item.to}
							item={item}
							className="xz-bottomnav__item"
							current={isActive(url.pathname, item.to, item.exact)}
						>
							<Icon name={item.icon} size={19} />
							<span>{item.label}</span>
						</NavItemLink>
					))}
				</nav>
			</div>

			<CommandPalette
				open={paletteOpen}
				onClose={() => setPaletteOpen(false)}
				commands={[
					...commands,
					{
						id: "action:switch-workspace",
						label: workspace === "player" ? "切换到管理控制台" : "切换到训练场",
						group: "操作",
						icon: workspace === "player" ? "shield" : "flag",
						run: () => navigate(workspace === "player" ? "/admin" : "/"),
					},
					{
						id: "action:logout",
						label: "退出登录",
						group: "操作",
						icon: "logout",
						run: () => {
							void confirm({
								title: "退出登录？",
								tone: "danger",
								confirmText: "退出",
							}).then((ok) => {
								if (ok) onLogout();
							});
						},
					},
				]}
			/>
		</div>
	);
}
