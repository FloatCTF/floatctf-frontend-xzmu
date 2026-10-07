/**
 * 赛事控制台 · `network` 标签 —— 本赛事的 AWD 网络分配。
 *
 * SDK：
 * - `client.awd.admin.getEventNetwork(id)`：**未分配时后端返回 404**（查询会 reject），
 *   这里必须当作「尚未分配网络」而不是「加载失败」，并给出分配入口。
 * - `client.awd.admin.allocateEventNetwork(id, body)`：空 body（`automatic`）或手动指定两个 CIDR。
 * - `client.awd.admin.reallocateEventNetwork(id)`：**破坏性**（换网段），仅在未锁定时可用。
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { NetworkAllocationRequest } from "@floatctf/sdk";

import { call } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { Icon } from "../../../ui/icons.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	Field,
	Segmented,
	TextInput,
} from "../../../ui/primitives.tsx";
import { ROOT } from "./shared.tsx";

function httpStatusOf(error: unknown): number | undefined {
	if (error && typeof error === "object" && "httpStatus" in error) {
		const value = (error as { httpStatus?: unknown }).httpStatus;
		return typeof value === "number" ? value : undefined;
	}
	return undefined;
}

const CIDR = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;

interface ManualForm {
	gamebox_cidr: string;
	wireguard_cidr: string;
	wireguard_listen_port: string;
}

const EMPTY_MANUAL: ManualForm = { gamebox_cidr: "", wireguard_cidr: "", wireguard_listen_port: "" };

export function EventNetworkTab({ eventId }: { eventId: string }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const [mode, setMode] = useState<"automatic" | "manual">("automatic");
	const [manual, setManual] = useState<ManualForm>(EMPTY_MANUAL);
	const [formError, setFormError] = useState<string | undefined>();

	const network = useQuery({
		queryKey: qk.awd.adminNetwork(eventId),
		queryFn: () => call(client.awd.admin.getEventNetwork(eventId), "赛事网络"),
		enabled: eventId.length > 0,
		retry: false,
	});

	const info = network.data;
	const notAllocated = network.isError && httpStatusOf(network.error) === 404;

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.awd.adminNetwork(eventId) });
		void queryClient.invalidateQueries({ queryKey: ROOT.awdPlatformNetwork });
		void queryClient.invalidateQueries({ queryKey: ROOT.awdAdmin });
	};

	const allocate = useMutation({
		mutationFn: (body: NetworkAllocationRequest) => call(client.awd.admin.allocateEventNetwork(eventId, body), "分配结果"),
		onSuccess: () => {
			toast.success("赛事网络已分配", "锁定后不可再修改。");
			setManual(EMPTY_MANUAL);
			invalidate();
		},
		onError: (error) => toast.error("分配赛事网络失败", errorText(error)),
	});

	const reallocate = useMutation({
		mutationFn: () => call(client.awd.admin.reallocateEventNetwork(eventId), "重新分配结果"),
		onSuccess: () => {
			toast.success("已重新分配赛事网络");
			invalidate();
		},
		onError: (error) => toast.error("重新分配失败", errorText(error)),
	});

	const submitAllocate = () => {
		if (mode === "automatic") {
			// 空 body = automatic（SDK 注释：`allocation_mode` 默认 automatic）。
			allocate.mutate({});
			return;
		}
		if (!CIDR.test(manual.gamebox_cidr.trim())) {
			setFormError("GameBox 网段必须是合法的 CIDR，例如 10.42.16.0/20");
			return;
		}
		if (!CIDR.test(manual.wireguard_cidr.trim())) {
			setFormError("WireGuard 网段必须是合法的 CIDR，例如 10.42.32.0/24");
			return;
		}
		const port = manual.wireguard_listen_port.trim();
		if (port) {
			const value = Number(port);
			if (!Number.isSafeInteger(value) || value < 1 || value > 65_535) {
				setFormError("WireGuard 监听端口必须在 1–65535 之间");
				return;
			}
		}
		setFormError(undefined);
		allocate.mutate({
			allocation_mode: "manual",
			gamebox_cidr: manual.gamebox_cidr.trim(),
			wireguard_cidr: manual.wireguard_cidr.trim(),
			...(port ? { wireguard_listen_port: Number(port) } : {}),
		});
	};

	const askReallocate = async () => {
		const ok = await confirm({
			title: "重新分配赛事网络？",
			description: "会为赛事重新选取 GameBox 与 WireGuard 网段，并更新防火墙与分配账本。",
			consequences:
				"已部署容器的地址会变化，选手端 WireGuard 配置需要重新下发；分配一旦锁定（locked）后端会拒绝该操作。",
			tone: "danger",
			confirmText: "重新分配",
		});
		if (ok) reallocate.mutate();
	};

	const allocationForm = (
		<Card>
			<CardHead title="分配赛事网络" icon="network" sub="每个 AWD 赛事开赛前的必做步骤" />
			<CardBody>
				<Segmented
					ariaLabel="分配方式"
					value={mode}
					onChange={(next) => {
						setMode(next);
						setFormError(undefined);
					}}
					options={[
						{ value: "automatic", label: "自动分配" },
						{ value: "manual", label: "手动指定" },
					]}
				/>

				{mode === "automatic" ? (
					<div className="xz-aev-note" style={{ marginTop: 12 }}>
						平台会从平台网络池中自动挑选空闲的 GameBox / WireGuard 网段与监听端口。
					</div>
				) : (
					<div className="xz-aev-grid3" style={{ marginTop: 12 }}>
						<Field label="GameBox 网段（CIDR）" required>
							{(props) => (
								<TextInput
									{...props}
									className="xz-input--mono"
									value={manual.gamebox_cidr}
									placeholder="10.42.16.0/20"
									onChange={(changeEvent) => setManual({ ...manual, gamebox_cidr: changeEvent.target.value })}
								/>
							)}
						</Field>
						<Field label="WireGuard 网段（CIDR）" required>
							{(props) => (
								<TextInput
									{...props}
									className="xz-input--mono"
									value={manual.wireguard_cidr}
									placeholder="10.42.32.0/24"
									onChange={(changeEvent) => setManual({ ...manual, wireguard_cidr: changeEvent.target.value })}
								/>
							)}
						</Field>
						<Field label="监听端口" hint="留空使用平台默认">
							{(props) => (
								<TextInput
									{...props}
									type="number"
									value={manual.wireguard_listen_port}
									placeholder="51820"
									onChange={(changeEvent) =>
										setManual({ ...manual, wireguard_listen_port: changeEvent.target.value })
									}
								/>
							)}
						</Field>
					</div>
				)}

				{formError ? (
					<Banner tone="danger" title="参数不合法">
						{formError}
					</Banner>
				) : null}

				<div className="xz-aev-inline" style={{ marginTop: 12 }}>
					<Button variant="primary" icon="network" loading={allocate.isPending} onClick={submitAllocate}>
						{mode === "automatic" ? "自动分配网络" : "按手动配置分配"}
					</Button>
					<span className="xz-muted xz-xs">分配完成并部署后网络会被锁定，锁定后不可再分配。</span>
				</div>
			</CardBody>
		</Card>
	);

	if (notAllocated) {
		return (
			<div className="xz-aev-col">
				<Banner tone="info" title="该赛事尚未分配网络">
					`GET /admin/events/{"{id}"}/awd/network` 在未分配时返回 404，这是**正常状态**而不是加载失败。
					请在下面选择分配方式；部署后网络会锁定。
				</Banner>
				{allocationForm}
			</div>
		);
	}

	return (
		<div className="xz-aev-col">
			<QueryBoundary
				isPending={network.isPending}
				isError={network.isError}
				error={network.error}
				refetch={() => void network.refetch()}
				loadingLabel="正在加载赛事网络…"
			>
				{info ? (
					<Card>
						<CardHead
							title="赛事网络"
							icon="network"
							sub={`allocation_mode: ${info.allocation_mode}`}
							actions={
								<div className="xz-aev-inline">
									{info.locked ? (
										<Badge tone="warn" icon="lock">
											已锁定
										</Badge>
									) : (
										<Badge tone="ok">未锁定</Badge>
									)}
									{!info.locked ? (
										<Button
											variant="danger-ghost"
											icon="refresh"
											loading={reallocate.isPending}
											onClick={() => void askReallocate()}
										>
											重新分配
										</Button>
									) : null}
								</div>
							}
						/>
						<CardBody>
							{info.locked ? (
								<Banner tone="warn" title="网络已锁定">
									部署后分配被锁定（`locked = true`），后端会拒绝再分配（AWD_NETWORK_LOCKED）。
								</Banner>
							) : null}
							<div className="xz-aev-netgrid" style={{ marginTop: 12 }}>
								<div className="xz-aev-netcell">
									<div className="xz-aev-netcell__k">GameBox 网段</div>
									<div className="xz-aev-netcell__v xz-net">
										<Icon name="box" size={14} />
										{info.gamebox_cidr}
									</div>
								</div>
								<div className="xz-aev-netcell">
									<div className="xz-aev-netcell__k">WireGuard 网段</div>
									<div className="xz-aev-netcell__v xz-net">
										<Icon name="shield" size={14} />
										{info.wireguard_cidr}
									</div>
								</div>
								<div className="xz-aev-netcell">
									<div className="xz-aev-netcell__k">基础设施子网</div>
									<div className="xz-aev-netcell__v">{info.infrastructure_subnet}</div>
								</div>
								<div className="xz-aev-netcell">
									<div className="xz-aev-netcell__k">FlagServer</div>
									<div className="xz-aev-netcell__v">{info.flagserver_ip}</div>
								</div>
								<div className="xz-aev-netcell">
									<div className="xz-aev-netcell__k">JudgeServer</div>
									<div className="xz-aev-netcell__v">{info.judgeserver_ip}</div>
								</div>
								<div className="xz-aev-netcell">
									<div className="xz-aev-netcell__k">WireGuard 接口</div>
									<div className="xz-aev-netcell__v">
										{info.wireguard_interface_name} : {info.wireguard_listen_port}
									</div>
								</div>
								<div className="xz-aev-netcell">
									<div className="xz-aev-netcell__k">Docker 网络</div>
									<div className="xz-aev-netcell__v">{info.docker_network_name}</div>
								</div>
								<div className="xz-aev-netcell">
									<div className="xz-aev-netcell__k">赛事 ID</div>
									<div className="xz-aev-netcell__v">{info.event_id}</div>
								</div>
							</div>
						</CardBody>
					</Card>
				) : null}
			</QueryBoundary>

			{!info && !notAllocated ? allocationForm : null}
		</div>
	);
}
