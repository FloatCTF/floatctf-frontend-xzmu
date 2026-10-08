/**
 * 命令面板（`Ctrl/Cmd + K`）—— 键盘优先导航模型的核心。
 *
 * 命令来源：两个工作区的全部导航项 + 由 Shell 注入的即时动作
 * （切换工作区 / 打开当前页搜索 / 登出）。
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "../ui/icons.tsx";
import { useNavigate } from "../router/router.tsx";

export interface Command {
	id: string;
	label: string;
	group: string;
	icon: string;
	hint?: string;
	run: () => void;
}

export function CommandPalette({
	open,
	onClose,
	commands,
}: {
	open: boolean;
	onClose: () => void;
	commands: Command[];
}) {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActive(0);
		const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
		return () => window.clearTimeout(timer);
	}, [open]);

	const filtered = useMemo(() => {
		const trimmed = query.trim().toLowerCase();
		if (!trimmed) return commands;
		return commands.filter((command) =>
			`${command.label} ${command.group} ${command.hint ?? ""}`.toLowerCase().includes(trimmed),
		);
	}, [commands, query]);

	// 分组后仍保持扁平索引，键盘上下移动才能跨组连续。
	const grouped = useMemo(() => {
		const groups: { label: string; items: { command: Command; index: number }[] }[] = [];
		filtered.forEach((command, index) => {
			const existing = groups.find((group) => group.label === command.group);
			if (existing) existing.items.push({ command, index });
			else groups.push({ label: command.group, items: [{ command, index }] });
		});
		return groups;
	}, [filtered]);

	if (!open) return null;

	const runAt = (index: number) => {
		const command = filtered[index];
		if (!command) return;
		onClose();
		command.run();
	};

	return (
		<div
			className="xz-palette-scrim"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="xz-palette" role="dialog" aria-modal="true" aria-label="命令面板">
				<div className="xz-palette__input">
					<Icon name="search" size={17} />
					<input
						ref={inputRef}
						value={query}
						placeholder="搜索页面与操作…"
						aria-label="搜索页面与操作"
						onChange={(event) => {
							setQuery(event.target.value);
							setActive(0);
						}}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setActive((current) => Math.min(current + 1, filtered.length - 1));
							} else if (event.key === "ArrowUp") {
								event.preventDefault();
								setActive((current) => Math.max(current - 1, 0));
							} else if (event.key === "Enter") {
								event.preventDefault();
								runAt(active);
							} else if (event.key === "Escape") {
								event.preventDefault();
								onClose();
							}
						}}
					/>
					<kbd className="xz-topbar__kbd" style={{ color: "var(--xz-ink-3)", borderColor: "var(--xz-line-strong)" }}>
						Esc
					</kbd>
				</div>
				<div className="xz-palette__list" ref={listRef}>
					{filtered.length === 0 ? (
						<div className="xz-palette__empty">没有匹配的页面或操作</div>
					) : (
						grouped.map((group) => (
							<div key={group.label}>
								<div className="xz-palette__group">{group.label}</div>
								{group.items.map(({ command, index }) => (
									<button
										key={command.id}
										type="button"
										className="xz-palette__item"
										data-active={index === active}
										onMouseEnter={() => setActive(index)}
										onClick={() => runAt(index)}
									>
										<Icon name={command.icon} size={16} />
										<span>{command.label}</span>
										{command.hint ? <span className="xz-palette__hint">{command.hint}</span> : null}
									</button>
								))}
							</div>
						))
					)}
				</div>
			</div>
		</div>
	);
}

/** 由导航配置生成「跳转」类命令。 */
export function useNavigationCommands(
	groups: {
		label: string;
		items: { to: string; label: string; icon: string; reloadDocument?: boolean }[];
	}[],
	onNavigate: (to: string) => void,
): Command[] {
	const navigate = useNavigate();
	return useMemo(
		() =>
			groups.flatMap((group) =>
				group.items.map((item) => ({
					id: `nav:${item.to}`,
					label: item.label,
					group: group.label,
					icon: item.icon,
					hint: item.to,
					run: () => {
						onNavigate(item.to);
						// 同源静态站点（如 `/training/` 教学课程站）不在本前端路由表内，
						// 走自研路由会落到 not-found，必须整页跳转。
						if (item.reloadDocument) {
							window.location.assign(item.to);
							return;
						}
						navigate(item.to);
					},
				})),
			),
		[groups, navigate, onNavigate],
	);
}
