/**
 * 选手工作区 · 赛事。
 *
 * - `/events`：赛事目录（搜索 / 赛制 / 状态 / 仅我报名）
 * - `/events/:id`：**赛事驾驶舱** —— 该赛事的全部能力都收在这一页的标签里，
 *   `?tab=` 记录当前标签，可深链、可刷新（平台承诺 SPA fallback）。
 *
 * 加入语义严格跟随后端（`player_service.rs`）：
 * - `purpose=competition` + `system_key` 为空 + `individual` + `allow_join` + **未开始** 才允许 join/leave；
 * - 团队赛**不能**直接 join，必须走建队 / 入队；队长不能退队。
 */

import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EventInfo } from "@floatctf/sdk";
import type { Events } from "@floatctf/sdk/entity";

import { call, callList } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { errorText } from "../../api/errors.ts";
import { qk } from "../../api/keys.ts";
import { useAuth } from "../../auth/store.ts";
import { formatCountdown, formatDateTime, matches } from "../../lib/format.ts";
import { useDebounced, useNow } from "../../lib/hooks.ts";
import { Link } from "../../router/Link.tsx";
import type { PageDef, PageProps } from "../../router/pages.ts";
import { useDocumentTitle, useSearchParam } from "../../router/router.tsx";
import { Icon } from "../../ui/icons.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	EmptyState,
	ErrorState,
	Field,
	KeyValue,
	Segmented,
	Select,
	TextInput,
} from "../../ui/primitives.tsx";
import { AwdArenaPanel } from "../awd/panels.tsx";
import { AwdpDrillPanel } from "../awdp/panels.tsx";
import {
	EventAnnouncementsPanel,
	EventChallengesPanel,
	EventInstancesPanel,
	EventScoreboardPanel,
	EventTrendPanel,
} from "../jeopardy/panels.tsx";
import { EventCard } from "./EventCard.tsx";
import {
	EVENT_PHASE_LABEL,
	EVENT_PHASE_TONE,
	eventPhase,
	familyLabel,
	participantLabel,
} from "./status.ts";

/* ── 赛事目录 ─────────────────────────────────────────────────────── */

export function EventListPage() {
	useDocumentTitle("赛事");
	const client = useClient();
	const [search, setSearch] = useState("");
	const [family, setFamily] = useState("all");
	const [phase, setPhase] = useState("all");
	const [joinedOnly, setJoinedOnly] = useState(false);
	const debounced = useDebounced(search);

	const events = useQuery({
		queryKey: qk.events.list(),
		queryFn: () => callList(client.service.events.fetch()),
	});

	const items = events.data?.items ?? [];
	const filtered = useMemo(
		() =>
			items.filter((item) => {
				if (!matches([item.event.title, item.event.description, item.event.family], debounced)) return false;
				if (family !== "all" && item.event.family !== family) return false;
				if (phase !== "all" && eventPhase(item.event) !== phase) return false;
				if (joinedOnly && !item.joined) return false;
				return true;
			}),
		[items, debounced, family, phase, joinedOnly],
	);

	return (
		<div className="xz-page">
			<header className="xz-page__head">
				<div>
					<h1 className="xz-page__title">赛事</h1>
					<p className="xz-page__desc">
						进入任意赛事即可打开它的驾驶舱：解题赛显示题目矩阵，AWD 显示靶场与实时积分，
						AWDP 显示演练工作台。报名与退出只在赛事开始前可用。
					</p>
				</div>
			</header>

			<div className="xz-filters">
				<span className="xz-search">
					<span className="xz-search__icon">
						<Icon name="search" size={14} />
					</span>
					<input
						className="xz-input"
						data-page-search
						placeholder="搜索赛事名称 / 简介"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</span>
				<Select value={family} onChange={(event) => setFamily(event.target.value)} aria-label="赛制">
					<option value="all">全部赛制</option>
					<option value="jeopardy">解题赛</option>
					<option value="awd">AWD</option>
					<option value="awdp">AWDP</option>
				</Select>
				<Segmented
					ariaLabel="赛事状态"
					value={phase}
					onChange={setPhase}
					options={[
						{ value: "all", label: "全部" },
						{ value: "running", label: "进行中" },
						{ value: "upcoming", label: "未开始" },
						{ value: "ended", label: "已结束" },
					]}
				/>
				<label className="xz-checkbox">
					<input type="checkbox" checked={joinedOnly} onChange={(event) => setJoinedOnly(event.target.checked)} />
					只看我报名的
				</label>
				<span className="xz-muted xz-xs" style={{ marginLeft: "auto" }}>
					{events.isSuccess ? `${filtered.length} / ${items.length} 场` : ""}
				</span>
			</div>

			<QueryBoundary
				isPending={events.isPending}
				isError={events.isError}
				error={events.error}
				refetch={() => void events.refetch()}
				loadingLabel="正在加载赛事列表…"
			>
				{filtered.length === 0 ? (
					<Card flat>
						<EmptyState
							icon="flag"
							title={items.length === 0 ? "当前没有可见的赛事" : "没有符合条件的赛事"}
							desc={
								items.length === 0
									? "管理员创建并公开赛事后会显示在这里。"
									: "试着放宽筛选条件。"
							}
						/>
					</Card>
				) : (
					<div className="xz-grid xz-grid--3">
						{filtered.map((item) => (
							<EventCard key={item.event.id} info={item} />
						))}
					</div>
				)}
			</QueryBoundary>
		</div>
	);
}

/* ── 驾驶舱：报名 / 战队 ──────────────────────────────────────────── */

function RosterCard({ info }: { info: EventInfo }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const { me } = useAuth();
	const [teamName, setTeamName] = useState("");
	const [teamId, setTeamId] = useState("");

	const event = info.event;
	const phase = eventPhase(event);
	const canMutate = phase === "upcoming" && event.allow_join;
	const team = info.team_result;
	const isCaptain = Boolean(
		me && team?.members.some((member) => member.member.user_id === me.id && member.member.role === "captain"),
	);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.events.all });
		void queryClient.invalidateQueries({ queryKey: qk.instances.all });
	};

	const join = useMutation({
		mutationFn: () => call(client.service.events.join(event.id), "报名结果"),
		onSuccess: () => {
			toast.success("已报名", `你已加入「${event.title}」。`);
			invalidate();
		},
		onError: (error) => toast.error("报名失败", errorText(error)),
	});

	const leave = useMutation({
		mutationFn: () => call(client.service.events.leave(event.id), "退出结果"),
		onSuccess: () => {
			toast.success("已退出赛事");
			invalidate();
		},
		onError: (error) => toast.error("退出失败", errorText(error)),
	});

	const createTeam = useMutation({
		mutationFn: () => call(client.service.events.createTeam({ event_id: event.id, name: teamName }), "建队结果"),
		onSuccess: () => {
			toast.success("战队已创建", "你是队长，其他成员可用战队 ID 加入。");
			setTeamName("");
			invalidate();
		},
		onError: (error) => toast.error("创建战队失败", errorText(error)),
	});

	const joinTeam = useMutation({
		mutationFn: () => call(client.service.events.joinTeam({ event_id: event.id, team_id: teamId }), "入队结果"),
		onSuccess: () => {
			toast.success("已加入战队");
			setTeamId("");
			invalidate();
		},
		onError: (error) => toast.error("加入战队失败", errorText(error)),
	});

	const quitTeam = useMutation({
		mutationFn: () => call(client.service.events.quitTeam({ event_id: event.id, team_id: team?.team.id ?? "" }), "退队结果"),
		onSuccess: () => {
			toast.success("已退出战队");
			invalidate();
		},
		onError: (error) => toast.error("退出战队失败", errorText(error)),
	});

	const busy = join.isPending || leave.isPending || createTeam.isPending || joinTeam.isPending || quitTeam.isPending;

	return (
		<Card>
			<CardHead title="参赛资格" icon="users" sub={participantLabel(event.participant_mode)} />
			<CardBody>
				<KeyValue
					items={[
						{
							k: "状态",
							v: (
								<Badge tone={EVENT_PHASE_TONE[phase]}>{EVENT_PHASE_LABEL[phase]}</Badge>
							),
						},
						{ k: "报名", v: event.allow_join ? "开放" : "已锁定" },
						{ k: "我的报名", v: info.joined ? <Badge tone="ok" icon="check">已报名</Badge> : <Badge tone="crimson">未报名</Badge> },
						{ k: "赛制", v: familyLabel(event.family) },
						{ k: "开始", v: formatDateTime(event.start_time) },
						{ k: "结束", v: event.end_time ? formatDateTime(event.end_time) : "长期开放" },
					]}
				/>

				{!canMutate ? (
					<div style={{ marginTop: 14 }}>
						<Banner tone="info">
							{phase === "upcoming"
								? "该赛事已锁定报名（allow_join=false），如需调整请联系管理员。"
								: "报名与退队只在赛事开始前可用；赛事进行中或已结束后不可变更参赛名单。"}
						</Banner>
					</div>
				) : null}

				{event.participant_mode === "individual" ? (
					<div className="xz-row" style={{ marginTop: 14, gap: 8 }}>
						{info.joined ? (
							<Button
								variant="danger-ghost"
								icon="logout"
								disabled={!canMutate || busy}
								onClick={async () => {
									const ok = await confirm({
										title: "退出赛事？",
										description: `将退出「${event.title}」。`,
										consequences: "退出后你的解题与积分记录仍会保留，但需要重新报名才能继续参赛。",
										tone: "danger",
										confirmText: "退出赛事",
									});
									if (ok) leave.mutate();
								}}
							>
								退出赛事
							</Button>
						) : (
							<Button
								variant="primary"
								icon="check"
								loading={join.isPending}
								disabled={!canMutate || busy}
								onClick={() => join.mutate()}
							>
								报名参赛
							</Button>
						)}
					</div>
				) : team ? (
					<div className="xz-col" style={{ marginTop: 14, gap: 10 }}>
						<div className="xz-row" style={{ gap: 8, flexWrap: "wrap" }}>
							<Badge tone="gold" icon="users">
								{team.team.name}
							</Badge>
							{team.team.banned ? <Badge tone="danger">已封禁</Badge> : null}
							{isCaptain ? <Badge tone="crimson">我是队长</Badge> : null}
						</div>
						<div className="xz-muted xz-xs xz-mono">战队 ID：{team.team.id}</div>
						<div className="xz-tablewrap">
							<table className="xz-table xz-table--compact">
								<thead>
									<tr>
										<th>成员</th>
										<th>角色</th>
										<th>加入时间</th>
									</tr>
								</thead>
								<tbody>
									{team.members.map((member) => (
										<tr key={member.member.user_id}>
											<td>{member.member_name}</td>
											<td>{member.member.role === "captain" ? "队长" : "成员"}</td>
											<td className="xz-muted xz-xs">{formatDateTime(member.member.joined_at)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<Button
							variant="danger-ghost"
							icon="logout"
							disabled={!canMutate || busy}
							onClick={async () => {
								const ok = await confirm({
									title: "退出战队？",
									description: `将退出「${team.team.name}」。`,
									consequences: isCaptain
										? "队长不能直接退队；如果后端判定你是队长，该操作会被拒绝，请先解散队伍。"
										: "退出后需要重新加入或创建战队才能继续参赛。",
									tone: "danger",
									confirmText: "退出战队",
								});
								if (ok) quitTeam.mutate();
							}}
						>
							退出战队
						</Button>
					</div>
				) : (
					<form
						className="xz-col"
						style={{ marginTop: 14, gap: 12 }}
						onSubmit={(submitEvent: FormEvent) => {
							submitEvent.preventDefault();
							createTeam.mutate();
						}}
					>
						<p className="xz-muted xz-xs" style={{ margin: 0 }}>
							这是团队赛：必须先创建战队或加入已有战队才能参赛（直接报名会被后端拒绝）。
						</p>
						<Field label="创建战队" hint="队名在本赛事内唯一。">
							{(props) => (
								<TextInput
									{...props}
									value={teamName}
									placeholder="输入队名"
									disabled={!canMutate || busy}
									onChange={(inputEvent) => setTeamName(inputEvent.target.value)}
								/>
							)}
						</Field>
						<Button
							type="submit"
							variant="primary"
							icon="plus"
							loading={createTeam.isPending}
							disabled={!canMutate || busy || teamName.trim().length === 0}
						>
							创建战队
						</Button>
						<div className="xz-muted xz-xs" style={{ textAlign: "center" }}>
							或者
						</div>
						<Field label="加入已有战队" hint="向队长索取战队 ID。">
							{(props) => (
								<TextInput
									{...props}
									value={teamId}
									placeholder="粘贴战队 ID"
									className="xz-input--mono"
									disabled={!canMutate || busy}
									onChange={(inputEvent) => setTeamId(inputEvent.target.value)}
								/>
							)}
						</Field>
						<Button
							icon="login"
							loading={joinTeam.isPending}
							disabled={!canMutate || busy || teamId.trim().length === 0}
							onClick={() => joinTeam.mutate()}
						>
							加入战队
						</Button>
					</form>
				)}
			</CardBody>
		</Card>
	);
}

function OverviewPanel({ info }: { info: EventInfo }) {
	const event = info.event;
	return (
		<div className="xz-grid xz-grid--2">
			<Card>
				<CardHead title="赛事说明" icon="info" />
				<CardBody>
					{event.description ? (
						<p className="xz-break">{event.description}</p>
					) : (
						<p className="xz-muted">管理员未填写赛事简介。</p>
					)}
					{event.rules ? (
						<>
							<h3 className="xz-section__title" style={{ marginTop: 18, fontSize: 15 }}>
								规则
							</h3>
							<p className="xz-break" style={{ whiteSpace: "pre-wrap" }}>
								{event.rules}
							</p>
						</>
					) : null}
				</CardBody>
			</Card>
			<div className="xz-col" style={{ gap: 16 }}>
				<Card>
					<CardHead title="赛事信息" icon="calendar" />
					<CardBody>
						<KeyValue
							items={[
								{ k: "赛制", v: familyLabel(event.family) },
								{
									k: "用途",
									v: event.purpose === "practice" ? "练习" : "正式比赛",
								},
								{ k: "参赛方式", v: participantLabel(event.participant_mode) },
								{ k: "开始", v: formatDateTime(event.start_time) },
								{ k: "结束", v: event.end_time ? formatDateTime(event.end_time) : "未设置" },
								{ k: "flag 前缀", v: event.flag_prefix ? <code className="xz-code">{event.flag_prefix}</code> : "—" },
								{ k: "报名锁定", v: event.allow_join ? "未锁定" : "已锁定" },
							]}
						/>
					</CardBody>
				</Card>
				{info.team_result ? (
					<Card>
						<CardHead title="我的战队" icon="users" />
						<CardBody>
							<KeyValue
								items={[
									{ k: "队名", v: info.team_result.team.name },
									{ k: "队内积分", v: info.team_result.team.points },
									{
										k: "成员",
										v: info.team_result.members.map((member) => member.member_name).join("、") || "—",
									},
								]}
							/>
						</CardBody>
					</Card>
				) : null}
			</div>
		</div>
	);
}

/* ── 驾驶舱：标签 ─────────────────────────────────────────────────── */

interface TabDef {
	key: string;
	label: string;
	icon: string;
	render: (info: EventInfo) => ReactNode;
}

/**
 * `client.service.events.get(id)` 的响应形状守卫。
 *
 * DTO 契约是 `EventInfo = { id, event, team_result?, joined }`，其中 `event` 是必需的
 * 赛事实体。聚合页面在渲染前先验证形状：形状不对时给出**可见的错误态**并保留外壳，
 * 而不是让 `data.event.family` 在渲染期抛异常（那就是白屏 / 被错误边界整页接管）。
 */
function hasEventInfoShape(value: unknown): value is EventInfo {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.event === "object" &&
		record.event !== null &&
		typeof (record.event as { id?: unknown }).id === "string" &&
		typeof record.joined === "boolean"
	);
}

function tabsFor(family: string): TabDef[] {
	const tabs: TabDef[] = [
		{ key: "overview", label: "概览", icon: "info", render: (info) => <OverviewPanel info={info} /> },
	];
	if (family === "jeopardy") {
		tabs.push({
			key: "challenges",
			label: "题目",
			icon: "puzzle",
			render: (info) => <EventChallengesPanel eventId={info.event.id} mode={family} />,
		});
	}
	if (family === "awd") {
		tabs.push({
			key: "arena",
			label: "靶场",
			icon: "sword",
			render: (info) => <AwdArenaPanel eventId={info.event.id} mode={family} />,
		});
	}
	if (family === "awdp") {
		tabs.push({
			key: "drill",
			label: "演练",
			icon: "target",
			render: (info) => <AwdpDrillPanel eventId={info.event.id} mode={family} />,
		});
	}
	tabs.push({
		key: "announcements",
		label: "公告",
		icon: "bell",
		render: (info) => <EventAnnouncementsPanel eventId={info.event.id} mode={family} />,
	});

	// 榜单 / 趋势 / 实例这三个标签走的是**通用赛事子资源**
	// （`/events/{id}/scoreboard`、`/trend`、`/instances`），后端只在 Jeopardy 家族开放：
	// 其它家族会以 `UnsupportedForFamily` 拒绝（`event/jeopardy/domain/policy.rs:37-44`、
	// `event/jeopardy/application/trend.rs:18`、`.../instance.rs:173`）。
	// 因此**按赛制门控**，否则 AWD / AWDP 赛事下会渲染出三个必然报错的标签。
	// AWD 的积分榜在「靶场」标签内（`awd.player.scores`），
	// AWDP 的积分榜/趋势在「演练」标签内（`awdp.player.scoreboard` / `trend`）。
	if (family === "jeopardy") {
		tabs.push(
			{
				key: "scoreboard",
				label: "榜单",
				icon: "trophy",
				render: (info) => <EventScoreboardPanel eventId={info.event.id} mode={family} />,
			},
			{
				key: "trend",
				label: "趋势",
				icon: "trendUp",
				render: (info) => <EventTrendPanel eventId={info.event.id} mode={family} />,
			},
			{
				key: "instances",
				label: "实例",
				icon: "box",
				render: (info) => <EventInstancesPanel eventId={info.event.id} mode={family} />,
			},
		);
	}
	return tabs;
}

function Countdown({ event }: { event: Events }) {
	useNow(1000);
	const phase = eventPhase(event);
	if (phase === "running") {
		return (
			<div>
				<div className="xz-muted xz-xs">距离结束</div>
				<div className="xz-clock xz-clock--danger">
					{event.end_time ? formatCountdown(event.end_time) : "长期开放"}
				</div>
			</div>
		);
	}
	if (phase === "upcoming") {
		return (
			<div>
				<div className="xz-muted xz-xs">距离开始</div>
				<div className="xz-clock">{formatCountdown(event.start_time)}</div>
			</div>
		);
	}
	return (
		<div>
			<div className="xz-muted xz-xs">状态</div>
			<div className="xz-clock" style={{ color: "var(--xz-ink-3)" }}>
				已结束
			</div>
		</div>
	);
}

export function EventCockpitPage({ params }: PageProps) {
	const client = useClient();
	const eventId = params.id ?? "";
	const [tab, setTab] = useSearchParam("tab");

	const info = useQuery({
		queryKey: qk.events.detail(eventId),
		queryFn: () => call(client.service.events.get(eventId), "赛事详情"),
		enabled: eventId.length > 0,
	});

	// 注意：下面两行在 QueryBoundary **之前**执行，必须自己做安全取值 ——
	// 否则形状异常的响应会在渲染期抛异常，整页被错误边界接管（而不是显示本页的
	// 「赛事接口返回了非预期结构」提示）。
	const safeEvent = info.data && hasEventInfoShape(info.data) ? info.data.event : null;
	const family = safeEvent?.family ?? "jeopardy";
	const tabs = useMemo(() => tabsFor(family), [family]);
	const activeKey = tabs.some((entry) => entry.key === tab) ? (tab ?? "overview") : "overview";
	const activeTab = tabs.find((entry) => entry.key === activeKey);

	useDocumentTitle(safeEvent?.title ?? "赛事");

	if (!eventId) {
		return (
			<div className="xz-page">
				<EmptyState icon="alert" title="缺少赛事 ID" desc="地址中没有赛事标识，请从赛事列表进入。" />
			</div>
		);
	}

	return (
		<div className="xz-page xz-page--wide">
			<QueryBoundary
				isPending={info.isPending}
				isError={info.isError}
				error={info.error}
				refetch={() => void info.refetch()}
				loadingLabel="正在加载赛事…"
			>
				{info.data && !hasEventInfoShape(info.data) ? (
					// 接口成功但结构不符合预期（前后端版本漂移 / 网关返回了非平台响应）：
					// 这里是本前端的核心路由，必须在渲染前显式报错，而不是在
					// `data.event.family` 上抛异常（那样整页会被错误边界接管）。
					<ErrorState
						title="赛事接口返回了非预期结构"
						message="`GET /api/events/{id}` 的响应缺少 event / joined 字段，页面无法安全渲染"
						retryable
						onRetry={() => void info.refetch()}
					/>
				) : info.data ? (
					<>
						<header className="xz-page__head">
							<div className="xz-grow">
								<div className="xz-row" style={{ gap: 8, marginBottom: 6 }}>
									<Link to="/events" className="xz-muted xz-xs">
										← 赛事列表
									</Link>
									<Badge tone={EVENT_PHASE_TONE[eventPhase(info.data.event)]}>
										{EVENT_PHASE_LABEL[eventPhase(info.data.event)]}
									</Badge>
									<Badge tone="crimson">{familyLabel(info.data.event.family)}</Badge>
									<Badge>{participantLabel(info.data.event.participant_mode)}</Badge>
									{info.data.event.hidden ? <Badge tone="warn">隐藏</Badge> : null}
								</div>
								<h1 className="xz-page__title">{info.data.event.title}</h1>
								<p className="xz-page__desc">
									{formatDateTime(info.data.event.start_time)}
									{info.data.event.end_time ? ` → ${formatDateTime(info.data.event.end_time)}` : " 起长期开放"}
								</p>
							</div>
							<div className="xz-page__actions">
								<Countdown event={info.data.event} />
							</div>
						</header>

						{!info.data.joined && eventPhase(info.data.event) === "running" ? (
							<div style={{ marginBottom: 16 }}>
								<Banner tone="warn" title="你还没有报名这场赛事">
									赛事进行中，你可以继续答题/提交，但需要先报名（团队赛请先建队或入队）。
								</Banner>
							</div>
						) : null}

						<div className="xz-cockpit">
							<div className="xz-grow" style={{ minWidth: 0 }}>
								<div className="xz-tabs" role="tablist" aria-label="赛事能力">
									{tabs.map((entry) => (
										<button
											key={entry.key}
											type="button"
											role="tab"
											className="xz-tab"
											aria-selected={entry.key === activeKey}
											onClick={() => setTab(entry.key)}
										>
											<Icon name={entry.icon} size={15} />
											{entry.label}
										</button>
									))}
								</div>

								<div role="tabpanel" aria-label={activeTab?.label}>
									{activeTab ? activeTab.render(info.data) : null}
								</div>
							</div>

							<aside className="xz-col" style={{ gap: 16 }}>
								<RosterCard info={info.data} />
							</aside>
						</div>
					</>
				) : null}
			</QueryBoundary>
		</div>
	);
}

/* ── 路由 ─────────────────────────────────────────────────────────── */

export const eventPages: PageDef[] = [
	{ path: "/events", auth: "user", title: "赛事", render: () => <EventListPage /> },
	{
		path: "/events/:id",
		auth: "user",
		title: "赛事驾驶舱",
		wide: true,
		render: (props) => <EventCockpitPage {...props} />,
	},
];
