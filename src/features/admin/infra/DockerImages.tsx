/**
 * Docker 镜像视图（`/admin/docker` → 镜像）。
 *
 * 语义要点：
 * - `client.admin.docker.fetchImages(params)`；后端同样按 `offset` + `limit` 切片。
 * - `repo_tags` 是数组：空数组或 `<none>:<none>` 表示 dangling 镜像（没有可读名字）。
 * - `size` 是**字节**，用 `formatBytes` 展示；`created` 是 Unix 秒。
 * - 删除镜像不可恢复，且会让依赖它的题目 / GameBox 无法再构建容器，因此：
 *   `useConfirm()` + 逐字输入镜像标签（无标签时用 ID 前缀）。
 */

import type { ImageInfo } from "@floatctf/sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatBytes, matches } from "../../../lib/format.ts";
import { useDebounced } from "../../../lib/hooks.ts";
import { QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import { Button, Card, CardBody, CardHead, IconButton } from "../../../ui/primitives.tsx";
import { type Column, DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import { confirmTarget, formatUnixSeconds, shortId, useOffsetPaging } from "./common.tsx";

const DANGLING = "<none>:<none>";

/** 可读的镜像标识：优先第一个真实 tag，其次 ID 前缀。 */
function imageLabel(image: ImageInfo): string {
	const tag = image.repo_tags.find((entry) => entry && entry !== DANGLING);
	return tag ?? `（无标签）${shortId(image.id)}`;
}

export function DockerImagesView() {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const paging = useOffsetPaging();
	const [search, setSearch] = useState("");
	const debounced = useDebounced(search);

	const list = useQuery({
		queryKey: qk.admin.images(paging.params),
		queryFn: () => callList(client.admin.docker.fetchImages(paging.params)),
	});

	const items = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, paging.limit);

	const rows = useMemo(() => {
		if (!debounced.trim()) return items;
		return items.filter((item) => matches([item.id, ...item.repo_tags], debounced));
	}, [items, debounced]);

	const remove = useMutation({
		mutationFn: (image: ImageInfo) => call(client.admin.docker.deleteImage(image.id), "删除结果"),
		onSuccess: (_data, image) => {
			toast.success("镜像已删除", imageLabel(image));
			void queryClient.invalidateQueries({ queryKey: qk.admin.images(paging.params) });
		},
		onError: (error) => toast.error("删除镜像失败", errorText(error)),
	});

	const onDelete = async (image: ImageInfo) => {
		const label = imageLabel(image);
		const ok = await confirm({
			title: `删除镜像「${label}」`,
			description: "删除镜像不可恢复，Docker 只会在没有任何容器引用它时允许删除。",
			consequences:
				"会删除该镜像。依赖它的题目 / GameBox 将无法再创建或重建容器（正在运行的容器不受影响，但一旦停止就无法再启动）。",
			confirmText: "删除镜像",
			confirmPhrase: confirmTarget(label, image.id),
			tone: "danger",
		});
		if (ok) remove.mutate(image);
	};

	const columns: readonly Column<ImageInfo>[] = [
		{
			key: "repo_tags",
			header: "镜像标签",
			render: (image) => {
				const tags = image.repo_tags.filter((entry) => entry && entry !== DANGLING);
				if (tags.length === 0) {
					return <span className="xz-muted">无标签（dangling）</span>;
				}
				return (
					<div>
						{tags.map((tag) => (
							<div key={tag} className="xz-inf-name">
								{tag}
							</div>
						))}
					</div>
				);
			},
		},
		{
			key: "id",
			header: "镜像 ID",
			render: (image) => (
				<span className="xz-inf-id" title={image.id}>
					{shortId(image.id, 19)}
				</span>
			),
		},
		{
			key: "size",
			header: "大小",
			numeric: true,
			width: 110,
			render: (image) => formatBytes(image.size),
		},
		{
			key: "created",
			header: "构建时间",
			width: 160,
			render: (image) => <span className="xz-xs xz-muted">{formatUnixSeconds(image.created)}</span>,
		},
		{
			key: "actions",
			header: "操作",
			align: "right",
			width: 100,
			render: (image) => {
				const busy = remove.isPending && remove.variables?.id === image.id;
				return (
					<Button
						size="sm"
						variant="danger-ghost"
						icon="trash"
						disabled={busy}
						onClick={() => void onDelete(image)}
					>
						删除
					</Button>
				);
			},
		},
	];

	return (
		<Card>
			<CardHead
				title="镜像"
				icon="layers"
				sub={list.isSuccess ? `共 ${meta.total} 个` : undefined}
				actions={
					<IconButton
						icon="refresh"
						label="刷新镜像列表"
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
						placeholder="在当前页内筛选标签 / 镜像 ID"
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
					loadingLabel="正在读取宿主镜像列表…"
				>
					<DataTable
						columns={columns}
						rows={rows}
						rowKey={(image) => image.id}
						compact
						empty={
							<div className="xz-state xz-state--sm">
								{items.length === 0 ? "宿主上没有任何镜像。" : "没有符合当前筛选的镜像。"}
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
