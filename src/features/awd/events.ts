/**
 * AWD 实时事件 → 中文战报（纯函数，选手端 / 管理端 / 大屏共用）。
 *
 * payload 结构**逐字段来自后端 `apps/api/src/modules/event/awd/websocket.rs`**，
 * 不猜字段：
 *
 * | 事件 | payload |
 * |---|---|
 * | `attack.success` | `attacker_team_id` / `victim_team_id` / `event_gamebox_id` / `points` |
 * | `score.changed` | `team_id` / `new_total` / `delta` |
 * | `judge.result` | `team_id` / `event_gamebox_id` / `status`（up/down/judge_error）/ `duration_ms` |
 * | `round.started` | `round_number` / `phase` |
 * | `round.ended` / `round.completed` | `round_number` |
 * | `network.policy.applied` / `failed` | `desired_revision` / `observed_revision` / `phase` |
 * | `gamebox.reset` | `instance_id` / `team_id` / `status` |
 * | `team.banned` / `team.unbanned` | `team_id` |
 * | `event.finished` | `{}` |
 *
 * 约定：**认不出的事件类型或 payload 缺字段时返回空串**，由调用方回落到原始摘要
 * （`stream.tsx` 的 `summary`）——绝不编造平台没给的内容。
 *
 * 注：后端目前只在提交成功时发布 `score.changed`（`attack.success` 定义了但无发布点），
 * 所以战报里的攻击行来自 `score.changed` 的 `delta` 正负，这是平台自己的数字，不是推断。
 */

/** 阶段中文名（`AwdPhase`）。 */
export const PHASE_LABEL: Record<string, string> = {
	hardening: "加固期",
	attack: "攻击期",
	pause: "暂停期",
};

/** 生命周期中文名（`AwdEventStatus`，14 个取值全列，未知值回落原样显示）。 */
export const LIFECYCLE_LABEL: Record<string, string> = {
	draft: "草稿",
	configuring: "配置中",
	deploying: "部署中",
	deployed: "已部署",
	prechecking: "预检中",
	verified: "已验证",
	start_blocked: "开赛受阻",
	deploy_failed: "部署失败",
	verification_failed: "验证失败",
	running: "进行中",
	paused: "已暂停",
	network_error: "网络异常",
	finished: "已结束",
	archived: "已归档",
};

/** AWD 判题结果（AWD 规范 §17）：`up` / `down` / `judge_error`。 */
const JUDGE_STATUS_LABEL: Record<string, string> = {
	up: "服务正常",
	down: "服务异常",
	judge_error: "判题异常",
};

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function number(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 队伍展示名：有名单用名单，没有就退化成短 ID（不猜名字）。 */
function teamName(teamId: unknown, names?: Map<string, string>, ownTeamId?: string | null): string {
	const id = text(teamId);
	if (!id) return "未知队伍";
	if (ownTeamId && id === ownTeamId) return "本队";
	return names?.get(id) ?? `队伍 ${id.slice(0, 8)}`;
}

function revision(value: unknown): string {
	const n = number(value);
	return n === null ? "?" : String(n);
}

/**
 * 把一条 AWD 实时事件翻译成中文战报。
 *
 * @param type SSE 事件的 `type` 原样字符串
 * @param payload 事件的 `payload`
 * @param names 可选的队伍 ID → 名称映射（大屏用积分榜数据；没有则显示短 ID）
 * @param ownTeamId 可选的本队 ID（选手端高亮语义）
 * @returns 中文战报；**无法翻译时返回空串**，调用方应回落到原始摘要
 */
export function describeAwdEvent(
	type: string,
	payload: unknown,
	names?: Map<string, string>,
	ownTeamId?: string | null,
): string {
	const p = asRecord(payload);
	const team = (id: unknown) => teamName(id, names, ownTeamId);

	switch (type) {
		case "attack.success": {
			const attacker = team(p.attacker_team_id);
			const victim = team(p.victim_team_id);
			const points = number(p.points);
			const loss = number(p.victim_loss);
			const parts: string[] = [];
			if (points !== null) parts.push(`+${points}`);
			if (loss !== null && loss > 0) parts.push(`对方 -${loss}`);
			if (p.first_blood === true) parts.push("首杀");
			return `${attacker} 攻破 ${victim}${parts.length > 0 ? `（${parts.join("，")}）` : ""}`;
		}
		case "score.changed": {
			const who = team(p.team_id);
			const delta = number(p.delta);
			const total = number(p.new_total);
			const totalText = total === null ? "" : `（累计 ${total}）`;
			if (delta === null) return total === null ? "" : `${who} 得分更新为 ${total}`;
			if (delta > 0) return `${who} 攻击得分 +${delta}${totalText}`;
			if (delta < 0) return `${who} 被攻破 ${delta}${totalText}`;
			return `${who} 得分未变化${totalText}`;
		}
		case "judge.result": {
			const who = team(p.team_id);
			const status = text(p.status);
			const statusText = JUDGE_STATUS_LABEL[status] ?? (status || "结果未知");
			const ms = number(p.duration_ms);
			return `${who} 判题：${statusText}${ms === null ? "" : `（${ms}ms）`}`;
		}
		case "round.started": {
			const n = number(p.round_number);
			const phase = text(p.phase);
			const phaseText = phase ? `（${PHASE_LABEL[phase] ?? phase}）` : "";
			return n === null ? `回合开始${phaseText}` : `第 ${n} 回合开始${phaseText}`;
		}
		case "round.ended": {
			const n = number(p.round_number);
			return n === null ? "回合结束，进入结算" : `第 ${n} 回合结束，进入结算`;
		}
		case "round.completed": {
			const n = number(p.round_number);
			return n === null ? "回合结算完成" : `第 ${n} 回合结算完成`;
		}
		case "network.policy.applied":
			return `网络策略已生效（rev ${revision(p.observed_revision)}）`;
		case "network.policy.failed":
			return `网络策略下发失败（期望 rev ${revision(p.desired_revision)}，实际 rev ${revision(p.observed_revision)}）`;
		case "gamebox.reset": {
			const who = team(p.team_id);
			const status = text(p.status);
			return `${who} 重置实例${status ? `（${status}）` : ""}`;
		}
		case "team.banned":
			return `${team(p.team_id)} 已被封禁`;
		case "team.unbanned":
			return `${team(p.team_id)} 已解除封禁`;
		case "event.finished":
			return "比赛已结束";
		default:
			return "";
	}
}

/** 带 payload 与时间的流水条目（大屏与面板的 feed 形状）。 */
export interface AwdFeedLike {
	type: string;
	payload: unknown;
	occurredAt: string | null;
}

/**
 * 战报去重（纯展示层）：
 *
 * 一次成功提交后端会发两条事件 —— `score.changed`（攻击方得分）与
 * `attack.success`（双方队伍 + 一血）。同一条战况显示两行是噪音，所以当
 * `attack.success` 存在时，丢弃它前后 5 秒内**同一攻击方**的 `score.changed`。
 *
 * 只做筛选，不改写任何字段；匹配不上时原样保留（宁可多显示，不丢信息）。
 */
export function dedupeAwdFeed<T extends AwdFeedLike>(entries: T[]): T[] {
	const attacks = entries.filter((entry) => entry.type === "attack.success");
	if (attacks.length === 0) return entries;

	const millis = (value: string | null): number | null => {
		if (!value) return null;
		const time = new Date(value).getTime();
		return Number.isNaN(time) ? null : time;
	};

	return entries.filter((entry) => {
		if (entry.type !== "score.changed") return true;
		const p = asRecord(entry.payload);
		const delta = number(p.delta);
		if (delta === null || delta <= 0) return true; // 失分等其它变更一律保留
		const teamId = text(p.team_id);
		if (!teamId) return true;
		const at = millis(entry.occurredAt);
		return !attacks.some((attack) => {
			const ap = asRecord(attack.payload);
			if (text(ap.attacker_team_id) !== teamId) return false;
			const attackAt = millis(attack.occurredAt);
			if (at === null || attackAt === null) return true; // 时间不可比时按同一条处理
			return Math.abs(attackAt - at) <= 5_000;
		});
	});
}
