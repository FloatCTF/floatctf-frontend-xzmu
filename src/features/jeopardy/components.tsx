/**
 * Jeopardy 共享组件 —— 题目实例生命周期（获取 / 启动 / 倒计时 / 销毁）与 flag 提交。
 *
 * 三个使用场景只差「取实例 / 启动 / 提交」的后端入口，因此统一到一个 `ChallengeRunner`：
 *
 * | 场景 | 取实例 | 启动 | 提交 |
 * |---|---|---|---|
 * | 赛事题目 | `events.getChallengeInstance` | `events.launchSingleInstance` | `submit.submitSingle` |
 * | 独立题目详情 | `challenges.getInstance` | `instances.launch` | `submit.submit` |
 * | 题集内题目 | 同「独立题目详情」（题集是练习维度，没有赛事上下文） |
 *
 * 后端语义（见 docs/CAPABILITY-BEHAVIOR-MAP「Jeopardy」）：
 * - `container_port == null` ⇒ 静态题：没有容器，但**仍要**启动一个答题实例才拿得到 `instance_id`；
 * - `challenges.getInstance` 对非动态题可能失败（该接口只查系统练习赛事，且无实例时 `data=null`），
 *   调用方必须把它当「无实例」而不是「加载失败」；
 * - 实例 `content` 是**HTML**：本前端不做 `dangerouslySetInnerHTML`，而是放进
 *   `sandbox=""`（等于全限制）的 iframe，或按 Markdown 渲染纯文本；
 * - 实例 `flag` 字段是答案凭据，任何界面都不渲染。
 */

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChallengesListItem, Instances } from "@floatctf/sdk";

import { call } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { errorText } from "../../api/errors.ts";
import { formatBytes, formatCountdown, formatDateTime } from "../../lib/format.ts";
import { useNow } from "../../lib/hooks.ts";
import { Link } from "../../router/Link.tsx";
import { Icon } from "../../ui/icons.tsx";
import { MarkdownView } from "../../ui/Markdown.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../ui/overlays.tsx";
import { Badge, Button, CopyButton, Field, KeyValue, TextInput } from "../../ui/primitives.tsx";

/* ── 后端语义判定 ─────────────────────────────────────────────────── */

/** `container_port == null` ⇒ 静态题（无容器，启动后直接提交 flag）。 */
export function isStaticChallenge(challenge: { container_port?: number | null }): boolean {
	return challenge.container_port === null || challenge.container_port === undefined;
}

/**
 * 附件下载地址：平台由 Caddy 暴露 `/static/challenges/<safe_name>/attachment/*`，
 * SDK 没有附件下载方法（见交付说明的 `PUBLIC SDK GAP`），因此这里按平台既有约定拼路径。
 */
export function attachmentUrl(challenge: {
	safe_name: string;
	attachment?: { path: string } | null;
}): string | null {
	const path = challenge.attachment?.path;
	if (!path) return null;
	return `/static/challenges/${challenge.safe_name}/${path}`;
}

/** 分值为 f64（动态分值），最多展示 2 位小数。 */
export function formatPoints(value: number | null | undefined): string {
	if (value === null || value === undefined || Number.isNaN(value)) return "—";
	return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

/** 一血 / 二血 / 三血 —— `solved_no === 1/2/3`，与后端语义一致。 */
export function bloodLabel(solvedNo: number | null | undefined): string | null {
	if (solvedNo === 1) return "一血";
	if (solvedNo === 2) return "二血";
	if (solvedNo === 3) return "三血";
	return null;
}

export function BloodBadge({
	solvedNo,
	mine,
}: {
	solvedNo: number | null | undefined;
	mine?: boolean;
}) {
	const label = bloodLabel(solvedNo);
	if (!label) return null;
	return (
		<Badge
			tone={solvedNo === 1 ? "gold" : "crimson"}
			icon={solvedNo === 1 ? "crown" : "medal"}
			title={mine ? `你是第 ${solvedNo} 个解出本题的参赛者` : `第 ${solvedNo} 个解出`}
		>
			{mine ? `我拿了${label}` : label}
		</Badge>
	);
}

/* ── 附件 ─────────────────────────────────────────────────────────── */

export function AttachmentLink({ challenge }: { challenge: ChallengesListItem }) {
	const url = attachmentUrl(challenge);
	const attachment = challenge.attachment;
	if (!url || !attachment) return null;
	return (
		<a className="xz-jeo-attach" href={url} download={attachment.name} rel="noreferrer">
			<Icon name="download" size={15} />
			<span className="xz-grow xz-truncate">{attachment.name}</span>
			{typeof attachment.size === "number" ? (
				<span className="xz-mono xz-xs xz-muted">{formatBytes(attachment.size)}</span>
			) : null}
		</a>
	);
}

/* ── 实例倒计时 ───────────────────────────────────────────────────── */

/** `destroy_at` 倒计时（只在挂载该组件的单元格里每秒重渲染）。 */
export function InstanceCountdown({ destroyAt }: { destroyAt: string | null | undefined }) {
	useNow(1000);
	if (!destroyAt) return <span className="xz-muted">不自动销毁</span>;
	const remaining = new Date(destroyAt).getTime() - Date.now();
	const expired = Number.isFinite(remaining) && remaining <= 0;
	return (
		<span
			className={expired ? "xz-jeo-countdown xz-jeo-countdown--expired" : "xz-jeo-countdown"}
			title={formatDateTime(destroyAt)}
		>
			{expired ? "已到期" : formatCountdown(destroyAt)}
		</span>
	);
}

/* ── 题目卡片 ─────────────────────────────────────────────────────── */

export function ChallengeTile({
	challenge,
	points,
	solved,
	solvedNo,
	meta,
	actions,
	onOpen,
	to,
	openLabel = "打开题目",
	pointsGold,
}: {
	challenge: ChallengesListItem;
	/** 赛事维度的动态分值（只有 `events.fetchChallenges` 返回 `current_points`）。 */
	points?: number | null;
	solved?: boolean;
	solvedNo?: number | null;
	/** 卡片底部的补充信息（解出人数、题集名等）。 */
	meta?: ReactNode;
	actions?: ReactNode;
	/** 提供时卡片主体变为按钮（打开弹窗等页内交互）。 */
	onOpen?: () => void;
	/** 提供时卡片主体变为站内链接（保留中键 / ⌘+点击开新标签）。 */
	to?: string;
	openLabel?: string;
	pointsGold?: boolean;
}) {
	const staticChallenge = isStaticChallenge(challenge);

	const main = (
		<>
			<div className="xz-chcard__top">
				<Badge>{challenge.category || "未分类"}</Badge>
				{staticChallenge ? (
					<Badge tone="neutral" icon="file">
						静态题
					</Badge>
				) : (
					<Badge tone="info" icon="box">
						容器题
					</Badge>
				)}
				{solved ? (
					<Badge tone="ok" icon="check">
						已解出
					</Badge>
				) : null}
				<BloodBadge solvedNo={solvedNo} mine />
			</div>
			<div className="xz-chcard__name">{challenge.name}</div>
			<div className="xz-chcard__cat xz-clamp-2">{challenge.description || "（题目没有描述）"}</div>
			<div className="xz-chcard__foot">
				{challenge.attachment ? (
					<span className="xz-muted xz-xs xz-row" style={{ gap: 4 }}>
						<Icon name="file" size={12} />
						附件
					</span>
				) : null}
				{points !== undefined && points !== null ? (
					<span className={pointsGold ? "xz-points xz-points--gold" : "xz-points"}>
						{formatPoints(points)} 分
					</span>
				) : null}
			</div>
			{meta ? <div className="xz-jeo-tile__meta">{meta}</div> : null}
		</>
	);

	return (
		<article className="xz-chcard" data-solved={solved ? "true" : "false"}>
			{to ? (
				<Link to={to} className="xz-jeo-tile__main" title={openLabel}>
					{main}
				</Link>
			) : onOpen ? (
				<button type="button" className="xz-jeo-tile__main" title={openLabel} onClick={onOpen}>
					{main}
				</button>
			) : (
				<div className="xz-jeo-tile__main">{main}</div>
			)}
			{actions ? <div className="xz-chcard__foot xz-jeo-tile__actions">{actions}</div> : null}
		</article>
	);
}

/* ── 实例内容（HTML / Markdown）───────────────────────────────────── */

/**
 * 实例 `content` 由后端生成，可能是 HTML 片段或纯文本。
 *
 * 安全策略（**不允许** `dangerouslySetInnerHTML`）：
 * - 形态是 HTML 时 → `sandbox=""` 的 iframe：脚本、表单、同源访问、顶层导航全部被禁止，
 *   因此可以安全地承载选手/管理员产生的不可信 HTML；
 * - 形态是文本/Markdown 时 → `<MarkdownView>`（react-markdown 不启用 rehype-raw）。
 *
 * 因为两种形态都有安全渲染路径，所以不需要降级成「新标签页打开」——那样反而会把
 * 不可信 HTML 丢进一个没有 sandbox 的顶层文档。
 */
function InstanceContent({ content }: { content: string }) {
	const looksLikeHtml = useMemo(() => /<\/?[a-z][\s\S]*>/i.test(content), [content]);
	if (!looksLikeHtml) return <MarkdownView>{content}</MarkdownView>;
	return (
		<iframe
			className="xz-jeo-frame"
			title="实例内容"
			sandbox=""
			srcDoc={content}
			referrerPolicy="no-referrer"
			loading="lazy"
		/>
	);
}

/* ── 实例生命周期 + flag 提交 ─────────────────────────────────────── */

export interface ChallengeRunnerAdapter {
	/** 该题「我的实例」查询键（赛事维度与独立维度必须不同）。 */
	instanceKey: QueryKey;
	/** 取当前运行中实例；`null` = 没有实例（调用方负责把 404 / 空 data 归一成 null）。 */
	getInstance: () => Promise<Instances | null>;
	/** 启动（或复用）实例。 */
	launch: () => Promise<Instances>;
	/** 提交 flag。 */
	submit: (instanceId: string, flag: string) => Promise<unknown>;
	/** 成功后需要失效的其它查询（赛事题目列表 / 我的实例 / 目录…）。 */
	invalidate?: readonly QueryKey[];
}

export function ChallengeRunner({
	challenge,
	adapter,
	solved,
	solvedNo,
	onSolved,
	hint,
	notice,
}: {
	challenge: ChallengesListItem;
	adapter: ChallengeRunnerAdapter;
	solved?: boolean;
	solvedNo?: number | null;
	onSolved?: () => void;
	hint?: ReactNode;
	/** 实例状态无法确认时的可见说明（例如独立题目接口不适用于非动态题）。 */
	notice?: ReactNode;
}) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const [flag, setFlag] = useState("");
	const staticChallenge = isStaticChallenge(challenge);

	const instanceQuery = useQuery({
		queryKey: adapter.instanceKey,
		queryFn: adapter.getInstance,
	});
	const instance = instanceQuery.data ?? null;

	const invalidateAll = () => {
		void queryClient.invalidateQueries({ queryKey: adapter.instanceKey });
		for (const key of adapter.invalidate ?? []) {
			void queryClient.invalidateQueries({ queryKey: key });
		}
	};

	const launch = useMutation({
		mutationFn: () => adapter.launch(),
		onSuccess: (data) => {
			// 立即把返回的实例写进缓存，界面无需等待二次请求。
			queryClient.setQueryData(adapter.instanceKey, data);
			toast.success(
				staticChallenge ? "答题会话已创建" : "实例已启动",
				staticChallenge ? "这是一道静态题，现在可以直接提交 flag。" : "实例到期后会被平台自动销毁。",
			);
			invalidateAll();
		},
		onError: (error) => toast.error("启动实例失败", errorText(error)),
	});

	const destroy = useMutation({
		mutationFn: (instanceId: string) => call(client.service.instances.destroy(instanceId), "销毁结果"),
		onSuccess: () => {
			queryClient.setQueryData(adapter.instanceKey, null);
			toast.success("实例已销毁");
			invalidateAll();
		},
		onError: (error) => toast.error("销毁实例失败", errorText(error)),
	});

	const submit = useMutation({
		mutationFn: (input: { instanceId: string; flag: string }) => adapter.submit(input.instanceId, input.flag),
		onSuccess: () => {
			setFlag("");
			// 后端在 flag 正确后会关闭实例，本地直接清空，避免显示已失效的实例。
			queryClient.setQueryData(adapter.instanceKey, null);
			toast.success("提交成功", "该题已解出。");
			invalidateAll();
			onSolved?.();
		},
		onError: (error) => toast.error("提交失败", errorText(error)),
	});

	// 倒计时到期：后端调度会销毁实例，前端只重新拉一次真实状态，不重复发销毁请求。
	const now = useNow(1000);
	const destroyAt = instance?.destroy_at ?? null;
	const remainingMs = destroyAt ? new Date(destroyAt).getTime() - now : null;
	const expired = remainingMs !== null && Number.isFinite(remainingMs) && remainingMs <= 0;
	const handledExpiry = useRef<string | null>(null);
	const refetchInstance = instanceQuery.refetch;
	useEffect(() => {
		if (!expired || !instance) return;
		if (handledExpiry.current === instance.id) return;
		handledExpiry.current = instance.id;
		void refetchInstance();
	}, [expired, instance, refetchInstance]);

	return (
		<div className="xz-jeo-runner">
			<div className="xz-jeo-runner__head">
				{staticChallenge ? (
					<Badge tone="neutral" icon="file">
						静态题（无容器）
					</Badge>
				) : (
					<Badge tone="info" icon="box">
						容器题
					</Badge>
				)}
				{!staticChallenge && challenge.container_port != null ? (
					<span className="xz-mono xz-xs xz-muted">容器端口 {challenge.container_port}</span>
				) : null}
				{!staticChallenge && typeof challenge.recommended_memory_bytes === "number" ? (
					<span className="xz-mono xz-xs xz-muted">内存 {formatBytes(challenge.recommended_memory_bytes)}</span>
				) : null}
				{solved ? (
					<Badge tone="ok" icon="check">
						已解出
					</Badge>
				) : null}
				<BloodBadge solvedNo={solvedNo} mine />
				{hint ? <span className="xz-muted xz-xs xz-truncate">{hint}</span> : null}
			</div>

			{notice ? <div className="xz-jeo-runner__notice">{notice}</div> : null}

			<QueryBoundary
				isPending={instanceQuery.isPending}
				isError={instanceQuery.isError}
				error={instanceQuery.error}
				refetch={() => void instanceQuery.refetch()}
				loadingLabel="正在获取我的实例…"
			>
				{instance === null ? (
					<div className="xz-jeo-runner__empty">
						<p className="xz-muted" style={{ margin: 0 }}>
							{staticChallenge
								? "这是一道静态题：点击开始即可获得答题会话，然后直接提交 flag（平台不会创建容器）。"
								: "你还没有这道题的运行中实例。启动后即可进入题目环境解题。"}
						</p>
						<Button
							variant="primary"
							icon="rocket"
							loading={launch.isPending}
							onClick={() => launch.mutate()}
						>
							{staticChallenge ? "开始答题" : "启动实例"}
						</Button>
					</div>
				) : (
					<div className="xz-jeo-inst">
						<KeyValue
							items={[
								{
									k: "实例状态",
									v: <Badge tone={instance.status === "running" ? "ok" : "neutral"}>{instance.status}</Badge>,
								},
								{
									k: "实例标识",
									v: (
										<span className="xz-row" style={{ gap: 6 }}>
											<code className="xz-code xz-mono">{instance.identifier}</code>
											<CopyButton value={instance.identifier} label="" />
										</span>
									),
								},
								{ k: "创建时间", v: formatDateTime(instance.created_at) },
								{
									k: "自动销毁",
									v: destroyAt ? (
										<span className={expired ? "xz-jeo-countdown xz-jeo-countdown--expired" : "xz-jeo-countdown"}>
											{formatDateTime(destroyAt)}
											{expired ? "（已到期，正在刷新状态）" : `（剩余 ${formatCountdown(destroyAt)}）`}
										</span>
									) : (
										"平台未设置自动销毁时间"
									),
								},
							]}
						/>

						{instance.content ? (
							<div className="xz-jeo-inst__content">
								<div className="xz-jeo-inst__label">实例内容</div>
								<InstanceContent content={instance.content} />
							</div>
						) : null}

						<form
							className="xz-jeo-flag"
							onSubmit={(event) => {
								event.preventDefault();
								const value = flag.trim();
								if (!value) return;
								submit.mutate({ instanceId: instance.id, flag: value });
							}}
						>
							<Field label="提交 flag" hint="提交正确的 flag 后，该题会记入你的成绩，实例由后端关闭">
								{(props) => (
									<TextInput
										{...props}
										className="xz-input--mono"
										value={flag}
										autoComplete="off"
										spellCheck={false}
										placeholder="flag{...}"
										onChange={(event) => setFlag(event.target.value)}
									/>
								)}
							</Field>
							<Button
								type="submit"
								variant="primary"
								icon="flag"
								loading={submit.isPending}
								disabled={flag.trim().length === 0}
							>
								提交
							</Button>
						</form>

						{!staticChallenge ? (
							<div className="xz-jeo-inst__actions">
								<Button
									variant="danger-ghost"
									icon="trash"
									loading={destroy.isPending}
									onClick={async () => {
										const ok = await confirm({
											title: "销毁该实例？",
											description: `将销毁实例 ${instance.identifier}。`,
											consequences:
												"容器会被停止并移除，实例内的临时文件、进程与已获取的线索全部丢失，且无法恢复；如需继续解题必须重新启动实例（重新启动可能耗时）。",
											tone: "danger",
											confirmText: "销毁实例",
										});
										if (ok) destroy.mutate(instance.id);
									}}
								>
									销毁实例
								</Button>
							</div>
						) : null}
					</div>
				)}
			</QueryBoundary>
		</div>
	);
}
