/**
 * `/admin/network` —— 平台网络控制面。
 *
 * SDK：
 * - `getPlatformNetwork()` → `PlatformNetworkSettings`（设置 + 容量预览）
 * - `updatePlatformNetwork(body)` → 部分更新（返回少量字段 + `note`）
 * - `getPlatformNetworkHealth()` → **只读** Host 观测状态
 * - `getPlatformNetworkAllocations()` → **只读** 分配账本
 *
 * ⚠ `awd_network_allocations` 里残留的**已释放**行是正常的历史配置（`released_at` 非空），
 * 本页如实展示，不标记为「泄漏」，也不提供任何「清理」按钮。
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlatformNetworkSettingsUpdate } from "@floatctf/sdk";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime, formatNumber } from "../../../lib/format.ts";
import { QueryBoundary, useToast } from "../../../ui/overlays.tsx";
import { Badge, Banner, Button, Card, CardBody, CardHead, Field, TextInput } from "../../../ui/primitives.tsx";
import { DataTable } from "../../../ui/Table.tsx";
import { ROOT, TextField, parseNumberText } from "./shared.tsx";

interface NetworkForm {
	gamebox_pool: string;
	gamebox_event_prefix: string;
	gamebox_team_prefix: string;
	wireguard_pool: string;
	wireguard_event_prefix: string;
	wireguard_team_prefix: string;
	wireguard_port_min: string;
	wireguard_port_max: string;
	wireguard_public_endpoint: string;
}

export function AdminNetworkPage() {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const [form, setForm] = useState<NetworkForm | null>(null);
	const [error, setError] = useState<string | undefined>();
	const [loadedVersion, setLoadedVersion] = useState<string | null>(null);

	const network = useQuery({
		queryKey: qk.awd.platformNetwork,
		queryFn: () => call(client.awd.admin.getPlatformNetwork(), "平台网络设置"),
	});
	const health = useQuery({
		queryKey: qk.awd.platformNetworkHealth,
		queryFn: () => call(client.awd.admin.getPlatformNetworkHealth(), "网络健康"),
		refetchInterval: 60_000,
	});
	const allocations = useQuery({
		queryKey: qk.awd.platformNetworkAllocations,
		queryFn: () => callList(client.awd.admin.getPlatformNetworkAllocations()),
	});

	const settings = network.data ?? null;

	// 远端值首次到达（或版本变化）时初始化表单。
	if (settings && loadedVersion !== settings.updated_at) {
		setLoadedVersion(settings.updated_at);
		setForm({
			gamebox_pool: settings.gamebox_pool,
			gamebox_event_prefix: String(settings.gamebox_event_prefix),
			gamebox_team_prefix: String(settings.gamebox_team_prefix),
			wireguard_pool: settings.wireguard_pool,
			wireguard_event_prefix: String(settings.wireguard_event_prefix),
			wireguard_team_prefix: String(settings.wireguard_team_prefix),
			wireguard_port_min: String(settings.wireguard_port_min),
			wireguard_port_max: String(settings.wireguard_port_max),
			wireguard_public_endpoint: settings.wireguard_public_endpoint ?? "",
		});
	}

	const save = useMutation({
		mutationFn: (body: PlatformNetworkSettingsUpdate) =>
			call(client.awd.admin.updatePlatformNetwork(body), "设置更新"),
		onSuccess: (result) => {
			toast.success("平台网络设置已更新", result.note);
			setError(undefined);
			void queryClient.invalidateQueries({ queryKey: ROOT.awdPlatformNetwork });
		},
		onError: (err) => toast.error("更新平台网络设置失败", errorText(err)),
	});

	const submit = () => {
		if (!form) return;
		const intField = (text: string, label: string): number | null => {
			const parsed = parseNumberText(text);
			if (!parsed.ok) {
				setError(`${label}：${parsed.error}`);
				return null;
			}
			if (parsed.value === null || parsed.value < 0 || !Number.isInteger(parsed.value)) {
				setError(`${label}必须是非负整数`);
				return null;
			}
			return parsed.value;
		};

		const gameboxEventPrefix = intField(form.gamebox_event_prefix, "GameBox 赛事前缀");
		const gameboxTeamPrefix = intField(form.gamebox_team_prefix, "GameBox 队伍前缀");
		const wireguardEventPrefix = intField(form.wireguard_event_prefix, "WireGuard 赛事前缀");
		const wireguardTeamPrefix = intField(form.wireguard_team_prefix, "WireGuard 队伍前缀");
		const portMin = intField(form.wireguard_port_min, "WireGuard 端口下界");
		const portMax = intField(form.wireguard_port_max, "WireGuard 端口上界");
		if (
			gameboxEventPrefix === null ||
			gameboxTeamPrefix === null ||
			wireguardEventPrefix === null ||
			wireguardTeamPrefix === null ||
			portMin === null ||
			portMax === null
		) {
			return;
		}
		if (portMin < 1 || portMax > 65_535 || portMin > portMax) {
			setError("WireGuard 端口范围必须在 1–65535 之间，且下界不大于上界");
			return;
		}
		if (form.gamebox_pool.trim() === "" || form.wireguard_pool.trim() === "") {
			setError("GameBox / WireGuard 池都不能为空");
			return;
		}
		setError(undefined);
		save.mutate({
			gamebox_pool: form.gamebox_pool.trim(),
			gamebox_event_prefix: gameboxEventPrefix,
			gamebox_team_prefix: gameboxTeamPrefix,
			wireguard_pool: form.wireguard_pool.trim(),
			wireguard_event_prefix: wireguardEventPrefix,
			wireguard_team_prefix: wireguardTeamPrefix,
			wireguard_port_min: portMin,
			wireguard_port_max: portMax,
			wireguard_public_endpoint: form.wireguard_public_endpoint.trim() || null,
		});
	};

	const capacity = useMemo(() => {
		if (!settings) return [];
		return [
			{ k: "GameBox 可容纳赛事数", v: settings.gamebox_event_capacity, hint: `池 ${settings.gamebox_pool}` },
			{
				k: "每赛事可容纳队伍数",
				v: settings.gamebox_team_capacity_per_event,
				hint: `每队 ${settings.gamebox_hosts_per_team} 台主机`,
			},
			{ k: "WireGuard 可容纳赛事数", v: settings.wireguard_event_capacity, hint: `池 ${settings.wireguard_pool}` },
			{
				k: "WireGuard 每赛事队伍数",
				v: settings.wireguard_team_capacity_per_event,
				hint: `端口范围 ${settings.wireguard_port_min}–${settings.wireguard_port_max}`,
			},
			{ k: "WireGuard 端口容量", v: settings.wireguard_port_capacity, hint: "可用端口总数" },
		];
	}, [settings]);

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head xz-aev-pagehead">
				<div className="xz-grow">
					<h1 className="xz-page__title">平台网络</h1>
					<p className="xz-page__desc">
						AWD / AWDP 的靶场网段池、前缀与 WireGuard 端口范围；以及 Host 端 nftables / WireGuard /
						Docker 的只读观测状态与全平台分配账本。
					</p>
				</div>
				<Button
					icon="refresh"
					onClick={() => {
						void network.refetch();
						void health.refetch();
						void allocations.refetch();
					}}
				>
					刷新全部
				</Button>
			</header>

			<QueryBoundary
				isPending={network.isPending}
				isError={network.isError}
				error={network.error}
				refetch={() => void network.refetch()}
				loadingLabel="正在加载平台网络设置…"
			>
				{settings && form ? (
					<div className="xz-aev-col">
						<Card>
							<CardHead
								title="平台网络设置"
								icon="network"
								sub={`updated_at ${formatDateTime(settings.updated_at)}`}
								actions={<Badge tone={settings.wireguard_public_endpoint ? "ok" : "warn"}>
									{settings.wireguard_public_endpoint ? "已配置公网端点" : "未配置公网端点"}
								</Badge>}
							/>
							<CardBody>
								<div className="xz-aev-grid3">
									<TextField
										label="GameBox 池"
										mono
										value={form.gamebox_pool}
										onChange={(value) => setForm({ ...form, gamebox_pool: value })}
									/>
									<TextField
										label="GameBox 赛事前缀"
										value={form.gamebox_event_prefix}
										onChange={(value) => setForm({ ...form, gamebox_event_prefix: value })}
									/>
									<TextField
										label="GameBox 队伍前缀"
										value={form.gamebox_team_prefix}
										onChange={(value) => setForm({ ...form, gamebox_team_prefix: value })}
									/>
									<TextField
										label="WireGuard 池"
										mono
										value={form.wireguard_pool}
										onChange={(value) => setForm({ ...form, wireguard_pool: value })}
									/>
									<TextField
										label="WireGuard 赛事前缀"
										value={form.wireguard_event_prefix}
										onChange={(value) => setForm({ ...form, wireguard_event_prefix: value })}
									/>
									<TextField
										label="WireGuard 队伍前缀"
										value={form.wireguard_team_prefix}
										onChange={(value) => setForm({ ...form, wireguard_team_prefix: value })}
									/>
									<TextField
										label="WireGuard 端口下界"
										value={form.wireguard_port_min}
										onChange={(value) => setForm({ ...form, wireguard_port_min: value })}
									/>
									<TextField
										label="WireGuard 端口上界"
										value={form.wireguard_port_max}
										onChange={(value) => setForm({ ...form, wireguard_port_max: value })}
									/>
									<Field label="WireGuard 公网端点" hint="留空 = 清空（提交 null）">
										{(props) => (
											<TextInput
												{...props}
												className="xz-input--mono"
												value={form.wireguard_public_endpoint}
												placeholder="vpn.example.edu:51820"
												onChange={(event) =>
													setForm({ ...form, wireguard_public_endpoint: event.target.value })
												}
											/>
										)}
									</Field>
								</div>

								{error ? (
									<Banner tone="danger" title="参数不合法">
										{error}
									</Banner>
								) : null}

								<div className="xz-aev-inline" style={{ marginTop: 12 }}>
									<Button variant="primary" icon="save" loading={save.isPending} onClick={submit}>
										保存平台网络设置
									</Button>
									<Button
										icon="undo"
										disabled={save.isPending}
										onClick={() => {
											setLoadedVersion(null);
											setError(undefined);
										}}
									>
										放弃本地改动
									</Button>
									<span className="xz-muted xz-xs">
										设置变更会影响后续赛事网络分配；已锁定的赛事分配不会自动迁移。
									</span>
								</div>
							</CardBody>
						</Card>

						<Card>
							<CardHead title="容量预览" icon="chart" sub="后端根据前缀与池实时计算" />
							<CardBody>
								<div className="xz-aev-stats">
									{capacity.map((entry) => (
										<div key={entry.k} className="xz-aev-cap">
											<span className="xz-aev-cap__k">{entry.k}</span>
											<span className="xz-aev-cap__v">{formatNumber(entry.v)}</span>
											<span className="xz-muted xz-xs">{entry.hint}</span>
										</div>
									))}
								</div>
							</CardBody>
						</Card>
					</div>
				) : null}
			</QueryBoundary>

			<Card>
				<CardHead title="Host 观测状态（只读）" icon="server" sub="60s 轮询" />
				<CardBody>
					<QueryBoundary
						isPending={health.isPending}
						isError={health.isError}
						error={health.error}
						refetch={() => void health.refetch()}
						loadingLabel="正在读取 Host 状态…"
					>
						{health.data ? (
							<div className="xz-aev-col">
								<div className="xz-aev-grid3">
									{[
										["nftables", health.data.nftables],
										["wireguard", health.data.wireguard],
										["docker", health.data.docker],
										["firewall_runtime", health.data.firewall_runtime],
										["floatctf_table", health.data.floatctf_table],
										["docker_firewall_backend", health.data.docker_firewall_backend ?? "—"],
										["firewalld", health.data.firewalld],
										["ipv4_forwarding", health.data.ipv4_forwarding ?? "—"],
										["ipv6_policy", health.data.ipv6_policy],
									].map(([label, value]) => (
										<div key={label} className="xz-aev-netcell">
											<div className="xz-aev-netcell__k">{label}</div>
											<div className="xz-aev-netcell__v">{value}</div>
										</div>
									))}
								</div>
								<div className="xz-aev-inline">
									<Badge tone={health.data.capability_supported ? "ok" : "danger"}>
										{health.data.capability_supported ? "helper 能力可用" : "helper 能力不足"}
									</Badge>
									<span className="xz-muted xz-xs">
										该面板纯只读；修复 Host 侧问题需要管理员在宿主上处理。
									</span>
								</div>
								{(health.data.notes ?? []).length > 0 ? (
									<div className="xz-aev-report">
										{(health.data.notes ?? []).map((note, index) => (
											<div key={index} className="xz-aev-report__item" data-tone="info">
												<span className="xz-aev-report__text">{note}</span>
											</div>
										))}
									</div>
								) : null}
							</div>
						) : null}
					</QueryBoundary>
				</CardBody>
			</Card>

			<Card>
				<CardHead
					title="分配账本（只读）"
					icon="clipboard"
					sub="含已释放的历史行 —— 这是正常的历史配置，不是泄漏"
				/>
				<CardBody flush>
					<Banner tone="info" title="关于 released 行">
						`awd_network_allocations` 里 `released_at` 非空的行是**已经释放**的历史分配记录；
						平台保留它们用于审计与网段复用，本页不提供「清理」操作。
					</Banner>
					<QueryBoundary
						isPending={allocations.isPending}
						isError={allocations.isError}
						error={allocations.error}
						refetch={() => void allocations.refetch()}
						loadingLabel="正在加载分配账本…"
					>
						<DataTable
							rows={allocations.data?.items ?? []}
							rowKey={(row, index) => `${row.event_id}-${row.kind}-${row.cidr}-${index}`}
							empty={<div className="xz-aev-emptyline">还没有任何网络分配记录。</div>}
							columns={[
								{
									key: "event",
									header: "赛事",
									render: (row) => (
										<div>
											<div>{row.event_title ?? "（赛事已删除）"}</div>
											<div className="xz-muted xz-xs xz-mono">{row.event_id}</div>
										</div>
									),
								},
								{ key: "kind", header: "类型", render: (row) => <Badge tone="info">{row.kind}</Badge> },
								{ key: "cidr", header: "网段", render: (row) => <span className="xz-aev-mono">{row.cidr}</span> },
								{
									key: "active",
									header: "状态",
									render: (row) =>
										row.active ? <Badge tone="ok">使用中</Badge> : <Badge tone="neutral">已释放</Badge>,
								},
								{ key: "allocated", header: "分配时间", render: (row) => formatDateTime(row.allocated_at) },
								{
									key: "released",
									header: "释放时间",
									render: (row) =>
										row.released_at ? formatDateTime(row.released_at) : <span className="xz-muted">—</span>,
								},
							]}
						/>
					</QueryBoundary>
				</CardBody>
			</Card>
		</div>
	);
}
