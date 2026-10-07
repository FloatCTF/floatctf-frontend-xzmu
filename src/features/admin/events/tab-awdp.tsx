/**
 * 赛事控制台 · `awdp` 标签 —— AWDP 运维。
 *
 * 覆盖（6 项 required）：
 * 1. 配置读写 `getConfig(id)` / `updateConfig(id, body)`（**乐观锁 `expected_updated_at`**）。
 * 2. 生命周期 `start` / `breakToFix` / `finish` —— 破坏性，全部二次确认。
 * 3. GameBox 挂载 `attachGamebox(id, gameboxId, hidden?)`（**第 3 个是可选位置参数**）/
 *    `detachGamebox(id, egId)` / `listEventGameboxes(id, params?)`。
 * 4. 赛事实例 `listInstances(id)` → `AwdpAdminInstanceDto[]`。
 * 5. 积分榜 `scores(id)`；6. 数据大屏（optional）`dataPresent(id)`。
 *
 * 注意 `preparing_fix` 是 `break → fix` 之间的真实过渡态（Default 漏掉），这里如实展示。
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AwdpAdminEventGameBoxDto, AwdpConfigPatchInput } from "@floatctf/sdk";
import type { Events } from "@floatctf/sdk/entity";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime, formatNumber, formatSeconds } from "../../../lib/format.ts";
import { Icon } from "../../../ui/icons.tsx";
import { Modal, QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	Checkbox,
	EmptyState,
	Field,
	Select,
	Stat,
	TextInput,
} from "../../../ui/primitives.tsx";
import { DataTable } from "../../../ui/Table.tsx";
import { AwdpPhaseBadge, ROOT, RowActions, parseNumberText } from "./shared.tsx";

interface AwdpForm {
	fix_duration_secs: string;
	fix_round_interval_secs: string;
	break_score: string;
	fix_round_score: string;
}

export function AwdpOpsTab({ eventId, event }: { eventId: string; event: Events }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();

	const configQuery = useQuery({
		queryKey: qk.awdp.config(eventId),
		queryFn: () => call(client.awdp.admin.getConfig(eventId), "AWDP 配置"),
		enabled: eventId.length > 0,
	});

	const config = configQuery.data ?? null;
	const phase = config ? String(config.phase) : null;
	const editable = !config || config.phase === "pending";

	const [form, setForm] = useState<AwdpForm>({
		fix_duration_secs: "",
		fix_round_interval_secs: "",
		break_score: "",
		fix_round_score: "",
	});
	const [formError, setFormError] = useState<string | undefined>();
	/** `break_score` 默认与 fix_round_score 联动（×0.6）；管理员手动改过之后不再联动。 */
	const [breakTouched, setBreakTouched] = useState(false);
	const [loadedVersion, setLoadedVersion] = useState<string | null>(null);

	// 远端值变化时同步表单（未编辑过或版本变化时）。
	if (config && loadedVersion !== config.updated_at) {
		setLoadedVersion(config.updated_at);
		setBreakTouched(false);
		setForm({
			fix_duration_secs: String(config.fix_duration_secs),
			fix_round_interval_secs: String(config.fix_round_interval_secs),
			break_score: String(config.break_score),
			fix_round_score: String(config.fix_round_score),
		});
	}

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.awdp.config(eventId) });
		void queryClient.invalidateQueries({ queryKey: ROOT.awdpAdmin });
		void queryClient.invalidateQueries({ queryKey: ROOT.adminEvents });
		void queryClient.invalidateQueries({ queryKey: ROOT.events });
	};

	const save = useMutation({
		mutationFn: (payload: AwdpConfigPatchInput) => call(client.awdp.admin.updateConfig(eventId, payload), "配置更新"),
		onSuccess: () => {
			setFormError(undefined);
			toast.success("AWDP 配置已保存");
			invalidate();
		},
		onError: (error) => {
			toast.error("保存 AWDP 配置失败", errorText(error));
			void configQuery.refetch();
		},
	});

	const lifecycle = useMutation({
		mutationFn: (action: "start" | "breakToFix" | "finish") => {
			switch (action) {
				case "start":
					return call(client.awdp.admin.start(eventId), "开始结果");
				case "breakToFix":
					return call(client.awdp.admin.breakToFix(eventId), "阶段切换结果");
				case "finish":
					return call(client.awdp.admin.finish(eventId), "结束结果");
			}
		},
		onSuccess: (_data, action) => {
			toast.success(
				action === "start" ? "AWDP 已开始（进入攻破阶段）" : action === "breakToFix" ? "已切换到修复阶段" : "AWDP 已结束",
			);
			invalidate();
		},
		onError: (error) => toast.error("AWDP 生命周期操作失败", errorText(error)),
	});

	const runLifecycle = async (action: "start" | "breakToFix" | "finish") => {
		const meta = AWDP_META[action];
		const ok = await confirm({
			title: meta.title(event.title),
			description: meta.description,
			consequences: meta.consequences,
			tone: "danger",
			confirmText: meta.confirmText,
		});
		if (ok) lifecycle.mutate(action);
	};

	/* 事件窗口推导 Break 时长（与 Default 口径一致：Break = 赛事总时长 − Fix 时长）。 */
	const derived = useMemo(() => {
		const start = event.start_time ? new Date(event.start_time).getTime() : null;
		const end = event.end_time ? new Date(event.end_time).getTime() : null;
		const total = start !== null && end !== null ? Math.round((end - start) / 1000) : null;
		const fix = Number(config?.fix_duration_secs ?? 0);
		return {
			total,
			breakSecs: total !== null ? total - fix : null,
		};
	}, [event.start_time, event.end_time, config?.fix_duration_secs]);

	const submit = () => {
		if (!config) return;
		const fixDuration = parseNumberText(form.fix_duration_secs);
		const interval = parseNumberText(form.fix_round_interval_secs);
		const breakScore = parseNumberText(form.break_score);
		const fixScore = parseNumberText(form.fix_round_score);
		for (const [parsed, label] of [
			[fixDuration, "修复阶段时长"],
			[interval, "修复轮次间隔"],
			[breakScore, "Break 单题得分"],
			[fixScore, "Fix 每轮得分"],
		] as const) {
			if (!parsed.ok) {
				setFormError(`${label}：${parsed.error}`);
				return;
			}
			if (parsed.value === null || parsed.value < 0) {
				setFormError(`${label}必须是非负整数`);
				return;
			}
		}
		if (!fixDuration.ok || !interval.ok || !breakScore.ok || !fixScore.ok) return;
		if (fixDuration.value === null || interval.value === null || breakScore.value === null || fixScore.value === null) {
			return;
		}
		const payload: AwdpConfigPatchInput = {
			expected_updated_at: config.updated_at,
			fix_duration_secs: fixDuration.value,
			fix_round_interval_secs: interval.value,
			break_score: breakScore.value,
			fix_round_score: fixScore.value,
		};
		setFormError(undefined);
		save.mutate(payload);
	};

	return (
		<div className="xz-aev-col">
			<QueryBoundary
				isPending={configQuery.isPending}
				isError={configQuery.isError}
				error={configQuery.error}
				refetch={() => void configQuery.refetch()}
				loadingLabel="正在加载 AWDP 配置…"
			>
				{config ? (
					<>
						<Card>
							<CardHead
								title="AWDP 配置"
								icon="settings"
								sub={`updated_at ${formatDateTime(config.updated_at)}`}
								actions={
									<div className="xz-aev-inline">
										<AwdpPhaseBadge phase={phase} />
										<Badge>第 {config.current_round} 轮</Badge>
										<Badge tone="info">generation {config.configuration_generation}</Badge>
									</div>
								}
							/>
							<CardBody>
								{!editable ? (
									<Banner tone="warn" title={`当前阶段 ${phase ?? "—"} 已锁定 AWDP 参数`}>
										只有 `pending` 阶段可以修改配置；开赛后 `fix_duration_secs` /
										`fix_round_interval_secs` / 分值都会被锁定。
									</Banner>
								) : null}

								<div className="xz-aev-grid3" style={{ marginTop: 12 }}>
									<Field label="修复阶段时长（秒）" hint="提交到 fix_duration_secs">
										{(props) => (
											<TextInput
												{...props}
												type="number"
												value={form.fix_duration_secs}
												disabled={!editable}
												onChange={(changeEvent) =>
													setForm((current) => ({ ...current, fix_duration_secs: changeEvent.target.value }))
												}
											/>
										)}
									</Field>
									<Field label="修复轮次间隔（秒）" hint="提交到 fix_round_interval_secs">
										{(props) => (
											<TextInput
												{...props}
												type="number"
												value={form.fix_round_interval_secs}
												disabled={!editable}
												onChange={(changeEvent) =>
													setForm((current) => ({
														...current,
														fix_round_interval_secs: changeEvent.target.value,
													}))
												}
											/>
										)}
									</Field>
									<Field label="Fix 每轮得分" hint="提交到 fix_round_score">
										{(props) => (
											<TextInput
												{...props}
												type="number"
												value={form.fix_round_score}
												disabled={!editable}
												onChange={(changeEvent) => {
													const value = changeEvent.target.value;
													setForm((current) => ({
														...current,
														fix_round_score: value,
														break_score: breakTouched
															? current.break_score
															: String(Math.round((Number(value) || 0) * 0.6)),
													}));
												}}
											/>
										)}
									</Field>
									<Field label="Break 单题得分" hint="默认 = Fix 每轮得分 × 0.6，手动改过后不再联动">
										{(props) => (
											<TextInput
												{...props}
												type="number"
												value={form.break_score}
												disabled={!editable}
												onChange={(changeEvent) => {
													setBreakTouched(true);
													setForm((current) => ({ ...current, break_score: changeEvent.target.value }));
												}}
											/>
										)}
									</Field>
								</div>

								<div className="xz-aev-note" style={{ marginTop: 8 }}>
									Break 时长是**推导值**：赛事窗口总时长 {derived.total === null ? "—" : formatSeconds(derived.total)} −
									Fix 时长 {formatSeconds(config.fix_duration_secs)} ={" "}
									{derived.breakSecs === null ? "—" : formatSeconds(Math.max(0, derived.breakSecs))}。
									要改 Break 时长请调整赛事 start_time / end_time 或 Fix 时长。
								</div>

								{formError ? (
									<Banner tone="danger" title="配置校验未通过">
										{formError}
									</Banner>
								) : null}

								<div className="xz-aev-inline" style={{ marginTop: 12 }}>
									<Button
										variant="primary"
										icon="save"
										disabled={!editable}
										loading={save.isPending}
										onClick={submit}
									>
										保存配置（带乐观锁）
									</Button>
									<span className="xz-muted xz-xs">
										提交时回传 `expected_updated_at = {config.updated_at}`
									</span>
								</div>

								<div className="xz-aev-grid3" style={{ marginTop: 16 }}>
									<Stat label="开始时间" value={formatDateTime(config.started_at)} icon="clock" />
									<Stat label="Break 结束" value={formatDateTime(config.break_ends_at)} icon="clock" />
									<Stat label="Fix 开始" value={formatDateTime(config.fix_started_at)} icon="clock" />
									<Stat label="Fix 结束" value={formatDateTime(config.fix_ends_at)} icon="clock" />
									<Stat label="结束时间" value={formatDateTime(config.finished_at)} icon="clock" />
									<Stat label="下次动作" value={formatDateTime(config.next_action_at)} icon="bolt" gold />
								</div>
							</CardBody>
						</Card>

						<Card>
							<CardHead title="AWDP 生命周期" icon="bolt" sub="每次操作都会二次确认并写明后果" />
							<CardBody>
								<Banner tone="info" title="自动推进与手动推进">
									Break 到期会 tick 自动进入 Fix；Fix 最后一轮 cutoff 会自动结束。
									下面的按钮只用于**提前**推进阶段。
								</Banner>
								<div className="xz-danger-zone xz-aev-danger">
									<div className="xz-danger-zone__title">
										<Icon name="warn" size={15} />
										阶段推进（破坏性，逐个二次确认）
									</div>
									<div className="xz-aev-flow">
									{phase === "pending" ? (
										<Button
											variant="primary"
											icon="play"
											disabled={lifecycle.isPending}
											onClick={() => void runLifecycle("start")}
										>
											开始（进入攻破阶段）
										</Button>
									) : null}
									{phase === "break" || phase === "preparing_fix" ? (
										<Button
											variant="danger-ghost"
											icon="wrench"
											disabled={lifecycle.isPending}
											onClick={() => void runLifecycle("breakToFix")}
										>
											攻破 → 修复
										</Button>
									) : null}
									{phase === "fix" ? (
										<Button
											variant="danger"
											icon="stop"
											disabled={lifecycle.isPending}
											onClick={() => void runLifecycle("finish")}
										>
											结束（进入已结束）
										</Button>
									) : null}
									{phase === "ended" ? <Badge tone="neutral">赛事已结束</Badge> : null}
									{phase === "preparing_fix" ? <Badge tone="warn">preparing_fix 过渡态：实例正在重置</Badge> : null}
									<span className="xz-muted xz-xs">
										当前阶段：{phase ?? "—"}（后端枚举含 preparing_fix，Default 未单独展示）
									</span>
									</div>
								</div>
							</CardBody>
						</Card>
					</>
				) : null}
			</QueryBoundary>

			<AwdpGameboxesSection eventId={eventId} />
			<AwdpInstancesSection eventId={eventId} />
			<AwdpScoresSection eventId={eventId} />
			<AwdpDataSection eventId={eventId} />
		</div>
	);
}

/* ── 赛事 GameBox 挂载 / 卸载 ─────────────────────────────────────── */

function AwdpGameboxesSection({ eventId }: { eventId: string }) {
	const client = useClient();
	const queryClient = useQueryClient();
	const toast = useToast();
	const confirm = useConfirm();
	const [attachOpen, setAttachOpen] = useState(false);
	const [gameboxId, setGameboxId] = useState("");
	const [hidden, setHidden] = useState(false);

	const params = useMemo(() => ({ page: 1, limit: 200 }), []);
	const list = useQuery({
		queryKey: qk.awdp.adminGameboxes(eventId),
		queryFn: () => callList(client.awdp.admin.listEventGameboxes(eventId, params)),
		enabled: eventId.length > 0,
	});
	const library = useQuery({
		queryKey: qk.awd.gameboxLibrary(params),
		queryFn: () => callList(client.awd.admin.listGameboxes(params)),
		enabled: attachOpen,
	});

	const rows = list.data?.items ?? [];
	const attached = useMemo(() => new Set(rows.map((row) => row.gamebox_id)), [rows]);

	const invalidate = () => {
		void queryClient.invalidateQueries({ queryKey: qk.awdp.adminGameboxes(eventId) });
		void queryClient.invalidateQueries({ queryKey: ROOT.awdpAdmin });
	};

	const attach = useMutation({
		// 第 3 个参数是**可选位置参数** hidden。
		mutationFn: () => call(client.awdp.admin.attachGamebox(eventId, gameboxId, hidden), "挂载结果"),
		onSuccess: (dto: AwdpAdminEventGameBoxDto) => {
			toast.success("GameBox 已挂载", dto.name);
			setAttachOpen(false);
			setGameboxId("");
			setHidden(false);
			invalidate();
		},
		onError: (error) => toast.error("挂载 GameBox 失败", errorText(error)),
	});

	const detach = useMutation({
		mutationFn: (egId: string) => call(client.awdp.admin.detachGamebox(eventId, egId), "卸载结果"),
		onSuccess: () => {
			toast.success("GameBox 已卸载");
			invalidate();
		},
		onError: (error) => toast.error("卸载 GameBox 失败", errorText(error)),
	});

	const askDetach = async (row: AwdpAdminEventGameBoxDto) => {
		const ok = await confirm({
			title: `卸载「${row.name}」？`,
			description: "会解除该 GameBox 与赛事的挂载关系。",
			consequences: "该题不再参与本赛事 AWDP；已产生的实例与评估记录仍由后端保留。此操作不可撤销。",
			tone: "danger",
			confirmText: "卸载",
		});
		if (ok) detach.mutate(row.id);
	};

	return (
		<Card>
			<CardHead
				title="赛事 GameBox"
				icon="box"
				sub="挂载只接受具备完整 AWDP capability 的 GameBox（后端校验）"
				actions={
					<Button variant="primary" icon="plus" onClick={() => setAttachOpen(true)}>
						挂载 GameBox
					</Button>
				}
			/>
			<CardBody flush>
				<QueryBoundary
					isPending={list.isPending}
					isError={list.isError}
					error={list.error}
					refetch={() => void list.refetch()}
					loadingLabel="正在加载赛事 GameBox…"
				>
					<DataTable
						rows={rows}
						rowKey={(row) => row.id}
						empty={<div className="xz-aev-emptyline">本赛事还没有挂载 GameBox。</div>}
						columns={[
							{
								key: "name",
								header: "GameBox",
								render: (row) => (
									<div>
										<div>{row.name}</div>
										<div className="xz-muted xz-xs xz-mono">
											{row.safe_name} · {row.category}
										</div>
									</div>
								),
							},
							{
								key: "flags",
								header: "开关",
								render: (row) => (
									<div className="xz-aev-badges">
										<Badge tone={row.enabled ? "ok" : "neutral"}>{row.enabled ? "已启用" : "已停用"}</Badge>
										{row.hidden ? <Badge tone="warn">隐藏</Badge> : null}
										{row.awdp_capable ? <Badge tone="gold">AWDP 就绪</Badge> : <Badge tone="danger">能力不足</Badge>}
									</div>
								),
							},
							{
								key: "source",
								header: "源码目录",
								render: (row) => (
									<span className="xz-aev-mono xz-xs">{row.awdp_source_code_dir ?? "—"}</span>
								),
							},
							{
								key: "build",
								header: "构建",
								render: (row) =>
									row.build_status ? (
										<Badge tone={row.build_status === "ready" ? "ok" : "danger"}>{row.build_status}</Badge>
									) : (
										<span className="xz-muted">—</span>
									),
							},
							{
								key: "actions",
								header: "操作",
								align: "right",
								render: (row) => (
									<RowActions>
										<Button
											size="sm"
											variant="danger-ghost"
											icon="trash"
											loading={detach.isPending && detach.variables === row.id}
											onClick={() => void askDetach(row)}
										>
											卸载
										</Button>
									</RowActions>
								),
							},
						]}
					/>
				</QueryBoundary>
			</CardBody>

			<Modal
				open={attachOpen}
				onClose={() => setAttachOpen(false)}
				persistent={attach.isPending}
				title="挂载 GameBox 到赛事"
				description="挂载成功后该 GameBox 参与 AWDP 破题/修复流程。"
				footer={
					<>
						<Button variant="quiet" onClick={() => setAttachOpen(false)} disabled={attach.isPending}>
							取消
						</Button>
						<Button
							variant="primary"
							icon="plus"
							loading={attach.isPending}
							disabled={!gameboxId}
							onClick={() => attach.mutate()}
						>
							挂载
						</Button>
					</>
				}
			>
				<div className="xz-aev-col">
					<Field label="GameBox（来自库）" required>
						{(props) => (
							<Select
								{...props}
								value={gameboxId}
								onChange={(changeEvent) => setGameboxId(changeEvent.target.value)}
							>
								<option value="">请选择</option>
								{(library.data?.items ?? []).map((gamebox) => (
									<option key={gamebox.id} value={gamebox.id} disabled={attached.has(gamebox.id)}>
										{gamebox.name}（{gamebox.safe_name}
										{attached.has(gamebox.id) ? " · 已挂载" : ""}）
									</option>
								))}
							</Select>
						)}
					</Field>
					<Checkbox label="对选手隐藏（hidden）" checked={hidden} onChange={setHidden} />
					{library.isError ? (
						<Banner tone="danger" title="GameBox 库加载失败">
							{errorText(library.error)}
						</Banner>
					) : null}
					{library.isSuccess && (library.data?.items.length ?? 0) === 0 ? (
						<EmptyState icon="box" title="库里还没有 GameBox" desc="先到「GameBox 库」导入包。" />
					) : null}
				</div>
			</Modal>
		</Card>
	);
}

/* ── 赛事实例 ─────────────────────────────────────────────────────── */

function AwdpInstancesSection({ eventId }: { eventId: string }) {
	const client = useClient();
	const list = useQuery({
		queryKey: qk.awdp.adminInstances(eventId),
		queryFn: () => callList(client.awdp.admin.listInstances(eventId)),
		enabled: eventId.length > 0,
	});

	const rows = list.data?.items ?? [];

	return (
		<Card>
			<CardHead title="赛事实例" icon="server" sub="client.awdp.admin.listInstances（AWDP 专属视图）" />
			<CardBody flush>
				<QueryBoundary
					isPending={list.isPending}
					isError={list.isError}
					error={list.error}
					refetch={() => void list.refetch()}
					loadingLabel="正在加载 AWDP 实例…"
				>
					<DataTable
						rows={rows}
						rowKey={(row) => row.instance_id}
						empty={<div className="xz-aev-emptyline">还没有实例（开赛后选手启动实例）。</div>}
						columns={[
							{
								key: "gamebox",
								header: "GameBox",
								render: (row) => (
									<div>
										<div>{row.gamebox_name}</div>
										<div className="xz-muted xz-xs xz-mono">{row.container_name}</div>
									</div>
								),
							},
							{
								key: "owner",
								header: "归属",
								render: (row) => (
									<div className="xz-xs">
										{row.owner_team_id ? <div>team:{row.owner_team_id.slice(0, 8)}</div> : null}
										{row.owner_user_id ? <div>user:{row.owner_user_id.slice(0, 8)}</div> : null}
										{!row.owner_team_id && !row.owner_user_id ? <span className="xz-muted">—</span> : null}
									</div>
								),
							},
							{
								key: "state",
								header: "运行状态",
								render: (row) => <Badge tone={row.runtime_state === "ready" ? "ok" : "info"}>{row.runtime_state}</Badge>,
							},
							{
								key: "generation",
								header: "运行代",
								numeric: true,
								render: (row) => row.runtime_generation,
							},
							{
								key: "endpoints",
								header: "端点",
								render: (row) =>
									row.endpoints.length === 0 ? (
										<span className="xz-muted">—</span>
									) : (
										<div className="xz-aev-col" style={{ gap: 2 }}>
											{row.endpoints.map((endpoint, index) => (
												<span key={index} className="xz-aev-mono xz-xs">
													{endpoint.protocol}://{endpoint.public_host}:{endpoint.public_port} → {endpoint.container_port}
												</span>
											))}
										</div>
									),
							},
						]}
					/>
				</QueryBoundary>
			</CardBody>
		</Card>
	);
}

/* ── 积分榜 ───────────────────────────────────────────────────────── */

function AwdpScoresSection({ eventId }: { eventId: string }) {
	const client = useClient();
	const scores = useQuery({
		queryKey: qk.awdp.adminScores(eventId),
		queryFn: () => callList(client.awdp.admin.scores(eventId)),
		enabled: eventId.length > 0,
		refetchInterval: 30_000,
	});

	const rows = scores.data?.items ?? [];

	return (
		<Card>
			<CardHead title="AWDP 积分榜" icon="trophy" sub="Break 分 + Fix 分（30s 轮询）" />
			<CardBody flush>
				<QueryBoundary
					isPending={scores.isPending}
					isError={scores.isError}
					error={scores.error}
					refetch={() => void scores.refetch()}
					loadingLabel="正在加载积分榜…"
				>
					<DataTable
						rows={rows}
						rowKey={(row) => row.subject_id}
						empty={<div className="xz-aev-emptyline">暂无成绩。</div>}
						columns={[
							{ key: "rank", header: "#", width: 56, render: (row) => <span className="xz-aev-score">{row.rank}</span> },
							{ key: "subject", header: "选手 / 队伍", render: (row) => row.subject_name },
							{ key: "break", header: "Break 分", numeric: true, render: (row) => formatNumber(row.break_score) },
							{ key: "fix", header: "Fix 分", numeric: true, render: (row) => formatNumber(row.fix_score) },
							{
								key: "total",
								header: "总分",
								numeric: true,
								render: (row) => <span className="xz-aev-score">{formatNumber(row.total_score)}</span>,
							},
						]}
					/>
				</QueryBoundary>
			</CardBody>
		</Card>
	);
}

/* ── 数据大屏（optional）───────────────────────────────────────────── */

function AwdpDataSection({ eventId }: { eventId: string }) {
	const client = useClient();
	const data = useQuery({
		queryKey: qk.awdp.adminData(eventId),
		queryFn: () => call(client.awdp.admin.dataPresent(eventId), "AWDP 大屏数据"),
		enabled: eventId.length > 0,
	});

	const present = data.data;

	return (
		<Card>
			<CardHead title="数据大屏（optional）" icon="chart" sub="client.awdp.admin.dataPresent" />
			<CardBody>
				<QueryBoundary
					isPending={data.isPending}
					isError={data.isError}
					error={data.error}
					refetch={() => void data.refetch()}
					loadingLabel="正在加载大屏数据…"
				>
					{present ? (
						<div className="xz-aev-col">
							<div className="xz-aev-stats">
								<Stat label="参赛用户" value={formatNumber(present.user_count)} icon="users" />
								<Stat label="战队数" value={formatNumber(present.team_count)} icon="shield" />
								<Stat label="GameBox" value={formatNumber(present.gameboxes.length)} icon="box" />
								<Stat
									label="最近动态"
									value={formatNumber(present.recent_activity.length)}
									icon="bolt"
									gold
								/>
							</div>

							<DataTable
								compact
								rows={present.gameboxes}
								rowKey={(row) => row.id}
								empty={<div className="xz-aev-emptyline">暂无 GameBox 统计。</div>}
								columns={[
									{ key: "name", header: "GameBox", render: (row) => row.name },
									{ key: "category", header: "分类", render: (row) => row.category },
									{ key: "break", header: "被攻破次数", numeric: true, render: (row) => row.break_count },
									{ key: "fix", header: "修复次数", numeric: true, render: (row) => row.fix_count },
								]}
							/>

							<DataTable
								compact
								rows={present.scoreboard_top10}
								rowKey={(row) => row.subject_id}
								empty={<div className="xz-aev-emptyline">暂无榜单。</div>}
								columns={[
									{ key: "rank", header: "#", width: 46, render: (row) => row.rank },
									{ key: "name", header: "主体", render: (row) => row.subject_name },
									{ key: "total", header: "总分", numeric: true, render: (row) => row.total_score },
								]}
							/>

							{present.recent_activity.length > 0 ? (
								<div className="xz-feed">
									{present.recent_activity.map((entry, index) => (
										<div
											key={`${entry.subject_name}-${entry.created_at}-${index}`}
											className="xz-feed__item"
											data-kind={entry.action === "break" ? "attack" : "defense"}
										>
											<span>
												<strong>{entry.subject_name}</strong>{" "}
												{entry.action === "break" ? "攻破" : "修复"} {entry.gamebox_name}（
												{entry.gamebox_category}）
											</span>
											<Badge tone={entry.delta >= 0 ? "ok" : "danger"}>
												{entry.delta >= 0 ? "+" : ""}
												{entry.delta}
											</Badge>
											<span className="xz-feed__time">{formatDateTime(entry.created_at)}</span>
										</div>
									))}
								</div>
							) : (
								<div className="xz-aev-emptyline">暂无计分动态。</div>
							)}
						</div>
					) : null}
				</QueryBoundary>
			</CardBody>
		</Card>
	);
}

/* ── 生命周期文案 ─────────────────────────────────────────────────── */

const AWDP_META: Record<
	"start" | "breakToFix" | "finish",
	{
		title: (eventTitle: string) => string;
		description: string;
		consequences: string;
		confirmText: string;
	}
> = {
	start: {
		title: (title) => `开始「${title}」的 AWDP？`,
		description: "从 pending 进入 Break（攻破）阶段。",
		consequences: "开赛后 AWDP 参数被锁定（phase ≠ pending 不可再改配置）；选手开始破题计时，无法回到 pending。",
		confirmText: "开始 AWDP",
	},
	breakToFix: {
		title: (title) => `提前把「${title}」推进到修复阶段？`,
		description: "正常会由 Break 到期自动进入 Fix；此按钮用于提前推进。",
		consequences:
			"**所有实例会被重置为 pristine（runtime_generation + 1，公开端口不变）**，选手当前环境中的改动与已获取的 flag 状态会回到初始。",
		confirmText: "进入修复阶段",
	},
	finish: {
		title: (title) => `结束「${title}」的 AWDP？`,
		description: "Fix → Ended：选手不能再提交 flag / patch。",
		consequences: "结束时剩余评估仍会结算；结束后不可再开始或回到修复阶段，只能归档。",
		confirmText: "结束 AWDP",
	},
};
