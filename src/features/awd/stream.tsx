/**
 * AWD 选手端实时链路（SSE）接入层。
 *
 * 职责有三，全部集中在 `useAwdRealtime`：
 *
 * 1. **连接状态**：用 `useBindings().useAwdEventStream({ eventId })`（URL 由
 *    `@floatctf/react` 内部拼成 `/events/{id}/awd/stream`，本文件不拼字符串），
 *    把 `SseConnectionState` 的**全部取值**（idle / connecting / connected /
 *    reconnecting / auth_error / error / closed）如实注入顶栏实时状态条。
 *    `auth_error` 是 SSE 的 401/403：它**不会**触发全局 `onUnauthorized`
 *    （SSE 走 fetch，不经 axios 拦截器），所以必须单独可见地提示。
 * 2. **事件 → 失效映射**：SSE 事件只是「数据失效信号」，真实数据永远来自 REST。
 *    但 `@floatctf/react` 的 `useAwdEventStream` 内部只失效它自己硬编码的 key 形态
 *    （`["awd-scores", eventId]` 等，见 `awdInvalidation.ts`），与本前端的
 *    `qk.awd.player(eventId) = ["awd","player",eventId,…]` 层级并不重叠，
 *    因此这里按同一口径补一次映射；否则「SSE 连上之后页面反而不刷新」。
 * 3. **轮询兜底**：hook 在断线时自身会降级轮询，但它失效的仍是上面那套 key 形态，
 *    所以本层额外给出 `pollInterval`（已连接 = false，未连接 = 15s），
 *    由各查询自己带上 `refetchInterval`，保证断线时页面数据不冻结。
 */

import { useEffect, useRef, useState } from "react";
import type { AwdStreamEvent } from "@floatctf/react";
import { useQueryClient } from "@tanstack/react-query";

import { useBindings } from "../../api/client.ts";
import { qk } from "../../api/keys.ts";
import { useLiveStatus } from "../../app/live.tsx";
import { truncate } from "../../lib/format.ts";

export interface AwdStreamStateMeta {
	label: string;
	tone: "neutral" | "ok" | "warn" | "danger" | "info";
}

/** `SseConnectionState` 全集（7 个）的中文标签与语气。 */
export const AWD_STREAM_STATE_META: Record<string, AwdStreamStateMeta> = {
	idle: { label: "待机", tone: "neutral" },
	connecting: { label: "连接中", tone: "info" },
	connected: { label: "已连接", tone: "ok" },
	reconnecting: { label: "重连中", tone: "warn" },
	auth_error: { label: "登录状态失效", tone: "danger" },
	error: { label: "连接错误", tone: "danger" },
	closed: { label: "已断开", tone: "neutral" },
};

export function awdStreamStateMeta(state: string): AwdStreamStateMeta {
	return AWD_STREAM_STATE_META[state] ?? { label: state || "未知", tone: "neutral" };
}

/** 顶栏状态条的补充说明（不随时间抖动，避免每次事件都重渲染全局顶栏）。 */
const AWD_STREAM_DETAIL: Record<string, string> = {
	idle: "未建立实时连接（可能尚未登录或未启用）",
	connecting: "正在建立 SSE 连接",
	connected: "SSE 已连接，由事件驱动刷新",
	reconnecting: "连接中断，退避重连中（已回退 REST 轮询）",
	auth_error: "SSE 鉴权失败（登录状态失效），已停止重连并回退轮询",
	error: "SSE 连接错误，已回退 REST 轮询",
	closed: "实时连接已关闭",
};

/** 某个连接状态的一句话说明（顶栏状态条与面板共用）。 */
export function awdStreamDetail(state: string): string | undefined {
	return AWD_STREAM_DETAIL[state];
}

/** 实时事件流里的一条（只来自 SSE 帧，不做任何补写）。 */
export interface AwdFeedEntry {
	/** React key（帧去重后的自增序号 + 事件类型）。 */
	key: string;
	type: string;
	kind: "attack" | "defense" | "round" | undefined;
	/** 平台原始 payload（展示层用 `describeAwdEvent` 翻成战报，认不出时回落到 `summary`）。 */
	payload: unknown;
	summary: string;
	occurredAt: string | null;
}

export interface AwdRealtime {
	/** 原始 `SseConnectionState`。 */
	state: string;
	connected: boolean;
	lastEvent: AwdStreamEvent | null;
	lastError: Error | null;
	/** 最近事件（最多 12 条）。 */
	feed: AwdFeedEntry[];
	/** 供查询使用的轮询间隔：已连接 = false（事件驱动），未连接 = 15000ms。 */
	pollInterval: number | false;
}

const FEED_LIMIT = 12;

function eventKind(type: string): AwdFeedEntry["kind"] {
	if (type.startsWith("attack")) return "attack";
	if (type.startsWith("judge") || type.startsWith("defense")) return "defense";
	if (type.startsWith("round")) return "round";
	return undefined;
}

/** 把事件负载压成一行摘要；无法序列化时保持为空（不编造内容）。 */
function summarize(payload: unknown): string {
	if (payload === undefined || payload === null) return "";
	try {
		const text = typeof payload === "string" ? payload : JSON.stringify(payload);
		return truncate(text ?? "", 140);
	} catch {
		return "";
	}
}

/** 订阅 AWD SSE 并把连接状态 / 事件流 / 轮询间隔交给面板。 */
export function useAwdRealtime(eventId: string): AwdRealtime {
	const { useAwdEventStream } = useBindings();
	const stream = useAwdEventStream({ eventId });
	const { setLive } = useLiveStatus();
	const queryClient = useQueryClient();

	const [feed, setFeed] = useState<AwdFeedEntry[]>([]);
	const counter = useRef(0);

	const state = String(stream.connectionState ?? "idle");
	const lastEvent = stream.lastEvent;

	// ① 顶栏实时状态条：7 种连接状态全部可见（含 auth_error 的「登录状态失效」）。
	//    只依赖 state，避免每条事件都重渲染整个应用外壳。
	useEffect(() => {
		setLive({
			label: `AWD 实时 · ${awdStreamStateMeta(state).label}`,
			state,
			detail: AWD_STREAM_DETAIL[state],
		});
		return () => setLive(null);
	}, [state, setLive]);

	// ② 最近事件（仅来自 SSE；断线时列表停止增长，而不是被伪造的「示例事件」填满）。
	useEffect(() => {
		if (!lastEvent) return;
		counter.current += 1;
		const entry: AwdFeedEntry = {
			key: `${counter.current}-${lastEvent.type}`,
			type: lastEvent.type,
			kind: eventKind(lastEvent.type),
			payload: lastEvent.payload,
			summary: summarize(lastEvent.payload),
			occurredAt: lastEvent.occurred_at ?? null,
		};
		setFeed((previous) => [entry, ...previous].slice(0, FEED_LIMIT));
	}, [lastEvent]);

	// ③ 事件 → 本前端查询键的失效映射（见文件头说明；（250ms 合并突发事件）。
	useEffect(() => {
		if (!lastEvent) return;
		const timer = window.setTimeout(() => {
			void queryClient.invalidateQueries({ queryKey: qk.awd.player(eventId) });
		}, 250);
		return () => window.clearTimeout(timer);
	}, [lastEvent, eventId, queryClient]);

	return {
		state,
		connected: stream.connected,
		lastEvent,
		lastError: stream.lastError,
		feed,
		pollInterval: stream.connected ? false : 15_000,
	};
}
