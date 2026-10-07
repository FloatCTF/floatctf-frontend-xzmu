/**
 * 数据表格与分页。
 *
 * 只做「渲染 + 排序 + 行点击」，数据获取、分页状态、筛选都在页面里
 * （与平台的分页 `meta` 语义一致：`page` / `page_size` / `total`）。
 */

import type { ReactNode } from "react";

import { Icon } from "./icons.tsx";

export interface Column<T> {
	key: string;
	header: ReactNode;
	/** 单元格渲染；未提供时回退到 `row[key]`。 */
	render?: (row: T, index: number) => ReactNode;
	/** 数字列右对齐 + 等宽。 */
	numeric?: boolean;
	width?: number | string;
	align?: "left" | "right" | "center";
}

export function DataTable<T>({
	columns,
	rows,
	rowKey,
	onRowClick,
	activeKey,
	empty,
	compact,
	rowClassName,
}: {
	columns: readonly Column<T>[];
	rows: readonly T[];
	rowKey: (row: T, index: number) => string;
	onRowClick?: (row: T) => void;
	activeKey?: string | null;
	empty?: ReactNode;
	compact?: boolean;
	rowClassName?: (row: T) => string | undefined;
}) {
	return (
		<div className="xz-tablewrap">
			<table className={["xz-table", compact ? "xz-table--compact" : null].filter(Boolean).join(" ")}>
				<thead>
					<tr>
						{columns.map((column) => (
							<th
								key={column.key}
								style={{
									width: column.width,
									textAlign: column.align ?? (column.numeric ? "right" : "left"),
								}}
							>
								{column.header}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.length === 0 ? (
						<tr>
							<td colSpan={columns.length}>{empty ?? <div className="xz-state xz-state--sm">暂无数据</div>}</td>
						</tr>
					) : (
						rows.map((row, index) => {
							const key = rowKey(row, index);
							return (
								<tr
									key={key}
									className={[
										onRowClick ? "xz-table__row--clickable" : null,
										activeKey && activeKey === key ? "xz-table__row--active" : null,
										rowClassName?.(row),
									]
										.filter(Boolean)
										.join(" ")}
									onClick={onRowClick ? () => onRowClick(row) : undefined}
								>
									{columns.map((column) => (
										<td
											key={column.key}
											className={
												column.numeric
													? "xz-table__cell--num"
													: column.align === "right"
														? "xz-table__cell--actions"
														: undefined
											}
										>
											{column.render
												? column.render(row, index)
												: ((row as Record<string, unknown>)[column.key] as ReactNode)}
										</td>
									))}
								</tr>
							);
						})
					)}
				</tbody>
			</table>
		</div>
	);
}

/** 从 1 开始的页码窗口（最多 7 个按钮 + 首尾）。 */
function pageWindow(current: number, totalPages: number): (number | "…")[] {
	if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
	const pages = new Set<number>([1, totalPages, current, current - 1, current + 1]);
	const sorted = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
	const result: (number | "…")[] = [];
	let previous = 0;
	for (const page of sorted) {
		if (previous && page - previous > 1) result.push("…");
		result.push(page);
		previous = page;
	}
	return result;
}

export function Pagination({
	page,
	pageSize,
	total,
	onPageChange,
	onPageSizeChange,
}: {
	page: number;
	pageSize: number;
	total: number;
	onPageChange: (page: number) => void;
	onPageSizeChange?: (size: number) => void;
}) {
	const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));

	return (
		<div className="xz-pager">
			<span>
				共 <strong>{total}</strong> 条 · 第 {page} / {totalPages} 页
			</span>
			{onPageSizeChange ? (
				<select
					className="xz-select"
					style={{ width: "auto", height: 30 }}
					value={pageSize}
					aria-label="每页条数"
					onChange={(event) => onPageSizeChange(Number(event.target.value))}
				>
					{[10, 20, 50, 100].map((size) => (
						<option key={size} value={size}>
							{size} / 页
						</option>
					))}
				</select>
			) : null}
			<div className="xz-pager__pages">
				<button
					type="button"
					className="xz-pager__btn"
					disabled={page <= 1}
					aria-label="上一页"
					onClick={() => onPageChange(page - 1)}
				>
					<Icon name="chevronLeft" size={13} />
				</button>
				{pageWindow(page, totalPages).map((entry, index) =>
					entry === "…" ? (
						<span key={`gap-${index}`} className="xz-muted" style={{ padding: "0 4px" }}>
							…
						</span>
					) : (
						<button
							key={entry}
							type="button"
							className="xz-pager__btn"
							aria-current={entry === page}
							onClick={() => onPageChange(entry)}
						>
							{entry}
						</button>
					),
				)}
				<button
					type="button"
					className="xz-pager__btn"
					disabled={page >= totalPages}
					aria-label="下一页"
					onClick={() => onPageChange(page + 1)}
				>
					<Icon name="chevronRight" size={13} />
				</button>
			</div>
		</div>
	);
}

/**
 * 平台统一响应的分页 meta。
 * 形状以 SDK 的 `UniResponse` 为准；字段可能缺失（部分接口不分页），因此全部可选。
 */
export interface PagedMeta {
	page?: number;
	page_size?: number;
	pageSize?: number;
	total?: number;
	total_pages?: number;
	totalPages?: number;
}

export function readMeta(meta: PagedMeta | undefined, fallbackSize: number): {
	page: number;
	pageSize: number;
	total: number;
} {
	return {
		page: meta?.page ?? 1,
		pageSize: meta?.page_size ?? meta?.pageSize ?? fallbackSize,
		total: meta?.total ?? 0,
	};
}
