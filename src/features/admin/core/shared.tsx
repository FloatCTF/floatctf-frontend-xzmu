/**
 * 管理控制台 · 核心域 —— 共享小组件与表格状态。
 *
 * 设计约束（来自本前端作业手册 §3）：
 * - 数据只能来自后端接口，禁止占位数据；
 * - 每个 mutation 成功要 toast、失败要 `toast.error(..., errorText(e))`；
 * - 破坏性操作一律 `useConfirm()` 并写明后果；
 * - 密集表格 = 搜索框（本地过滤）+ 分页 + 行内操作。
 *
 * 关于「本地过滤」：平台各列表接口的 `filter` 语法按资源不同（只支持各自声明的键），
 * 因此默认搜索框只在**已加载的结果**内过滤，界面会显式标注；
 * 需要跨页筛选的页面（操作日志）另提供直填 `filter` 表达式的高级入口。
 */

import { type ReactNode, useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { QueryParams } from "@floatctf/sdk";

import { matches } from "../../../lib/format.ts";
import { Icon } from "../../../ui/icons.tsx";
import { Modal } from "../../../ui/overlays.tsx";
import { Button, CopyButton, TextInput } from "../../../ui/primitives.tsx";

/**
 * 失效前缀 —— 与 `src/api/keys.ts` 里 `qk.admin.*` 的层级一一对应。
 *
 * `qk.admin.users({page:1})` → `["admin","users",{page:1}]`，前缀 `["admin","users"]`
 * 能命中全部参数组合（含详情键），因此在页面里直接失效前缀即可。
 */
export const inv = {
	dashboard: ["admin", "dashboard"] as const,
	systemMonitor: ["admin", "system", "monitor"] as const,
	version: ["admin", "system", "version"] as const,
	users: ["admin", "users"] as const,
	superAdmins: ["admin", "super-admins"] as const,
	settings: ["admin", "settings"] as const,
	logs: ["admin", "logs"] as const,
	scheduledTasks: ["admin", "scheduled-tasks"] as const,
	announcements: ["admin", "announcements"] as const,
	discussions: ["admin", "discussions"] as const,
	weapons: ["admin", "weapons"] as const,
} as const;

/** 失效一个或多个查询前缀（`qk` 未覆盖注册表查询键，见 `frontends.tsx`）。 */
export function useInvalidate(): (keys: readonly (readonly unknown[])[]) => void {
	const queryClient = useQueryClient();
	return useCallback(
		(keys: readonly (readonly unknown[])[]) => {
			for (const key of keys) void queryClient.invalidateQueries({ queryKey: key });
		},
		[queryClient],
	);
}

/* ── 页面头 ───────────────────────────────────────────────────────── */

export function AdminPageHead({
	title,
	desc,
	actions,
}: {
	title: ReactNode;
	desc?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="xz-page__head">
			<div>
				<h1 className="xz-page__title">{title}</h1>
				{desc ? <p className="xz-page__desc">{desc}</p> : null}
			</div>
			{actions ? <div className="xz-page__actions">{actions}</div> : null}
		</header>
	);
}

/* ── 表格状态与工具条 ─────────────────────────────────────────────── */

export interface TableState {
	page: number;
	pageSize: number;
	search: string;
	setPage: (page: number) => void;
	setPageSize: (size: number) => void;
	setSearch: (search: string) => void;
}

/**
 * 表格状态：页码 / 每页条数 / 本地搜索词。
 * 搜索词变化时回到第 1 页（避免停留在越界页码上显示空表）。
 */
export function useTableState(initialSize = 20): TableState {
	const [page, setPage] = useState(1);
	const [pageSize, setPageSizeRaw] = useState(initialSize);
	const [search, setSearchRaw] = useState("");

	const setSearch = useCallback((value: string) => {
		setSearchRaw(value);
		setPage(1);
	}, []);
	const setPageSize = useCallback((value: number) => {
		setPageSizeRaw(value);
		setPage(1);
	}, []);

	return { page, pageSize, search, setPage, setPageSize, setSearch };
}

/** 服务端分页参数（`QueryParams` 只有 offset/limit/page/total/filter 五个键）。 */
export function pageParams(page: number, pageSize: number, filter?: string): QueryParams {
	return filter ? { page, limit: pageSize, filter } : { page, limit: pageSize };
}

/** 本地过滤（对已加载的行做大小写无关匹配；空搜索词原样返回）。 */
export function filterRows<T>(
	rows: readonly T[],
	search: string,
	fields: (row: T) => readonly (string | null | undefined)[],
): T[] {
	const needle = search.trim();
	if (!needle) return [...rows];
	return rows.filter((row) => matches(fields(row), needle));
}

/** 客户端分页切片（用于后端不提供分页的列表，例如动态设置）。 */
export function slicePage<T>(rows: readonly T[], page: number, pageSize: number): T[] {
	const safePage = Math.max(1, page);
	return rows.slice((safePage - 1) * pageSize, safePage * pageSize);
}

export function ListToolbar({
	search,
	onSearch,
	placeholder = "搜索…",
	hint,
	children,
	actions,
}: {
	search: string;
	onSearch: (value: string) => void;
	placeholder?: string;
	hint?: ReactNode;
	/** 附加筛选控件（下拉 / 复选框等）。 */
	children?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<div className="xz-adm-toolbar">
			<div className="xz-filters xz-adm-toolbar__main">
				<span className="xz-search">
					<span className="xz-search__icon">
						<Icon name="search" size={14} />
					</span>
					<TextInput
						value={search}
						placeholder={placeholder}
						aria-label={placeholder}
						onChange={(event) => onSearch(event.target.value)}
					/>
				</span>
				{children}
				{hint ? <span className="xz-adm-hint">{hint}</span> : null}
			</div>
			{actions ? <div className="xz-row">{actions}</div> : null}
		</div>
	);
}

export function RowActions({ children }: { children: ReactNode }) {
	return <div className="xz-adm-actions">{children}</div>;
}

/**
 * 表单对话框 —— 统一走本前端的 `Modal`（焦点陷阱 / Esc / 遮罩关闭）。
 * 调用方用 `key` 强制重挂载来重置表单初值。
 */
export function FormModal({
	open,
	title,
	description,
	onClose,
	children,
	size = "wide",
}: {
	open: boolean;
	title: ReactNode;
	description?: ReactNode;
	onClose: () => void;
	children: ReactNode;
	size?: "md" | "wide" | "xl";
}) {
	return (
		<Modal open={open} onClose={onClose} title={title} description={description} size={size}>
			{children}
		</Modal>
	);
}

/** 查询刷新按钮（列表 / 详情通用）。 */
export function RefreshButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
	return (
		<Button size="sm" icon="refresh" loading={loading} onClick={onClick}>
			刷新
		</Button>
	);
}

/* ── 单元格 ───────────────────────────────────────────────────────── */

/** 长 ID：短前缀 + 复制。管理端表格 ID 列密集，全量展示会挤爆列宽。 */
export function IdCell({ id }: { id: string }) {
	return (
		<span className="xz-adm-id">
			<code className="xz-mono xz-xs" title={id}>
				{id.slice(0, 8)}…
			</code>
			<CopyButton value={id} label="" />
		</span>
	);
}

/** 可能为空的长文本单元格。 */
export function TextCell({ value, max = 64 }: { value: string | null | undefined; max?: number }) {
	const text = value ?? "";
	if (!text) return <span className="xz-muted">—</span>;
	return (
		<span className="xz-adm-clamp" title={text.length > max ? text : undefined}>
			{text.length > max ? `${text.slice(0, max)}…` : text}
		</span>
	);
}

/** 详情抽屉里的 JSON 文本（预检报告 / 日志 details 等）。 */
export function JsonBlock({ value }: { value: string | null | undefined }) {
	const text = value ?? "";
	if (!text.trim()) return <span className="xz-muted">—</span>;
	let pretty = text;
	try {
		pretty = JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		pretty = text;
	}
	return <pre className="xz-codeblock">{pretty}</pre>;
}

/* ── 时间格式 ─────────────────────────────────────────────────────── */

/** 系统 uptime（秒）→ `12天 03:04:05`；负值 / 非法值显示 `—`。 */
export function formatUptime(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) return "—";
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = Math.floor(seconds % 60);
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${days > 0 ? `${days}天 ` : ""}${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

/** 温度：后端未提供时是 0，显示为 `—` 而不是伪造 0℃。 */
export function formatTemp(celsius: number | null | undefined): string {
	if (celsius === null || celsius === undefined || Number.isNaN(celsius) || celsius <= 0) return "—";
	return `${celsius.toFixed(1)} ℃`;
}

/** `datetime-local` 输入值 → RFC3339（后端 `DateTime<FixedOffset>` 需要带时区）。 */
export function localDateTimeToIso(value: string): string {
	if (!value) return "";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** RFC3339 → `datetime-local` 输入值（本地时区，供编辑表单回填）。 */
export function isoToLocalDateTime(value: string | null | undefined): string {
	if (!value) return "";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* ── 列表分页辅助 ─────────────────────────────────────────────────── */

/**
 * 服务端分页列表的「本页搜索」结果。
 * 返回过滤后的当前页行与匹配数，供界面标注 `N / M`。
 */
export function useFilteredPage<T>(
	rows: readonly T[],
	search: string,
	fields: (row: T) => readonly (string | null | undefined)[],
): { rows: T[]; matched: number; loaded: number } {
	return useMemo(() => {
		const filtered = filterRows(rows, search, fields);
		return { rows: filtered, matched: filtered.length, loaded: rows.length };
	}, [rows, search, fields]);
}
