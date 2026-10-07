/**
 * 选手总览（`/`）—— 进入平台后的第一屏：
 * 我的赛事、平台公告、告警（未报名但可加入的进行中赛事）、运行中的实例、最近动态。
 *
 * 全部数据来自真实接口；没有数据的区块显示空态，**不用占位数据填充**。
 */

import { useQuery } from "@tanstack/react-query";
import type { SolveResult, TopUser } from "@floatctf/sdk";

import { callList } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { qk } from "../../api/keys.ts";
import { useAuth } from "../../auth/store.ts";
import { formatDateTime, formatRelative } from "../../lib/format.ts";
import { Link } from "../../router/Link.tsx";
import { useDocumentTitle } from "../../router/router.tsx";
import { Icon } from "../../ui/icons.tsx";
import { QueryBoundary } from "../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	EmptyState,
	Stat,
} from "../../ui/primitives.tsx";
import { EventCard } from "../events/EventCard.tsx";
import { eventPhase } from "../events/status.ts";

/** Top15 榜单条目：字段来自 `TopUser`（`no` / `nickname` / `solved_count` / `solved_last_at`）。 */
function RankRow({ entry, me }: { entry: TopUser; me: string | null }) {
	const isMe = Boolean(me && entry.nickname === me);
	return (
		<div className="xz-list__row" style={isMe ? { background: "var(--xz-gold-a16)" } : undefined}>
			<span className="xz-board__rank" data-top={entry.no}>
				#{entry.no}
			</span>
			<div className="xz-list__main">
				<div className="xz-list__title">{entry.nickname || "（匿名）"}</div>
				<div className="xz-list__meta">
					<span>最近解出 {formatRelative(entry.solved_last_at)}</span>
				</div>
			</div>
			<span className="xz-board__score" title="解出题数">
				{entry.solved_count}
			</span>
		</div>
	);
}

export function PlayerDashboardPage() {
	useDocumentTitle("总览");
	const client = useClient();
	const { me } = useAuth();

	const events = useQuery({
		queryKey: qk.events.list(),
		queryFn: () => callList(client.service.events.fetch()),
	});

	const announcements = useQuery({
		queryKey: qk.announcements.list({ page: 1, limit: 5 }),
		queryFn: () => callList(client.service.announcements.fetch({ page: 1, limit: 5 })),
	});

	const instances = useQuery({
		queryKey: qk.instances.list({ page: 1, limit: 5 }),
		queryFn: () => callList(client.service.instances.fetch({ page: 1, limit: 5 })),
	});

	const solves = useQuery({
		queryKey: qk.solves.list({ page: 1, limit: 5 }),
		queryFn: () => callList(client.service.solves.fetch({ page: 1, limit: 5 })),
	});

	const top = useQuery({
		queryKey: qk.solves.top15,
		queryFn: () => callList<TopUser>(client.service.solves.getTop15Users()),
	});

	const eventItems = events.data?.items ?? [];
	const joined = eventItems.filter((item) => item.joined);
	const running = joined.filter((item) => eventPhase(item.event) === "running");
	const openNotJoined = eventItems.filter(
		(item) => !item.joined && eventPhase(item.event) === "running" && item.event.allow_join,
	);
	const announcementTotal = announcements.data?.meta?.total ?? announcements.data?.items.length ?? 0;

	return (
		<div className="xz-page">
			<header className="xz-page__head">
				<div>
					<h1 className="xz-page__title">
						训练场
						{me ? (
							<span className="xz-muted xz-serif" style={{ fontSize: 16, fontWeight: 400 }}>
								· {me.nickname || me.username}
							</span>
						) : null}
					</h1>
					<p className="xz-page__desc">
						这里汇总你正在参加的赛事、平台公告与运行中的靶场实例。赛事相关能力（解题 / 攻防 /
						演练）都在各自赛事的驾驶舱内。
					</p>
				</div>
				<div className="xz-page__actions">
					<Link to="/events">
						<Button variant="primary" icon="flag">
							浏览赛事
						</Button>
					</Link>
					<Link to="/challenges">
						<Button icon="puzzle">题库</Button>
					</Link>
				</div>
			</header>

			{openNotJoined.length > 0 ? (
				<div style={{ marginBottom: 20 }}>
					<Banner
						tone="warn"
						title={`有 ${openNotJoined.length} 场已开始的赛事你还没有报名`}
						actions={
							<Link to={`/events/${openNotJoined[0]?.event.id ?? ""}`}>
								<Button size="sm" variant="primary">
									去报名
								</Button>
							</Link>
						}
					>
						{openNotJoined.map((item) => item.event.title).join("、")}
					</Banner>
				</div>
			) : null}

			<div className="xz-grid xz-grid--4" style={{ marginBottom: 24 }}>
				<Stat
					label="报名赛事"
					icon="flag"
					value={events.isSuccess ? joined.length : "—"}
					foot={events.isSuccess ? `共 ${eventItems.length} 场可见` : "加载中"}
				/>
				<Stat
					label="进行中"
					icon="bolt"
					value={events.isSuccess ? running.length : "—"}
					foot="已报名且未结束"
				/>
				<Stat
					label="运行中的实例"
					icon="box"
					value={instances.isSuccess ? (instances.data?.items.length ?? 0) : "—"}
					foot={instances.isSuccess ? `共 ${instances.data?.meta?.total ?? 0} 个` : "加载中"}
				/>
				<Stat
					label="平台公告"
					icon="bell"
					value={announcements.isSuccess ? announcementTotal : "—"}
					foot="全站累计"
				/>
			</div>

			<section className="xz-section">
				<div className="xz-section__head">
					<h2 className="xz-section__title">我的赛事</h2>
					<Link to="/events" className="xz-xs" style={{ marginLeft: "auto" }}>
						全部赛事 →
					</Link>
				</div>
				<QueryBoundary
					isPending={events.isPending}
					isError={events.isError}
					error={events.error}
					refetch={() => void events.refetch()}
				>
					{joined.length === 0 ? (
						<Card flat>
							<EmptyState
								icon="flag"
								title="还没有报名任何赛事"
								desc="前往赛事列表，选择一场比赛加入后即可在这里快速进入。"
								actions={
									<Link to="/events">
										<Button variant="primary" icon="flag">
											浏览赛事
										</Button>
									</Link>
								}
							/>
						</Card>
					) : (
						<div className="xz-grid xz-grid--3">
							{joined.slice(0, 6).map((item) => (
								<EventCard key={item.event.id} info={item} />
							))}
						</div>
					)}
				</QueryBoundary>
			</section>

			<div className="xz-grid xz-grid--2">
				<Card>
					<CardHead
						title="平台公告"
						icon="bell"
						actions={
							<Link to="/community/announcements" className="xz-xs">
								更多 →
							</Link>
						}
					/>
					<CardBody flush>
						<QueryBoundary
							isPending={announcements.isPending}
							isError={announcements.isError}
							error={announcements.error}
							refetch={() => void announcements.refetch()}
						>
							{(announcements.data?.items.length ?? 0) === 0 ? (
								<EmptyState icon="bell" title="暂无公告" />
							) : (
								<div className="xz-list">
									{announcements.data?.items.map((item) => (
										<Link key={item.id} to="/community/announcements" className="xz-list__row">
											<div className="xz-list__main">
												<div className="xz-list__title xz-truncate">{item.title}</div>
												<div className="xz-list__meta">
													<span>{formatDateTime(item.created_at)}</span>
												</div>
											</div>
											<Icon name="chevronRight" size={15} />
										</Link>
									))}
								</div>
							)}
						</QueryBoundary>
					</CardBody>
				</Card>

				<Card>
					<CardHead
						title="最近解出"
						icon="bolt"
						actions={
							<Link to="/community/solves" className="xz-xs">
								全部流水 →
							</Link>
						}
					/>
					<CardBody flush>
						<QueryBoundary
							isPending={solves.isPending}
							isError={solves.isError}
							error={solves.error}
							refetch={() => void solves.refetch()}
						>
							{(solves.data?.items.length ?? 0) === 0 ? (
								<EmptyState icon="bolt" title="还没有解出记录" />
							) : (
								<div className="xz-list">
									{solves.data?.items.map((item: SolveResult) => (
										<div key={item.id} className="xz-list__row">
											<div className="xz-list__main">
												<div className="xz-list__title xz-truncate">{item.challenge_name}</div>
												<div className="xz-list__meta">
													<span>{item.nickname || "（匿名）"}</span>
													<span>{formatRelative(item.created_at)}</span>
												</div>
											</div>
											<Badge tone="ok" icon="check">
												+{item.obtained_points + item.bonus_points}
											</Badge>
										</div>
									))}
								</div>
							)}
						</QueryBoundary>
					</CardBody>
				</Card>

				<Card>
					<CardHead
						title="我的实例"
						icon="box"
						actions={
							<Link to="/instances" className="xz-xs">
								管理实例 →
							</Link>
						}
					/>
					<CardBody flush>
						<QueryBoundary
							isPending={instances.isPending}
							isError={instances.isError}
							error={instances.error}
							refetch={() => void instances.refetch()}
						>
							{(instances.data?.items.length ?? 0) === 0 ? (
								<EmptyState
									icon="box"
									title="没有运行中的实例"
									desc="在题目详情中启动实例后会显示在这里。"
								/>
							) : (
								<div className="xz-list">
									{instances.data?.items.map((item) => (
										<div key={item.id} className="xz-list__row">
											<div className="xz-list__main">
												<div className="xz-list__title xz-truncate">
													{item.challenge_title || item.gamebox_title || "（实例）"}
												</div>
												<div className="xz-list__meta">
													<span>{item.status}</span>
													<span>{item.event_title || "（无赛事）"}</span>
													<span>{formatRelative(item.created_at)}</span>
												</div>
											</div>
											<Link to="/instances">
												<Button size="sm">管理</Button>
											</Link>
										</div>
									))}
								</div>
							)}
						</QueryBoundary>
					</CardBody>
				</Card>

				<Card>
					<CardHead
						title="Top15"
						icon="crown"
						actions={
							<Link to="/community/top" className="xz-xs">
								完整榜单 →
							</Link>
						}
					/>
					<CardBody flush>
						<QueryBoundary
							isPending={top.isPending}
							isError={top.isError}
							error={top.error}
							refetch={() => void top.refetch()}
						>
							{(top.data?.items.length ?? 0) === 0 ? (
								<EmptyState icon="crown" title="榜单暂时为空" />
							) : (
								<div className="xz-list">
									{top.data?.items.slice(0, 5).map((entry) => (
										<RankRow key={`${entry.no}-${entry.nickname}`} entry={entry} me={me?.nickname ?? null} />
									))}
								</div>
							)}
						</QueryBoundary>
					</CardBody>
				</Card>
			</div>
		</div>
	);
}
