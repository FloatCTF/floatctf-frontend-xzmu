/**
 * 赛事驾驶舱 · AWDP「演练」面板（选手侧）。
 *
 * 这是 `/events/:id?tab=drill` 的全部内容，覆盖 CAPABILITY-MATRIX
 * 「选手端：AWDP 比赛」的 11 项 required 能力：
 *
 *   总览 / 实例生命周期 / Break flag / Fix 补丁 / Test Check /
 *   轮次 / 我的官方评测 / 积分榜明细 / 趋势 / 源码下载 / 实时流
 *
 * 状态判定的权威来源是 `client.awdp.player.overview(eventId)` 的 `phase`；
 * 「当前相位允许哪些操作」全部走纯函数 `awdpPhasePolicy()`（依据见其注释，
 * 其中 `preparing_fix` 是 Default 漏掉的 durable 过渡态，这里如实展示）。
 */

import "./styles.css";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { call, unwrapNullable } from "../../api/call.ts";
import { useBindings, useClient } from "../../api/client.ts";
import { qk } from "../../api/keys.ts";
import { familyLabel } from "../events/status.ts";
import { Icon } from "../../ui/icons.tsx";
import { QueryBoundary } from "../../ui/overlays.tsx";
import { Badge, Button, Card, CardBody, CardHead, EmptyState, Segmented, SectionTitle } from "../../ui/primitives.tsx";
import type { EventPanelProps } from "../panels.ts";
import {
	AwdpBoxCard,
	AwdpEvaluationsCard,
	AwdpLiveNotice,
	AwdpPhaseNotice,
	AwdpPhasePill,
	AwdpRoundsCard,
	AwdpScoreboardCard,
	AwdpTimingPanel,
	AwdpTrendCard,
	awdpPhasePolicy,
	awdpPollMs,
	boxViewFromEvent,
	useAwdpLiveStrip,
	useAwdpSseBridge,
	type AwdpBoxActions,
} from "./components.tsx";

type DetailSection = "rounds" | "evaluations" | "scoreboard" | "trend";

export function AwdpDrillPanel({ eventId, mode }: EventPanelProps) {
	const client = useClient();
	const { useAwdpEventStream } = useBindings();

	// 实时流：事件只用来触发失效；真实数据永远来自 REST（见 useAwdpSseBridge 的说明）。
	const stream = useAwdpEventStream({ eventId });
	useAwdpLiveStrip("AWDP 演练实时", stream);
	useAwdpSseBridge("event", eventId, qk.awdp.all);

	const overview = useQuery({
		queryKey: qk.awdp.overview(eventId),
		queryFn: () => call(client.awdp.player.overview(eventId), "AWDP 总览"),
	});

	const phase = overview.data?.phase;
	const policy = awdpPhasePolicy(phase ?? "pending");
	const poll = awdpPollMs(phase);

	const rounds = useQuery({
		queryKey: qk.awdp.rounds(eventId),
		queryFn: () => call(client.awdp.player.rounds(eventId), "回合列表"),
		refetchInterval: poll,
	});

	const evaluations = useQuery({
		queryKey: qk.awdp.evaluations(eventId),
		queryFn: () => call(client.awdp.player.evaluations(eventId), "评测记录"),
		refetchInterval: poll,
	});

	const [section, setSection] = useState<DetailSection>("rounds");

	// 积分榜 / 趋势按 Default 已核实的语义 **轮询 30s**；只在对应子视图可见时开启。
	const scoreboard = useQuery({
		queryKey: qk.awdp.scoreboard(eventId),
		queryFn: () => call(client.awdp.player.scoreboard(eventId), "积分榜明细"),
		refetchInterval: 30_000,
		enabled: section === "scoreboard",
	});

	const trend = useQuery({
		queryKey: qk.awdp.trend(eventId),
		queryFn: () => call(client.awdp.player.trend(eventId), "得分趋势"),
		refetchInterval: 30_000,
		enabled: section === "trend",
	});

	/**
	 * 卡片动作 —— 赛事侧全部打在 `client.awdp.player.*` 上，参数顺序
	 * `(eventId, egId)`；`egId` 即 `AwdpGameBox.id`（赛事 GameBox 关联 ID）。
	 */
	const actions = useMemo<AwdpBoxActions>(
		() => ({
			submitBreak: (egId, flag) => call(client.awdp.player.submitBreak(eventId, egId, flag), "Break 提交结果"),
			uploadPatch: (egId, file) => call(client.awdp.player.uploadPatch(eventId, egId, file), "补丁提交结果"),
			testCheck: (egId) => call(client.awdp.player.testCheck(eventId, egId), "Test Check 结果"),
			startInstance: (egId) => call(client.awdp.player.startInstance(eventId, egId), "实例"),
			// stopInstance 返回 UniResponse<null>：不能用 call()（它把 null 当失败）。
			stopInstance: async (egId) => {
				unwrapNullable(await client.awdp.player.stopInstance(eventId, egId));
				return null;
			},
			resetInstance: (egId) => call(client.awdp.player.resetInstance(eventId, egId), "实例"),
			sourceUrl: (egId) => call(client.awdp.player.sourceUrl(eventId, egId), "源码下载地址"),
		}),
		[client, eventId],
	);

	const gameboxes = overview.data?.gameboxes ?? [];

	return (
		<div className="xz-awdp-stack">
			<AwdpLiveNotice stream={stream} />

			<QueryBoundary
				isPending={overview.isPending}
				isError={overview.isError}
				error={overview.error}
				refetch={() => void overview.refetch()}
				loadingLabel="正在加载 AWDP 演练总览…"
			>
				{overview.data ? (
					<>
						<Card>
							<CardHead
								title="演练总览"
								icon="target"
								sub={familyLabel(mode)}
								actions={
									<div className="xz-awdp-toolbar">
										<AwdpPhasePill phase={overview.data.phase} />
										<Badge tone="gold" icon="trophy">
											我的积分 {overview.data.my_score}
										</Badge>
										<Button
											size="sm"
											variant="quiet"
											icon="refresh"
											loading={overview.isFetching}
											onClick={() => void overview.refetch()}
										>
											刷新
										</Button>
									</div>
								}
							/>
							<CardBody>
								<div style={{ marginBottom: 16 }}>
									<AwdpPhaseNotice phase={overview.data.phase} isPractice={false} />
								</div>
								<AwdpTimingPanel timing={overview.data} />
							</CardBody>
						</Card>

						<div>
							<SectionTitle
								actions={
									<span className="xz-awdp-note">
										实例到点由系统自动启动；也可以手动启动 / 停止 / 重置（仅 Break、Fix 阶段）。
									</span>
								}
							>
								<Icon name="box" size={15} /> 我的 GameBox（{gameboxes.length}）
							</SectionTitle>
							{gameboxes.length === 0 ? (
								<EmptyState
									icon="box"
									title="本赛事没有可展示的 GameBox"
									desc="管理员尚未挂载任何 AWDP GameBox，或它们仍处于隐藏状态。"
								/>
							) : (
								<div className="xz-gbgrid">
									{gameboxes.map((gamebox) => (
										<AwdpBoxCard
											key={gamebox.id}
											box={boxViewFromEvent(gamebox)}
											policy={policy}
											actions={actions}
											invalidateKey={qk.awdp.all}
											instanceQueryKey={qk.awdp.instance(eventId, gamebox.id)}
											probeInstance={async () =>
												unwrapNullable(await client.awdp.player.getInstance(eventId, gamebox.id))
											}
											isPractice={false}
										/>
									))}
								</div>
							)}
						</div>

						<div>
							<SectionTitle
								actions={
									<Segmented
										ariaLabel="AWDP 明细视图"
										value={section}
										onChange={setSection}
										options={[
											{ value: "rounds" as const, label: "回合" },
											{ value: "evaluations" as const, label: "我的评测" },
											{ value: "scoreboard" as const, label: "积分榜" },
											{ value: "trend" as const, label: "趋势" },
										]}
									/>
								}
							>
								<Icon name="list" size={15} /> 明细
							</SectionTitle>
							{section === "rounds" ? (
								<QueryBoundary
									isPending={rounds.isPending}
									isError={rounds.isError}
									error={rounds.error}
									refetch={() => void rounds.refetch()}
									loadingLabel="正在加载回合…"
								>
									<AwdpRoundsCard rounds={rounds.data ?? []} />
								</QueryBoundary>
							) : null}
							{section === "evaluations" ? (
								<QueryBoundary
									isPending={evaluations.isPending}
									isError={evaluations.isError}
									error={evaluations.error}
									refetch={() => void evaluations.refetch()}
									loadingLabel="正在加载评测记录…"
								>
									<AwdpEvaluationsCard evaluations={evaluations.data ?? []} />
								</QueryBoundary>
							) : null}
							{section === "scoreboard" ? (
								<QueryBoundary
									isPending={scoreboard.isPending}
									isError={scoreboard.isError}
									error={scoreboard.error}
									refetch={() => void scoreboard.refetch()}
									loadingLabel="正在加载积分榜明细…"
								>
									{scoreboard.data ? <AwdpScoreboardCard detail={scoreboard.data} /> : null}
								</QueryBoundary>
							) : null}
							{section === "trend" ? (
								<QueryBoundary
									isPending={trend.isPending}
									isError={trend.isError}
									error={trend.error}
									refetch={() => void trend.refetch()}
									loadingLabel="正在加载趋势…"
								>
									<AwdpTrendCard items={trend.data ?? []} />
								</QueryBoundary>
							) : null}
						</div>
					</>
				) : null}
			</QueryBoundary>
		</div>
	);
}
