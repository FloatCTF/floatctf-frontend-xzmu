/**
 * 赛事状态判定 —— **与后端语义一致**（AI-FRONTEND-GUIDE §12.1 硬规则：
 * 状态判定不得由前端自造）。
 *
 * 后端事实（`packages/sdk/src/entity/events.ts`）：
 * - `start_time` 必有；`end_time` 可空（不设结束时间 = 长期开放）；
 * - `hidden` 控制选手端可见性；`allow_join` 控制报名；
 * - `family`（jeopardy / awd / awdp）决定进入哪个驾驶舱；
 * - `participant_mode`（individual / team）决定加入通道：
 *   团队赛**不能**直接 `join`，必须先建队或入队（后端 `player_service.rs:661-665`）。
 */

import type { EventInfo } from "@floatctf/sdk";
import type { Events } from "@floatctf/sdk/entity";

export type EventPhase = "upcoming" | "running" | "ended";

export function eventPhase(event: Pick<Events, "start_time" | "end_time">): EventPhase {
	const now = Date.now();
	const start = new Date(event.start_time).getTime();
	const end = event.end_time ? new Date(event.end_time).getTime() : null;
	if (Number.isFinite(start) && now < start) return "upcoming";
	if (end !== null && Number.isFinite(end) && now > end) return "ended";
	return "running";
}

export const EVENT_PHASE_LABEL: Record<EventPhase, string> = {
	upcoming: "未开始",
	running: "进行中",
	ended: "已结束",
};

export const EVENT_PHASE_TONE: Record<EventPhase, "info" | "ok" | "neutral"> = {
	upcoming: "info",
	running: "ok",
	ended: "neutral",
};

export const FAMILY_LABEL: Record<string, string> = {
	jeopardy: "解题赛",
	awd: "攻防对抗 AWD",
	awdp: "攻防演练 AWDP",
};

export function familyLabel(family: string | null | undefined): string {
	if (!family) return "未知赛制";
	return FAMILY_LABEL[family] ?? family;
}

export const PARTICIPANT_LABEL: Record<string, string> = {
	individual: "个人赛",
	team: "团队赛",
};

export function participantLabel(mode: string | null | undefined): string {
	if (!mode) return "—";
	return PARTICIPANT_LABEL[mode] ?? mode;
}

/** 选手是否已经可以进入赛事内容（`joined` 是报名，不等于赛题已开放）。 */
export function joinState(event: EventInfo): { joined: boolean; phase: EventPhase } {
	return { joined: event.joined, phase: eventPhase(event.event) };
}
