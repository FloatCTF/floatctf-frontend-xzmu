/**
 * Docker 网络视图（`/admin/docker` → 网络）。
 *
 * 语义要点：
 * - `client.admin.docker.fetchNetworks(params)`（同样 `offset` + `limit`）。
 * - **后端不返回 `created`**：`NetworkInfo` 结构体里没有该字段（SDK 声明有，
 *   但运行时是 `undefined`），因此这个视图**不渲染**创建时间列，而不是显示假时间。
 * - `createNetwork({ name, subnet, gateway, driver? })` 的响应体只有 `name`
 *   （其余字段是 Rust `Default`），所以创建成功后**只提示名称并刷新列表**，
 *   绝不把响应体当成完整的网络对象渲染。
 * - 创建网络会直接改动宿主网络，子网与 AWD 基础设施 / 赛事网络重叠会导致靶场失联，
 *   因此表单上方有明确警告；删除网络是破坏性操作，要求逐字输入网络名（或 ID 前缀）。
 */

import type { NetworkInfo } from "@floatctf/sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { matches } from "../../../lib/format.ts";
import { useDebounced } from "../../../lib/hooks.ts";
import { QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import {
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	Field,
	IconButton,
	Select,
	TextInput,
} from "../../../ui/primitives.tsx";
import { type Column, DataTable, Pagination, readMeta } from "../../../ui/Table.tsx";
import { confirmTarget, shortId, useOffsetPaging } from "./common.tsx";

interface CreateForm {
	name: string;
	subnet: string;
	gateway: string;
	driver: string;
}

const EMPTY_FORM: CreateForm = { name: "", subnet: "", gateway: "", driver: "" };

export function DockerNetworksView() {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const paging = useOffsetPaging();

	const [search, setSearch] = useState("");
	const debounced = useDebounced(search);
	const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
	const [errors, setErrors] = useState<Partial<CreateForm>>({});

	const list = useQuery({
		queryKey: qk.admin.networks(paging.params),
		queryFn: () => callList(client.admin.docker.fetchNetworks(paging.params)),
	});

	const items = list.data?.items ?? [];
	const meta = readMeta(list.data?.meta, paging.limit);

	const rows = useMemo(() => {
		if (!debounced.trim()) return items;
		return items.filter((item) =>
			matches([item.name, item.id, item.driver, item.subnet, item.gateway], debounced),
		);
	}, [items, debounced]);

	const create = useMutation({
		mutationFn: (input: CreateForm) =>
			call(
				client.admin.docker.createNetwork({
					name: input.name.trim(),
					subnet: input.subnet.trim(),
					gateway: input.gateway.trim(),
					// 留空时省略该字段，让后端使用它自己的默认驱动（bridge）。
					driver: input.driver.trim() || undefined,
				}),
				"创建结果",
			),
		onSuccess: (_data, input) => {
			toast.success("网络已创建", `${input.name.trim()}（子网 ${input.subnet.trim()}）`);
			setForm(EMPTY_FORM);
			setErrors({});
			void queryClient.invalidateQueries({ queryKey: qk.admin.networks(paging.params) });
		},
		onError: (error) => toast.error("创建网络失败", errorText(error)),
	});

	const remove = useMutation({
		mutationFn: (network: NetworkInfo) => call(client.admin.docker.deleteNetwork(network.id), "删除结果"),
		onSuccess: (_data, network) => {
			toast.success("网络已删除", network.name || shortId(network.id));
			void queryClient.invalidateQueries({ queryKey: qk.admin.networks(paging.params) });
		},
		onError: (error) => toast.error("删除网络失败", errorText(error)),
	});

	const submit = () => {
		const next: Partial<CreateForm> = {};
		if (!form.name.trim()) next.name = "网络名称不能为空";
		if (!form.subnet.trim()) next.subnet = "子网 CIDR 不能为空";
		if (!form.gateway.trim()) next.gateway = "网关不能为空";
		setErrors(next);
		if (Object.keys(next).length > 0) return;
		create.mutate(form);
	};

	const onDelete = async (network: NetworkInfo) => {
		const label = network.name || shortId(network.id);
		const ok = await confirm({
			title: `删除网络「${label}」`,
			description: "删除不可恢复；Docker 只会在没有容器仍连接该网络时允许删除。",
			consequences:
				"会删除该网络，正在运行的靶场环境会中断：仍连接该网络的容器会失去互相通信能力，AWD 赛事网络一旦被删除需要重新分配与部署。",
			confirmText: "删除网络",
			confirmPhrase: confirmTarget(label, network.id),
			tone: "danger",
		});
		if (ok) remove.mutate(network);
	};

	const columns: readonly Column<NetworkInfo>[] = [
		{
			key: "name",
			header: "网络名称",
			render: (network) => {
				const label = network.name || "（无名网络）";
				return (
					<div>
						<div className="xz-inf-name">{label}</div>
						<div className="xz-inf-id" title={network.id}>
							{shortId(network.id, 19)}
						</div>
					</div>
				);
			},
		},
		{ key: "driver", header: "驱动", width: 110, render: (network) => network.driver || "—" },
		{ key: "scope", header: "范围", width: 90, render: (network) => network.scope || "—" },
		{
			key: "subnet",
			header: "子网",
			render: (network) => <span className="xz-inf-id">{network.subnet || "—"}</span>,
		},
		{
			key: "gateway",
			header: "网关",
			render: (network) => <span className="xz-inf-id">{network.gateway || "—"}</span>,
		},
		{
			key: "actions",
			header: "操作",
			align: "right",
			width: 100,
			render: (network) => {
				const busy = remove.isPending && remove.variables?.id === network.id;
				return (
					<Button
						size="sm"
						variant="danger-ghost"
						icon="trash"
						disabled={busy}
						onClick={() => void onDelete(network)}
					>
						删除
					</Button>
				);
			},
		},
	];

	return (
		<>
			<Card className="xz-inf-create">
				<CardHead title="新建网络" icon="network" sub="在宿主 Docker 上直接创建" />
				<CardBody>
					<Banner tone="warn" title="子网不能与平台已用网段重叠">
						AWD / AWDP 的赛事网络与基础设施子网由平台分配。这里创建的子网一旦与它们重叠，
						靶场容器会互相串网、FlagServer / JudgeServer 回调失败，且需要人工清理才能恢复。
						请先用「靶场网络」页面确认已占用网段。
					</Banner>
					<form
						className="xz-formgrid"
						style={{ marginTop: "var(--xz-sp-4)" }}
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
					>
						<Field label="网络名称" required error={errors.name} hint="例如 floatctf-lab-1">
							{(props) => (
								<TextInput
									{...props}
									value={form.name}
									autoComplete="off"
									onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
								/>
							)}
						</Field>
						<Field label="子网 CIDR" required error={errors.subnet} hint="例如 10.20.30.0/24">
							{(props) => (
								<TextInput
									{...props}
									className="xz-input--mono"
									value={form.subnet}
									autoComplete="off"
									onChange={(event) => setForm((current) => ({ ...current, subnet: event.target.value }))}
								/>
							)}
						</Field>
						<Field label="网关" required error={errors.gateway} hint="必须落在子网内，例如 10.20.30.1">
							{(props) => (
								<TextInput
									{...props}
									className="xz-input--mono"
									value={form.gateway}
									autoComplete="off"
									onChange={(event) => setForm((current) => ({ ...current, gateway: event.target.value }))}
								/>
							)}
						</Field>
						<Field label="驱动" hint="留空则使用后端默认值 bridge">
							{(props) => (
								<Select
									{...props}
									value={form.driver}
									onChange={(event) => setForm((current) => ({ ...current, driver: event.target.value }))}
								>
									<option value="">默认（bridge）</option>
									<option value="bridge">bridge</option>
									<option value="overlay">overlay</option>
									<option value="macvlan">macvlan</option>
									<option value="none">none</option>
								</Select>
							)}
						</Field>
						<div className="xz-formgrid--full xz-row">
							<Button variant="primary" type="submit" icon="plus" loading={create.isPending}>
								创建网络
							</Button>
							<Button
								variant="quiet"
								disabled={create.isPending}
								onClick={() => {
									setForm(EMPTY_FORM);
									setErrors({});
								}}
							>
								清空
							</Button>
						</div>
					</form>
				</CardBody>
			</Card>

			<Card>
				<CardHead
					title="网络"
					icon="network"
					sub={list.isSuccess ? `共 ${meta.total} 个` : undefined}
					actions={
						<IconButton
							icon="refresh"
							label="刷新网络列表"
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
							placeholder="在当前页内筛选名称 / 驱动 / 子网"
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
						loadingLabel="正在读取宿主网络列表…"
					>
						<DataTable
							columns={columns}
							rows={rows}
							rowKey={(network) => network.id}
							compact
							empty={
								<div className="xz-state xz-state--sm">
									{items.length === 0 ? "宿主上没有任何 Docker 网络。" : "没有符合当前筛选的网络。"}
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
		</>
	);
}
