/**
 * 操作日志查询（`/admin/logs`）—— 平台审计日志。
 *
 * 后端语义（SDK-API-REFERENCE §2.2.18 + 后端 `operations/logs.rs` 的 FilterMapping）：
 * - `client.admin.logs.fetch(params)`，返回 `Logs[]`（`level` / `category` / `action` /
 *   `message` / `details` / `ip_address` / `user_id` / `superadmin_id`）；
 * - 服务端 `filter` 支持的键（逐一核对后端源码）：`id`、`user_id`、`superadmin_id`、
 *   `ip_address`、`category`、`action`、`level`；语法是空白分隔的 `key:value`，
 *   `&` 表示 AND、`|` 表示 OR（`build_filter_condition`）；
 * - 本页是**只读**的：日志没有删除接口，不做任何写操作。
 */

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Logs } from "@floatctf/sdk/entity";

import { callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime, formatRelative } from "../../../lib/format.ts";
import { useDebounced } from "../../../lib/hooks.ts";
import { useDocumentTitle } from "../../../router/router.tsx";
import { Drawer, QueryBoundary } from "../../../ui/overlays.tsx";
import {
	Badge,
	Button,
	Card,
	CardBody,
	CardHead,
	IconButton,
	KeyValue,
	Select,
	TextInput,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta, type Column } from "../../../ui/Table.tsx";
import {
	AdminPageHead,
	IdCell,
	JsonBlock,
	ListToolbar,
	pageParams,
	RowActions,
	TextCell,
	useFilteredPage,
	useTableState,
} from "./shared.tsx";

const FILTER_KEYS = ["id", "user_id", "superadmin_id", "ip_address", "category", "action", "level"];

type Tone = "neutral" | "info" | "warn" | "danger" | "ok";

function levelTone(level: string): Tone {
	const normalized = level.toUpperCase();
	if (normalized.includes("FATAL") || normalized.includes("CRIT") || normalized.includes("ERROR")) {
		return "danger";
	}
	if (normalized.includes("WARN")) return "warn";
	if (normalized.includes("INFO")) return "info";
	if (normalized.includes("DEBUG") || normalized.includes("TRACE")) return "neutral";
	return "ok";
}

const searchFields = (row: Logs) => [
	row.message,
	row.category,
	row.action,
	row.level,
	row.ip_address,
	row.user_id,
	row.superadmin_id,
	row.details,
	row.id,
];

export function AdminLogsPage() {
	useDocumentTitle("操作日志");
	const client = useClient();
	const state = useTableState(20);

	// 服务端筛选表达式（跨页生效），与页内搜索框相互独立。
	const [filterExpr, setFilterExpr] = useState("");
	const [levelFilter, setLevelFilter] = useState("all");
	const debouncedExpr = useDebounced(filterExpr, 450);

	const serverFilter = debouncedExpr.trim();

	const params = useMemo(
		() => pageParams(state.page, state.pageSize, serverFilter || undefined),
		[state.page, state.pageSize, serverFilter],
	);

	const query = useQuery({
		queryKey: qk.admin.logs(params),
		queryFn: () => callList(client.admin.logs.fetch(params)),
		placeholderData: keepPreviousData,
	});

	const meta = readMeta(query.data?.meta, state.pageSize);
	const loaded = query.data?.items ?? [];

	// 级别下拉的选项来自已加载的数据（不硬编码后端的 level 取值）。
	const levels = useMemo(() => {
		const set = new Set<string>();
		for (const row of loaded) if (row.level) set.add(row.level);
		return [...set].sort();
	}, [loaded]);

	const withLevel = useMemo(
		() => (levelFilter === "all" ? loaded : loaded.filter((row) => row.level === levelFilter)),
		[loaded, levelFilter],
	);

	const page = useFilteredPage(withLevel, state.search, searchFields);

	const [selected, setSelected] = useState<Logs | null>(null);

	const columns: readonly Column<Logs>[] = [
		{
			key: "created_at",
			header: "时间",
			render: (row) => (
				<div>
					<div>{formatDateTime(row.created_at)}</div>
					<div className="xz-adm-hint">{formatRelative(row.created_at)}</div>
				</div>
			),
		},
		{
			key: "level",
			header: "级别",
			render: (row) => <Badge tone={levelTone(row.level)}>{row.level || "—"}</Badge>,
		},
		{ key: "category", header: "类别", render: (row) => <code className="xz-mono xz-xs">{row.category}</code> },
		{ key: "action", header: "动作", render: (row) => <code className="xz-mono xz-xs">{row.action}</code> },
		{
			key: "message",
			header: "消息",
			render: (row) => <TextCell value={row.message} max={92} />,
		},
		{
			key: "actor",
			header: "操作者",
			render: (row) =>
				row.superadmin_id ? (
					<span title={`superadmin_id: ${row.superadmin_id}`}>
						<Badge tone="crimson">管理员</Badge>{" "}
						<code className="xz-mono xz-xs">{row.superadmin_id.slice(0, 8)}…</code>
					</span>
				) : row.user_id ? (
					<span title={`user_id: ${row.user_id}`}>
						<Badge tone="neutral">选手</Badge>{" "}
						<code className="xz-mono xz-xs">{row.user_id.slice(0, 8)}…</code>
					</span>
				) : (
					<span className="xz-muted">系统</span>
				),
		},
		{
			key: "ip_address",
			header: "IP",
			render: (row) => <code className="xz-mono xz-xs">{row.ip_address || "—"}</code>,
		},
		{
			key: "actions",
			header: "操作",
			align: "right",
			width: 60,
			render: (row) => (
				<RowActions>
					<IconButton icon="eye" label="查看日志详情" onClick={() => setSelected(row)} />
				</RowActions>
			),
		},
	];

	return (
		<div className="xz-page xz-page--wide">
			<AdminPageHead
				title="操作日志"
				desc="平台审计日志（管理操作 / 系统事件）。服务端筛选表达式跨页生效，搜索框只在已加载的当前页内过滤。"
				actions={
					<Button
						size="sm"
						icon="refresh"
						loading={query.isFetching}
						onClick={() => void query.refetch()}
					>
						刷新
					</Button>
				}
			/>

			<Card
				className="xz-adm-section"
				flat
			>
				<CardBody>
					<div className="xz-adm-toolbar xz-adm-filter-expr">
						<div className="xz-filters xz-adm-toolbar__main">
							<TextInput
								value={filterExpr}
								placeholder="服务端筛选：level:ERROR & category:SETTINGS"
								aria-label="服务端筛选表达式"
								onChange={(event) => {
									setFilterExpr(event.target.value);
									state.setPage(1);
								}}
							/>
							<span className="xz-adm-hint">
								支持的键：{FILTER_KEYS.join(" / ")}；<code className="xz-mono">&amp;</code> 为
								AND、<code className="xz-mono">|</code> 为 OR，值含空格时会被合并
							</span>
						</div>
						<div className="xz-row">
							<Select
								value={levelFilter}
								aria-label="按级别筛选（本页）"
								onChange={(event) => {
									setLevelFilter(event.target.value);
									state.setPage(1);
								}}
							>
								<option value="all">全部级别（本页）</option>
								{levels.map((level) => (
									<option key={level} value={level}>
										{level}
									</option>
								))}
							</Select>
							{serverFilter ? (
								<Button
									size="sm"
									variant="quiet"
									icon="close"
									onClick={() => {
										setFilterExpr("");
										state.setPage(1);
									}}
								>
									清除筛选
								</Button>
							) : null}
						</div>
					</div>
				</CardBody>
			</Card>

			<Card>
				<CardHead icon="clipboard" title="日志列表" sub={`共 ${meta.total} 条`} />
				<CardBody flush>
					<div style={{ padding: "var(--xz-sp-4) var(--xz-sp-5) 0" }}>
						<ListToolbar
							search={state.search}
							onSearch={state.setSearch}
							placeholder="在本页内搜索消息 / 类别 / 动作 / IP"
							hint={
								state.search || levelFilter !== "all"
									? `本页匹配 ${page.matched} / ${page.loaded} 条`
									: "搜索在已加载的当前页内过滤；跨页筛选请用上方表达式"
							}
						/>
					</div>
					<QueryBoundary
						isPending={query.isPending}
						isError={query.isError}
						error={query.error}
						refetch={query.refetch}
						loadingLabel="正在加载日志…"
					>
						<DataTable
							columns={columns}
							rows={page.rows}
							rowKey={(row) => row.id}
							activeKey={selected?.id ?? null}
							onRowClick={(row) => setSelected(row)}
							empty={
								state.search || levelFilter !== "all"
									? "当前页没有匹配的日志。"
									: serverFilter
										? "该筛选表达式没有命中任何日志。"
										: "还没有日志记录。"
							}
						/>
						<div style={{ padding: "0 var(--xz-sp-5) var(--xz-sp-4)" }}>
							<Pagination
								page={meta.page}
								pageSize={meta.pageSize}
								total={meta.total}
								onPageChange={state.setPage}
								onPageSizeChange={state.setPageSize}
							/>
						</div>
					</QueryBoundary>
				</CardBody>
			</Card>

			<Drawer
				open={selected !== null}
				onClose={() => setSelected(null)}
				title="日志详情"
				subtitle={selected ? formatDateTime(selected.created_at) : undefined}
			>
				{selected ? (
					<div className="xz-col">
						<KeyValue
							items={[
								{ k: "级别", v: <Badge tone={levelTone(selected.level)}>{selected.level || "—"}</Badge> },
								{ k: "类别", v: <code className="xz-mono">{selected.category}</code> },
								{ k: "动作", v: <code className="xz-mono">{selected.action}</code> },
								{ k: "记录时间", v: formatDateTime(selected.created_at) },
								{ k: "来源 IP", v: <code className="xz-mono">{selected.ip_address || "—"}</code> },
								{
									k: "管理员",
									v: selected.superadmin_id ? <IdCell id={selected.superadmin_id} /> : "—",
								},
								{ k: "选手", v: selected.user_id ? <IdCell id={selected.user_id} /> : "—" },
								{ k: "日志 ID", v: <IdCell id={selected.id} /> },
							]}
						/>
						<div>
							<div className="xz-adm-attention__title">消息</div>
							<p className="xz-adm-note xz-break">{selected.message || "—"}</p>
						</div>
						<div>
							<div className="xz-adm-attention__title">details</div>
							<JsonBlock value={selected.details} />
						</div>
					</div>
				) : null}
			</Drawer>
		</div>
	);
}
