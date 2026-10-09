/**
 * AWD 靶场面板的子组件（选手侧）。
 *
 * 全部数据来自真实接口（`client.awd.player.*` 与 `client.service.events.get`），
 * 不做任何假数据 / 占位数据；每个查询都有 loading / empty / error 三态，
 * 每个 mutation 都有成功 toast 与 `toast.error(标题, errorText(e))`。
 */

import { useState } from "react";
import type { AwdGameBox, AwdPlayerStatus, AwdScoreRow, SshAccessResponse } from "@floatctf/sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { call, unwrapNullable } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { errorText } from "../../api/errors.ts";
import { qk } from "../../api/keys.ts";
import { formatNumber, formatTime } from "../../lib/format.ts";
import { dedupeAwdFeed, describeAwdEvent } from "./events.ts";
import { Link } from "../../router/Link.tsx";
import { Icon } from "../../ui/icons.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardFoot,
	CardHead,
	CodeBlock,
	CopyButton,
	EmptyState,
	IconButton,
	KeyValue,
	Secret,
	Stat,
	TextInput,
} from "../../ui/primitives.tsx";
import {
	type AwdAvailability,
	awdLifecycleLabel,
	awdPhaseLabel,
	gameboxHealthState,
	gameboxStatusTone,
} from "./phase.tsx";
import { type AwdRealtime, awdStreamDetail, awdStreamStateMeta } from "./stream.tsx";

/* ── 通用小工具 ───────────────────────────────────────────────────── */

/** 把后端原文保存为本地文件（不构造内容，只落盘真实响应）。 */
function downloadText(filename: string, text: string): void {
	const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

/* ── 实时链路：连接状态 + 可见提示 ────────────────────────────────── */

/**
 * 展示 SSE 的**全部**连接状态；`auth_error` 必须显式提示「登录状态失效」，
 * 因为 SSE 的 401/403 不走 axios 拦截器，不会触发全局 `onUnauthorized`。
 */
export function AwdStreamNotice({ realtime }: { realtime: AwdRealtime }) {
	const meta = awdStreamStateMeta(realtime.state);
	const detail = awdStreamDetail(realtime.state);
	const next = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;

	return (
		<div className="xz-awd-stream">
			<div className="xz-awd-live" data-state={realtime.state}>
				<span className="xz-awd-live__dot" aria-hidden="true" />
				<span>
					实时流：<b>{meta.label}</b>
				</span>
				{detail ? <span className="xz-awd-hint">{detail}</span> : null}
			</div>
			{realtime.state === "auth_error" ? (
				<Banner
					tone="danger"
					title="实时流登录状态失效"
					actions={
						<Link className="xz-btn xz-btn--primary xz-btn--sm" to={`/login?next=${encodeURIComponent(next)}`}>
							重新登录
						</Link>
					}
				>
					SSE 的 401/403 不会触发全局登录跳转（它走 <code className="xz-code">fetch</code>
					，不经 axios 拦截器），因此单独提示：重新登录后本页会重建实时连接；期间数据仍按 REST 轮询刷新。
				</Banner>
			) : null}
			{realtime.state === "error" ? (
				<Banner tone="danger" title="实时连接错误">
					连接中断且不会自动重连（非 401/403 的 4xx，或响应类型不是{" "}
					<code className="xz-code">text/event-stream</code>）。页面数据仍按 REST 轮询刷新。
					{realtime.lastError ? <span className="xz-mono xz-xs"> {realtime.lastError.message}</span> : null}
				</Banner>
			) : null}
			{realtime.state === "reconnecting" ? (
				<Banner tone="warn" title="实时连接中断，正在重连">
					已回退到每 15 秒的 REST 轮询，页面不会因断线冻结。
				</Banner>
			) : null}
			{realtime.state === "connecting" ? (
				<Banner tone="info" title="正在建立实时连接">
					连接建立前同样按 REST 轮询刷新数据。
				</Banner>
			) : null}
			{realtime.state === "idle" ? (
				<Banner tone="info" title="实时连接处于待机">
					可能尚未登录，或 <code className="xz-code">preferStream</code> 未启用；数据仍来自 REST 接口。
				</Banner>
			) : null}
			{realtime.state === "closed" ? (
				<Banner tone="info" title="实时连接已关闭">
					数据仍来自 REST 接口；如需实时事件可重新进入本标签页。
				</Banner>
			) : null}
		</div>
	);
}

/* ── ① 赛事状态（权威来源）────────────────────────────────────────── */

export function AwdStatusCard({
	status,
	availability,
	onRefresh,
	refreshing,
}: {
	status: AwdPlayerStatus;
	availability: AwdAvailability;
	onRefresh: () => void;
	refreshing: boolean;
}) {
	return (
		<Card>
			<CardHead
				title="赛事状态"
				icon="sword"
				sub="client.awd.player.status"
				actions={
					<>
						<Badge tone={availability.terminal ? "neutral" : availability.notStarted ? "info" : "crimson"}>
							{awdLifecycleLabel(status.status)}
						</Badge>
						<IconButton
							icon="refresh"
							label={refreshing ? "正在刷新赛事状态" : "刷新赛事状态"}
							disabled={refreshing}
							onClick={onRefresh}
						/>
					</>
				}
			/>
			<CardBody>
				<div className="xz-awd-status">
					<div className="xz-phase" data-phase={status.phase}>
						{awdPhaseLabel(status.phase)}
					</div>
					<Stat
						label="我方总分"
						value={status.score === null ? "—" : formatNumber(status.score)}
						icon="trophy"
						gold
					/>
					<Stat
						label="当前轮次"
						value={`${status.current_round ?? "—"} / ${status.round_count ?? "—"}`}
						icon="clock"
					/>
					<Stat label="生命周期 status" value={awdLifecycleLabel(status.status)} icon="task" />
				</div>
				{status.banned ? (
					<Banner tone="danger" title="本队已被封禁（团队级 ban）">
						这是<b>队伍级</b> active ban：可查看比赛，但无法提交 flag、重置靶机或获取接入凭据。
					</Banner>
				) : null}
				{status.final_settlement ? (
					<Banner tone="warn" title="最终结算中（final_settlement）">
						最后一轮已结束、Judge 仍在结算：所有 AWD 操作已关闭，排行榜仍可能变化。
					</Banner>
				) : null}
				{availability.terminal ? (
					<Banner tone="info" title="赛事已结束">
						终态赛事（finished / archived）只读；历史的积分榜与凭据接口都会拒绝访问。
					</Banner>
				) : null}
				{availability.notStarted ? (
					<Banner tone="info" title="AWD 尚未开始">
						当前生命周期 status 为 <code className="xz-code">{status.status}</code>，尚未进入 running：
						靶机与网络未就绪，因此不提供可操作按钮。
					</Banner>
				) : null}
				{availability.blockedReason !== null &&
				!status.banned &&
				!status.final_settlement &&
				!availability.terminal &&
				!availability.notStarted ? (
					<Banner tone="warn" title="当前不可操作">
						{availability.blockedReason}
					</Banner>
				) : null}
				{!availability.submitFlag.allowed && availability.blockedReason === null ? (
					<Banner tone="warn" title="当前不可提交 flag">
						{availability.submitFlag.reason}
					</Banner>
				) : null}
			</CardBody>
		</Card>
	);
}

/* ── ④ flag 提交 ──────────────────────────────────────────────────── */

export function AwdFlagCard({
	eventId,
	availability,
}: {
	eventId: string;
	availability: AwdAvailability;
}) {
	const client = useClient();
	const toast = useToast();
	const queryClient = useQueryClient();
	const [flag, setFlag] = useState("");

	const gate = availability.submitFlag;

	const submit = useMutation({
		// 陷阱：`submitFlag` 的公共返回类型被抹成 `UniResponse<null>`（后端真实返回体含
		// was_first_blood 等字段，但 SDK 未暴露），因此这里用 `unwrapNullable` 容忍 data=null，
		// 绝不臆造一血 / 得分明细；成功后只失效积分榜与状态。
		mutationFn: async (value: string) =>
			unwrapNullable(await client.awd.player.submitFlag(eventId, value)),
		onSuccess: () => {
			setFlag("");
			toast.success("flag 已提交", "计分结果以随后刷新的积分榜为准。");
			void queryClient.invalidateQueries({ queryKey: qk.awd.scores(eventId) });
			void queryClient.invalidateQueries({ queryKey: qk.awd.status(eventId) });
			void queryClient.invalidateQueries({ queryKey: qk.awd.gameboxes(eventId) });
		},
		onError: (error) => toast.error("flag 提交失败", errorText(error)),
	});

	return (
		<Card>
			<CardHead
				title="提交 flag"
				icon="flag"
				sub={gate.allowed ? "attack 阶段 · 攻击得分入口" : "当前阶段不可提交"}
			/>
			<CardBody>
				<form
					className="xz-flagbar"
					onSubmit={(event) => {
						event.preventDefault();
						const value = flag.trim();
						if (!value || submit.isPending) return;
						submit.mutate(value);
					}}
				>
					<TextInput
						value={flag}
						onChange={(event) => setFlag(event.target.value)}
						placeholder={gate.allowed ? "flag{...}" : "当前阶段不可提交 flag"}
						aria-label="flag"
						autoComplete="off"
						spellCheck={false}
						disabled={!gate.allowed || submit.isPending}
					/>
					<Button
						type="submit"
						variant="primary"
						icon="send"
						loading={submit.isPending}
						disabled={!gate.allowed || !flag.trim()}
					>
						提交
					</Button>
				</form>
				{!gate.allowed ? (
					<div className="xz-awd-notice">
						<Banner tone="warn" title="已禁用：当前不能提交 flag">
							{gate.reason}
						</Banner>
					</div>
				) : null}
				<p className="xz-awd-hint">
					后端要求 <code className="xz-code">phase=attack</code> 且存在 active round。公共 SDK 的{" "}
					<code className="xz-code">submitFlag</code> 返回 <code className="xz-code">UniResponse&lt;null&gt;</code>
					，不含 <code className="xz-code">was_first_blood</code> 等明细，因此本页不展示一血提示。
				</p>
			</CardBody>
		</Card>
	);
}

/* ── ②③ GameBox 列表与重置 ────────────────────────────────────────── */

export function AwdGameboxesCard({
	eventId,
	availability,
	pollInterval,
}: {
	eventId: string;
	availability: AwdAvailability;
	pollInterval: number | false;
}) {
	const client = useClient();
	const toast = useToast();
	const confirm = useConfirm();
	const queryClient = useQueryClient();

	const gameboxes = useQuery({
		queryKey: qk.awd.gameboxes(eventId),
		queryFn: () => call(client.awd.player.gameboxes(eventId), "GameBox 列表"),
		refetchInterval: pollInterval,
	});

	const reset = useMutation({
		mutationFn: async (instanceId: string) =>
			unwrapNullable(await client.awd.player.resetGamebox(eventId, instanceId)),
		onSuccess: () => {
			toast.success("已提交重置请求", "容器会销毁并按原始镜像重建，最终状态以 GameBox 列表为准。");
			void queryClient.invalidateQueries({ queryKey: qk.awd.gameboxes(eventId) });
		},
		onError: (error) => toast.error("重置 GameBox 失败", errorText(error)),
	});

	const askReset = async (box: AwdGameBox) => {
		const name = box.gamebox_name || box.container_name || box.gamebox_ip;
		const ok = await confirm({
			title: `重置靶机「${name}」？`,
			description: "重置是破坏性操作：容器会被销毁并从原始镜像重建。",
			consequences: (
				<>
					容器内的<b>全部改动</b>都会丢失（Web 目录、shell 历史、植入的后门等），重建后 IP 与端口可能变化。
					<br />
					重置会消耗免费次数；<b>超出免费额度后将按平台规则扣分</b>。选手端接口不返回剩余免费次数，
					因此本页无法显示「还剩几次」。
				</>
			),
			tone: "danger",
			confirmText: "重置靶机",
		});
		if (ok) reset.mutate(box.id);
	};

	const items: AwdGameBox[] = gameboxes.data ?? [];
	const resetGate = availability.resetGamebox;

	return (
		<Card>
			<CardHead
				title="我的 GameBox"
				icon="box"
				sub="IP / 容器 / 健康状态"
				actions={<IconButton icon="refresh" label="刷新 GameBox 列表" onClick={() => void gameboxes.refetch()} />}
			/>
			<CardBody>
				{!resetGate.allowed ? (
					<div className="xz-awd-notice">
						<Banner tone="warn" title="暂不能重置靶机">
							{resetGate.reason}
						</Banner>
					</div>
				) : null}
				<QueryBoundary
					isPending={gameboxes.isPending}
					isError={gameboxes.isError}
					error={gameboxes.error}
					refetch={() => void gameboxes.refetch()}
					loadingLabel="正在加载 GameBox…"
				>
					{items.length === 0 ? (
						<EmptyState
							title="没有可用的 GameBox"
							icon="box"
							desc="两种已知原因：① 赛事尚未部署；② 你的队伍在部署之后才创建（需要管理员重新部署）。"
						/>
					) : (
						<div className="xz-gbgrid">
							{items.map((box) => (
								<AwdGameboxTile
									key={box.id}
									box={box}
									gate={resetGate}
									busy={reset.isPending && reset.variables === box.id}
									onReset={() => void askReset(box)}
								/>
							))}
						</div>
					)}
				</QueryBoundary>
			</CardBody>
			<CardFoot>
				GameBox 通过 SSH 访问（凭据见「接入凭据」）；重置会销毁并重建容器，操作前已二次确认。
			</CardFoot>
		</Card>
	);
}

function AwdGameboxTile({
	box,
	gate,
	busy,
	onReset,
}: {
	box: AwdGameBox;
	gate: AwdAvailability["resetGamebox"];
	busy: boolean;
	onReset: () => void;
}) {
	const health = gameboxHealthState(box.health_status);
	return (
		<article className="xz-gb" data-health={health}>
			<div className="xz-gb__head">
				<div className="xz-grow">
					<div className="xz-gb__name">{box.gamebox_name || box.container_name || "未命名 GameBox"}</div>
				</div>
				<Badge tone={gameboxStatusTone(box.status)}>{box.status}</Badge>
			</div>
			<div className="xz-gb__rows">
				<div className="xz-gb__row">
					<span className="xz-gb__k">IP</span>
					<span className="xz-gb__v">{box.gamebox_ip || "—"}</span>
				</div>
				<div className="xz-gb__row">
					<span className="xz-gb__k">容器</span>
					<span className="xz-gb__v">{box.container_name || "—"}</span>
				</div>
				<div className="xz-gb__row">
					<span className="xz-gb__k">健康</span>
					<span className="xz-gb__v">{box.health_status || "—"}</span>
				</div>
			</div>
			<div className="xz-gb__foot">
				<Button
					variant="danger-ghost"
					size="sm"
					icon="refresh"
					loading={busy}
					disabled={!gate.allowed}
					title={gate.allowed ? "销毁并从原始镜像重建该容器" : gate.reason}
					onClick={onReset}
				>
					重置靶机
				</Button>
				{!gate.allowed ? <span className="xz-awd-hint">{gate.reason}</span> : null}
			</div>
		</article>
	);
}

/* ── ⑤ 积分榜（30s 轮询，高亮本队）────────────────────────────────── */

export function AwdScoresCard({
	eventId,
	myTeamId,
	myTeamUnavailable,
}: {
	eventId: string;
	myTeamId: string | null;
	myTeamUnavailable: boolean;
}) {
	const client = useClient();
	const scores = useQuery({
		queryKey: qk.awd.scores(eventId),
		queryFn: () => call(client.awd.player.scores(eventId), "AWD 积分榜"),
		// Default 已核实的语义：AWD 计分榜轮询 30s。
		refetchInterval: 30_000,
	});

	const rows: AwdScoreRow[] = scores.data ?? [];

	return (
		<Card>
			<CardHead
				title="积分榜"
				icon="trophy"
				sub="每 30 秒自动刷新"
				actions={<IconButton icon="refresh" label="刷新积分榜" onClick={() => void scores.refetch()} />}
			/>
			<CardBody flush>
				{myTeamUnavailable ? (
					<div className="xz-awd-pad">
						<Banner tone="warn" title="无法读取本队信息">
							未能从赛事详情（<code className="xz-code">events.get(id).team_result.team.id</code>
							）取得我的队伍，因此本队所在行不会被高亮。
						</Banner>
					</div>
				) : null}
				<QueryBoundary
					isPending={scores.isPending}
					isError={scores.isError}
					error={scores.error}
					refetch={() => void scores.refetch()}
					loadingLabel="正在加载积分榜…"
				>
					{rows.length === 0 ? (
						<EmptyState title="暂无积分记录" icon="trophy" desc="比赛尚未产生得分事件（攻击得分 / 防守失分）。" />
					) : (
						<div className="xz-awd-scroll">
							<table className="xz-board">
								<thead>
									<tr>
										<th>#</th>
										<th>队伍</th>
										<th className="xz-awd-num">攻击分</th>
										<th className="xz-awd-num">防守分</th>
										<th className="xz-awd-num">总分</th>
									</tr>
								</thead>
								<tbody>
									{rows.map((row) => {
										const mine = myTeamId !== null && row.team_id === myTeamId;
										return (
											<tr key={row.team_id} className={mine ? "xz-board__row--me" : undefined}>
												<td className="xz-board__rank" data-top={row.rank}>
													{row.rank}
												</td>
												<td>
													<span className="xz-row">
														{row.team_name}
														{mine ? <Badge tone="gold">我的队伍</Badge> : null}
													</span>
												</td>
												<td className="xz-board__num">{formatNumber(row.attack_score)}</td>
												<td className="xz-board__num">{formatNumber(row.defense_score)}</td>
												<td className="xz-board__score">{formatNumber(row.total_score)}</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</QueryBoundary>
			</CardBody>
		</Card>
	);
}

/* ── ⑥⑦ WireGuard 配置 + SSH 凭据 ─────────────────────────────────── */

export function AwdCredentialsCard({
	eventId,
	availability,
}: {
	eventId: string;
	availability: AwdAvailability;
}) {
	const client = useClient();
	const allowed = availability.credentials.allowed;

	// 不可用时也保持 hook 调用顺序（`enabled` 关闭），渲染层改显原因横幅。
	// `retry: false` 沿用 Default 语义：凭据接口不做自动重试（避免无意义地反复取密钥）。
	const wg = useQuery({
		queryKey: qk.awd.wireguard(eventId),
		queryFn: () => call(client.awd.player.wireguardConfig(eventId), "WireGuard 配置"),
		enabled: allowed,
		retry: false,
	});
	const ssh = useQuery({
		queryKey: qk.awd.ssh(eventId),
		queryFn: () => call(client.awd.player.sshConfig(eventId), "SSH 凭据"),
		enabled: allowed,
		retry: false,
	});

	const refresh = () => {
		void wg.refetch();
		void ssh.refetch();
	};

	return (
		<Card>
			<CardHead
				title="接入凭据"
				icon="key"
				sub="WireGuard / SSH"
				actions={<IconButton icon="refresh" label="刷新接入凭据" disabled={!allowed} onClick={refresh} />}
			/>
			<CardBody>
				{!allowed ? (
					<Banner tone="warn" title="暂不可获取接入凭据">
						{availability.credentials.reason}
					</Banner>
				) : (
					<div className="xz-awd-credgrid">
						<section className="xz-awd-cred">
							<h3 className="xz-awd-cred__title">
								<Icon name="globe" size={15} /> WireGuard 配置
							</h3>
							<QueryBoundary
								isPending={wg.isPending}
								isError={wg.isError}
								error={wg.error}
								refetch={() => void wg.refetch()}
								loadingLabel="正在获取 WireGuard 配置…"
							>
								{wg.data && wg.data.config ? (
									<>
										<CodeBlock>{wg.data.config}</CodeBlock>
										<div className="xz-row xz-wrap">
											<Button
												size="sm"
												icon="download"
												onClick={() => downloadText(`floatctf-awd-${eventId}.conf`, wg.data?.config ?? "")}
											>
												下载 .conf
											</Button>
											<span className="xz-awd-hint">私钥只在下发时返回一次；丢失需管理员轮换后重新获取。</span>
										</div>
									</>
								) : (
									<EmptyState
										title="未返回配置文本"
										icon="globe"
										desc="后端返回的 config 为空（可能尚未部署 WireGuard 网络）。"
									/>
								)}
							</QueryBoundary>
						</section>
						<section className="xz-awd-cred">
							<h3 className="xz-awd-cred__title">
								<Icon name="terminal" size={15} /> SSH 访问
							</h3>
							<QueryBoundary
								isPending={ssh.isPending}
								isError={ssh.isError}
								error={ssh.error}
								refetch={() => void ssh.refetch()}
								loadingLabel="正在获取 SSH 凭据…"
							>
								{ssh.data ? (
									<AwdSshCredentials data={ssh.data} />
								) : (
									<EmptyState
										title="未返回 SSH 凭据"
										icon="terminal"
										desc="凭据在后端部署完成后才可用；未加入队伍或未部署时不会有数据。"
									/>
								)}
							</QueryBoundary>
						</section>
					</div>
				)}
			</CardBody>
		</Card>
	);
}

/** SSH 凭据正文：端口 + 密码（敏感值，默认模糊）+ 实例清单。 */
function AwdSshCredentials({ data }: { data: SshAccessResponse }) {
	// 后端契约里 `instances` 必有，但运行时缺失时不能白屏：退化为空态。
	const instances = Array.isArray(data.instances) ? data.instances : [];
	return (
		<>
			<KeyValue
				items={[
					{ k: "端口", v: <code className="xz-code">{data.port}</code> },
					{
						k: "密码",
						v: <Secret value={data.password} />,
					},
				]}
			/>
			{instances.length === 0 ? (
				<EmptyState title="暂无 SSH 目标实例" icon="server" desc="后端未返回实例清单（可能尚未部署）。" />
			) : (
				<ul className="xz-list">
					{instances.map((instance) => (
						<li className="xz-list__row" key={instance.id}>
							<div className="xz-list__main">
								<div className="xz-list__title xz-mono">{instance.gamebox_ip}</div>
								<div className="xz-list__meta">
									<span>容器 {instance.container_name || "—"}</span>
									<span>用户 {instance.username || "—"}</span>
									<span>健康 {instance.health_status || "—"}</span>
								</div>
							</div>
							<div className="xz-list__aside">
								<CopyButton
									value={`ssh ${instance.username}@${instance.gamebox_ip} -p ${data.port}`}
									label="复制命令"
								/>
							</div>
						</li>
					))}
				</ul>
			)}
		</>
	);
}

/* ── ⑧ 实时事件流 ─────────────────────────────────────────────────── */

export function AwdFeedCard({ realtime }: { realtime: AwdRealtime }) {
	const meta = awdStreamStateMeta(realtime.state);
	return (
		<Card>
			<CardHead
				title="实时事件流"
				icon="bolt"
				sub="SSE 失效信号"
				actions={<Badge tone={meta.tone}>{meta.label}</Badge>}
			/>
			<CardBody>
				<p className="xz-awd-hint">
					事件只作为「数据失效信号」，真实数据始终来自 REST 接口；断线时自动回退到 REST 轮询。
				</p>
				{realtime.feed.length === 0 ? (
					<EmptyState
						title="尚未收到实时事件"
						icon="bolt"
						desc="连接建立后，得分 / 攻击 / 轮次 / 暂停 / 网络等事件会出现在这里。"
					/>
				) : (
					<ul className="xz-feed">
						{dedupeAwdFeed(realtime.feed).map((entry) => {
							// 战报优先（payload 字段取自后端 `websocket.rs`）；认不出的事件回落到原始摘要。
							const line = describeAwdEvent(entry.type, entry.payload) || entry.summary;
							return (
								<li className="xz-feed__item" key={entry.key} data-kind={entry.kind}>
									<span className="xz-awd-feed__type">{entry.type}</span>
									{line ? (
										<span className="xz-awd-feed__summary xz-xs" title={entry.summary}>
											{line}
										</span>
									) : null}
									<span className="xz-feed__time">{entry.occurredAt ? formatTime(entry.occurredAt) : "—"}</span>
								</li>
							);
						})}
					</ul>
				)}
			</CardBody>
		</Card>
	);
}
