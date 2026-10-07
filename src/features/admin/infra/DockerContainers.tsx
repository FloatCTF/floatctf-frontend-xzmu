/**
 * Docker 容器视图（`/admin/docker` → 容器）。
 *
 * 语义要点：
 * - 列表走 `client.admin.docker.fetchContainers(params)`；后端按 **`offset` + `limit`** 切片，
 *   `meta.total` 是宿主上的真实容器总数（见 `useOffsetPaging` 的注释）。
 * - `created` 是 bollard 的 **Unix 秒**，展示前转毫秒（`formatUnixSeconds`）。
 * - `ports` 在 SDK 里是**字符串**（不是数组），后端已经拼成 `ip:public` / `private` 列表。
 * - 启动 / 停止 / 删除都是对宿主 Docker 的真实操作：一律先 `useConfirm()` 并写明后果；
 *   删除还要求逐字输入容器名（或 ID 前缀）。
 */

import type { FloatDockerContainer } from "@floatctf/sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { matches } from "../../../lib/format.ts";
import { useDebounced } from "../../../lib/hooks.ts";
import { QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import { Badge, Button, Card, CardBody, CardHead, IconButton } from "../../../ui/primitives.tsx";
import { type Column, DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import {
	cleanContainerName,
	confirmTarget,
	formatUnixSeconds,
	shortId,
	useOffsetPaging,
} from "./common.tsx";

/** 后端把容器状态格式化成 bollard 枚举的 Debug 名（`Running` / `Exited` / …）。 */
function statusTone(status: string): "neutral" | "ok" | "warn" | "danger" | "info" {
	switch (status.toLowerCase()) {
		case "running":
			return "ok";
		case "restarting":
		case "paused":
			return "warn";
		case "dead":
			return "danger";
		case "exited":
		case "created":
			return "neutral";
		default:
			return "info";
	}
}

export function DockerContainersView() {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const paging = useOffsetPaging();
	const [search, setSearch] = useState("");
	const debounced = useDebounced(search);

	const list = useQuery({
		queryKey: qk.admin.containers(paging.params),
		queryFn: () => callList(client.admin.docker.fetchContainers(paging.params)),
	});

	const items = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, paging.limit);

	// 后端的 Docker 列表接口不接受 `filter`（`QueryParams.filter` 在 handler 里被忽略），
	// 因此搜索只能对**当前页**已取回的数据做客户端筛选，界面上如实标注。
	const rows = useMemo(() => {
		if (!debounced.trim()) return items;
		return items.filter((item) => matches([item.name, item.image, item.status, item.ports], debounced));
	}, [items, debounced]);

	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: qk.admin.containers(paging.params) });
	};

	const start = useMutation({
		mutationFn: (row: FloatDockerContainer) =>
			call(client.admin.docker.startContainer(row.id), "启动结果"),
		onSuccess: (_data, row) => {
			toast.success("容器已启动", cleanContainerName(row.name) || shortId(row.id));
			refresh();
		},
		onError: (error) => toast.error("启动容器失败", errorText(error)),
	});

	const stop = useMutation({
		mutationFn: (row: FloatDockerContainer) =>
			call(client.admin.docker.stopContainer(row.id), "停止结果"),
		onSuccess: (_data, row) => {
			toast.success("容器已停止", cleanContainerName(row.name) || shortId(row.id));
			refresh();
		},
		onError: (error) => toast.error("停止容器失败", errorText(error)),
	});

	const remove = useMutation({
		mutationFn: (row: FloatDockerContainer) =>
			call(client.admin.docker.deleteContainer(row.id), "删除结果"),
		onSuccess: (_data, row) => {
			toast.success("容器已删除", cleanContainerName(row.name) || shortId(row.id));
			refresh();
		},
		onError: (error) => toast.error("删除容器失败", errorText(error)),
	});

	const isBusy = (row: FloatDockerContainer) =>
		(start.isPending && start.variables?.id === row.id) ||
		(stop.isPending && stop.variables?.id === row.id) ||
		(remove.isPending && remove.variables?.id === row.id);

	const onStart = async (row: FloatDockerContainer) => {
		const label = cleanContainerName(row.name) || shortId(row.id);
		const ok = await confirm({
			title: `启动容器「${label}」`,
			description: "该操作直接在宿主 Docker 上执行。",
			consequences:
				"会启动该容器。若它属于某个靶场实例，容器的端口与网络会被重新占用（通常用于恢复被中断的靶场环境）。",
			confirmText: "启动",
		});
		if (ok) start.mutate(row);
	};

	const onStop = async (row: FloatDockerContainer) => {
		const label = cleanContainerName(row.name) || shortId(row.id);
		const ok = await confirm({
			title: `停止容器「${label}」`,
			description: "该操作直接在宿主 Docker 上执行。",
			consequences:
				"会停止对应容器，正在运行的靶场环境会中断；依赖它的选手提交、判题与 AWDP 评测都会失败，直到容器被重新启动。",
			confirmText: "停止",
			tone: "danger",
		});
		if (ok) stop.mutate(row);
	};

	const onDelete = async (row: FloatDockerContainer) => {
		const label = cleanContainerName(row.name) || shortId(row.id);
		const ok = await confirm({
			title: `删除容器「${label}」`,
			description: "删除不可恢复，容器内未持久化的数据会一并丢失。",
			consequences:
				"会删除对应容器，正在运行的靶场环境会中断；若它是某个赛事实例的运行载体，选手与判题将立即无法访问，重建只能依靠赛事侧重新部署。",
			confirmText: "删除容器",
			confirmPhrase: confirmTarget(label, row.id),
			tone: "danger",
		});
		if (ok) remove.mutate(row);
	};

	const columns: readonly Column<FloatDockerContainer>[] = [
		{
			key: "name",
			header: "容器",
			render: (row) => {
				const label = cleanContainerName(row.name);
				return (
					<div>
						<div className="xz-inf-name">{label || "（无名容器）"}</div>
						<div className="xz-inf-id" title={row.id}>
							{shortId(row.id)}
						</div>
					</div>
				);
			},
		},
		{
			key: "status",
			header: "状态",
			width: 120,
			render: (row) => <Badge tone={statusTone(row.status)}>{row.status || "unknown"}</Badge>,
		},
		{
			key: "image",
			header: "镜像",
			render: (row) => <span className="xz-inf-id">{row.image || "—"}</span>,
		},
		{
			key: "ports",
			header: "端口映射",
			render: (row) => <span className="xz-inf-ports">{row.ports || "—"}</span>,
		},
		{
			key: "created",
			header: "创建时间",
			width: 160,
			render: (row) => <span className="xz-xs xz-muted">{formatUnixSeconds(row.created)}</span>,
		},
		{
			key: "actions",
			header: "操作",
			align: "right",
			width: 190,
			render: (row) => {
				const busy = isBusy(row);
				// bollard 的容器状态来自后端 `format!("{:?}", state)`。
				// 这三种状态都能被 `docker stop` 正常停止；其余（created / exited / dead…）用启动。
				const canStop = ["running", "paused", "restarting"].includes(row.status.toLowerCase());
				return (
					<div className="xz-row" style={{ justifyContent: "flex-end" }}>
						{canStop ? (
							<Button size="sm" icon="stop" disabled={busy} onClick={() => void onStop(row)}>
								停止
							</Button>
						) : (
							<Button size="sm" icon="play" disabled={busy} onClick={() => void onStart(row)}>
								启动
							</Button>
						)}
						<Button
							size="sm"
							variant="danger-ghost"
							icon="trash"
							disabled={busy}
							onClick={() => void onDelete(row)}
						>
							删除
						</Button>
					</div>
				);
			},
		},
	];

	return (
		<Card>
			<CardHead
				title="容器"
				icon="server"
				sub={list.isSuccess ? `共 ${meta.total} 个（含未运行）` : undefined}
				actions={
					<IconButton
						icon="refresh"
						label="刷新容器列表"
						onClick={() => void list.refetch()}
						disabled={list.isFetching}
					/>
				}
			/>
			<CardBody flush>
				<div className="xz-inf-filters">
					<input
						className="xz-input"
						data-page-search
						placeholder="在当前页内筛选名称 / 镜像 / 状态 / 端口"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
					<span className="xz-inf-filters__note">
						列表接口不支持服务端筛选，这里只过滤当前页已取回的数据
					</span>
				</div>

				<QueryBoundary
					isPending={list.isPending}
					isError={list.isError}
					error={list.error}
					refetch={() => void list.refetch()}
					loadingLabel="正在读取宿主容器列表…"
				>
					<DataTable
						columns={columns}
						rows={rows}
						rowKey={(row) => row.id}
						compact
						empty={
							<div className="xz-state xz-state--sm">
								{items.length === 0 ? "宿主上没有任何容器。" : "没有符合当前筛选的容器。"}
							</div>
						}
					/>
					{meta.total > 0 ? (
						<Pagination
							page={paging.page}
							pageSize={paging.limit}
							total={meta.total}
							onPageChange={paging.setPage}
							onPageSizeChange={paging.setLimit}
						/>
					) : null}
				</QueryBoundary>
			</CardBody>
		</Card>
	);
}
