/**
 * 赛事控制台 · `awd` 标签 —— AWD 运维。
 *
 * 覆盖（11 项 required）：
 * 1. 配置：`getStatus(id)`（未配置时 `data` 为 `null`）/ `createEvent({event_id, …})` / `updateConfig(id, body)`
 *    —— PATCH 支持乐观锁 **`expected_updated_at`**，这里把详情里的 `updated_at` 回传。
 * 2. 生命周期：`deploy` / `start` / `pause` / `resume` / `finish` / `archive`（全部破坏性 → 二次确认；
 *    `archive` 用 `confirmPhrase` 要求输入赛事名）。
 * 3. 凭据轮换与预检：`rotateTokens(id)`（高风险，`confirmPhrase`）/ `precheck(id)` / `prechecks(id)`
 *    —— `error_msg` 是 **JSON 文本**，解析失败原样展示。
 * 4. 分数调整与积分榜 / 5. 战队封禁解封 / 6. 赛事 GameBox 挂载 / 7. GameBox 实例重置 / 8. 管理端 AWD 实时流。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AwdEventConfigInput, AwdEventStatus } from "@floatctf/sdk";

import { call, callList, unwrapNullable } from "../../../api/call.ts";
import { useBindings, useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime, formatNumber } from "../../../lib/format.ts";
import { useLiveStatus } from "../../../app/live.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import { Badge, Banner, Button, Card, CardBody, CardHead, Field, TextInput } from "../../../ui/primitives.tsx";
import { DataTable } from "../../../ui/Table.tsx";
import {
	AwdInstanceResetSection,
	AwdGameboxesSection,
	AwdScoresSection,
	AwdTeamsSection,
} from "./tab-awd-assets.tsx";
import {
	AwdStatusBadge,
	PrecheckReportView,
	ROOT,
	awdPhaseLabel,
	opStatusTone,
	parsePrecheckReport,
	toLocalInput,
} from "./shared.tsx";

/** 可编辑配置的状态集合（与 Default `configure.tsx` 的 EDITABLE_STATUSES 一致）。 */
const EDITABLE_STATUSES = new Set([
	"draft",
	"configuring",
	"deployed",
	"verified",
	"start_blocked",
	"deploy_failed",
]);

interface NumericFieldSpec {
	key: keyof AwdConfigForm;
	label: string;
	min: number;
	max: number;
	hint: string;
}

interface AwdConfigForm {
	round_count: string;
	round_duration_secs: string;
	initial_score: string;
	free_reset_count: string;
	extra_reset_penalty: string;
	judge_max_concurrency: string;
	judge_default_timeout_secs: string;
	judge_retry_interval_secs: string;
	archive_retention_hours: string;
	planned_start_at: string;
}

const NUMERIC_FIELDS: readonly NumericFieldSpec[] = [
	{ key: "round_count", label: "回合数", min: 1, max: 1000, hint: "1–1000" },
	{ key: "round_duration_secs", label: "单回合时长（秒）", min: 30, max: 86_400, hint: "30–86400" },
	{ key: "initial_score", label: "初始分数", min: 0, max: 1_000_000_000, hint: "0–1e9" },
	{ key: "free_reset_count", label: "免费重置次数", min: 0, max: 100, hint: "0–100" },
	{ key: "extra_reset_penalty", label: "额外重置罚分", min: 0, max: 1_000_000_000, hint: "0–1e9" },
	{ key: "judge_max_concurrency", label: "评测最大并发", min: 1, max: 1_000, hint: "1–1000" },
	{ key: "judge_default_timeout_secs", label: "评测默认超时（秒）", min: 1, max: 3_600, hint: "1–3600" },
	{ key: "judge_retry_interval_secs", label: "评测重试间隔（秒）", min: 1, max: 3_600, hint: "1–3600" },
	{ key: "archive_retention_hours", label: "归档保留（小时）", min: 1, max: 87_600, hint: "1–87600" },
];

const DEFAULT_FORM: AwdConfigForm = {
	round_count: "10",
	round_duration_secs: "600",
	initial_score: "1000",
	free_reset_count: "1",
	extra_reset_penalty: "50",
	judge_max_concurrency: "4",
	judge_default_timeout_secs: "60",
	judge_retry_interval_secs: "15",
	archive_retention_hours: "72",
	planned_start_at: "",
};

function formFromStatus(status: AwdEventStatus): AwdConfigForm {
	return {
		round_count: status.round_count === null ? "" : String(status.round_count),
		round_duration_secs: String(status.round_duration_secs),
		initial_score: String(status.initial_score),
		free_reset_count: String(status.free_reset_count),
		extra_reset_penalty: String(status.extra_reset_penalty),
		judge_max_concurrency: String(status.judge_max_concurrency),
		judge_default_timeout_secs: String(status.judge_default_timeout_secs),
		judge_retry_interval_secs: String(status.judge_retry_interval_secs),
		archive_retention_hours: String(status.archive_retention_hours),
		planned_start_at: toLocalInput(status.planned_start_at),
	};
}

type ConfigParse = { ok: true; payload: AwdEventConfigInput } | { ok: false; error: string };

function parseConfigForm(form: AwdConfigForm, expectedUpdatedAt: string | undefined): ConfigParse {
	const payload: AwdEventConfigInput = {};
	if (expectedUpdatedAt) payload.expected_updated_at = expectedUpdatedAt;

	for (const spec of NUMERIC_FIELDS) {
		const raw = form[spec.key].trim();
		const value = Number(raw);
		if (raw === "" || !Number.isSafeInteger(value)) {
			return { ok: false, error: `${spec.label}必须是合法整数（${spec.hint}）` };
		}
		if (value < spec.min || value > spec.max) {
			return { ok: false, error: `${spec.label}必须在 ${spec.min} 到 ${spec.max} 之间` };
		}
		(payload as Record<string, number>)[spec.key] = value;
	}

	const planned = form.planned_start_at.trim();
	if (planned) {
		const date = new Date(planned);
		if (Number.isNaN(date.getTime())) return { ok: false, error: "计划开赛时间不是合法时间" };
		if (date.getTime() <= Date.now()) return { ok: false, error: "计划开赛时间必须是未来时间" };
		payload.planned_start_at = date.toISOString();
		payload.clear_planned_start = false;
	} else {
		payload.clear_planned_start = true;
	}
	return { ok: true, payload };
}

/* ── 主组件 ───────────────────────────────────────────────────────── */

export function AwdOpsTab({ eventId, eventTitle }: { eventId: string; eventTitle: string }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const { useAdminAwdEventStream } = useBindings();
	const { setLive } = useLiveStatus();

	const stream = useAdminAwdEventStream({ eventId, enabled: eventId.length > 0 });

	useEffect(() => {
		setLive({
			label: "AWD 管理实时",
			state: String(stream.connectionState),
			detail: stream.lastEvent?.type ? `最近事件：${stream.lastEvent.type}` : "管理端 AWD 事件流",
		});
		return () => setLive(null);
	}, [setLive, stream.connectionState, stream.lastEvent]);

	const statusQuery = useQuery({
		queryKey: qk.awd.adminStatus(eventId),
		queryFn: async () => unwrapNullable(await client.awd.admin.getStatus(eventId)),
		enabled: eventId.length > 0,
	});

	const prechecks = useQuery({
		queryKey: qk.awd.adminPrechecks(eventId),
		queryFn: () => callList(client.awd.admin.prechecks(eventId)),
		enabled: eventId.length > 0,
		refetchInterval: 20_000,
	});

	const status = statusQuery.data ?? null;
	const latestPrecheck = prechecks.data?.items[0] ?? null;
	const report = useMemo(() => parsePrecheckReport(latestPrecheck?.error_msg), [latestPrecheck]);

	const [form, setForm] = useState<AwdConfigForm>(DEFAULT_FORM);
	const [formError, setFormError] = useState<string | undefined>();
	/** 表单基于哪个远端版本构建（乐观锁 + 远端变更提示）。 */
	const loadedVersion = useRef<string | null>(null);
	const [dirty, setDirty] = useState(false);

	useEffect(() => {
		if (!status) {
			if (!dirty && loadedVersion.current !== "unconfigured") {
				setForm(DEFAULT_FORM);
				loadedVersion.current = "unconfigured";
			}
			return;
		}
		if (loadedVersion.current === status.updated_at) return;
		if (dirty && loadedVersion.current !== null && loadedVersion.current !== "unconfigured") return;
		setForm(formFromStatus(status));
		loadedVersion.current = status.updated_at;
	}, [status, dirty]);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.awd.adminStatus(eventId) });
		void queryClient.invalidateQueries({ queryKey: qk.awd.adminPrechecks(eventId) });
		void queryClient.invalidateQueries({ queryKey: qk.awd.adminScores(eventId) });
		void queryClient.invalidateQueries({ queryKey: ROOT.awdAdmin });
		void queryClient.invalidateQueries({ queryKey: ROOT.adminEvents });
		void queryClient.invalidateQueries({ queryKey: ROOT.events });
	};

	const save = useMutation({
		mutationFn: async (payload: AwdEventConfigInput): Promise<void> => {
			if (status) {
				await call(client.awd.admin.updateConfig(eventId, payload), "配置更新");
			} else {
				await call(client.awd.admin.createEvent({ event_id: eventId, ...payload }), "AWD 创建");
			}
		},
		onSuccess: () => {
			setDirty(false);
			setFormError(undefined);
			toast.success(status ? "AWD 配置已保存" : "AWD 已开启");
			invalidate();
		},
		onError: (error) => {
			toast.error(status ? "保存 AWD 配置失败" : "开启 AWD 失败", errorText(error));
			void statusQuery.refetch();
		},
	});

	const lifecycle = useMutation({
		mutationFn: (action: LifecycleAction) => {
			// 显式分支：避免用联合键去索引方法表带来的类型不确定性。
			switch (action) {
				case "deploy":
					return call(client.awd.admin.deploy(eventId), "部署结果");
				case "start":
					return call(client.awd.admin.start(eventId), "开赛结果");
				case "pause":
					return call(client.awd.admin.pause(eventId), "暂停结果");
				case "resume":
					return call(client.awd.admin.resume(eventId), "恢复结果");
				case "finish":
					return call(client.awd.admin.finish(eventId), "结束结果");
				case "archive":
					return call(client.awd.admin.archive(eventId), "归档结果");
			}
		},
		onSuccess: (_data, action) => {
			toast.success(LIFECYCLE_LABEL[action]);
			invalidate();
		},
		onError: (error) => toast.error("AWD 生命周期操作失败", errorText(error)),
	});

	const precheck = useMutation({
		mutationFn: () => call(client.awd.admin.precheck(eventId), "预检结果"),
		onSuccess: () => {
			toast.success("预检已触发", "结果会在下方预检历史里出现。");
			invalidate();
		},
		onError: (error) => toast.error("触发预检失败", errorText(error)),
	});

	const rotate = useMutation({
		mutationFn: () => call(client.awd.admin.rotateTokens(eventId), "轮换结果"),
		onSuccess: () => {
			toast.success("内部令牌已轮换", "key_version +1，FlagServer / JudgeServer 容器已重建。");
			invalidate();
		},
		onError: (error) => toast.error("轮换内部令牌失败", errorText(error)),
	});

	const runLifecycle = async (action: LifecycleAction) => {
		if (action === "archive") {
			const ok = await confirm({
				title: `归档赛事「${eventTitle}」？`,
				description: "归档后赛事不可再修改，GameBox 容器可能被清理。",
				consequences:
					"归档是不可逆的终态：不能再部署/开赛/调分；平台会按 `archive_retention_hours` 回收容器与网络分配。",
				tone: "danger",
				confirmText: "归档赛事",
				confirmPhrase: eventTitle,
			});
			if (ok) lifecycle.mutate(action);
			return;
		}
		const meta = LIFECYCLE_META[action];
		const ok = await confirm({
			title: meta.title(eventTitle),
			description: meta.description,
			consequences: meta.consequences,
			tone: "danger",
			confirmText: meta.confirmText,
		});
		if (ok) lifecycle.mutate(action);
	};

	const askRotate = async () => {
		const ok = await confirm({
			title: "轮换内部令牌？",
			description: "会递增 key_version、重新加密，并重建 FlagServer / JudgeServer 容器。",
			consequences:
				"轮换期间正在进行的提交/判题可能短暂失败；选手端凭据不需要变更，但 AWD 内部通信会经历一次重建。",
			tone: "danger",
			confirmText: "轮换令牌",
			confirmPhrase: "ROTATE-TOKENS",
		});
		if (ok) rotate.mutate();
	};

	const statusValue = status ? String(status.status) : null;
	const finalSettlement = status?.final_settlement ?? false;
	const editable = !status || EDITABLE_STATUSES.has(statusValue ?? "");

	const attackDuration = useMemo(() => {
		const rounds = Number(form.round_count);
		const duration = Number(form.round_duration_secs);
		if (!Number.isFinite(rounds) || !Number.isFinite(duration)) return null;
		return rounds * duration;
	}, [form.round_count, form.round_duration_secs]);

	return (
		<div className="xz-aev-col">
			<Card flat>
				<CardBody>
					<div className="xz-aev-inline">
						<span className="xz-muted xz-xs">管理端 AWD 实时事件流</span>
						<Badge
							tone={
								stream.connectionState === "connected"
									? "ok"
									: stream.connectionState === "auth_error"
										? "danger"
										: stream.connectionState === "reconnecting"
											? "warn"
											: "neutral"
							}
						>
							{String(stream.connectionState)}
						</Badge>
						{stream.lastEvent?.type ? (
							<span className="xz-muted xz-xs xz-mono">最近事件：{stream.lastEvent.type}</span>
						) : null}
						{stream.lastError ? (
							<span className="xz-muted xz-xs">{errorText(stream.lastError)}</span>
						) : null}
						<span className="xz-aev-toolbar--end xz-muted xz-xs">
							该流为 optional 能力；断线时管理端各列表仍会按固定周期轮询。
						</span>
					</div>
				</CardBody>
			</Card>

			<QueryBoundary
				isPending={statusQuery.isPending}
				isError={statusQuery.isError}
				error={statusQuery.error}
				refetch={() => void statusQuery.refetch()}
				loadingLabel="正在加载 AWD 状态…"
			>
				<Card>
					<CardHead
						title="AWD 配置"
						icon="settings"
						sub={status ? `updated_at ${formatDateTime(status.updated_at)}` : "尚未开启 AWD"}
						actions={
							<div className="xz-aev-inline">
								<AwdStatusBadge status={statusValue} />
								{status ? <Badge tone="info">{awdPhaseLabel(String(status.phase))}</Badge> : null}
								{finalSettlement ? <Badge tone="warn">终局结算中</Badge> : null}
							</div>
						}
					/>
					<CardBody>
						{!status ? (
							<Banner tone="info" title="该赛事还没有 AWD 配置">
								{"`getStatus` 返回 `data: null`。填写下面的参数并保存即调用 `createEvent({ event_id, … })` 为赛事开启 AWD。"}
							</Banner>
						) : !editable ? (
							<Banner tone="warn" title={`当前状态 ${statusValue} 不允许改配置`}>
								只有 draft / configuring / deployed / verified / start_blocked / deploy_failed
								状态下可以修改配置；比赛进行中或已结束/归档时后端会拒绝。
							</Banner>
						) : null}

						<div style={{ marginTop: 12 }} className="xz-aev-col">
							<div className="xz-aev-grid3">
								{NUMERIC_FIELDS.map((spec) => (
									<Field key={spec.key} label={spec.label} hint={spec.hint}>
										{(props) => (
											<TextInput
												{...props}
												type="number"
												value={form[spec.key]}
												disabled={!editable}
												onChange={(changeEvent) => {
													setDirty(true);
													setForm((current) => ({ ...current, [spec.key]: changeEvent.target.value }));
												}}
											/>
										)}
									</Field>
								))}
								<Field label="计划开赛时间" hint="必须是未来时间；留空表示清除计划。">
									{(props) => (
										<TextInput
											{...props}
											type="datetime-local"
											value={form.planned_start_at}
											disabled={!editable}
											onChange={(changeEvent) => {
												setDirty(true);
												setForm((current) => ({ ...current, planned_start_at: changeEvent.target.value }));
											}}
										/>
									)}
								</Field>
							</div>

							<div className="xz-aev-note">
								攻击时长 = 回合数 × 单回合时长 = {attackDuration === null ? "—" : `${formatNumber(attackDuration)} 秒`}
								{" · "}赛事窗口由「配置」标签的 start_time / end_time 决定（加固期 = 赛事时长 − 攻击时长）。
							</div>

							{formError ? (
								<Banner tone="danger" title="配置校验未通过">
									{formError}
								</Banner>
							) : null}

							<div className="xz-aev-inline">
								<Button
									variant="primary"
									icon="save"
									disabled={!editable}
									loading={save.isPending}
									onClick={() => {
										const parsed = parseConfigForm(form, status?.updated_at);
										if (!parsed.ok) {
											setFormError(parsed.error);
											return;
										}
										setFormError(undefined);
										save.mutate(parsed.payload);
									}}
								>
									{status ? "保存配置（带乐观锁）" : "开启 AWD"}
								</Button>
								<Button
									icon="refresh"
									disabled={!status}
									onClick={() => {
										if (!status) return;
										setDirty(false);
										setForm(formFromStatus(status));
										loadedVersion.current = status.updated_at;
									}}
								>
									从服务端重载
								</Button>
								<span className="xz-muted xz-xs">
									保存时回传 `expected_updated_at = {status?.updated_at ? "详情里的 updated_at" : "（新建时省略）"}`
								</span>
							</div>
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardHead title="AWD 生命周期" icon="bolt" sub="每次操作都会二次确认并写明后果" />
					<CardBody>
						<div className="xz-danger-zone xz-aev-danger">
							<div className="xz-danger-zone__title">
								<Icon name="warn" size={15} />
								生命周期操作（破坏性，逐个二次确认）
							</div>
							{finalSettlement ? (
								<Banner tone="warn" title="终局结算中（final_settlement = true）">
									最后一轮已结算、Judge 仍在收敛；除归档外的生命周期操作都会被禁用。
								</Banner>
							) : null}
							<div className="xz-aev-flow" style={{ marginTop: 12 }}>
							{["draft", "configuring", "deploy_failed"].includes(statusValue ?? "") && !finalSettlement ? (
								<Button
									variant="primary"
									icon="rocket"
									disabled={lifecycle.isPending}
									onClick={() => void runLifecycle("deploy")}
								>
									部署
								</Button>
							) : null}
							{["verified", "start_blocked"].includes(statusValue ?? "") && !finalSettlement ? (
								<Button
									variant="primary"
									icon="play"
									disabled={lifecycle.isPending}
									onClick={() => void runLifecycle("start")}
								>
									开赛
								</Button>
							) : null}
							{statusValue === "running" && !finalSettlement ? (
								<Button icon="pause" disabled={lifecycle.isPending} onClick={() => void runLifecycle("pause")}>
									暂停
								</Button>
							) : null}
							{["paused", "network_error"].includes(statusValue ?? "") && !finalSettlement ? (
								<Button
									variant="primary"
									icon="play"
									disabled={lifecycle.isPending}
									onClick={() => void runLifecycle("resume")}
								>
									恢复
								</Button>
							) : null}
							{["running", "paused"].includes(statusValue ?? "") && !finalSettlement ? (
								<Button
									variant="danger-ghost"
									icon="stop"
									disabled={lifecycle.isPending}
									onClick={() => void runLifecycle("finish")}
								>
									结束比赛
								</Button>
							) : null}
							{statusValue === "finished" ? (
								<Button
									variant="danger"
									icon="archive"
									disabled={lifecycle.isPending}
									onClick={() => void runLifecycle("archive")}
								>
									归档赛事
								</Button>
							) : null}
							{status && statusValue !== "archived" ? (
								<Button
									variant="danger-ghost"
									icon="key"
									disabled={rotate.isPending}
									onClick={() => void askRotate()}
								>
									轮换内部令牌
								</Button>
							) : null}
							<span className="xz-muted xz-xs">
								{lifecycle.isPending ? "操作进行中…" : "当前可用动作由 status 决定（与后端状态机一致）"}
							</span>
							</div>
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardHead
						title="预检"
						icon="shield"
						sub={latestPrecheck ? `最近一次：${String(latestPrecheck.status)}` : "还没有预检记录"}
						actions={
							<Button
								icon="beaker"
								loading={precheck.isPending}
								disabled={!status || finalSettlement}
								onClick={() => precheck.mutate()}
							>
								触发预检
							</Button>
						}
					/>
					<CardBody>
						{latestPrecheck ? (
							<div className="xz-aev-col">
								<div className="xz-aev-inline">
									<Badge tone={opStatusTone(String(latestPrecheck.status))}>{String(latestPrecheck.status)}</Badge>
									<span className="xz-muted xz-xs">
										触发：{latestPrecheck.trigger ?? "—"} · revision {latestPrecheck.revision ?? "—"}
									</span>
									<span className="xz-muted xz-xs">
										{formatDateTime(latestPrecheck.started_at)} →{" "}
										{latestPrecheck.completed_at ? formatDateTime(latestPrecheck.completed_at) : "进行中"}
									</span>
								</div>
								<PrecheckReportView report={report} />
							</div>
						) : (
							<div className="xz-aev-emptyline">还没有预检记录。部署后先跑一次预检再开赛。</div>
						)}

						<QueryBoundary
							isPending={prechecks.isPending}
							isError={prechecks.isError}
							error={prechecks.error}
							refetch={() => void prechecks.refetch()}
							loadingLabel="正在加载预检历史…"
						>
							<DataTable
								compact
								rows={prechecks.data?.items ?? []}
								rowKey={(run) => run.id}
								empty={<div className="xz-aev-emptyline">无预检历史。</div>}
								columns={[
									{ key: "time", header: "开始时间", render: (run) => formatDateTime(run.started_at) },
									{ key: "status", header: "状态", render: (run) => <Badge tone={opStatusTone(String(run.status))}>{String(run.status)}</Badge> },
									{ key: "trigger", header: "触发", render: (run) => run.trigger ?? "—" },
									{ key: "revision", header: "revision", numeric: true, render: (run) => run.revision ?? "—" },
									{
										key: "report",
										header: "报告",
										render: (run) => {
											const parsed = parsePrecheckReport(run.error_msg);
											if (parsed.errors.length === 0 && parsed.notes.length === 0) {
												return <span className="xz-muted">无错误</span>;
											}
											return (
												<span className="xz-xs">
													{parsed.errors.length} 个错误 · {parsed.notes.length} 条备注
													{parsed.parseFailed ? "（原文展示）" : ""}
												</span>
											);
										},
									},
								]}
							/>
						</QueryBoundary>
					</CardBody>
				</Card>
			</QueryBoundary>

			<AwdScoresSection eventId={eventId} locked={statusValue === "archived" || Boolean(finalSettlement)} />
			<AwdTeamsSection eventId={eventId} />
			<AwdGameboxesSection eventId={eventId} />
			<AwdInstanceResetSection eventId={eventId} />
		</div>
	);
}

/* ── 生命周期文案 ─────────────────────────────────────────────────── */

type LifecycleAction = "deploy" | "start" | "pause" | "resume" | "finish" | "archive";

const LIFECYCLE_LABEL: Record<LifecycleAction, string> = {
	deploy: "AWD 已开始部署",
	start: "比赛已开始",
	pause: "比赛已暂停",
	resume: "比赛已恢复",
	finish: "比赛已结束",
	archive: "赛事已归档",
};

const LIFECYCLE_META: Record<
	Exclude<LifecycleAction, "archive">,
	{
		title: (eventTitle: string) => string;
		description: string;
		consequences: string;
		confirmText: string;
	}
> = {
	deploy: {
		title: (title) => `部署「${title}」的 AWD 环境？`,
		description: "会创建赛事网络分配、FlagServer / JudgeServer 与全部 GameBox 容器。",
		consequences: "部署会消耗平台网络容量并启动大量容器，可能持续数分钟；失败会进入 deploy_failed。",
		confirmText: "开始部署",
	},
	start: {
		title: (title) => `开始「${title}」的比赛？`,
		description: "只有预检通过（verified）或 start_blocked 状态下才可开赛。",
		consequences: "开赛后选手立即可提交 flag；回合计时开始，暂停/恢复会影响计分口径。",
		confirmText: "开始比赛",
	},
	pause: {
		title: (title) => `暂停「${title}」的比赛？`,
		description: "暂停会冻结当前回合计时。",
		consequences: "选手端进入 pause 相位，无法继续攻击；恢复后按剩余时间继续。",
		confirmText: "暂停比赛",
	},
	resume: {
		title: (title) => `恢复「${title}」的比赛？`,
		description: "从暂停（或网络故障）状态恢复。",
		consequences: "恢复后选手立即可以继续提交；网络故障状态恢复会重试基础设施检查。",
		confirmText: "恢复比赛",
	},
	finish: {
		title: (title) => `结束「${title}」的比赛？`,
		description: "结束是不可逆的终态（Default 前端没有提供该按钮，SDK 暴露了 `finish`）。",
		consequences:
			"结束后不能再开赛或恢复；仍在进行的判题会走终局结算（final_settlement），之后只能归档。",
		confirmText: "结束比赛",
	},
};
