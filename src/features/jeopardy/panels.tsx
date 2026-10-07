/**
 * 赛事驾驶舱的 Jeopardy 面板。
 *
 * 驾驶舱（`/events/:id`）只负责解析赛事与切换标签；每个面板自己取数、处理三态与破坏性操作。
 *
 * 后端语义要点（docs/CAPABILITY-BEHAVIOR-MAP）：
 * - 赛事题目列表有**两道后端门槛**：赛事必须已开始（否则「赛事尚未开始」）、用户必须已报名
 *   （否则「你尚未加入本赛事」）。两者都原样展示后端文案，并按后端文案给出对应指引；
 * - `EventChallengeResult.current_points` 是**动态分值**（随解出人数下降），只有这个接口返回；
 * - 积分榜的题列是**动态的**：用 `data[0].challenges` 的题目名生成；`solved_no === 1/2/3` = 一/二/三血；
 * - 趋势图在前端把各队的 `time` 做并集、缺失点补 0（与 Default 语义一致，此处用纯 CSS 画）；
 * - 实例字段是 `instance.identifier`（**没有 `ref`**）；`content` 是 HTML（见 components.tsx 的安全渲染）；
 * - 计分榜 / 趋势轮询 30s，公告轮询 60s。
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	EventChallengeResult,
	EventInstanceResult,
	ScoreboardItem,
	TrendItem,
} from "@floatctf/sdk";

import { call, callList, unwrapNullable } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { errorText, toErrorView } from "../../api/errors.ts";
import { qk } from "../../api/keys.ts";
import { formatDateTime, formatTime, matches } from "../../lib/format.ts";
import { useDebounced } from "../../lib/hooks.ts";
import { Link } from "../../router/Link.tsx";
import { Icon } from "../../ui/icons.tsx";
import { MarkdownView } from "../../ui/Markdown.tsx";
import { Modal, QueryBoundary, useConfirm, useToast } from "../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	EmptyState,
	IconButton,
	KeyValue,
	Select,
	Stat,
} from "../../ui/primitives.tsx";
import { type Column, DataTable } from "../../ui/Table.tsx";
import type { EventPanelProps } from "../panels.ts";
import {
	AttachmentLink,
	bloodLabel,
	ChallengeRunner,
	type ChallengeRunnerAdapter,
	ChallengeTile,
	formatPoints,
	InstanceCountdown,
	isStaticChallenge,
} from "./components.tsx";

const POLL_SCOREBOARD_MS = 30_000;
const POLL_ANNOUNCEMENTS_MS = 60_000;

/* ── 赛事题目 ─────────────────────────────────────────────────────── */

/**
 * 赛事题目接口的两道门槛。
 *
 * **判定依据是后端原文**：被拒绝时 `message` 恰好是「赛事尚未开始」或「你尚未加入本赛事」
 * （`player_service.rs:250-271`）。这里只把后端拒绝映射成一句可执行的指引，
 * 从不修改后端文案本身 —— 原始 message 由下方的 `QueryBoundary` → `ErrorState` 原样展示。
 */
function EventChallengeGate({
	error,
	joined,
	phase,
}: {
	error: unknown;
	joined: boolean | null;
	phase: "upcoming" | "running" | "ended" | null;
}) {
	const view = toErrorView(error);
	const message = view.message;
	const notStarted = message.includes("尚未开始");
	const notJoined = message.includes("未加入");
	if (!notStarted && !notJoined) {
		return (
			<Banner tone="danger" title="无法读取赛事题目">
				{message}
			</Banner>
		);
	}
	return (
		<Banner tone={notStarted ? "info" : "warn"} title={notStarted ? "赛事尚未开始" : "你尚未加入本赛事"}>
			{notStarted
				? "赛题集合只在赛事开始后对参赛者开放；开始前这个标签会一直是空的。可以稍后刷新。"
				: "请先在「概览」标签报名（团队赛需要先创建或加入战队），再回到「题目」标签。"}
			{phase === "upcoming" && joined ? "（按赛事时间，本场仍未开始。）" : null}
		</Banner>
	);
}

export function EventChallengesPanel({ eventId, mode }: EventPanelProps) {
	const client = useClient();
	const queryClient = useQueryClient();
	const [openId, setOpenId] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState("all");
	const debounced = useDebounced(search);

	const info = useQuery({
		queryKey: qk.events.detail(eventId),
		queryFn: () => call(client.service.events.get(eventId), "赛事详情"),
	});
	const challenges = useQuery({
		queryKey: qk.events.challenges(eventId),
		queryFn: () => callList(client.service.events.fetchChallenges(eventId, {})),
	});

	const items: EventChallengeResult[] = challenges.data?.items ?? [];

	const categories = useMemo(() => {
		const set = new Set<string>();
		for (const item of items) set.add(item.challenge.category || "");
		return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
	}, [items]);

	const filtered = useMemo(
		() =>
			items.filter((item) => {
				if (
					!matches(
						[item.challenge.name, item.challenge.category, item.challenge.description],
						debounced,
					)
				)
					return false;
				if (category !== "all" && (item.challenge.category || "") !== category) return false;
				return true;
			}),
		[items, debounced, category],
	);

	const solvedCount = items.filter((item) => item.solved).length;
	const remainingPoints = items.reduce((sum, item) => sum + (item.solved ? 0 : item.current_points), 0);
	const active = openId ? (items.find((item) => item.challenge.id === openId) ?? null) : null;

	// 赛事时间相位（与 events/status.ts 同口径；仅用于解释后端的「尚未开始」拒绝）。
	const phase: "upcoming" | "running" | "ended" | null = (() => {
		if (!info.data) return null;
		const start = new Date(info.data.event.start_time).getTime();
		const end = info.data.event.end_time ? new Date(info.data.event.end_time).getTime() : null;
		if (Number.isFinite(start) && Date.now() < start) return "upcoming";
		if (end !== null && Number.isFinite(end) && Date.now() > end) return "ended";
		return "running";
	})();

	/**
	 * 赛事维度的实例适配器。
	 *
	 * 查询键由 `qk.events.instances(eventId)` 派生：keys.ts（他人所有）没有「赛事 + 题目」维度的键，
	 * 派生键仍能被 `qk.events.instances(eventId)` 的前缀失效命中。
	 */
	const adapterFor = (challengeId: string): ChallengeRunnerAdapter => ({
		instanceKey: [...qk.events.instances(eventId), "challenge", challengeId],
		getInstance: async () =>
			unwrapNullable(await client.service.events.getChallengeInstance(eventId, challengeId)),
		launch: () => call(client.service.events.launchSingleInstance(eventId, challengeId), "实例"),
		submit: (instanceId, flag) =>
			call(
				client.service.submit.submitSingle({ event_id: eventId, instance_id: instanceId, flag }),
				"提交结果",
			),
		invalidate: [qk.events.challenges(eventId), qk.events.instances(eventId), qk.instances.all],
	});

	return (
		<div className="xz-col" style={{ gap: 16 }}>
			<Card>
				<CardHead
					title="赛事题目"
					icon="puzzle"
					sub={mode === "jeopardy" ? "解题赛" : mode}
					actions={
						<IconButton icon="refresh" label="刷新题目列表" onClick={() => void challenges.refetch()} />
					}
				/>
				<CardBody>
					{info.isSuccess ? (
						<div className="xz-jeo-stats">
							<Stat label="赛事开放题目" value={items.length} icon="puzzle" />
							<Stat label="我已解出" value={solvedCount} icon="check" gold={solvedCount > 0} />
							<Stat label="剩余可得分值" value={formatPoints(remainingPoints)} icon="trophy" gold />
							<Stat
								label="我的报名"
								value={info.data?.joined ? "已报名" : "未报名"}
								icon="users"
							/>
						</div>
					) : info.isError ? (
						<Banner tone="warn" title="赛事详情加载失败">
							{errorText(info.error)}（题目列表仍会独立尝试加载。）
						</Banner>
					) : null}

					{challenges.isError ? (
						<div style={{ marginBottom: 12 }}>
							<EventChallengeGate
								error={challenges.error}
								joined={info.data ? info.data.joined : null}
								phase={phase}
							/>
						</div>
					) : null}

					<QueryBoundary
						isPending={challenges.isPending}
						isError={challenges.isError}
						error={challenges.error}
						refetch={() => void challenges.refetch()}
						loadingLabel="正在加载赛事题目…"
					>
						{items.length === 0 ? (
							<EmptyState
								icon="puzzle"
								title="本赛事当前没有可见题目"
								desc="隐藏的题目对参赛者不可见；管理员开放题目后这里会显示。"
							/>
						) : (
							<>
								<div className="xz-filters">
									<span className="xz-search">
										<span className="xz-search__icon">
											<Icon name="search" size={14} />
										</span>
										<input
											className="xz-input"
											data-page-search
											placeholder="搜索题目名称 / 分类 / 描述"
											value={search}
											onChange={(event) => setSearch(event.target.value)}
										/>
									</span>
									<Select
										value={category}
										aria-label="分类"
										onChange={(event) => setCategory(event.target.value)}
									>
										<option value="all">全部分类</option>
										{categories.map((entry) => (
											<option key={entry || "__empty"} value={entry}>
												{entry || "未分类"}
											</option>
										))}
									</Select>
									<span className="xz-muted xz-xs" style={{ marginLeft: "auto" }}>
										{filtered.length} / {items.length} 道
									</span>
								</div>

								{filtered.length === 0 ? (
									<EmptyState icon="search" title="没有符合条件的题目" desc="试着放宽搜索或分类筛选。" />
								) : (
									<div className="xz-chgrid">
										{filtered.map((item) => (
											<ChallengeTile
												key={item.challenge.id}
												challenge={item.challenge}
												points={item.current_points}
												pointsGold
												solved={item.solved}
												solvedNo={item.solved_no}
												onOpen={() => setOpenId(item.challenge.id)}
												openLabel={`打开「${item.challenge.name}」`}
												meta={
													<span className="xz-muted xz-xs">
														本题已解出 {item.solved_count} 次
														{item.solved ? ` · 你是第 ${item.solved_no} 个解出` : ""}
													</span>
												}
												actions={
													<Button
														size="sm"
														icon="flag"
														onClick={() => setOpenId(item.challenge.id)}
													>
														{item.solved ? "查看" : "启动 / 提交"}
													</Button>
												}
											/>
										))}
									</div>
								)}
							</>
						)}
					</QueryBoundary>
				</CardBody>
			</Card>

			<Modal
				open={active !== null}
				onClose={() => setOpenId(null)}
				size="wide"
				title={active?.challenge.name ?? "题目"}
				description={
					active
						? `${active.challenge.category || "未分类"} · 当前分值 ${formatPoints(active.current_points)} · 本题已解出 ${active.solved_count} 次`
						: undefined
				}
			>
				{active ? (
					<div className="xz-col" style={{ gap: 16 }}>
						<ChallengeRunner
							challenge={active.challenge}
							adapter={adapterFor(active.challenge.id)}
							solved={active.solved}
							solvedNo={active.solved_no}
							hint={`本场赛事 · 当前 ${formatPoints(active.current_points)} 分`}
							onSolved={() => {
								void queryClient.invalidateQueries({ queryKey: qk.events.challenges(eventId) });
								void challenges.refetch();
							}}
						/>
						{active.challenge.description ? (
							<div className="xz-card xz-card--flat">
								<div className="xz-card__body">
									<MarkdownView>{active.challenge.description}</MarkdownView>
								</div>
							</div>
						) : (
							<p className="xz-muted" style={{ margin: 0 }}>
								这道题没有文字描述。
							</p>
						)}
						<AttachmentLink challenge={active.challenge} />
						<div className="xz-row" style={{ gap: 8, flexWrap: "wrap" }}>
							<Link
								to={`/challenges/${active.challenge.id}`}
								className="xz-btn xz-btn--ghost xz-btn--sm"
							>
								<Icon name="external" size={14} />
								打开题目详情
							</Link>
							<span className="xz-muted xz-xs">
								{isStaticChallenge(active.challenge)
									? "静态题：启动后直接提交 flag，没有容器与自动销毁。"
									: "容器题：实例到期后由平台自动销毁。"}
							</span>
						</div>
					</div>
				) : null}
			</Modal>
		</div>
	);
}

/* ── 积分榜 ───────────────────────────────────────────────────────── */

/** 积分榜题列：`solved_no === 1/2/3` 显式标注一血 / 二血 / 三血。 */
function BoardCell({ row, name, index }: { row: ScoreboardItem; name: string; index: number }) {
	const cell = row.challenges.find((entry) => entry.name === name) ?? row.challenges[index];
	if (!cell) return <span className="xz-muted">—</span>;
	if (!cell.solved) return <span className="xz-muted">·</span>;
	const label = bloodLabel(cell.solved_no);
	if (label) {
		return (
			<Badge tone={cell.solved_no === 1 ? "gold" : "crimson"} title={`第 ${cell.solved_no} 个解出该题`}>
				{label}
			</Badge>
		);
	}
	return (
		<span className="xz-jeo-check" title={`已解出（第 ${cell.solved_no} 个）`}>
			<Icon name="check" size={13} />
		</span>
	);
}

export function EventScoreboardPanel({ eventId }: EventPanelProps) {
	const client = useClient();
	const board = useQuery({
		queryKey: qk.events.scoreboard(eventId),
		queryFn: () => call(client.service.events.getScoreboard(eventId), "积分榜"),
		refetchInterval: POLL_SCOREBOARD_MS,
	});
	// 高亮「我所在的队伍」：`team_result` 只在赛事详情接口返回（列表接口恒为 None）。
	const info = useQuery({
		queryKey: qk.events.detail(eventId),
		queryFn: () => call(client.service.events.get(eventId), "赛事详情"),
	});

	const rows = board.data ?? [];
	// 列是动态的：以第一行的 challenges 作为题列定义。
	const columns = rows[0]?.challenges ?? [];
	const isTeamEvent = info.data?.event.participant_mode === "team";
	const myTeamName = isTeamEvent ? (info.data?.team_result?.team.name ?? null) : null;

	return (
		<Card>
			<CardHead
				title="赛事积分榜"
				icon="trophy"
				sub={`每 ${POLL_SCOREBOARD_MS / 1000} 秒自动刷新`}
				actions={
					<div className="xz-row" style={{ gap: 8 }}>
						{board.isSuccess ? (
							<span className="xz-muted xz-xs">最近更新 {formatTime(board.dataUpdatedAt)}</span>
						) : null}
						<IconButton icon="refresh" label="刷新积分榜" onClick={() => void board.refetch()} />
					</div>
				}
			/>
			<CardBody>
				<div className="xz-jeo-legend">
					<span className="xz-row" style={{ gap: 6 }}>
						<Badge tone="gold" icon="crown">
							一血
						</Badge>
						第 1 个解出
					</span>
					<span className="xz-row" style={{ gap: 6 }}>
						<Badge tone="crimson" icon="medal">
							二血
						</Badge>
						第 2 个解出
					</span>
					<span className="xz-row" style={{ gap: 6 }}>
						<Badge tone="crimson" icon="medal">
							三血
						</Badge>
						第 3 个解出
					</span>
					<span className="xz-muted xz-xs">· 其余解出只显示对勾；— 表示该主体与本题无关</span>
				</div>

				{isTeamEvent && info.isSuccess && !myTeamName ? (
					<Banner tone="info">
						团队赛：你还没有战队，因此本页没有可高亮的行。创建或加入战队后，你所在的行会带上「我的队伍」标记。
					</Banner>
				) : null}
				{info.isError ? (
					<Banner tone="warn" title="无法加载我的队伍信息">
						积分榜数据本身可见，但「我所在的队伍」高亮需要赛事详情：{errorText(info.error)}
					</Banner>
				) : null}

				<QueryBoundary
					isPending={board.isPending}
					isError={board.isError}
					error={board.error}
					refetch={() => void board.refetch()}
					loadingLabel="正在加载积分榜…"
				>
					{rows.length === 0 ? (
						<EmptyState
							icon="trophy"
							title="还没有计分数据"
							desc="赛事开始并有人解出题目后，积分榜会在这里出现。"
						/>
					) : (
						<div className="xz-jeo-boardwrap">
							<table className="xz-board">
								<thead>
									<tr>
										<th className="xz-board__rank">#</th>
										<th>参赛主体</th>
										<th className="xz-board__num">解出</th>
										<th className="xz-board__score">总分</th>
										{columns.map((column, index) => (
											<th key={`${column.name}-${index}`} className="xz-jeo-board__ch">
												{column.name}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{rows.map((row) => {
										const mine = myTeamName !== null && row.name === myTeamName;
										return (
											<tr key={row.id} className={mine ? "xz-board__row--me" : undefined}>
												<td className="xz-board__rank" data-top={row.no <= 3 ? row.no : undefined}>
													{row.no}
												</td>
												<td>
													<span className="xz-jeo-board__name">{row.name}</span>
													{mine ? (
														<Badge tone="gold" icon="pin">
															我的队伍
														</Badge>
													) : null}
												</td>
												<td className="xz-board__num">{row.solved_count}</td>
												<td className="xz-board__score">{formatPoints(row.score)}</td>
												{columns.map((column, index) => (
													<td
														key={`${row.id}-${column.name}-${index}`}
														className="xz-jeo-board__cell"
													>
														<BoardCell row={row} name={column.name} index={index} />
													</td>
												))}
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

/* ── 趋势 ─────────────────────────────────────────────────────────── */

interface TrendSeries {
	name: string;
	/** 与 `times` 等长；缺失的时间点补 0（与 Default 语义一致）。 */
	scores: number[];
}

/** 把各队的折线按 `time` 做并集，缺失点补 0。 */
function buildTrend(data: readonly TrendItem[]): { times: string[]; series: TrendSeries[] } {
	const timeSet = new Set<string>();
	const maps = new Map<string, Map<string, number>>();
	for (const item of data) {
		const map = new Map<string, number>();
		for (const point of item.points) {
			timeSet.add(point.time);
			map.set(point.time, point.score);
		}
		maps.set(item.name, map);
	}
	const times = [...timeSet].sort();
	return {
		times,
		series: data.map((item) => ({
			name: item.name,
			scores: times.map((time) => maps.get(item.name)?.get(time) ?? 0),
		})),
	};
}

export function EventTrendPanel({ eventId }: EventPanelProps) {
	const client = useClient();
	const [focus, setFocus] = useState("all");
	const trend = useQuery({
		queryKey: qk.events.trend(eventId),
		queryFn: () => call(client.service.events.getTrend(eventId), "分数走势"),
		refetchInterval: POLL_SCOREBOARD_MS,
	});

	const data = trend.data ?? [];
	const chart = useMemo(() => buildTrend(data), [data]);
	const visible = focus === "all" ? chart.series : chart.series.filter((entry) => entry.name === focus);

	// 堆叠柱：以「某一时刻参与堆叠的分数之和」的最大值归一化，保证柱高不溢出。
	const maxStack = useMemo(() => {
		let max = 0;
		for (let index = 0; index < chart.times.length; index += 1) {
			const sum = visible.reduce((acc, entry) => acc + (entry.scores[index] ?? 0), 0);
			if (sum > max) max = sum;
		}
		return max;
	}, [visible, chart.times.length]);

	const labelStep = Math.max(1, Math.ceil(chart.times.length / 14));

	return (
		<Card>
			<CardHead
				title="分数走势"
				icon="trendUp"
				sub={`每 ${POLL_SCOREBOARD_MS / 1000} 秒自动刷新 · 缺失时间点补 0`}
				actions={
					<div className="xz-row" style={{ gap: 8 }}>
						{chart.series.length > 1 ? (
							<Select
								aria-label="只看某个主体"
								value={focus}
								onChange={(event) => setFocus(event.target.value)}
								style={{ width: "auto", height: 30 }}
							>
								<option value="all">全部主体（堆叠）</option>
								{chart.series.map((entry) => (
									<option key={entry.name} value={entry.name}>
										{entry.name}
									</option>
								))}
							</Select>
						) : null}
						{trend.isSuccess ? (
							<span className="xz-muted xz-xs">最近更新 {formatTime(trend.dataUpdatedAt)}</span>
						) : null}
						<IconButton icon="refresh" label="刷新走势" onClick={() => void trend.refetch()} />
					</div>
				}
			/>
			<CardBody>
				<QueryBoundary
					isPending={trend.isPending}
					isError={trend.isError}
					error={trend.error}
					refetch={() => void trend.refetch()}
					loadingLabel="正在加载分数走势…"
				>
					{chart.times.length === 0 || maxStack <= 0 ? (
						<EmptyState
							icon="chart"
							title="还没有分数变化"
							desc="赛事中一旦产生计分，走势柱就会在这里出现。"
						/>
					) : (
						<>
							<div className="xz-jeo-trendlegend">
								{visible.map((entry, index) => {
									const last = entry.scores[entry.scores.length - 1] ?? 0;
									return (
										<span key={entry.name} className="xz-jeo-legend__item">
											<span
												className={`xz-jeo-swatch xz-jeo-trend__seg--${index % 8}`}
												aria-hidden="true"
											/>
											{entry.name}
											<span className="xz-mono xz-xs xz-muted">当前 {formatPoints(last)} 分</span>
										</span>
									);
								})}
							</div>
							<div
								className="xz-trend xz-jeo-trend"
								role="img"
								aria-label="各参赛主体的分数随时间变化（堆叠柱状图）"
							>
								{chart.times.map((time, index) => (
									<div className="xz-trend__col" key={time}>
										<div
											className="xz-trend__stack"
											title={`${formatDateTime(time)} · 合计 ${formatPoints(
												visible.reduce((acc, entry) => acc + (entry.scores[index] ?? 0), 0),
											)} 分`}
										>
											{visible.map((entry, seriesIndex) => {
												const score = entry.scores[index] ?? 0;
												if (score <= 0) return null;
												return (
													<div
														key={entry.name}
														className={`xz-trend__seg xz-jeo-trend__seg--${seriesIndex % 8}`}
														style={{ height: `${(score / maxStack) * 100}%` }}
														title={`${entry.name} · ${formatDateTime(time)} · ${formatPoints(score)} 分`}
													/>
												);
											})}
										</div>
										<div className="xz-trend__label">
											{index % labelStep === 0 ? formatTime(time) : ""}
										</div>
									</div>
								))}
							</div>
							<p className="xz-muted xz-xs" style={{ marginTop: 8 }}>
								每根柱子是一个计分时刻，柱内按主体堆叠（颜色见上方图例）；悬停可看该时刻的明细。
							</p>
						</>
					)}
				</QueryBoundary>
			</CardBody>
		</Card>
	);
}

/* ── 公告 ─────────────────────────────────────────────────────────── */

export function EventAnnouncementsPanel({ eventId }: EventPanelProps) {
	const client = useClient();
	const announcements = useQuery({
		queryKey: qk.events.announcements(eventId),
		queryFn: () => call(client.service.events.getAnnouncements(eventId), "赛事公告"),
		refetchInterval: POLL_ANNOUNCEMENTS_MS,
	});

	const items = announcements.data ?? [];

	return (
		<Card>
			<CardHead
				title="赛事公告"
				icon="bell"
				sub={`每 ${POLL_ANNOUNCEMENTS_MS / 1000} 秒自动刷新`}
				actions={<IconButton icon="refresh" label="刷新公告" onClick={() => void announcements.refetch()} />}
			/>
			<CardBody>
				<QueryBoundary
					isPending={announcements.isPending}
					isError={announcements.isError}
					error={announcements.error}
					refetch={() => void announcements.refetch()}
					loadingLabel="正在加载赛事公告…"
				>
					{items.length === 0 ? (
						<EmptyState icon="bell" title="还没有赛事公告" desc="管理员发布公告后会显示在这里。" />
					) : (
						<div className="xz-col" style={{ gap: 12 }}>
							{items.map((item) => (
								<article className="xz-post" key={item.id}>
									<header className="xz-post__head">
										<Icon name="bell" size={16} />
										<div className="xz-grow">
											<div className="xz-jeo-ann__title">{item.title}</div>
											<div className="xz-muted xz-xs">{formatDateTime(item.created_at)}</div>
										</div>
									</header>
									<div className="xz-post__body">
										{item.content ? (
											<MarkdownView>{item.content}</MarkdownView>
										) : (
											<p className="xz-muted" style={{ margin: 0 }}>
												这条公告没有正文。
											</p>
										)}
									</div>
								</article>
							))}
						</div>
					)}
				</QueryBoundary>
			</CardBody>
		</Card>
	);
}

/* ── 赛事实例 ─────────────────────────────────────────────────────── */

export function EventInstancesPanel({ eventId }: EventPanelProps) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();

	const instances = useQuery({
		queryKey: qk.events.instances(eventId),
		queryFn: () => callList(client.service.events.getInstances(eventId)),
	});

	const destroy = useMutation({
		mutationFn: (instanceId: string) => call(client.service.instances.destroy(instanceId), "销毁结果"),
		onSuccess: () => {
			toast.success("实例已销毁");
			void queryClient.invalidateQueries({ queryKey: qk.events.instances(eventId) });
			void queryClient.invalidateQueries({ queryKey: qk.instances.all });
		},
		onError: (error) => toast.error("销毁实例失败", errorText(error)),
	});

	const rows: EventInstanceResult[] = instances.data?.items ?? [];

	const columns: Column<EventInstanceResult>[] = [
		{
			key: "challenge",
			header: "题目",
			render: (row) => <span className="xz-jeo-board__name">{row.challenge_name}</span>,
		},
		{
			key: "identifier",
			header: "实例标识",
			render: (row) => <code className="xz-code xz-mono xz-xs">{row.instance.identifier}</code>,
		},
		{
			key: "owner",
			header: "归属",
			render: (row) => row.user_nickname || <span className="xz-muted">—</span>,
		},
		{
			key: "status",
			header: "状态",
			render: (row) => (
				<Badge tone={row.instance.status === "running" ? "ok" : "neutral"}>{row.instance.status}</Badge>
			),
		},
		{
			key: "created_at",
			header: "创建时间",
			render: (row) => (
				<span className="xz-muted xz-xs">{formatDateTime(row.instance.created_at)}</span>
			),
		},
		{
			key: "destroy_at",
			header: "自动销毁",
			render: (row) => <InstanceCountdown destroyAt={row.instance.destroy_at} />,
		},
		{
			key: "actions",
			header: "操作",
			align: "right",
			render: (row) => (
				<Button
					variant="danger-ghost"
					size="sm"
					icon="trash"
					loading={destroy.isPending && destroy.variables === row.instance.id}
					onClick={async () => {
						const ok = await confirm({
							title: "销毁该实例？",
							description: `将销毁「${row.challenge_name}」的实例 ${row.instance.identifier}。`,
							consequences:
								"容器会被停止并移除，实例内的临时文件、进程与已获取的线索全部丢失且无法恢复；如需继续解题必须重新启动实例。",
							tone: "danger",
							confirmText: "销毁实例",
						});
						if (ok) destroy.mutate(row.instance.id);
					}}
				>
					销毁
				</Button>
			),
		},
	];

	return (
		<Card>
			<CardHead
				title="赛事实例"
				icon="box"
				sub={instances.isSuccess ? `${rows.length} 个运行中实例` : undefined}
				actions={<IconButton icon="refresh" label="刷新实例列表" onClick={() => void instances.refetch()} />}
			/>
			<CardBody flush>
				<QueryBoundary
					isPending={instances.isPending}
					isError={instances.isError}
					error={instances.error}
					refetch={() => void instances.refetch()}
					loadingLabel="正在加载赛事实例…"
				>
					{rows.length === 0 ? (
						<EmptyState
							icon="box"
							title="本赛事还没有实例"
							desc="在「题目」标签里启动实例后，它会出现在这里。"
						/>
					) : (
						<>
							<div className="xz-jeo-instnote">
								<KeyValue
									items={[
										{
											k: "说明",
											v: "实例标识是平台生成的唯一 ID（不是容器名）；销毁不可恢复。",
										},
									]}
								/>
							</div>
							<DataTable
								columns={columns}
								rows={rows}
								rowKey={(row) => row.instance.id}
								compact
							/>
						</>
					)}
				</QueryBoundary>
			</CardBody>
		</Card>
	);
}
