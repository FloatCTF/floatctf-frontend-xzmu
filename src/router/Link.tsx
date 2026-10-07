import type { AnchorHTMLAttributes, ReactNode } from "react";

import { useLocation, useNavigate } from "./router.tsx";

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
	to: string;
	children: ReactNode;
	/** 仅替换历史记录，不新增条目（用于页内标签切换）。 */
	replace?: boolean;
}

/** 只拦截「同源、非新窗口、非修饰键」的点击，其余交给浏览器（保留中键/⌘+点击开新标签）。 */
export function Link({ to, children, replace, onClick, ...rest }: LinkProps) {
	const navigate = useNavigate();

	return (
		<a
			href={to}
			onClick={(event) => {
				onClick?.(event);
				if (event.defaultPrevented) return;
				if (event.button !== 0) return;
				if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
				if (rest.target && rest.target !== "_self") return;
				event.preventDefault();
				navigate(to, { replace });
			}}
			{...rest}
		>
			{children}
		</a>
	);
}

interface NavLinkProps extends Omit<LinkProps, "replace"> {
	/** 精确匹配（默认前缀匹配，`/events` 会匹配 `/events/3`）。 */
	exact?: boolean;
	/** 命中时附加的 className。 */
	activeClassName?: string;
}

export function NavLink({ to, exact, activeClassName, className, ...rest }: NavLinkProps) {
	const { url } = useLocation();
	const target = to.split("?")[0] ?? to;
	const pathname = url.pathname;
	const isActive = exact ? pathname === target : pathname === target || pathname.startsWith(`${target}/`);
	const merged = [className, isActive ? activeClassName : null].filter(Boolean).join(" ");

	return (
		<Link
			to={to}
			className={merged || undefined}
			aria-current={isActive ? "page" : undefined}
			{...rest}
		/>
	);
}
