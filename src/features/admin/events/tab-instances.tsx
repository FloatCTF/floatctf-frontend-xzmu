/**
 * 赛事控制台 · `instances` 标签 —— 赛事统一实例列表。
 *
 * `client.admin.instances.listForEvent(eventId, params)` → `AdminInstanceRow[]`：
 * challenge（解题赛动态题容器）与 gamebox（AWD/AWDP 靶机）归一化到同一张表。
 * **列表不返回 flag**，因此这里只做只读观测。
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { useDebounced } from "../../../lib/hooks.ts";
import { Icon } from "../../../ui/icons.tsx";
import { QueryBoundary } from "../../../ui/overlays.tsx";
import { Badge, Card, CardBody, CardHead, Select } from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import { instanceTypeTone, runtimeStateTone, usePager } from "./shared.tsx";

export function EventInstancesTab({ eventId }: { eventId: string }) {
	const client = useClient();
	const pager = usePager(50);
	const [type, setType] = useState("all");
	const [status, setStatus] = useState("all");
	const [search, setSearch] = useState("");
	const debounced = useDebounced(search);

	const list = useQuery({
		queryKey: qk.admin.eventInstances(eventId, pager.params),
		queryFn: () => callList(client.admin.instances.listForEvent(eventId, pager.params)),
		enabled: eventId.length > 0,
	});

	const rows = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, pager.pageSize);

	const statuses = useMemo(() => [...new Set(rows.map((row) => String(row.status)))].sort(), [rows]);

	const filtered = useMemo(
		() =>
			rows.filter((row) => {
				if (type !== "all" && row.instance_type !== type) return false;
				if (status !== "all" && String(row.status) !== status) return false;
				const needle = debounced.trim().toLowerCase();
				if (!needle) return true;
				return [
					row.identifier,
					row.content_title ?? "",
					row.user_name ?? "",
					row.team_name ?? "",
					row.challenge_id ?? "",
					row.gamebox_id ?? "",
				].some((value) => value.toLowerCase().includes(needle));
			}),
		[rows, type, status, debounced],
	);

	return (
		<div className="xz-aev-col">
			<div className="xz-filters">
				<span className="xz-search">
					<span className="xz-search__icon">
						<Icon name="search" size={14} />
					</span>
					<input
						className="xz-input"
						placeholder="搜索标识 / 内容 / 用户"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</span>
				<Select value={type} onChange={(event) => setType(event.target.value)} aria-label="实例类型">
					<option value="all">全部类型</option>
					<option value="challenge">挑战实例（challenge）</option>
					<option value="gamebox">GameBox 实例（gamebox）</option>
				</Select>
				<Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="实例状态">
					<option value="all">全部状态</option>
					{statuses.map((entry) => (
						<option key={entry} value={entry}>
							{entry}
						</option>
					))}
				</Select>
				<span className="xz-aev-toolbar--end xz-muted xz-xs">
					{list.isSuccess ? `本页 ${filtered.length} / ${rows.length} 台` : ""}
				</span>
			</div>

			<Card>
				<CardHead
					title="赛事实例"
					icon="box"
					sub="challenge 与 gamebox 归一化视图；接口不返回 flag（只读）"
				/>
				<CardBody flush>
					<QueryBoundary
						isPending={list.isPending}
						isError={list.isError}
						error={list.error}
						refetch={() => void list.refetch()}
						loadingLabel="正在加载实例列表…"
					>
						<DataTable
							rows={filtered}
							rowKey={(row) => row.id}
							empty={<div className="xz-aev-emptyline">本赛事当前没有实例。</div>}
							columns={[
								{
									key: "type",
									header: "类型",
									render: (row) => (
										<Badge tone={instanceTypeTone(row.instance_type)}>
											{row.instance_type === "challenge" ? "挑战" : "GameBox"}
										</Badge>
									),
								},
								{
									key: "content",
									header: "内容",
									render: (row) => (
										<div>
											<div>{row.content_title ?? row.challenge_id ?? row.gamebox_id ?? "—"}</div>
											<div className="xz-muted xz-xs xz-mono">{row.identifier}</div>
										</div>
									),
								},
								{
									key: "status",
									header: "状态",
									render: (row) => <Badge tone={runtimeStateTone(row.status)}>{row.status}</Badge>,
								},
								{
									key: "owner",
									header: "归属",
									render: (row) => (
										<div className="xz-xs">
											{row.user_name ? <div>{row.user_name}</div> : null}
											{row.team_name ? (
												<div>
													<Badge tone="gold">战队</Badge> {row.team_name}
												</div>
											) : null}
											{!row.user_name && !row.team_name ? <span className="xz-muted">—</span> : null}
										</div>
									),
								},
								{
									key: "generation",
									header: "运行代",
									numeric: true,
									render: (row) => (row.runtime_generation === null || row.runtime_generation === undefined ? "—" : row.runtime_generation),
								},
								{ key: "created", header: "创建时间", render: (row) => formatDateTime(row.created_at) },
								{
									key: "destroy",
									header: "销毁时间",
									render: (row) => (row.destroy_at ? formatDateTime(row.destroy_at) : <span className="xz-muted">—</span>),
								},
							]}
						/>
					</QueryBoundary>
				</CardBody>
			</Card>

			<Pagination
				page={meta.page}
				pageSize={meta.pageSize}
				total={meta.total}
				onPageChange={pager.setPage}
				onPageSizeChange={pager.setPageSize}
			/>
		</div>
	);
}
