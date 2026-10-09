/**
 * AWD 数据大屏（kiosk）—— 选手端与管理端共用同一套展示层。
 *
 * 为什么需要它：平台的 AWD 能力矩阵里 required 的只有「积分榜」，
 * `AwdArenaPanel` 已经把积分榜做在赛事详情的「靶场」标签里；但赛场投屏需要的
 * **全屏、无交互、大字号、实时**视图此前三个前端都没有。本文件补这一块。
 *
 * 数据来源（全部来自平台，无任何假数据）：
 * - 赛事状态：`client.awd.player.status` / `client.admin.awd.getStatus`（phase / current_round / round_count / banned / score）
 * - 积分榜：`client.awd.player.scores` / `client.admin.awd.scores`（attack/defense/total/rank）
 * - 实时流水：选手端 `useAwdRealtime`（`useAwdEventStream`）、管理端 `useAdminAwdEventStream`；
 *   SSE 事件只作为「失效信号 + 流水展示」，真实数值永远来自上面的 REST 查询。
 * - 选手端额外显示 GameBox 健康统计（`client.awd.player.gameboxes`）。
 *
 * 只读：本页不做任何 mutation，不需要二次确认，也不暴露 token。
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AwdScoreRow } from "@floatctf/sdk";

import { useBindings, useClient } from "../../api/client.ts";
import { call } from "../../api/call.ts";
import { qk } from "../../api/keys.ts";
import { QueryBoundary } from "../../ui/overlays.tsx";
import { LIFECYCLE_LABEL, PHASE_LABEL, describeAwdEvent } from "./events.ts";
import { awdStreamStateMeta, useAwdRealtime } from "./stream.tsx";

// ── 展示用小工具（纯展示，不改语义） ────────────────────────────────

// 阶段 / 生命周期中文名与事件战报统一放在 `./events.ts`（payload 字段来自后端定义）。

/** 阶段 → CSS 语气（`.xz-screen[data-phase]` 决定强调色）。 */
function phaseTone(phase: string): "hardening" | "attack" | "pause" | "unknown" {
	return phase === "hardening" || phase === "attack" || phase === "pause" ? phase : "unknown";
}

/** SSE 事件类型 → 流水行语气。类型是平台给出的原始字符串，仅做映射，不造值。 */
function feedTone(type: string): "attack" | "defense" | "round" | "judge" | "info" {
	const t = type.toLowerCase();
	if (t.includes("attack") || t.includes("submit")) return "attack";
	if (t.includes("defense") || t.includes("defence") || t.includes("down")) return "defense";
	if (t.includes("round") || t.includes("phase") || t.includes("start") || t.includes("end")) {
		return "round";
	}
	if (t.includes("judge")) return "judge";
	return "info";
}

function hhmmss(value: string | null): string {
	if (!value) return "--:--:--";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "--:--:--";
	return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 赛事状态：选手端与管理端 DTO 字段不同，这里只取两端都有的公共语义。 */
interface ScreenStatus {
	lifecycle: string;
	phase: string;
	currentRound: number | null;
	roundCount: number | null;
	score: number | null;
	banned: boolean;
	finalSettlement: boolean;
}

function toScreenStatus(raw: unknown): ScreenStatus | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	return {
		lifecycle: typeof o.status === "string" ? o.status : "",
		phase: typeof o.phase === "string" ? o.phase : "",
		currentRound: num(o.current_round),
		roundCount: num(o.round_count),
		score: num(o.score),
		banned: o.banned === true,
		finalSettlement: o.final_settlement === true,
	};
}

interface ScreenFeedEntry {
	key: string;
	type: string;
	/** 平台原始 payload，供 `describeAwdEvent` 翻译。 */
	payload: unknown;
	summary: string;
	occurredAt: string | null;
}

/** SSE 事件 → 流水行；`payload` 无法序列化时只留类型，不编造内容。 */
function toFeedEntry(event: { type?: string; payload?: unknown; occurred_at?: string } | null, seq: number): ScreenFeedEntry | null {
	if (!event) return null;
	const type = typeof event.type === "string" ? event.type : "event";
	let summary = "";
	try {
		summary = event.payload === undefined || event.payload === null
			? ""
			: typeof event.payload === "string"
				? event.payload
				: JSON.stringify(event.payload);
	} catch {
		summary = "";
	}
	return {
		key: `${seq}-${type}`,
		type,
		payload: event.payload,
		summary: summary.length > 160 ? `${summary.slice(0, 160)}…` : summary,
		occurredAt: typeof event.occurred_at === "string" ? event.occurred_at : null,
	};
}

const FEED_LIMIT = 18;

/** 管理端实时链路：与 `useAwdRealtime` 同口径，但走 admin SSE 与 admin 查询键。 */
function useAdminAwdRealtime(eventId: string) {
	const { useAdminAwdEventStream } = useBindings();
	const stream = useAdminAwdEventStream({ eventId });
	const [feed, setFeed] = useState<ScreenFeedEntry[]>([]);
	const counter = useRef(0);
	const lastEvent = stream.lastEvent;

	useEffect(() => {
		if (!lastEvent) return;
		counter.current += 1;
		const entry = toFeedEntry(lastEvent, counter.current);
		if (!entry) return;
		setFeed((previous) => [entry, ...previous].slice(0, FEED_LIMIT));
	}, [lastEvent]);

	return {
		state: String(stream.connectionState ?? "idle"),
		connected: Boolean(stream.connected),
		feed,
		pollInterval: stream.connected ? (false as const) : 15_000,
		lastError: stream.lastError,
	};
}

// ── 展示层（两端共用） ──────────────────────────────────────────────

function ScoreRow({
	row,
	index,
	own,
	flash,
}: {
	row: AwdScoreRow;
	index: number;
	own: boolean;
	flash: "up" | "down" | null;
}) {
	return (
		<div className="xz-screen__row" data-own={own} data-flash={flash ?? undefined}>
			<span className="xz-screen__rank">{row.rank ?? index + 1}</span>
			<span className="xz-screen__team" title={row.team_name}>
				{row.team_name}
				{own ? <span className="xz-screen__me">本队</span> : null}
			</span>
			<span className="xz-screen__atk">+{row.attack_score}</span>
			<span className="xz-screen__def">{row.defense_score}</span>
			<span className="xz-screen__total">{row.total_score.toLocaleString("zh-CN")}</span>
		</div>
	);
}

function AwdBigScreenView({
	eventId,
	admin,
	title,
	status,
	scores,
	scoresPending,
	scoresError,
	refetchScores,
	feed,
	streamState,
	connected,
	boxHealth,
	ownTeamId,
}: {
	eventId: string;
	admin: boolean;
	title: string;
	status: ScreenStatus | null;
	scores: AwdScoreRow[];
	scoresPending: boolean;
	scoresError: unknown;
	refetchScores: () => void;
	feed: ScreenFeedEntry[];
	streamState: string;
	connected: boolean;
	boxHealth: Array<{ status: string; count: number }> | null;
	ownTeamId: string | null;
}) {
	// 涨分高亮：与上一份积分榜快照比对（数据仍来自平台，只是展示层的差分动画）。
	const prevTotals = useRef<Map<string, number>>(new Map());
	const [flash, setFlash] = useState<Record<string, "up" | "down">>({});

	useEffect(() => {
		const next = new Map<string, number>();
		const changes: Record<string, "up" | "down"> = {};
		for (const row of scores) {
			const before = prevTotals.current.get(row.team_id);
			if (before !== undefined && before !== row.total_score) {
				changes[row.team_id] = row.total_score > before ? "up" : "down";
			}
			next.set(row.team_id, row.total_score);
		}
		prevTotals.current = next;
		if (Object.keys(changes).length === 0) return undefined;
		setFlash(changes);
		const timer = window.setTimeout(() => setFlash({}), 3000);
		return () => window.clearTimeout(timer);
	}, [scores]);

	const phase = status?.phase ?? "";
	// 队伍 ID → 名称：让战报里出现队名而不是 UUID（数据来自积分榜，不猜）。
	const teamNames = new Map(scores.map((row) => [row.team_id, row.team_name]));
	const meta = awdStreamStateMeta(streamState);
	const exitHref = admin ? `/admin/events/${eventId}` : `/events/${eventId}`;
	const roundText = status
		? `${status.currentRound ?? "—"} / ${status.roundCount ?? "—"}`
		: "—";

	return (
		<div className="xz-screen" data-phase={phaseTone(phase)}>
			<header className="xz-screen__head">
				<div className="xz-screen__brand">
					<span className="xz-screen__eyebrow">AWD 攻防赛 · 实时数据大屏</span>
					<h1 className="xz-screen__title">{title || "赛事"}</h1>
				</div>
				<div className="xz-screen__stats">
					<div className="xz-screen__stat">
						<span className="xz-screen__stat-k">阶段</span>
						<span className="xz-screen__stat-v">{PHASE_LABEL[phase] ?? phase ?? "—"}</span>
					</div>
					<div className="xz-screen__stat">
						<span className="xz-screen__stat-k">回合</span>
						<span className="xz-screen__stat-v">{roundText}</span>
					</div>
					<div className="xz-screen__stat">
						<span className="xz-screen__stat-k">状态</span>
						<span className="xz-screen__stat-v">
							{LIFECYCLE_LABEL[status?.lifecycle ?? ""] ?? status?.lifecycle ?? "—"}
						</span>
					</div>
					<div className="xz-screen__stat">
						<span className="xz-screen__stat-k">队伍</span>
						<span className="xz-screen__stat-v">{scores.length || "—"}</span>
					</div>
					<div className="xz-screen__stat" data-tone={meta.tone}>
						<span className="xz-screen__stat-k">实时链路</span>
						<span className="xz-screen__stat-v">
							{connected ? "● " : "○ "}
							{meta.label}
						</span>
					</div>
				</div>
				<a className="xz-screen__exit" href={exitHref}>
					退出大屏
				</a>
			</header>

			<div className="xz-screen__grid">
				<section className="xz-screen__board">
					<div className="xz-screen__row xz-screen__row--head">
						<span className="xz-screen__rank">#</span>
						<span className="xz-screen__team">队伍</span>
						<span className="xz-screen__atk">攻击</span>
						<span className="xz-screen__def">防守</span>
						<span className="xz-screen__total">总分</span>
					</div>
					<QueryBoundary
						isPending={scoresPending}
						isError={Boolean(scoresError)}
						error={scoresError}
						refetch={refetchScores}
						loadingLabel="加载积分榜…"
					>
						{scores.length === 0 ? (
							<div className="xz-screen__empty">暂无积分数据（比赛尚未产生得分）</div>
						) : (
							scores.map((row, index) => (
								<ScoreRow
									key={row.team_id || `${index}`}
									row={row}
									index={index}
									own={ownTeamId !== null && row.team_id === ownTeamId}
									flash={flash[row.team_id] ?? null}
								/>
							))
						)}
					</QueryBoundary>
					{status?.banned ? <div className="xz-screen__warn">本队已被封禁，AWD 操作不可用</div> : null}
					{status?.finalSettlement ? (
						<div className="xz-screen__warn">最后一轮结束，判题仍在结算</div>
					) : null}
				</section>

				<aside className="xz-screen__feed">
					<div className="xz-screen__feed-head">实时流水</div>
					{feed.length === 0 ? (
						<div className="xz-screen__empty xz-screen__empty--sm">
							{connected ? "等待事件…" : "实时链路未连接，仅按轮询刷新"}
						</div>
					) : (
						feed.map((entry) => (
							<div key={entry.key} className="xz-screen__feed-row" data-tone={feedTone(entry.type)}>
								<span className="xz-screen__feed-time">{hhmmss(entry.occurredAt)}</span>
								<span className="xz-screen__feed-type">{entry.type}</span>
								<span className="xz-screen__feed-text" title={entry.summary}>
									{describeAwdEvent(entry.type, entry.payload, teamNames, ownTeamId) ||
										entry.summary ||
										"—"}
								</span>
							</div>
						))
					)}
				</aside>
			</div>

			<footer className="xz-screen__foot">
				{boxHealth ? (
					<span>
						GameBox：
						{boxHealth.length === 0
							? "无实例"
							: boxHealth.map((item) => `${item.status} × ${item.count}`).join(" · ")}
					</span>
				) : (
					<span>管理端视图（不展示各队实例明细）</span>
				)}
				<span className="xz-screen__foot-note">
					只读大屏 · 数据来自平台实时流与 REST 查询 · 断线自动重连
				</span>
			</footer>
		</div>
	);
}

/** 选手端大屏：看自己所在赛事的积分榜、实时流水与 GameBox 健康。 */
export function AwdBigScreenPlayer({ eventId }: { eventId: string }) {
	const client = useClient();
	const realtime = useAwdRealtime(eventId);

	const statusQuery = useQuery({
		queryKey: qk.awd.status(eventId),
		queryFn: () => call(client.awd.player.status(eventId), "AWD 赛事状态"),
		refetchInterval: realtime.pollInterval,
	});
	const scoresQuery = useQuery({
		queryKey: qk.awd.scores(eventId),
		queryFn: () => call(client.awd.player.scores(eventId), "AWD 积分榜"),
		refetchInterval: 30_000,
	});
	const boxesQuery = useQuery({
		queryKey: qk.awd.gameboxes(eventId),
		queryFn: () => call(client.awd.player.gameboxes(eventId), "AWD GameBox 列表"),
		refetchInterval: 60_000,
	});
	const eventQuery = useQuery({
		queryKey: qk.events.detail(eventId),
		queryFn: () => call(client.service.events.get(eventId), "赛事详情"),
	});

	const boxHealth = (() => {
		const boxes = boxesQuery.data;
		if (!Array.isArray(boxes)) return null;
		const counts = new Map<string, number>();
		for (const box of boxes) {
			const raw = (box as { status?: unknown }).status;
			const key = typeof raw === "string" && raw.length > 0 ? raw : "unknown";
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return Array.from(counts, ([status, count]) => ({ status, count }));
	})();

	return (
		<AwdBigScreenView
			eventId={eventId}
			admin={false}
			title={typeof eventQuery.data?.event.title === "string" ? eventQuery.data.event.title : ""}
			status={toScreenStatus(statusQuery.data)}
			scores={scoresQuery.data ?? []}
			scoresPending={scoresQuery.isPending}
			scoresError={scoresQuery.isError ? scoresQuery.error : null}
			refetchScores={() => void scoresQuery.refetch()}
			feed={realtime.feed.map((entry) => ({
				key: entry.key,
				type: entry.type,
				payload: entry.payload,
				summary: entry.summary,
				occurredAt: entry.occurredAt,
			}))}
			streamState={realtime.state}
			connected={realtime.connected}
			boxHealth={boxHealth}
			ownTeamId={eventQuery.data?.team_result?.team.id ?? null}
		/>
	);
}

/** 管理端大屏：任意赛事的全场视图（投屏用），不含各队实例明细。 */
export function AwdBigScreenAdmin({ eventId }: { eventId: string }) {
	const client = useClient();
	const realtime = useAdminAwdRealtime(eventId);

	const statusQuery = useQuery({
		queryKey: qk.awd.adminStatus(eventId),
		queryFn: () => call(client.admin.awd.getStatus(eventId), "AWD 赛事状态"),
		refetchInterval: realtime.pollInterval,
	});
	const scoresQuery = useQuery({
		queryKey: qk.awd.adminScores(eventId),
		queryFn: () => call(client.admin.awd.scores(eventId), "AWD 积分榜"),
		refetchInterval: 30_000,
	});
	const eventQuery = useQuery({
		queryKey: qk.events.adminDetail(eventId),
		queryFn: () => call(client.admin.events.get(eventId), "赛事详情"),
	});

	return (
		<AwdBigScreenView
			eventId={eventId}
			admin
			title={typeof eventQuery.data?.title === "string" ? eventQuery.data.title : ""}
			status={toScreenStatus(statusQuery.data)}
			scores={scoresQuery.data ?? []}
			scoresPending={scoresQuery.isPending}
			scoresError={scoresQuery.isError ? scoresQuery.error : null}
			refetchScores={() => void scoresQuery.refetch()}
			feed={realtime.feed}
			streamState={realtime.state}
			connected={realtime.connected}
			boxHealth={null}
			ownTeamId={null}
		/>
	);
}
