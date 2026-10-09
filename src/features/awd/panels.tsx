/**
 * 赛事驾驶舱 ·「靶场」标签（选手端 AWD）。
 *
 * 本面板 = 选手端 AWD 的全部 8 项必需能力，全部通过公共 SDK 读取真实数据：
 *
 * | # | 能力 | SDK |
 * |---|---|---|
 * | 1 | 赛事状态（phase / current_round / banned / score） | `client.awd.player.status` |
 * | 2 | GameBox 列表（IP / 容器 / 健康） | `client.awd.player.gameboxes` |
 * | 3 | GameBox 重置（二次确认） | `client.awd.player.resetGamebox` |
 * | 4 | flag 提交（仅 attack 相位） | `client.awd.player.submitFlag` |
 * | 5 | 积分榜（30s 轮询，高亮本队） | `client.awd.player.scores` |
 * | 6 | WireGuard 配置（可复制） | `client.awd.player.wireguardConfig` |
 * | 7 | SSH 凭据（密码走 `<Secret>`） | `client.awd.player.sshConfig` |
 * | 8 | 实时流（状态注入顶栏） | `useBindings().useAwdEventStream` |
 *
 * 权限与相位判定集中在 `./phase.tsx` 的纯函数 `awdAvailability()` 里，
 * 不在 JSX 中散落 `if`；`AwdPlayerStatus` 是所有状态判定的**权威来源**。
 */

import type { AwdPlayerStatus } from "@floatctf/sdk";
import { useQuery } from "@tanstack/react-query";

import "./styles.css";

import { call } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { qk } from "../../api/keys.ts";
import { QueryBoundary } from "../../ui/overlays.tsx";
import { Banner } from "../../ui/primitives.tsx";
import { familyLabel } from "../events/status.ts";
import type { EventPanelProps } from "../panels.ts";
import {
	AwdCredentialsCard,
	AwdFeedCard,
	AwdFlagCard,
	AwdGameboxesCard,
	AwdScoresCard,
	AwdStatusCard,
	AwdStreamNotice,
} from "./components.tsx";
import { type AwdAvailability, awdAvailability } from "./phase.tsx";
import { type AwdRealtime, useAwdRealtime } from "./stream.tsx";

/** 从归一化错误里读 HTTP 状态码（`FloatCTFError.httpStatus`，不假设 Axios 结构）。 */
function httpStatusOf(error: unknown): number | undefined {
	if (error && typeof error === "object" && "httpStatus" in error) {
		const value = (error as { httpStatus?: unknown }).httpStatus;
		return typeof value === "number" ? value : undefined;
	}
	return undefined;
}

export function AwdArenaPanel({ eventId, mode }: EventPanelProps) {
	const client = useClient();
	// 实时链路先订阅：它的连接状态决定其余查询是「事件驱动」还是「15s 轮询兜底」。
	const realtime = useAwdRealtime(eventId);

	const statusQuery = useQuery({
		queryKey: qk.awd.status(eventId),
		queryFn: () => call(client.awd.player.status(eventId), "AWD 赛事状态"),
		refetchInterval: realtime.pollInterval,
	});

	const status = statusQuery.data;
	// 权威判定：phase × status × banned × final_settlement → 每个操作是否可用。
	const availability = awdAvailability(status);

	return (
		<div className="xz-awd">
			{mode !== "awd" ? (
				<Banner tone="warn" title="面板与赛制不一致">
					驾驶舱报告的赛制是「{familyLabel(mode)}」，本面板只适用于 AWD；仍按 AWD 接口读取数据。
				</Banner>
			) : null}
			<AwdStreamNotice realtime={realtime} />
			{/* 数据大屏：只读 kiosk 视图，投屏时用新窗口打开（不影响本页实时链路）。 */}
			<a className="xz-awd-screen-entry" href={`/events/${eventId}/awd/screen`} target="_blank" rel="noreferrer">
				AWD 数据大屏（投屏用，新窗口打开）
			</a>
			{/* 后端：status 需要**队伍成员关系**（403「你不是本赛事的参赛者」），
			    赛事未配置 AWD 时 404。这里把平台错误翻译成可执行的下一步。 */}
			{statusQuery.isError && (httpStatusOf(statusQuery.error) === 403 || httpStatusOf(statusQuery.error) === 404) ? (
				<Banner tone="info" title="需要先加入赛事队伍 / 等待 AWD 部署">
					AWD 状态接口以<b>队伍</b>为主体：403 表示你还不是本赛事的队伍成员，请先在「概览」标签完成报名与组队；
					404 表示该赛事尚未配置（部署）AWD。平台的原始错误文案见下方。
				</Banner>
			) : null}
			<QueryBoundary
				isPending={statusQuery.isPending}
				isError={statusQuery.isError}
				error={statusQuery.error}
				refetch={() => void statusQuery.refetch()}
				loadingLabel="正在加载 AWD 赛事状态…"
			>
				{status ? (
					<AwdArenaBody
						eventId={eventId}
						status={status}
						availability={availability}
						realtime={realtime}
						refreshing={statusQuery.isFetching}
						onRefresh={() => void statusQuery.refetch()}
					/>
				) : null}
			</QueryBoundary>
		</div>
	);
}

function AwdArenaBody({
	eventId,
	status,
	availability,
	realtime,
	refreshing,
	onRefresh,
}: {
	eventId: string;
	status: AwdPlayerStatus;
	availability: AwdAvailability;
	realtime: AwdRealtime;
	refreshing: boolean;
	onRefresh: () => void;
}) {
	const client = useClient();

	// 「我的队伍」只存在于赛事详情（列表接口不返回 `team_result`），用于高亮积分榜本队行。
	const eventInfo = useQuery({
		queryKey: qk.events.detail(eventId),
		queryFn: () => call(client.service.events.get(eventId), "赛事详情"),
	});
	const myTeamId = eventInfo.data?.team_result?.team.id ?? null;

	return (
		<>
			<AwdStatusCard
				status={status}
				availability={availability}
				refreshing={refreshing}
				onRefresh={onRefresh}
			/>
			<div className="xz-split">
				<div className="xz-col xz-awd-stack">
					<AwdFlagCard eventId={eventId} availability={availability} />
					<AwdGameboxesCard
						eventId={eventId}
						availability={availability}
						pollInterval={realtime.pollInterval}
					/>
				</div>
				<aside className="xz-col xz-awd-stack">
					<AwdScoresCard
						eventId={eventId}
						myTeamId={myTeamId}
						myTeamUnavailable={eventInfo.isError}
					/>
					<AwdCredentialsCard eventId={eventId} availability={availability} />
					<AwdFeedCard realtime={realtime} />
				</aside>
			</div>
		</>
	);
}
