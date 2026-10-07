/**
 * 赛事控制台 · `data` 标签 —— 赛事数据大屏。
 *
 * `client.admin.events.getData(id)` → `DataPresent`（**仅 Jeopardy 语义**：
 * 题目解出率 / Top10 / 最近解出 / 得分趋势）。
 * 标签只在 `family === "jeopardy"` 时可见（由控制台决定）。
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { call } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime, formatNumber } from "../../../lib/format.ts";
import { QueryBoundary } from "../../../ui/overlays.tsx";
import { Badge, Card, CardBody, CardHead, EmptyState, Stat } from "../../../ui/primitives.tsx";
import { DataTable } from "../../../ui/Table.tsx";

export function EventDataTab({ eventId }: { eventId: string }) {
	const client = useClient();
	const data = useQuery({
		queryKey: qk.admin.eventData(eventId),
		queryFn: () => call(client.admin.events.getData(eventId), "赛事数据"),
		enabled: eventId.length > 0,
	});

	const present = data.data;

	const solvedTotal = useMemo(
		() => (present?.event_challenges ?? []).reduce((sum, entry) => sum + entry.solved_count, 0),
		[present],
	);
	const maxTrendScore = useMemo(() => {
		let max = 0;
		for (const item of present?.trend ?? []) {
			for (const point of item.points) if (point.score > max) max = point.score;
		}
		return max;
	}, [present]);

	return (
		<div className="xz-aev-col">
			<QueryBoundary
				isPending={data.isPending}
				isError={data.isError}
				error={data.error}
				refetch={() => void data.refetch()}
				loadingLabel="正在汇总赛事数据…"
			>
				{present ? (
					<>
						<div className="xz-aev-stats">
							<Stat label="参赛用户" value={formatNumber(present.user_count)} icon="users" />
							<Stat label="战队数" value={formatNumber(present.team_count)} icon="shield" />
							<Stat label="赛事题目" value={formatNumber(present.event_challenges.length)} icon="puzzle" />
							<Stat label="累计解出" value={formatNumber(solvedTotal)} icon="check" gold />
						</div>

						<Card>
							<CardHead title="题目解出情况" icon="chart" sub="按后端返回的 solved_percent 展示" />
							<CardBody>
								{present.event_challenges.length === 0 ? (
									<EmptyState icon="puzzle" title="本赛事还没有挂题" />
								) : (
									<div className="xz-aev-bars">
										{present.event_challenges.map((entry) => (
											<div key={`${entry.category}-${entry.name}`} className="xz-aev-bars__row">
												<div className="xz-truncate" title={`${entry.name}（${entry.category}）`}>
													{entry.name}
												</div>
												<div className="xz-aev-bars__track">
													<div
														className={[
															"xz-aev-bars__fill",
															entry.solved_percent >= 100 ? "xz-aev-bars__fill--gold" : null,
														]
															.filter(Boolean)
															.join(" ")}
														style={{ width: `${Math.max(0, Math.min(100, entry.solved_percent))}%` }}
													/>
												</div>
												<div className="xz-aev-bars__num">
													{entry.solved_count} 队 · {Math.round(entry.solved_percent)}%
												</div>
											</div>
										))}
									</div>
								)}
							</CardBody>
						</Card>

						<div className="xz-aev-grid2">
							<Card>
								<CardHead title="Top 10" icon="trophy" />
								<CardBody flush>
									<DataTable
										compact
										rows={present.scoreboard_top10}
										rowKey={(row) => row.id}
										empty={<div className="xz-aev-emptyline">暂无榜单数据。</div>}
										columns={[
											{
												key: "rank",
												header: "#",
												width: 46,
												render: (row) => <span className="xz-aev-score">{row.no}</span>,
											},
											{ key: "name", header: "选手 / 队伍", render: (row) => row.name },
											{
												key: "solved",
												header: "解出",
												numeric: true,
												render: (row) => row.solved_count,
											},
											{
												key: "score",
												header: "得分",
												numeric: true,
												render: (row) => <span className="xz-aev-score">{row.score}</span>,
											},
										]}
									/>
								</CardBody>
							</Card>

							<Card>
								<CardHead title="最近解出" icon="bolt" sub="后端返回的最近 15 条流水" />
								<CardBody>
									{present.solved_recent_15.length === 0 ? (
										<div className="xz-aev-emptyline">还没有解出记录。</div>
									) : (
										<div className="xz-feed">
											{present.solved_recent_15.map((entry, index) => (
												<div key={`${entry.user_nickname}-${entry.created_at}-${index}`} className="xz-feed__item" data-kind="defense">
													<span>
														<strong>{entry.user_nickname}</strong> 解出 {entry.challenge_name}
													</span>
													{entry.bonus_points > 0 ? <Badge tone="gold">+{entry.bonus_points}</Badge> : null}
													<span className="xz-feed__time">{formatDateTime(entry.created_at)}</span>
												</div>
											))}
										</div>
									)}
								</CardBody>
							</Card>
						</div>

						<Card>
							<CardHead title="得分趋势" icon="trendUp" sub={`采样上限 ${maxTrendScore} 分`} />
							<CardBody>
								{present.trend.length === 0 ? (
									<div className="xz-aev-emptyline">暂无趋势数据。</div>
								) : (
									<DataTable
										compact
										rows={present.trend}
										rowKey={(item) => item.name}
										columns={[
											{ key: "name", header: "选手 / 队伍", render: (item) => item.name },
											{
												key: "latest",
												header: "最新得分",
												numeric: true,
												render: (item) => (
													<span className="xz-aev-score">
														{item.points.length > 0 ? item.points[item.points.length - 1]?.score : "—"}
													</span>
												),
											},
											{
												key: "samples",
												header: "采样点",
												numeric: true,
												render: (item) => item.points.length,
											},
											{
												key: "span",
												header: "时间范围",
												render: (item) => (
													<span className="xz-muted xz-xs">
														{item.points.length > 0
															? `${formatDateTime(item.points[0]?.time)} → ${formatDateTime(
																	item.points[item.points.length - 1]?.time,
																)}`
															: "—"}
													</span>
												),
											},
											{
												key: "bar",
												header: "相对水平",
												render: (item) => {
													const latest = item.points.length > 0 ? (item.points[item.points.length - 1]?.score ?? 0) : 0;
													const percent = maxTrendScore > 0 ? (latest / maxTrendScore) * 100 : 0;
													return (
														<div className="xz-aev-bars__track" style={{ minWidth: 120 }}>
															<div className="xz-aev-bars__fill" style={{ width: `${percent}%` }} />
														</div>
													);
												},
											},
										]}
									/>
								)}
							</CardBody>
						</Card>
					</>
				) : null}
			</QueryBoundary>
		</div>
	);
}
