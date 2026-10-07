/**
 * 基础设施功能域的内部共用件（Docker / SQL / Web 终端三个页面共享）。
 *
 * 这里只放**纯展示 / 纯状态**的小工具，不放任何数据获取逻辑：
 * 每个视图自己负责 `useQuery` 的三态与 mutation 的错误可见性。
 */

import type { QueryParams } from "@floatctf/sdk";
import { useMemo, useState } from "react";

import { formatDateTime } from "../../../lib/format.ts";

export interface OffsetPaging {
	page: number;
	limit: number;
	setPage: (page: number) => void;
	setLimit: (limit: number) => void;
	/** 传给 SDK 的 `QueryParams`（每次 state 变化后引用稳定）。 */
	params: QueryParams;
}

/**
 * Docker 列表的分页状态。
 *
 * 语义依据（后端 `apps/api/src/modules/platform/operations/docker.rs`）：
 * 三个列表接口按 **`offset` + `limit`** 切片，并把 `total` 写回 `meta`；
 * `page` 只是被原样回显。因此这里三个字段都传：`offset` 决定真实切片，
 * `page` 让 `meta` 回显与 UI 一致（`readMeta` 才能读到正确页码）。
 */
export function useOffsetPaging(initialLimit = 20): OffsetPaging {
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState(initialLimit);

	const params = useMemo<QueryParams>(
		() => ({ page, limit, offset: (page - 1) * limit }),
		[page, limit],
	);

	return {
		page,
		limit,
		setPage,
		setLimit: (next: number) => {
			setLimit(next);
			setPage(1);
		},
		params,
	};
}

/**
 * Docker 的时间字段是 bollard 原样透传的 **Unix 秒**（不是毫秒）。
 * `<= 0` 视为后端没给值，显示 `—` 而不是伪造一个时间。
 */
export function formatUnixSeconds(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "—";
	return formatDateTime(value * 1000);
}

/** 长 ID 的展示形式（完整 ID 仍可通过 title/CopyButton 取到）。 */
export function shortId(id: string, length = 12): string {
	if (!id) return "—";
	return id.length <= length ? id : `${id.slice(0, length)}…`;
}

/** 容器名去掉 Docker 可能带的前导 `/`。 */
export function cleanContainerName(name: string): string {
	return name.replace(/^\/+/, "").trim();
}

/**
 * 破坏性确认时要用户逐字输入的「对象标识」：
 * 优先用名称（人可读、可核对），名称为空时退到 ID 前缀。
 */
export function confirmTarget(name: string, id: string): string {
	const trimmed = name.trim();
	if (trimmed) return trimmed;
	return id.slice(0, 12);
}
