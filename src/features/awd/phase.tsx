/**
 * AWD 选手端「操作可用性」判定 —— **纯函数，集中一处**，不把相位判断散落进 JSX。
 *
 * 权威依据（`docs/CAPABILITY-BEHAVIOR-MAP.md`「选手端：AWD」+「跨域公共语义 §6」，
 * 逐条对应后端与 Default 的证据）：
 *
 * 1. `AwdPlayerStatus.phase ∈ {hardening, attack, pause}`（`AwdPhase`）与
 *    `AwdPlayerStatus.status`（`AwdEventStatus`，14 个生命周期取值）是**两套并行开关**：
 *    phase 决定网络策略与「能否提交 flag / 能否重置」，status 决定「比赛是否在跑」。
 * 2. flag 提交要求 `phase === "attack"`：后端 `api/player.rs` 取 active round 前先判终态；
 *    Default `flagAllowed`（`awd.$id/index.tsx:34-60`）在 `hardening` 明确返回
 *    「Attack has not started (Hardening).」。
 * 3. GameBox 重置在 `hardening` **也允许**：Default `resetAllowed`
 *    （`awd.$id/gameboxes.tsx:22-32`）对 `hardening | attack` 都返回 allowed。
 * 4. `banned` 是**团队级** active ban（后端 `player.rs:563-570`），否决一切 AWD 操作。
 * 5. `status ∈ {finished, archived}`（后端 `AwdEventStatusExt::is_terminal`）、
 *    `final_settlement=true`（最后一轮结束、Judge 仍在结算）、`status=paused`、
 *    `status=network_error`、`phase=pause` 各自**独立**否决操作。
 * 6. 「未开赛」：后端 `AwdEventStatusExt::is_active` 只有 `running | paused`；
 *    其余（draft / configuring / deploying / deployed / prechecking / verified /
 *    start_blocked / deploy_failed / verification_failed）都还没有开始比赛，
 *    此时靶机与网络尚未就绪，按平台口径**不得暴露可操作按钮**。
 *
 * 注意：`AwdPlayerStatus` **没有** `free_reset_count`（它只出现在管理端 `AwdEventStatus`），
 * 所以这里**无法**判定「是否还在免费额度内」，只能如实告知「超出免费额度将按平台规则扣分」。
 */

import type { AwdPlayerStatus } from "@floatctf/sdk";
import { AwdEventStatus, AwdPhase, GameboxStatus } from "@floatctf/sdk/entity";

/** 单个操作的可用性判定结果。 */
export interface AwdGate {
	allowed: boolean;
	/** 禁止时的中文原因（`allowed === true` 时为空字符串）。 */
	reason: string;
}

export interface AwdAvailability {
	/** 赛事尚未开始（status 不在 running / paused / network_error / 终态内）。 */
	notStarted: boolean;
	/** 赛事已终态（finished / archived）。 */
	terminal: boolean;
	/**
	 * 全局否决原因（封禁 / 终态 / 最终结算 / 暂停 / 网络异常 / 未开赛）。
	 * 为 `null` 时表示没有任何全局开关挡住操作，各操作按其相位规则单独判定。
	 */
	blockedReason: string | null;
	/** flag 提交（仅 `phase === "attack"`）。 */
	submitFlag: AwdGate;
	/** GameBox 重置（`hardening` 与 `attack` 均允许）。 */
	resetGamebox: AwdGate;
	/** 接入凭据（WireGuard / SSH 只读凭据）。 */
	credentials: AwdGate;
}

const ALLOWED: AwdGate = { allowed: true, reason: "" };

/** 与后端 `AwdEventStatusExt::is_active` 对齐的「比赛进行中」状态。 */
const ACTIVE_LIFECYCLE: readonly string[] = [
	AwdEventStatus.Running,
	AwdEventStatus.Paused,
	AwdEventStatus.NetworkError,
];

export const AWD_PHASE_LABEL: Record<string, string> = {
	[AwdPhase.Hardening]: "加固阶段",
	[AwdPhase.Attack]: "攻击阶段",
	[AwdPhase.Pause]: "暂停",
};

export const AWD_LIFECYCLE_LABEL: Record<string, string> = {
	[AwdEventStatus.Draft]: "草稿",
	[AwdEventStatus.Configuring]: "配置中",
	[AwdEventStatus.Deploying]: "部署中",
	[AwdEventStatus.Deployed]: "已部署",
	[AwdEventStatus.Prechecking]: "预检中",
	[AwdEventStatus.Verified]: "预检通过",
	[AwdEventStatus.Running]: "进行中",
	[AwdEventStatus.Paused]: "已暂停",
	[AwdEventStatus.NetworkError]: "网络异常",
	[AwdEventStatus.StartBlocked]: "启动受阻",
	[AwdEventStatus.Finished]: "已结束",
	[AwdEventStatus.Archived]: "已归档",
	[AwdEventStatus.DeployFailed]: "部署失败",
	[AwdEventStatus.VerificationFailed]: "预检失败",
};

export function awdPhaseLabel(phase: string | null | undefined): string {
	if (!phase) return "未知阶段";
	return AWD_PHASE_LABEL[phase] ?? phase;
}

export function awdLifecycleLabel(status: string | null | undefined): string {
	if (!status) return "未知";
	return AWD_LIFECYCLE_LABEL[status] ?? status;
}

/**
 * 判定当前状态下每个操作是否可用。
 *
 * @param status `client.awd.player.status(eventId)` 的结果；未加载时传 `null`。
 */
export function awdAvailability(status: AwdPlayerStatus | null | undefined): AwdAvailability {
	if (!status) {
		const reason = "尚未取得 AWD 赛事状态，无法判定可执行操作。";
		return {
			notStarted: false,
			terminal: false,
			blockedReason: reason,
			submitFlag: { allowed: false, reason },
			resetGamebox: { allowed: false, reason },
			credentials: { allowed: false, reason },
		};
	}

	const phase = status.phase;
	const terminal =
		status.status === AwdEventStatus.Finished || status.status === AwdEventStatus.Archived;
	const notStarted = !terminal && !ACTIVE_LIFECYCLE.includes(status.status);

	const allBlocked = (reason: string): AwdAvailability => ({
		notStarted,
		terminal,
		blockedReason: reason,
		submitFlag: { allowed: false, reason },
		resetGamebox: { allowed: false, reason },
		credentials: { allowed: false, reason },
	});

	// ① 团队级封禁：该队伍存在 active ban 记录，所有写操作都会被后端拒绝。
	if (status.banned) {
		return allBlocked("本队已被封禁（团队级 ban）：只能查看，不能提交 flag、重置靶机或获取接入凭据。");
	}
	// ② 终态：finished / archived（后端 `is_terminal`）。
	if (terminal) {
		return allBlocked(`赛事已结束（status=${status.status}），AWD 操作已全部关闭。`);
	}
	// ③ 最终结算：最后一轮已结束、Judge 仍在结算，排行榜仍可能变化。
	if (status.final_settlement) {
		return allBlocked("最后一轮已结束、Judge 仍在最终结算（final_settlement=true）：操作已关闭，排行榜仍可能变化。");
	}
	// ④ 暂停：status=paused 或 phase=pause，后端与 Default 都禁止 flag / reset / 凭据。
	if (status.status === AwdEventStatus.Paused || phase === AwdPhase.Pause) {
		return allBlocked("比赛已暂停（网络双向阻断）：flag 提交、靶机重置与接入凭据全部不可用。");
	}
	// ⑤ 网络异常：平台 Fail Closed。
	if (status.status === AwdEventStatus.NetworkError) {
		return allBlocked("基础设施网络异常（status=network_error）：平台已 Fail Closed，操作全部不可用。");
	}
	// ⑥ 未开赛：靶机与网络尚未就绪，不暴露任何可操作按钮。
	if (notStarted) {
		return allBlocked(`AWD 赛事尚未开始（status=${status.status}），靶机与网络未就绪。`);
	}

	const isAttack = phase === AwdPhase.Attack;
	const isHardening = phase === AwdPhase.Hardening;

	return {
		notStarted,
		terminal,
		blockedReason: null,
		submitFlag: isAttack
			? ALLOWED
			: {
					allowed: false,
					reason: isHardening
						? "加固阶段（hardening）内跨队攻击被防火墙阻断，尚不能提交 flag；进入 attack 阶段后开放。"
						: `当前 phase=${phase}，只有 attack 阶段允许提交 flag。`,
				},
		resetGamebox:
			isAttack || isHardening
				? ALLOWED
				: {
						allowed: false,
						reason: `当前 phase=${phase}，只有 hardening / attack 阶段允许重置靶机。`,
					},
		// 只读凭据：hardening 与 attack 都可用（不在任何禁止列表内）。
		credentials: ALLOWED,
	};
}

/** `Badge` 可用的语气（与 `src/ui/primitives.tsx` 的 `BadgeTone` 同构）。 */
export type AwdBadgeTone = "neutral" | "crimson" | "gold" | "ok" | "warn" | "danger" | "info" | "solid";

/**
 * `GameboxStatus`（`@floatctf/sdk/entity`）→ 徽标语气。
 * 与 Default `gameboxes.tsx:34-49` 的 `statusVariant` 一致：
 * running / ready → 正常；resetting → 过渡；missing / start_failed / reset_failed / stopped → 危险。
 */
export function gameboxStatusTone(status: string): AwdBadgeTone {
	switch (status) {
		case GameboxStatus.Running:
		case GameboxStatus.Ready:
			return "ok";
		case GameboxStatus.Resetting:
			return "warn";
		case GameboxStatus.Missing:
		case GameboxStatus.Conflict:
		case GameboxStatus.StartFailed:
		case GameboxStatus.ResetFailed:
		case GameboxStatus.Stopped:
			return "danger";
		case GameboxStatus.Creating:
			return "info";
		default:
			return "neutral";
	}
}

/** 后端 `health_status` 目前只有 `unknown` 与健康检查写入的值；无法识别时返回 `undefined`（不臆造）。 */
export function gameboxHealthState(health: string): "healthy" | "unhealthy" | undefined {
	const value = (health ?? "").toLowerCase();
	if (value === "healthy") return "healthy";
	if (value === "unhealthy") return "unhealthy";
	return undefined;
}
