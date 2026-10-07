/**
 * AWDP 共享视图层 —— 赛事演练（`/events/:id?tab=drill`）与练习 Run 工作台
 * （`/training/:runId`）共用同一套阶段门禁、GameBox 卡片与结果呈现。
 *
 * 硬约束（见仓库 AGENTS.md §3）：
 * - **所有**「当前相位允许哪些操作」都有唯一来源：纯函数 `awdpPhasePolicy()`；
 * - 数据一律来自 `client.awdp.*` 真实接口，不构造任何占位数据；
 * - 每个 mutation 都有成功提示，并在 `onError` 里 `toast.error(标题, errorText(e))`；
 * - 破坏性操作（停止 / 重置实例、ALL Check）走 `useConfirm()` 并写明真实后果；
 * - 不使用原生 `alert/confirm/prompt`，不引入第三方 UI 库。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	AllCheckDto,
	AwdpEndpoint,
	AwdpEvaluationDto,
	AwdpGameBox,
	AwdpInstance,
	AwdpPhase,
	AwdpRoundDto,
	AwdpRunDto,
	AwdpRunEvaluationDto,
	AwdpRunScoresDto,
	AwdpScoreboardDetail,
	AwdpTrendItem,
	BreakSubmitResponse,
	ManualCheckDto,
	PatchSubmitResponse,
	ScoreEventDto,
} from "@floatctf/sdk";

import { useLiveStatus } from "../../app/live.tsx";
import { errorText } from "../../api/errors.ts";
import { formatBytes, formatCountdown, formatDateTime, formatSeconds, formatTime } from "../../lib/format.ts";
import { useNow } from "../../lib/hooks.ts";
import { DataTable } from "../../ui/Table.tsx";
import { Icon } from "../../ui/icons.tsx";
import { useConfirm, useToast } from "../../ui/overlays.tsx";
import {
	Badge,
	Button,
	Card,
	CardBody,
	CardFoot,
	CardHead,
	EmptyState,
	InlineLoading,
	Stat,
	TextInput,
} from "../../ui/primitives.tsx";

/* ══════════════════════════════════════════════════════════════════════════
 * 1. 相位模型 —— 唯一的门禁来源
 * ════════════════════════════════════════════════════════════════════════ */

export type AwdpTone = "neutral" | "crimson" | "gold" | "ok" | "warn" | "danger" | "info";

/** 相位中文名。取值域 = SDK `AwdpPhase`（`packages/sdk/src/api/awdp.ts:13`）。 */
export const AWDP_PHASE_LABEL: Record<AwdpPhase, string> = {
	pending: "待开始",
	break: "Break 攻破",
	preparing_fix: "正在准备 Fix",
	fix: "Fix 修复",
	ended: "已结束",
};

export const AWDP_PHASE_TONE: Record<AwdpPhase, AwdpTone> = {
	pending: "neutral",
	break: "danger",
	preparing_fix: "warn",
	fix: "info",
	ended: "neutral",
};

export interface AwdpPhasePolicy {
	/** 是否为 durable 过渡态（系统正在把所有实例 reset 到 pristine）。 */
	transitional: boolean;
	/** 该相位是否为「进行中」（决定轮询周期与实例可用性）。 */
	active: boolean;
	/** 启动/停止/重置实例（后端 `awdp/service/runtime.rs:121`：仅 Break | Fix）。 */
	instanceOps: boolean;
	/** 提交 Break flag（后端 `break_service.rs:55`：要求 `phase == Break`）。 */
	submitBreak: boolean;
	/** 上传修复补丁（后端 `patch_service.rs:181`：要求 `phase == Fix`）。 */
	uploadPatch: boolean;
	/** 手工 Test Check（后端仅有「实例存在」这一前置条件，按阶段语义收敛到 Fix）。 */
	testCheck: boolean;
	/** 源码下载（后端 `training.rs:626` / competition 同款：要求 `phase == Fix`）。 */
	source: boolean;
}

/**
 * 「当前相位允许哪些操作」的**唯一**判定函数。
 *
 * 依据（逐条来自后端门禁，不是前端自造）：
 * - `pending`：run 已创建未开始（`service/event_service.rs:153,275`）→ 无实例、不能提交 flag、不能上传补丁；
 * - `break`：**只能**提交 Break flag（`break_service.rs:36-62` 要求 `phase == Break`）；
 *   补丁被拒（`patch_service.rs:181` 要求 `phase == Fix`）；
 * - `preparing_fix`：**durable 过渡态**，系统正在把所有已启动实例 reset 到 pristine
 *   （`service/event_service.rs:23-65`）→ source 锁定、补丁禁止、Break flag 禁止；
 *   必须如实展示为「正在准备 Fix 阶段，请稍候」，**不得**误报成 `pending`
 *   （对照 `api/player.rs:110` 的注释：展示用 run 在 `preparing_fix` 时如实展示）；
 * - `fix`：可上传补丁、可 Test Check、官方评测按回合运行（`evaluation.rs:43`）；
 *   Break flag 被拒（`break_service.rs:59`）；
 * - `ended`：只读（`practice_service.rs:75`）。
 *
 * 实例类操作只在 `Break | Fix` 可用（`runtime.rs:121`），因此 `pending` /
 * `preparing_fix` / `ended` 下不渲染 Start/Stop/Reset。
 */
export function awdpPhasePolicy(phase: AwdpPhase): AwdpPhasePolicy {
	const active = phase === "break" || phase === "fix";
	return {
		transitional: phase === "preparing_fix",
		active,
		instanceOps: active,
		submitBreak: phase === "break",
		uploadPatch: phase === "fix",
		testCheck: phase === "fix",
		source: phase === "fix",
	};
}

export interface AwdpPhaseNotice {
	tone: "info" | "warn" | "danger" | "ok" | "neutral";
	title: string;
	body: string;
}

/** 阶段说明文案（赛事 / 练习语境不同，因为练习额外拥有 Launch / 重新训练）。 */
export function awdpPhaseNotice(phase: AwdpPhase, isPractice: boolean): AwdpPhaseNotice {
	if (phase === "preparing_fix") {
		return {
			tone: "warn",
			title: "正在准备 Fix 阶段，请稍候",
			body: "系统正在把所有已启动实例逐个重置到 pristine 状态。此阶段 Break flag、补丁上传与源码下载全部被后端禁止；准备完成后会自动进入 Fix 阶段，无需任何手动操作。",
		};
	}
	if (isPractice) {
		switch (phase) {
			case "pending":
				return {
					tone: "info",
					title: "尚未开始训练",
					body: "点击「开始训练」会冻结本次 run、回卷到全新的 Break 阶段并启动实例。此阶段不能提交 flag，也不能上传补丁。",
				};
			case "break":
				return {
					tone: "danger",
					title: "Break 攻破阶段",
					body: "只能提交 Break flag。练习里可以在任意时刻手动切到 Fix 阶段（切换后本阶段不再接受 flag）。",
				};
			case "fix":
				return {
					tone: "info",
					title: "Fix 修复阶段",
					body: "可以上传补丁、执行 Test Check 或 ALL Check（一键官方判定）。官方评测按回合自动运行，失败回合会按规则扣分。",
				};
			case "ended":
				return {
					tone: "neutral",
					title: "本次训练已结束",
					body: "全部数据只读。可以查看回合、评测与计分流水，或点「重新训练」开一个全新的 run。",
				};
		}
	}
	switch (phase) {
		case "pending":
			return {
				tone: "info",
				title: "演练尚未开始",
				body: "开赛后系统会自动创建实例并进入 Break 阶段。此阶段不能提交 flag，也不能上传补丁。",
			};
		case "break":
			return {
				tone: "danger",
				title: "Break 攻破阶段",
				body: "只能提交 Break flag（每个 GameBox 一次）。补丁上传、Test Check 与源码下载在此阶段会被后端拒绝。",
			};
		case "fix":
			return {
				tone: "info",
				title: "Fix 修复阶段",
				body: "可以上传补丁并执行 Test Check；官方评测按回合自动运行。Break flag 已被拒绝。",
			};
		case "ended":
			return {
				tone: "neutral",
				title: "演练已结束",
				body: "全部数据只读：仍可查看实例、回合、我的官方评测、积分榜与趋势。",
			};
	}
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. 状态字典（全部来自后端枚举，见 entity/sea_orm_active_enums.ts）
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * AWDP 查询的轮询周期（**兜底**，与 `useAwdpSseBridge` 互补）。
 *
 * 两条通道并存的原因：
 * 1. `useAwdpSseBridge` 让 SSE 事件 / 断线 15s 回退轮询真正生效（绑定层硬编码
 *    的失效键与本前端 `qk` 前缀不匹配，见该函数的说明）；但它只在**有事件**
 *    时触发，且 hook 在 `connected` 状态下不会自己轮询 —— 若流「连着但不来事件」
 *    （代理缓冲等），界面会一直停在旧数据；
 * 2. 因此这里按阶段再加一层周期兜底，周期语义与 hook 自身的 `pollMs = 15_000`
 *    一致：
 *    - `preparing_fix` 是 durable 过渡态，用更短周期以便尽快看到进入 `fix`；
 *    - `break` / `fix` 是进行中阶段，20s 兜底；
 *    - 其余阶段不轮询（`false`）。
 */
export function awdpPollMs(phase: AwdpPhase | undefined): number | false {
	if (phase === "preparing_fix") return 8_000;
	if (phase === "break" || phase === "fix") return 20_000;
	return false;
}

export interface AwdpStatusMeta {
	/** 单元格用的单字。 */
	short: string;
	label: string;
	tone: AwdpTone;
}

/**
 * 评测状态字典。取值域 = `AwdpEvaluationStatus`
 * （`entity/sea_orm_active_enums.ts:39-48`）。
 */
export function awdpStatusMeta(status: string | null | undefined): AwdpStatusMeta {
	switch (status) {
		case "pending":
			return { short: "等", label: "排队中", tone: "neutral" };
		case "running":
			return { short: "跑", label: "运行中", tone: "info" };
		case "no_patch":
			return { short: "无", label: "未提交补丁（0 分）", tone: "warn" };
		case "service_down":
			return { short: "崩", label: "服务不可达（0 分）", tone: "danger" };
		case "functional_broken":
			return { short: "损", label: "功能被破坏（0 分）", tone: "danger" };
		case "vulnerable":
			return { short: "漏", label: "仍可被攻破（0 分）", tone: "danger" };
		case "patched":
			return { short: "通", label: "修复通过（计分）", tone: "ok" };
		case "platform_error":
			return { short: "错", label: "平台错误", tone: "warn" };
		case null:
		case undefined:
		case "":
			return { short: "·", label: "未评测", tone: "neutral" };
		default:
			return { short: "?", label: status, tone: "neutral" };
	}
}

/** 实例 runtime_state 文案（`AwdpInstance.runtime_state` 是自由字符串，只做展示映射）。 */
export function awdpRuntimeLabel(state: string | null | undefined): { label: string; tone: AwdpTone } {
	switch (state) {
		case "running":
			return { label: "运行中", tone: "ok" };
		case "starting":
			return { label: "启动中", tone: "info" };
		case "stopping":
			return { label: "停止中", tone: "warn" };
		case "stopped":
			return { label: "已停止", tone: "neutral" };
		case "error":
			return { label: "异常", tone: "danger" };
		case null:
		case undefined:
		case "":
			return { label: "未启动", tone: "neutral" };
		default:
			return { label: state, tone: "neutral" };
	}
}

const SSE_STATE_LABEL: Record<string, string> = {
	idle: "未连接",
	connecting: "连接中",
	connected: "已连接",
	reconnecting: "重连中",
	auth_error: "鉴权失败（已停止重连）",
	error: "连接错误",
	closed: "已关闭",
};

export interface AwdpLiveStream {
	connectionState: string;
	connected: boolean;
	lastError: Error | null;
}

/**
 * 把 SSE 连接状态注入顶栏「实时链路」状态条。
 *
 * 注意（SDK-API-REFERENCE §5.3 陷阱 34）：SSE 的 401/403 **不会**触发
 * `onUnauthorized`，只会把 state 变成 `auth_error` 并停止重连；该状态必须
 * 如实展示（`AwdpLiveNotice` 会给出显式提示），不能假装成「已连接」。
 */
export function useAwdpLiveStrip(label: string, stream: AwdpLiveStream): void {
	const { setLive } = useLiveStatus();
	const state = stream.connectionState;
	const error = stream.lastError;

	useEffect(() => {
		setLive({
			label,
			state,
			detail: error ? `最近错误：${error.message}` : (SSE_STATE_LABEL[state] ?? state),
		});
		return () => setLive(null);
	}, [label, state, error, setLive]);
}

/** 连接异常时的显式提示（断线不得冻结页面，但必须可见）。 */
export function AwdpLiveNotice({ stream }: { stream: AwdpLiveStream }) {	if (stream.connectionState === "auth_error") {
		return (
			<div className="xz-awdp-notice" data-tone="danger" role="alert">
				<Icon name="alert" size={17} />
				<div>
					<div className="xz-awdp-notice__title">实时连接鉴权失败</div>
					事件流返回 401/403 且不再重连：你可能是未报名 / 登录态已过期。
					页面仍会通过定时轮询刷新，但数据可能滞后；请重新登录或确认已加入赛事。
				</div>
			</div>
		);
	}
	if (stream.connectionState === "reconnecting" || stream.connectionState === "error") {
		return (
			<div className="xz-awdp-notice" data-tone="warn" role="status">
				<Icon name="warn" size={17} />
				<div>
					<div className="xz-awdp-notice__title">实时连接不稳定（{SSE_STATE_LABEL[stream.connectionState]}）</div>
					已降级为定时轮询刷新，数据可能滞后数秒。
					{stream.lastError ? ` 最近错误：${stream.lastError.message}` : ""}
				</div>
			</div>
		);
	}
	return null;
}

/**
 * SSE → `qk` 失效桥。
 *
 * **为什么需要**：`@floatctf/react` 的流 hook 收到事件（或断线回退轮询）后，
 * 只会失效它**硬编码**的那些键 —— `useAwdpEventStream.ts:58-65` 的
 * `["awdp-overview", eventId]` / `["awdp-rounds", eventId]` / `["awdp-evals", eventId]`
 * … 与 `useAwdpRunStream.ts:47-51` 的 `["awdp-run", runId]` / `["gamebox-catalog"]`。
 * 而本前端的查询键统一走 `qk`（`["awdp","event",eventId,"overview"]`、
 * `["training","run",runId]` …）。`queryClient.invalidateQueries` 是**前缀**匹配，
 * 两组键前缀不同 → SDK 的失效对 `qk` 查询**完全无效**（这就是 awdpPollMs 存在的
 * 原因）。`src/api/keys.ts` 不在本次改动范围内，因此在这里做**补偿**：
 *
 * 注册一个只做失效、不发业务请求的「桥」查询，键刻意取 hook 会失效的那个字面键；
 * 它的 `queryFn` 转而失效 `qk` 命名空间。React Query 的 `refetchQueries` 只跳过
 * `isDisabled()` 的查询（`query-core/queryClient.js:171`），桥查询保持 enabled，
 * 因此 SSE 事件与「断线 15s 轮询回退」都能真正驱动数据刷新。
 *
 * 这是对绑定层硬编码键的补偿，不是平台契约的一部分：绑定一旦改为复用它失效的
 * 调用方键（或导出键常量），本函数即可删除。
 */
export function useAwdpSseBridge(
	kind: "event" | "run",
	id: string,
	invalidateKey: readonly unknown[],
): void {
	const queryClient = useQueryClient();
	const invalidateRef = useRef(invalidateKey);
	invalidateRef.current = invalidateKey;

	useQuery({
		queryKey: kind === "event" ? ["awdp-overview", id] : ["awdp-run", id],
		queryFn: async () => {
			try {
				await queryClient.invalidateQueries({ queryKey: invalidateRef.current });
			} catch {
				// 桥只负责触发失效：即使失效失败也不抛出，各数据查询自己会呈现错误态。
			}
			return null;
		},
		// 只作为失效桥：不轮询、不因窗口聚焦重取。
		refetchOnWindowFocus: false,
		staleTime: Number.POSITIVE_INFINITY,
		retry: false,
	});
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. 相位 / 时序展示
 * ════════════════════════════════════════════════════════════════════════ */

export function AwdpPhasePill({ phase }: { phase: AwdpPhase }) {
	return (
		<span className="xz-phase xz-awdp-phase" data-phase={phase} data-tone={AWDP_PHASE_TONE[phase]}>
			<Icon name={phase === "ended" ? "check" : phase === "fix" ? "shield" : "flag"} size={14} />
			{AWDP_PHASE_LABEL[phase]}
		</span>
	);
}

export function AwdpPhaseNotice({ phase, isPractice }: { phase: AwdpPhase; isPractice: boolean }) {
	const notice = awdpPhaseNotice(phase, isPractice);
	return (
		<div className="xz-awdp-notice" data-tone={notice.tone} role="status">
			<Icon name={notice.tone === "warn" ? "warn" : notice.tone === "danger" ? "alert" : "info"} size={17} />
			<div>
				<div className="xz-awdp-notice__title">{notice.title}</div>
				{notice.body}
			</div>
		</div>
	);
}

/** 赛事总览与练习 run 共有的时序字段子集（两个 DTO 都结构化满足它）。 */
export interface AwdpTiming {
	phase: AwdpPhase;
	break_duration_secs: number;
	fix_duration_secs: number;
	fix_round_interval_secs: number;
	total_rounds: number;
	break_score: number;
	fix_round_score: number;
	started_at: string | null;
	break_ends_at: string | null;
	fix_started_at: string | null;
	fix_ends_at: string | null;
	finished_at: string | null;
	current_round: number;
	next_action_at: string | null;
	my_score: number;
}

function Deadline({ label, at, urgentAfterSecs = 300 }: { label: string; at: string | null; urgentAfterSecs?: number }) {
	const now = useNow(1000);
	if (!at) return <Stat label={label} value="—" foot="未设置" />;
	const remainMs = new Date(at).getTime() - now;
	return (
		<Stat
			label={label}
			value={
				<span className="xz-awdp-phasebar__clock" data-urgent={remainMs <= urgentAfterSecs * 1000 && remainMs > 0}>
					{formatCountdown(at)}
				</span>
			}
			foot={formatDateTime(at)}
		/>
	);
}

/**
 * 相位时序 / 配置面板。
 *
 * `phaseEndsAt` 的映射沿用 Default 已核实的语义（CAPABILITY-BEHAVIOR-MAP §7）：
 * `break → break_ends_at`、`fix → next_action_at`（下一轮官方 Check）。
 */
export function AwdpTimingPanel({ timing }: { timing: AwdpTiming }) {
	const { phase } = timing;
	return (
		<div className="xz-awdp-timing">
			<Stat
				label="我的积分"
				value={timing.my_score}
				gold
				icon="trophy"
				foot={phase === "ended" ? "最终成绩" : "实时累计"}
			/>
			<Stat
				label="回合进度"
				value={`${timing.current_round} / ${timing.total_rounds}`}
				icon="layers"
				foot={phase === "fix" ? "官方评测按回合运行" : "Break 阶段不计回合"}
			/>
			{phase === "pending" ? <Stat label="开始时间" value="待开始" icon="clock" foot="开赛后自动进入 Break" /> : null}
			{phase === "break" ? <Deadline label="距 Break 结束" at={timing.break_ends_at} /> : null}
			{phase === "preparing_fix" ? (
				<Stat label="Fix 准备" value="进行中" icon="refresh" foot="自动重置实例中，无需操作" />
			) : null}
			{phase === "fix" ? <Deadline label="距下一轮 Check" at={timing.next_action_at} /> : null}
			{phase === "fix" || phase === "ended" ? <Deadline label="距 Fix 结束" at={timing.fix_ends_at} /> : null}
			{phase === "ended" ? <Stat label="结束时间" value={formatDateTime(timing.finished_at)} icon="check" /> : null}
			<Stat label="Break 时长" value={formatSeconds(timing.break_duration_secs)} foot={`单次攻破 ${timing.break_score} 分`} />
			<Stat
				label="Fix 时长"
				value={formatSeconds(timing.fix_duration_secs)}
				foot={`每轮 ${timing.fix_round_score} 分 · 间隔 ${formatSeconds(timing.fix_round_interval_secs)}`}
			/>
		</div>
	);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. GameBox 视图模型（赛事 `AwdpGameBox` 与练习 `AwdpRunDto` 归一化）
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 卡片统一视图。
 *
 * `key` 是**调用 SDK 要用的标识**：
 * - 赛事：`AwdpGameBox.id` = 赛事 GameBox 关联 ID（`egId`，后端 `api/player.rs:168` 的 `id: eg.id`）；
 * - 练习：`AwdpRunDto.gamebox_id`（run 只针对一个 GameBox）。
 */
export interface AwdpBoxView {
	key: string;
	gamebox_id: string;
	name: string;
	category: string;
	enabled: boolean;
	broken: boolean;
	instance: AwdpInstance | null;
	/** GameBox 声明会暴露的容器端口（`[protocol, container_port]`）。 */
	exposed: [string, number][];
	source_code_dir: string | null;
}

export function boxViewFromEvent(box: AwdpGameBox): AwdpBoxView {
	return {
		key: box.id,
		gamebox_id: box.gamebox_id,
		name: box.name,
		category: box.category,
		enabled: box.enabled,
		broken: box.broken,
		instance: box.instance,
		exposed: box.exposed,
		source_code_dir: box.source_code_dir ?? null,
	};
}

export function boxViewFromRun(run: AwdpRunDto): AwdpBoxView {
	const instance = run.instances[0] ?? null;
	return {
		key: run.gamebox_id,
		gamebox_id: run.gamebox_id,
		name: run.gamebox_name,
		category: run.gamebox_category,
		enabled: true,
		broken: instance?.broken ?? false,
		instance,
		exposed: [],
		source_code_dir: run.source_code_dir,
	};
}

/* ══════════════════════════════════════════════════════════════════════════
 * 5. GameBox 卡片（实例生命周期 + flag + 补丁 + 自检 + 源码）
 * ════════════════════════════════════════════════════════════════════════ */

/** 卡片要执行的动作（由面板按赛事 / 练习分别注入真实的 SDK 调用）。 */
export interface AwdpBoxActions {
	submitBreak: (boxKey: string, flag: string) => Promise<BreakSubmitResponse>;
	uploadPatch: (boxKey: string, file: File) => Promise<PatchSubmitResponse>;
	testCheck: (boxKey: string) => Promise<ManualCheckDto>;
	startInstance: (boxKey: string) => Promise<AwdpInstance>;
	stopInstance: (boxKey: string) => Promise<null>;
	resetInstance: (boxKey: string) => Promise<AwdpInstance>;
	sourceUrl: (boxKey: string) => Promise<string>;
	/** 仅练习提供：一键官方判定（成功会结算剩余回合并结束 run）。 */
	allCheck?: (boxKey: string) => Promise<AllCheckDto>;
}

export interface AwdpBoxCardProps {
	box: AwdpBoxView;
	policy: AwdpPhasePolicy;
	actions: AwdpBoxActions;
	/** 变更后要失效的查询键前缀（赛事 = `qk.awdp.all`，练习 = `qk.training.all`）。 */
	invalidateKey: readonly unknown[];
	/** 「查询实例」`getInstance` 的缓存键（`qk.awdp.instance` / `qk.training.instance`）。 */
	instanceQueryKey: readonly unknown[];
	/** `getInstance` 的读取器；`null` 表示该面板不提供实例探测。 */
	probeInstance: (() => Promise<AwdpInstance | null>) | null;
	isPractice: boolean;
	/** 练习 ALL Check 的后果文案需要用到每轮分值。 */
	fixRoundScore?: number;
}

function ResultRow({ k, v }: { k: string; v: ReactNode }) {
	return (
		<div className="xz-awdp-result__row">
			<span className="xz-awdp-result__k">{k}</span>
			<span className="xz-awdp-result__v">{v}</span>
		</div>
	);
}

function EndpointList({ instance, exposed }: { instance: AwdpInstance | null; exposed: [string, number][] }) {
	if (instance && instance.endpoints.length > 0) {
		return (
			<div className="xz-awdp-endpoints">
				{instance.endpoints.map((endpoint: AwdpEndpoint) => (
					<span
						key={`${endpoint.protocol}-${endpoint.public_host}-${endpoint.public_port}`}
						className="xz-awdp-endpoint"
						data-proto={endpoint.protocol}
						title={`容器端口 ${endpoint.container_port}`}
					>
						{endpoint.protocol}://{endpoint.public_host}:{endpoint.public_port}
					</span>
				))}
			</div>
		);
	}
	if (exposed.length > 0) {
		return (
			<div className="xz-awdp-endpoints">
				{exposed.map(([protocol, port]) => (
					<span key={`${protocol}-${port}`} className="xz-awdp-endpoint" data-proto={protocol} title="实例启动后分配公网端口">
						{protocol} :{port}（待启动）
					</span>
				))}
			</div>
		);
	}
	return <span className="xz-muted">—</span>;
}

/**
 * 单个 GameBox 卡：实例生命周期、Break flag、补丁上传、Test Check、
 * 练习 ALL Check、源码下载，以及每类操作的持久回执。
 */
export function AwdpBoxCard({
	box,
	policy,
	actions,
	invalidateKey,
	instanceQueryKey,
	probeInstance,
	isPractice,
	fixRoundScore = 0,
}: AwdpBoxCardProps) {
	const toast = useToast();
	const confirm = useConfirm();
	const queryClient = useQueryClient();

	const [flag, setFlag] = useState("");
	const [patchFile, setPatchFile] = useState<File | null>(null);
	const [breakResult, setBreakResult] = useState<BreakSubmitResponse | null>(null);
	const [patchResult, setPatchResult] = useState<PatchSubmitResponse | null>(null);
	const [checkResult, setCheckResult] = useState<ManualCheckDto | null>(null);
	const [allCheckResult, setAllCheckResult] = useState<AllCheckDto | null>(null);
	const [sourceHref, setSourceHref] = useState<string | null>(null);

	const instance = box.instance;
	const running = instance?.runtime_state === "running";

	const invalidate = () => queryClient.invalidateQueries({ queryKey: invalidateKey });

	const breakMutation = useMutation({
		mutationFn: (value: string) => actions.submitBreak(box.key, value),
		onSuccess: (result) => {
			setBreakResult(result);
			if (result.accepted && result.scored) {
				toast.success("flag 正确，已计分", "本次攻破已计入 Break 得分。");
			} else if (result.accepted && !result.scored) {
				// 关键语义：accepted && !scored = 此前已被攻破，不重复计分。
				toast.warn(
					"flag 正确，但此前已被攻破",
					result.already_broken
						? "该 GameBox 在更早的时间点已被攻破，本次不重复计分。"
						: "后端接受了 flag，但本次不计分（此前已攻破）。",
				);
			} else {
				toast.error("flag 未被接受", "后端判定该 flag 无效（未通过校验）。");
			}
			setFlag("");
			void invalidate();
		},
		onError: (error) => toast.error("Break flag 提交失败", errorText(error)),
	});

	const patchMutation = useMutation({
		mutationFn: (file: File) => actions.uploadPatch(box.key, file),
		onSuccess: (result) => {
			setPatchResult(result);
			if (result.status === "applied") {
				toast.success("补丁已应用", "后端已接收并应用该补丁，等待官方回合评测。");
				setPatchFile(null);
			} else {
				toast.error("补丁未通过", result.error_message || "后端未给出失败原因。");
			}
			void invalidate();
		},
		onError: (error) => toast.error("补丁上传失败", errorText(error)),
	});

	const checkMutation = useMutation({
		mutationFn: () => actions.testCheck(box.key),
		onSuccess: (result) => {
			setCheckResult(result);
			toast.success("Test Check 完成", "自检结果不计分，仅供诊断。");
			void invalidate();
		},
		onError: (error) => toast.error("Test Check 失败", errorText(error)),
	});

	const allCheckMutation = useMutation({
		mutationFn: () => {
			if (!actions.allCheck) throw new Error("当前上下文不支持 ALL Check");
			return actions.allCheck(box.key);
		},
		onSuccess: (result) => {
			setAllCheckResult(result);
			if (result.status === "patched") {
				toast.success(
					"ALL Check 通过：已结算全部剩余回合",
					`官方判定为 patched，剩余 ${result.swept_rounds} 个回合已按官方规则计分，本次训练随之结束。`,
				);
			} else {
				toast.warn(
					`ALL Check 未通过（${awdpStatusMeta(result.status).label}）`,
					"本次不计分也不扣分，最终以本轮 cutoff 的官方判定为准。",
				);
			}
			void invalidate();
		},
		onError: (error) => toast.error("ALL Check 失败", errorText(error)),
	});

	const startMutation = useMutation({
		mutationFn: () => actions.startInstance(box.key),
		onSuccess: (value) => {
			toast.success("实例已启动", `实例 ${value.instance_id.slice(0, 8)}… 状态：${value.runtime_state}`);
			void invalidate();
		},
		onError: (error) => toast.error("启动实例失败", errorText(error)),
	});

	const stopMutation = useMutation({
		mutationFn: () => actions.stopInstance(box.key),
		onSuccess: () => {
			toast.success("实例已停止");
			void invalidate();
		},
		onError: (error) => toast.error("停止实例失败", errorText(error)),
	});

	const resetMutation = useMutation({
		mutationFn: () => actions.resetInstance(box.key),
		onSuccess: (value) => {
			toast.success("实例已重置", `新世代 #${value.runtime_generation}，容器已回到 pristine 状态。`);
			void invalidate();
		},
		onError: (error) => toast.error("重置实例失败", errorText(error)),
	});

	const sourceMutation = useMutation({
		mutationFn: () => actions.sourceUrl(box.key),
		onSuccess: (url) => {
			setSourceHref(url);
			toast.success("源码下载链接已生成", "预签名链接有时效，请尽快下载。");
		},
		onError: (error) => toast.error("获取源码链接失败", errorText(error)),
	});

	const probe = useQuery({
		queryKey: instanceQueryKey,
		queryFn: async () => (probeInstance ? probeInstance() : null),
		enabled: false,
		retry: false,
		staleTime: 0,
	});

	const busy =
		breakMutation.isPending ||
		patchMutation.isPending ||
		checkMutation.isPending ||
		allCheckMutation.isPending ||
		startMutation.isPending ||
		stopMutation.isPending ||
		resetMutation.isPending;

	const onStopInstance = async () => {
		const ok = await confirm({
			title: `停止 GameBox 实例：${box.name}`,
			description: "停止后该实例对外端点立即失效，你将无法继续访问它。",
			consequences:
				"实例内部的进程与状态会随容器停止；重新启动会恢复实例（同一世代），但正在运行的服务会中断。" +
				(isPractice ? "练习模式可随时重新启动。" : "赛事模式需在 Break/Fix 阶段才能再次启动（后端门禁）。"),
			tone: "danger",
			confirmText: "停止实例",
		});
		if (ok) stopMutation.mutate();
	};

	const onResetInstance = async () => {
		const ok = await confirm({
			title: `重置 GameBox 实例：${box.name}`,
			description: "重置会销毁当前容器并重建 pristine 实例。",
			consequences:
				"容器内的一切改动都会丢失：已上传的补丁、正在运行的进程、临时文件全部清空；" +
				"实例标识与对外端口可能变化。" +
				(isPractice
					? "练习模式的 Reset 不计次数、不罚分。"
					: "赛事模式的免费次数与额外罚分由服务端结算（选手端接口不下发剩余免费次数）。"),
			tone: "danger",
			confirmText: "重置实例",
		});
		if (ok) resetMutation.mutate();
	};

	const onAllCheck = async () => {
		if (!actions.allCheck) return;
		const ok = await confirm({
			title: `执行 ALL Check（一键官方判定）：${box.name}`,
			description: "ALL Check 会立即调用官方评测流程，结果直接影响本次训练的最终得分。",
			consequences:
				`通过（patched）时：从当前轮起全部剩余回合按每轮 ${fixRoundScore} 分计入总分，并**立即结束本次 run**（实例停止）。` +
				"未通过时：本次不落账、不扣分，之后的得分仍以每轮 cutoff 时的官方判定为准。",
			tone: "danger",
			confirmText: "执行 ALL Check",
		});
		if (ok) allCheckMutation.mutate();
	};

	const onSource = () => {
		// 预签名 URL 由后端按需生成：先开好窗口，避免 await 之后被弹窗拦截。
		const reserved = window.open("about:blank", "_blank");
		if (reserved) {
			reserved.opener = null;
		}
		sourceMutation.mutate(undefined, {
			onSuccess: (url) => {
				if (reserved) {
					reserved.location.href = url;
					return;
				}
				toast.warn("浏览器拦截了新窗口", "请在下方链接上手动点击下载源码。");
			},
		});
	};

	const runtime = awdpRuntimeLabel(instance?.runtime_state);

	return (
		<article className="xz-gb" data-health={running ? "healthy" : "unhealthy"}>
			<div className="xz-gb__head">
				<div className="xz-grow">
					<div className="xz-gb__name">{box.name}</div>
					<div className="xz-row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
						<Badge tone="crimson">{box.category}</Badge>
						{box.broken ? (
							<Badge tone="danger" icon="flag">
								已攻破
							</Badge>
						) : (
							<Badge>未被攻破</Badge>
						)}
						<Badge tone={runtime.tone} icon="box">
							{runtime.label}
						</Badge>
						{!box.enabled ? <Badge tone="warn">已禁用</Badge> : null}
						{box.source_code_dir ? (
							<Badge tone="info" icon="code">
								源码目录已解锁
							</Badge>
						) : null}
					</div>
				</div>
			</div>

			<div className="xz-gb__rows">
				<div className="xz-gb__row">
					<span className="xz-gb__k">实例</span>
					<span className="xz-gb__v">{instance ? instance.instance_id : "未启动"}</span>
				</div>
				<div className="xz-gb__row">
					<span className="xz-gb__k">世代</span>
					<span className="xz-gb__v">{instance ? `#${instance.runtime_generation}` : "—"}</span>
				</div>
				<div className="xz-gb__row">
					<span className="xz-gb__k">手动 Reset</span>
					<span className="xz-gb__v">{instance ? `${instance.reset_count} 次` : "—"}</span>
				</div>
				<div className="xz-gb__row">
					<span className="xz-gb__k">端点</span>
					<span className="xz-gb__v">
						<EndpointList instance={instance} exposed={box.exposed} />
					</span>
				</div>
			</div>

			{/* ── 实例生命周期 ─────────────────────────────────────────── */}
			<div className="xz-awdp-actions">
				{policy.instanceOps ? (
					<>
						{!running ? (
							<Button size="sm" icon="play" loading={startMutation.isPending} disabled={busy} onClick={() => startMutation.mutate()}>
								启动实例
							</Button>
						) : (
							<Button
								size="sm"
								variant="danger-ghost"
								icon="stop"
								loading={stopMutation.isPending}
								disabled={busy}
								onClick={() => void onStopInstance()}
							>
								停止实例
							</Button>
						)}
						<Button
							size="sm"
							icon="refresh"
							loading={resetMutation.isPending}
							disabled={busy}
							onClick={() => void onResetInstance()}
						>
							重置实例
						</Button>
					</>
				) : (
					<span className="xz-awdp-note">当前阶段不允许启动 / 停止 / 重置实例（仅 Break、Fix 阶段可用）。</span>
				)}
				{probeInstance ? (
					<Button size="sm" variant="quiet" icon="search" loading={probe.isFetching} onClick={() => void probe.refetch()}>
						查询实例
					</Button>
				) : null}
			</div>

			{probe.isError ? (
				<div className="xz-awdp-note" role="alert">
					实例查询失败：{errorText(probe.error)}
				</div>
			) : null}
			{probe.isSuccess ? (
				<div className="xz-awdp-inline">
					<Icon name={probe.data ? "server" : "info"} size={14} />
					{probe.data ? (
						<span className="xz-mono xz-xs">
							服务端最新：{probe.data.instance_id} · {probe.data.runtime_state} · 世代 #{probe.data.runtime_generation}
						</span>
					) : (
						<span className="xz-xs">服务端返回：该 GameBox 当前没有实例。</span>
					)}
				</div>
			) : null}
			{probe.isFetching ? <InlineLoading>正在查询实例…</InlineLoading> : null}

			{/* ── Break flag（仅 break 阶段）──────────────────────────── */}
			{policy.submitBreak ? (
				<div className="xz-flagbar">
					<TextInput
						className="xz-input--mono"
						value={flag}
						placeholder="粘贴本题捕获到的 flag"
						aria-label={`${box.name} 的 Break flag`}
						onChange={(event) => setFlag(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && flag.trim() && !breakMutation.isPending) breakMutation.mutate(flag.trim());
						}}
					/>
					<Button
						variant="gold"
						icon="flag"
						loading={breakMutation.isPending}
						disabled={!flag.trim()}
						onClick={() => breakMutation.mutate(flag.trim())}
					>
						提交 flag
					</Button>
				</div>
			) : null}

			{/* ── 补丁 / 自检（仅 fix 阶段）────────────────────────────── */}
			{policy.uploadPatch ? (
				<>
					<div className="xz-awdp-file">
						<input
							type="file"
							accept=".tar.gz,.tgz,application/gzip"
							aria-label={`${box.name} 的修复补丁（tar.gz）`}
							onChange={(event) => {
								const file = event.target.files?.[0] ?? null;
								// 清空原生输入值：允许再次选择同一个文件（否则 change 不再触发）。
								event.target.value = "";
								setPatchFile(file);
								setPatchResult(null);
							}}
						/>
						{patchFile ? (
							<>
								<span className="xz-awdp-file__name">{patchFile.name}</span>
								<span className="xz-awdp-file__size">{formatBytes(patchFile.size)}</span>
							</>
						) : (
							<span className="xz-awdp-file__size">未选择文件（.tar.gz / .tgz）</span>
						)}
					</div>
					<div className="xz-awdp-actions">
						<Button
							size="sm"
							variant="primary"
							icon="upload"
							loading={patchMutation.isPending}
							disabled={!patchFile || busy}
							onClick={() => patchFile && patchMutation.mutate(patchFile)}
						>
							{patchMutation.isPending ? "上传并应用…" : "上传补丁"}
						</Button>
						<Button
							size="sm"
							icon="beaker"
							loading={checkMutation.isPending}
							disabled={!running || busy}
							title={running ? "执行 healthcheck + judge（不计分）" : "实例必须处于运行中"}
							onClick={() => checkMutation.mutate()}
						>
							Test Check
						</Button>
						{isPractice && actions.allCheck ? (
							<Button
								size="sm"
								variant="gold"
								icon="bolt"
								loading={allCheckMutation.isPending}
								disabled={!running || busy}
								title={running ? "一键官方判定（会结束本次 run）" : "实例必须处于运行中"}
								onClick={() => void onAllCheck()}
							>
								ALL Check
							</Button>
						) : null}
						<Button
							size="sm"
							variant="quiet"
							icon="download"
							loading={sourceMutation.isPending}
							disabled={box.source_code_dir === null || busy}
							title={box.source_code_dir === null ? "该 GameBox 未声明 AWDP 源码目录，后端会返回 404" : "下载 source.tar.gz"}
							onClick={onSource}
						>
							下载源码
						</Button>
					</div>
					{!running ? <div className="xz-awdp-note">实例未运行：Test Check / ALL Check 需要实例处于 running 状态。</div> : null}
				</>
			) : null}

			{/* ── 回执 ────────────────────────────────────────────────── */}
			{breakResult ? (
				<div
					className="xz-awdp-result"
					data-tone={breakResult.accepted && breakResult.scored ? "ok" : breakResult.accepted ? "warn" : "danger"}
				>
					<div className="xz-awdp-result__head">
						<Icon name={breakResult.accepted ? (breakResult.scored ? "check" : "warn") : "alert"} size={15} />
						{breakResult.accepted
							? breakResult.scored
								? "flag 正确，已计分"
								: "flag 正确，但此前已被攻破（不重复计分）"
							: "flag 未被接受"}
					</div>
					<ResultRow k="accepted" v={String(breakResult.accepted)} />
					<ResultRow k="scored" v={String(breakResult.scored)} />
					<ResultRow k="already_broken" v={String(breakResult.already_broken)} />
				</div>
			) : null}

			{patchResult ? (
				<div className="xz-awdp-result" data-tone={patchResult.status === "applied" ? "ok" : "danger"}>
					<div className="xz-awdp-result__head">
						<Icon name={patchResult.status === "applied" ? "check" : "alert"} size={15} />
						{patchResult.status === "applied" ? "补丁已应用" : "补丁未通过"}
					</div>
					<ResultRow k="status" v={patchResult.status} />
					{patchResult.error_message ? <ResultRow k="原因" v={patchResult.error_message} /> : null}
				</div>
			) : null}

			{checkResult ? (
				<div
					className="xz-awdp-result"
					data-tone={checkResult.judge_ok === false ? "danger" : checkResult.judge_ok === true ? "ok" : "warn"}
				>
					<div className="xz-awdp-result__head">
						<Icon name="beaker" size={15} />
						Test Check（不计分，仅供诊断）
					</div>
					<ResultRow k="评估 ID" v={checkResult.evaluation_id} />
					<ResultRow k="状态" v={`${checkResult.status} · ${awdpStatusMeta(checkResult.status).label}`} />
					<ResultRow
						k="健康检查"
						v={checkResult.healthcheck_ok === null ? "未执行" : checkResult.healthcheck_ok ? "OK" : "DOWN"}
					/>
					{checkResult.healthcheck_detail ? (
						<ResultRow k="健康详情" v={checkResult.healthcheck_detail.join(" / ")} />
					) : null}
					<ResultRow k="Judge" v={checkResult.judge_ok === null ? "未执行" : checkResult.judge_ok ? "PASS" : "FAIL"} />
					{checkResult.judge_detail ? <ResultRow k="Judge 详情" v={checkResult.judge_detail} /> : null}
					<ResultRow
						k="Exploit"
						v={
							checkResult.exploit_ok === null
								? "未执行（无结论）"
								: checkResult.exploit_ok
									? "仍可被攻破"
									: "未能攻破"
						}
					/>
					{checkResult.exploit_detail ? <ResultRow k="Exploit 详情" v={checkResult.exploit_detail} /> : null}
					<div className="xz-awdp-note">
						注意：`exploit_ok` 只有在真正执行到 exploit 时才有结论；`false` **不等于**「修复成功」——
						它也可能是 exploit 未执行 / 未跑通。
					</div>
				</div>
			) : null}

			{allCheckResult ? (
				<div className="xz-awdp-result" data-tone={allCheckResult.status === "patched" ? "ok" : "warn"}>
					<div className="xz-awdp-result__head">
						<Icon name={allCheckResult.status === "patched" ? "check" : "warn"} size={15} />
						ALL Check 结果：{awdpStatusMeta(allCheckResult.status).label}
					</div>
					<ResultRow k="status" v={allCheckResult.status} />
					<ResultRow k="已结算回合" v={`${allCheckResult.swept_rounds} 个（swept=${String(allCheckResult.swept)}）`} />
					<ResultRow k="目标回合" v={String(allCheckResult.target_round)} />
					{allCheckResult.healthcheck_detail ? <ResultRow k="健康检查" v={allCheckResult.healthcheck_detail} /> : null}
					{allCheckResult.judge_detail ? <ResultRow k="Judge" v={allCheckResult.judge_detail} /> : null}
					{allCheckResult.exploit_detail ? <ResultRow k="Exploit" v={allCheckResult.exploit_detail} /> : null}
				</div>
			) : null}

			{sourceHref ? (
				<div className="xz-awdp-result" data-tone="ok">
					<div className="xz-awdp-result__head">
						<Icon name="download" size={15} />
						源码下载链接已生成（预签名，有时效）
					</div>
					<a className="xz-awdp-inline" href={sourceHref} target="_blank" rel="noreferrer noopener">
						<Icon name="external" size={14} />
						若未自动打开，点击这里下载 source.tar.gz
					</a>
				</div>
			) : null}
		</article>
	);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6. 回合 / 评测 / 计分 / 积分榜 / 趋势
 * ════════════════════════════════════════════════════════════════════════ */

export function AwdpRoundsCard({ rounds }: { rounds: readonly AwdpRoundDto[] }) {
	const now = useNow(1000);
	return (
		<Card>
			<CardHead title="回合" icon="layers" sub={`共 ${rounds.length} 轮`} />
			<CardBody flush>
				<DataTable
					compact
					columns={[
						{ key: "sequence", header: "#", numeric: true, width: 60, render: (row: AwdpRoundDto) => row.sequence },
						{ key: "starts_at", header: "开始", render: (row: AwdpRoundDto) => formatDateTime(row.starts_at) },
						{ key: "cutoff_at", header: "截止", render: (row: AwdpRoundDto) => formatDateTime(row.cutoff_at) },
						{
							key: "remain",
							header: "剩余",
							render: (row: AwdpRoundDto) => {
								const remain = new Date(row.cutoff_at).getTime() - now;
								return remain > 0 ? formatCountdown(row.cutoff_at) : "已截止";
							},
						},
						{ key: "status", header: "状态", render: (row: AwdpRoundDto) => <Badge tone="neutral">{row.status}</Badge> },
					]}
					rows={rounds}
					rowKey={(row) => row.id}
					empty={<EmptyState icon="layers" title="暂无回合" desc="Fix 阶段开始后，后端会按配置生成回合。" />}
				/>
			</CardBody>
		</Card>
	);
}

type AnyEvaluation = AwdpEvaluationDto | AwdpRunEvaluationDto;

function exploitOf(evaluation: AnyEvaluation): string | null {
	return "exploit_result" in evaluation ? evaluation.exploit_result : null;
}

export function AwdpEvaluationsCard({ evaluations }: { evaluations: readonly AnyEvaluation[] }) {
	return (
		<Card>
			<CardHead
				title="我的评测"
				icon="clipboard"
				sub={`手动 + 官方 · 共 ${evaluations.length} 条`}
			/>
			<CardBody flush>
				<DataTable
					compact
					columns={[
						{
							key: "round",
							header: "回合",
							numeric: true,
							width: 64,
							render: (row: AnyEvaluation) => row.round_sequence ?? "—",
						},
						{
							key: "kind",
							header: "类型",
							render: (row: AnyEvaluation) => (
								<Badge tone={row.kind === "official" ? "crimson" : "neutral"}>
									{row.kind === "official" ? "官方" : "手动"}
								</Badge>
							),
						},
						{
							key: "status",
							header: "结论",
							render: (row: AnyEvaluation) => {
								const meta = awdpStatusMeta(row.status);
								return <Badge tone={meta.tone}>{meta.label}</Badge>;
							},
						},
						{
							key: "healthcheck",
							header: "健康检查",
							render: (row: AnyEvaluation) => (
								<span className="xz-mono xz-xs" title={row.healthcheck_result ?? ""}>
									{row.healthcheck_result ?? "—"}
								</span>
							),
						},
						{
							key: "judge",
							header: "Judge",
							render: (row: AnyEvaluation) => (
								<span className="xz-mono xz-xs" title={row.judge_result ?? ""}>
									{row.judge_result ?? "—"}
								</span>
							),
						},
						{
							key: "exploit",
							header: "Exploit",
							render: (row: AnyEvaluation) => {
								const value = exploitOf(row);
								return (
									<span className="xz-mono xz-xs" title={value ?? ""}>
										{value ?? "—"}
									</span>
								);
							},
						},
						{
							key: "finished_at",
							header: "完成时间",
							render: (row: AnyEvaluation) => (row.finished_at ? formatDateTime(row.finished_at) : "未完成"),
						},
					]}
					rows={evaluations}
					rowKey={(row) => row.id}
					empty={
						<EmptyState
							icon="clipboard"
							title="暂无评测记录"
							desc="上传补丁后，官方评测会在每个回合 cutoff 时自动执行；也可以手动 Test Check 了解当前状态（不计分）。"
						/>
					}
				/>
			</CardBody>
		</Card>
	);
}

export function AwdpScoresCard({ scores, gameboxName }: { scores: AwdpRunScoresDto; gameboxName: string }) {
	return (
		<Card>
			<CardHead
				title="计分流水"
				icon="trophy"
				sub={`合计 ${scores.total} 分`}
				actions={<Badge tone="gold">{scores.history.length} 条记账</Badge>}
			/>
			<CardBody flush>
				<DataTable
					compact
					columns={[
						{
							key: "score_type",
							header: "类型",
							render: (row: ScoreEventDto) => (
								<Badge tone={row.score_type === "break" ? "danger" : "info"}>
									{row.score_type === "break" ? "Break 攻破" : "Fix 修复"}
								</Badge>
							),
						},
						{ key: "gamebox", header: "GameBox", render: () => gameboxName },
						{
							key: "fix_round_id",
							header: "回合",
							render: (row: ScoreEventDto) => (row.fix_round_id ? `${row.fix_round_id.slice(0, 8)}…` : "—"),
						},
						{
							key: "delta",
							header: "分值",
							numeric: true,
							render: (row: ScoreEventDto) => (
								<span className="xz-awdp-delta" data-sign={row.delta >= 0 ? "plus" : "minus"}>
									{row.delta > 0 ? `+${row.delta}` : row.delta}
								</span>
							),
						},
						{ key: "created_at", header: "时间", render: (row: ScoreEventDto) => formatDateTime(row.created_at) },
					]}
					rows={scores.history}
					rowKey={(row) => row.id}
					empty={<EmptyState icon="trophy" title="尚无计分记录" desc="提交 Break flag 或通过官方 Fix 评测后会在此产生 append-only 记账。" />}
				/>
			</CardBody>
		</Card>
	);
}

/**
 * 积分榜明细矩阵。
 *
 * 下标契约（`packages/sdk/src/api/awdp.ts:185-200`）：`break_status` /
 * `fix_gamebox_score` 与 `gameboxes` 对齐；`fix_round_status` 是
 * **`[gamebox][round]` 二维**数组；`rows[].is_me` 标记当前主体。
 */
export function AwdpScoreboardCard({ detail }: { detail: AwdpScoreboardDetail }) {
	const { gameboxes, rounds, rows } = detail;
	return (
		<Card>
			<CardHead
				title="积分榜明细"
				icon="trophy"
				sub={
					detail.participant_mode === "team"
						? `团队赛 · ${rows.length} 支队伍 · ${gameboxes.length} 个 GameBox · ${rounds.length} 轮`
						: `个人赛 · ${rows.length} 名选手 · ${gameboxes.length} 个 GameBox · ${rounds.length} 轮`
				}
			/>
			<CardBody flush>
				{rows.length === 0 ? (
					<EmptyState
						icon="trophy"
						title="暂无计分明细"
						desc="赛事开始并产生计分后，这里会按主体 × GameBox × 回合显示明细。"
					/>
				) : (
					<div className="xz-awdp-matrixscroll">
						<table className="xz-board">
							<thead>
								<tr>
									<th>#</th>
									<th>主体</th>
									<th>Break</th>
									<th>Fix</th>
									<th>总分</th>
									{gameboxes.map((gamebox) => (
										<th key={gamebox.id} title={gamebox.category}>
											{gamebox.name}
											<span className="xz-awdp-gbcol">
												破 / Fix / {rounds.length > 0 ? `${rounds.length} 轮` : "无回合"}
											</span>
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => (
									<tr key={row.subject_id} className={row.is_me ? "xz-board__row--me" : undefined}>
										<td className="xz-board__rank" data-top={row.rank}>
											{row.rank}
										</td>
										<td>
											{row.subject_name}
											{row.is_me ? (
												<>
													{" "}
													<Badge tone="gold">我</Badge>
												</>
											) : null}
										</td>
										<td className="xz-board__num">{row.break_score}</td>
										<td className="xz-board__num">{row.fix_score}</td>
										<td className="xz-board__score">{row.total_score}</td>
										{gameboxes.map((gamebox, gameboxIndex) => {
											const broken = row.break_status[gameboxIndex] ?? false;
											const fixScore = row.fix_gamebox_score[gameboxIndex] ?? 0;
											const roundStatuses = row.fix_round_status[gameboxIndex] ?? [];
											return (
												<td key={gamebox.id}>
													<div className="xz-awdp-cells">
														<span
															className="xz-awdp-cell"
															data-status={broken ? "ok" : "neutral"}
															title={`Break：${broken ? "已攻破" : "未攻破"}`}
														>
															{broken ? "破" : "—"}
														</span>
														<span
															className="xz-awdp-cell"
															data-status={fixScore !== 0 ? "gold" : "neutral"}
															title={`Fix 得分：${fixScore}`}
														>
															{fixScore}
														</span>
														{rounds.map((round, roundIndex) => {
															const status = roundStatuses[roundIndex] ?? null;
															const meta = awdpStatusMeta(status);
															return (
																<span
																	key={`${gamebox.id}-${round.sequence}`}
																	className="xz-awdp-cell"
																	data-status={meta.tone === "crimson" ? "gold" : meta.tone}
																	title={`第 ${round.sequence} 轮（${formatDateTime(round.cutoff_at)}）：${meta.label}`}
																>
																	{meta.short}
																</span>
															);
														})}
													</div>
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</CardBody>
			<CardFoot>
				<div className="xz-awdp-legend">
					<span>单元格：破 = 是否攻破，数字 = 该 GameBox 的 Fix 分</span>
					<span>单字 = 各回合官方结论（等/跑/无/崩/损/漏/通/错），悬停可看轮次与时间</span>
				</div>
			</CardFoot>
		</Card>
	);
}

const MAX_TREND_SERIES = 12;

/** 得分趋势（结构同 Jeopardy `TrendItem`：`{name, points:[{name,score,time}]}`）。 */
export function AwdpTrendCard({ items }: { items: readonly AwdpTrendItem[] }) {
	const { series, truncated, maxScore } = useMemo(() => {
		const sorted = [...items].sort((a, b) => lastScore(b) - lastScore(a));
		const kept = sorted.slice(0, MAX_TREND_SERIES);
		let max = 0;
		for (const item of items) {
			for (const point of item.points) {
				if (point.score > max) max = point.score;
			}
		}
		return { series: kept, truncated: items.length - kept.length, maxScore: max };
	}, [items]);

	return (
		<Card>
			<CardHead
				title="得分趋势"
				icon="trendUp"
				sub={items.length === 0 ? "暂无数据" : `${items.length} 条折线`}
			/>
			<CardBody>
				{series.length === 0 ? (
					<EmptyState icon="trendUp" title="暂无趋势数据" desc="赛事产生计分后，这里会按主体显示得分时序。" />
				) : (
					<div className="xz-awdp-trend-list">
						{series.map((item) => (
							<div className="xz-awdp-trend-row" key={item.name}>
								<div className="xz-awdp-trend-name">
									<span>{item.name}</span>
									<span className="xz-mono xz-xs">最新 {lastScore(item)} 分</span>
								</div>
								<div className="xz-trend">
									{item.points.map((point, index) => {
										const height = maxScore > 0 ? Math.max(2, (point.score / maxScore) * 100) : 2;
										const step = Math.max(1, Math.ceil(item.points.length / 12));
										return (
											<div
												key={`${point.time}-${index}`}
												className="xz-trend__col"
												title={`${point.name} · ${point.score} 分 · ${formatDateTime(point.time)}`}
											>
												<div className="xz-trend__stack">
													<div className="xz-trend__seg" style={{ height: `${height}%` }} />
												</div>
												{index % step === 0 ? (
													<span className="xz-trend__label">{formatTime(point.time)}</span>
												) : (
													<span className="xz-trend__label"> </span>
												)}
											</div>
										);
									})}
								</div>
							</div>
						))}
					</div>
				)}
			</CardBody>
			<CardFoot>
				<div className="xz-awdp-legend">
					<span>柱高按全局最高分归一化</span>
					{truncated > 0 ? <span>仅显示最新得分最高的 {MAX_TREND_SERIES} 条折线，另有 {truncated} 条未显示</span> : null}
				</div>
			</CardFoot>
		</Card>
	);
}

function lastScore(item: AwdpTrendItem): number {
	const last = item.points[item.points.length - 1];
	return last?.score ?? 0;
}
