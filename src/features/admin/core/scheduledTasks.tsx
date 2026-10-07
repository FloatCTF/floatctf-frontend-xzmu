/**
 * 计划任务（`/admin/scheduled-tasks`）—— 调度任务 CRUD + 手动运行。
 *
 * 后端语义（SDK-API-REFERENCE §2.2.16 + 后端 `operations/scheduled_tasks.rs`）：
 * - `fetch(params)` / `create(task)` / `patch(task)`（payload 必须带 `id`）/ `remove(id_list)` /
 *   `run(task_id)`；
 * - `trigger_type` 的合法取值经后端校验为 **`once` / `cron` / `startup`**：
 *   `once` 必须填 `execute_at`，`cron` 必须填合法的 `cron_expr`；
 * - `task_key` 必须是后端 `TaskKey` 已注册的键，否则返回「未知任务键」——因此这里用
 *   可自由输入 + 候选列表（`datalist`），候选值逐一取自后端 `TaskKey::as_str`；
 * - `protected === true` 的任务**不可删除**（后端拒绝）；
 * - **手动运行是高风险操作**：会把任务置为待执行并唤醒调度器，任务的副作用会真实发生，
 *   所以要求输入确认词（任务键）。
 */

import { type FormEvent, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { ScheduledTasks } from "@floatctf/sdk/entity";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime, formatRelative } from "../../../lib/format.ts";
import { useDocumentTitle } from "../../../router/router.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	Checkbox,
	Field,
	IconButton,
	Switch,
	TextArea,
	TextInput,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta, type Column } from "../../../ui/Table.tsx";
import {
	AdminPageHead,
	FormModal,
	IdCell,
	inv,
	localDateTimeToIso,
	ListToolbar,
	isoToLocalDateTime,
	pageParams,
	RowActions,
	TextCell,
	useFilteredPage,
	useInvalidate,
	useTableState,
} from "./shared.tsx";

/**
 * 候选任务键 —— 与后端 `TaskKey::as_str()` 的取值逐一对应（`scheduler/task_key.rs`）。
 * 只是输入建议：最终以后端校验为准，新增键时仍可直接输入。
 */
const TASK_KEY_SUGGESTIONS = [
	"system.practice.check",
	"system.practice.clean",
	"platform.rustfs.clean",
	"awd.event.auto_precheck",
	"awd.event.start",
	"awd.event.hardening_end",
	"awd.judge.batch_deadline",
	"awd.round.start",
	"awd.round.end",
	"awd.archive.cleanup",
	"awdp.tick",
	"awdp.eval.worker",
	"awdp.practice.judge",
];

const TRIGGER_TYPES = ["cron", "once", "startup"] as const;

type TriggerType = (typeof TRIGGER_TYPES)[number];

const searchFields = (row: ScheduledTasks) => [
	row.task_name,
	row.task_key,
	row.description,
	row.status,
	row.trigger_type,
	row.cron_expr,
	row.last_error,
	row.error_msg,
	row.id,
];

function statusTone(status: string): "neutral" | "ok" | "warn" | "danger" | "info" {
	switch (status) {
		case "completed":
		case "success":
		case "done":
			return "ok";
		case "pending":
		case "running":
			return "info";
		case "failed":
		case "error":
			return "danger";
		case "retrying":
			return "warn";
		default:
			return "neutral";
	}
}

interface TaskDraft {
	task_name: string;
	task_key: string;
	trigger_type: TriggerType;
	cron_expr: string;
	execute_at: string;
	description: string;
	enabled: boolean;
}

function TaskForm({
	task,
	pending,
	onClose,
	onSubmit,
}: {
	task: ScheduledTasks | null;
	pending: boolean;
	onClose: () => void;
	onSubmit: (draft: TaskDraft) => void;
}) {
	const [draft, setDraft] = useState<TaskDraft>({
		task_name: task?.task_name ?? "",
		task_key: task?.task_key ?? "",
		trigger_type: (TRIGGER_TYPES as readonly string[]).includes(task?.trigger_type ?? "")
			? (task?.trigger_type as TriggerType)
			: "cron",
		cron_expr: task?.cron_expr ?? "",
		execute_at: isoToLocalDateTime(task?.execute_at),
		description: task?.description ?? "",
		// 后端 `CreateScheduledTaskRequest.enabled` 默认 false —— 默认勾选，任务才会真的跑。
		enabled: task?.enabled ?? true,
	});
	const [error, setError] = useState<string | null>(null);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!draft.task_name.trim()) {
			setError("任务名称不能为空。");
			return;
		}
		if (!draft.task_key.trim()) {
			setError("任务键不能为空。");
			return;
		}
		if (draft.trigger_type === "cron" && !draft.cron_expr.trim()) {
			setError("触发方式为 cron 时必须填写 Cron 表达式。");
			return;
		}
		if (draft.trigger_type === "once" && !draft.execute_at) {
			setError("触发方式为 once 时必须填写执行时间。");
			return;
		}
		setError(null);
		onSubmit({
			...draft,
			task_name: draft.task_name.trim(),
			task_key: draft.task_key.trim(),
			cron_expr: draft.cron_expr.trim(),
		});
	};

	return (
		<form className="xz-col" onSubmit={submit}>
			<div className="xz-formgrid">
				<Field label="任务名称" required>
					{(props) => (
						<TextInput
							{...props}
							value={draft.task_name}
							onChange={(event) => setDraft({ ...draft, task_name: event.target.value })}
						/>
					)}
				</Field>
				<Field
					label="任务键"
					required
					hint="必须是后端已注册的任务键（未知键会被拒绝）；可从候选列表选择"
				>
					{(props) => (
						<>
							<TextInput
								{...props}
								value={draft.task_key}
								list="xz-adm-task-keys"
								autoComplete="off"
								onChange={(event) => setDraft({ ...draft, task_key: event.target.value })}
							/>
							<datalist id="xz-adm-task-keys">
								{TASK_KEY_SUGGESTIONS.map((key) => (
									<option key={key} value={key} />
								))}
							</datalist>
						</>
					)}
				</Field>
				<Field label="触发方式" required hint="cron = 周期；once = 指定时刻；startup = 随调度器启动">
					{(props) => (
						<select
							{...props}
							className="xz-select"
							value={draft.trigger_type}
							onChange={(event) => {
								const next = TRIGGER_TYPES.find(
									(option) => String(option) === event.target.value,
								);
								setDraft({ ...draft, trigger_type: next ?? "cron" });
							}}
						>
							{TRIGGER_TYPES.map((option) => (
								<option key={option} value={option}>
									{option}
								</option>
							))}
						</select>
					)}
				</Field>
				<Field
					label="Cron 表达式"
					required={draft.trigger_type === "cron"}
					hint="仅在触发方式为 cron 时生效（后端用 cron 库校验）"
				>
					{(props) => (
						<TextInput
							{...props}
							className="xz-input--mono"
							value={draft.cron_expr}
							placeholder="0 */5 * * * * *"
							disabled={draft.trigger_type !== "cron"}
							onChange={(event) => setDraft({ ...draft, cron_expr: event.target.value })}
						/>
					)}
				</Field>
				<Field
					label="执行时间"
					required={draft.trigger_type === "once"}
					hint="仅在触发方式为 once 时生效（按浏览器本地时区提交）"
				>
					{(props) => (
						<TextInput
							{...props}
							type="datetime-local"
							value={draft.execute_at}
							disabled={draft.trigger_type !== "once"}
							onChange={(event) => setDraft({ ...draft, execute_at: event.target.value })}
						/>
					)}
				</Field>
			</div>
			<Field label="说明">
				{(props) => (
					<TextArea
						{...props}
						rows={3}
						value={draft.description}
						onChange={(event) => setDraft({ ...draft, description: event.target.value })}
					/>
				)}
			</Field>
			<Checkbox
				label="启用（创建时默认启用；停用的任务不会被调度器拾取）"
				checked={draft.enabled}
				onChange={(checked) => setDraft({ ...draft, enabled: checked })}
			/>
			{error ? (
				<div className="xz-field__error" role="alert">
					{error}
				</div>
			) : null}
			<div className="xz-adm-form-actions">
				<Button variant="quiet" onClick={onClose} disabled={pending}>
					取消
				</Button>
				<Button variant="primary" type="submit" loading={pending} icon="save">
					{task ? "保存修改" : "创建任务"}
				</Button>
			</div>
		</form>
	);
}

export function AdminScheduledTasksPage() {
	useDocumentTitle("计划任务");
	const client = useClient();
	const toast = useToast();
	const confirm = useConfirm();
	const invalidate = useInvalidate();
	const state = useTableState(20);

	const params = useMemo(
		() => pageParams(state.page, state.pageSize),
		[state.page, state.pageSize],
	);

	const query = useQuery({
		queryKey: qk.admin.scheduledTasks(params),
		queryFn: () => callList(client.admin.scheduled_tasks.fetch(params)),
		placeholderData: keepPreviousData,
	});

	const meta = readMeta(query.data?.meta, state.pageSize);
	const page = useFilteredPage(query.data?.items ?? [], state.search, searchFields);

	const [form, setForm] = useState<{ key: string; task: ScheduledTasks | null } | null>(null);

	const createMutation = useMutation({
		mutationFn: (draft: TaskDraft) =>
			call(
				client.admin.scheduled_tasks.create({
					task_name: draft.task_name,
					task_key: draft.task_key,
					trigger_type: draft.trigger_type,
					description: draft.description,
					enabled: draft.enabled,
					...(draft.trigger_type === "cron" ? { cron_expr: draft.cron_expr } : {}),
					...(draft.trigger_type === "once"
						? { execute_at: localDateTimeToIso(draft.execute_at) }
						: {}),
				}),
				"创建任务结果",
			),
		onSuccess: (task) => {
			toast.success("任务已创建", task.task_name);
			setForm(null);
			invalidate([inv.scheduledTasks, inv.dashboard]);
		},
		onError: (error) => toast.error("创建任务失败", errorText(error)),
	});

	const patchMutation = useMutation({
		mutationFn: ({ id, draft }: { id: string; draft: TaskDraft }) =>
			call(
				client.admin.scheduled_tasks.patch({
					// `patch` 用 `task.id` 拼 URL —— payload 必须带 id。
					id,
					task_name: draft.task_name,
					task_key: draft.task_key,
					trigger_type: draft.trigger_type,
					description: draft.description,
					enabled: draft.enabled,
					cron_expr: draft.trigger_type === "cron" ? draft.cron_expr : "",
					...(draft.trigger_type === "once"
						? { execute_at: localDateTimeToIso(draft.execute_at) }
						: {}),
				}),
				"修改任务结果",
			),
		onSuccess: (task) => {
			toast.success("任务已更新", task.task_name);
			setForm(null);
			invalidate([inv.scheduledTasks]);
		},
		onError: (error) => toast.error("更新任务失败", errorText(error)),
	});

	const toggleMutation = useMutation({
		mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
			call(client.admin.scheduled_tasks.patch({ id, enabled }), "启停任务结果"),
		onSuccess: (task) => {
			toast.success(task.enabled ? "任务已启用" : "任务已停用", task.task_name);
			invalidate([inv.scheduledTasks]);
		},
		onError: (error) => toast.error("切换任务状态失败", errorText(error)),
	});

	const removeMutation = useMutation({
		mutationFn: (id: string) => call(client.admin.scheduled_tasks.remove([id]), "删除任务结果"),
		onSuccess: (_count, id) => {
			toast.success("任务已删除", `ID ${id}`);
			invalidate([inv.scheduledTasks, inv.dashboard]);
		},
		onError: (error) => toast.error("删除任务失败", errorText(error)),
	});

	const runMutation = useMutation({
		mutationFn: (id: string) => call(client.admin.scheduled_tasks.run(id), "手动运行任务结果"),
		onSuccess: (task) => {
			toast.success("任务已提交执行", `${task.task_name}（${task.task_key}）`);
			invalidate([inv.scheduledTasks]);
		},
		onError: (error) => toast.error("手动运行任务失败", errorText(error)),
	});

	const askRun = async (row: ScheduledTasks) => {
		const ok = await confirm({
			title: `立即运行任务「${row.task_name}」？`,
			description: (
				<>
					任务键 <code className="xz-mono">{row.task_key}</code>
					{row.description ? ` · ${row.description}` : ""}
				</>
			),
			consequences: (
				<>
					任务会被立即置为待执行并唤醒调度器，其真实副作用会立刻发生（例如清理实例 / 推进 AWD
					轮次 / 结算评测）。该操作不受 `enabled` 开关限制，也不会等下一个触发时刻。请输入任务键以确认。
				</>
			),
			tone: "danger",
			confirmText: "立即运行",
			confirmPhrase: row.task_key,
		});
		if (ok) runMutation.mutate(row.id);
	};

	const askRemove = async (row: ScheduledTasks) => {
		if (row.protected) {
			toast.warn("受保护任务不可删除", `${row.task_name} 被标记为 protected，后端会拒绝该请求。`);
			return;
		}
		const ok = await confirm({
			title: `删除任务「${row.task_name}」？`,
			description: (
				<>
					任务键 <code className="xz-mono">{row.task_key}</code>
				</>
			),
			consequences: (
				<>
					该任务行会被永久删除且无法恢复；未完成的执行记录（`attempt_count` / `last_error`）一并消失。
					如果该任务由平台自动创建，删除后相关功能会失去调度入口。
				</>
			),
			tone: "danger",
			confirmText: "删除任务",
		});
		if (ok) removeMutation.mutate(row.id);
	};

	const columns: readonly Column<ScheduledTasks>[] = [
		{
			key: "task",
			header: "任务",
			render: (row) => (
				<div>
					<div className="xz-adm-attention__title">
						{row.task_name || "（未命名）"}
						{row.protected ? <Badge tone="warn" icon="lock">受保护</Badge> : null}
					</div>
					<div className="xz-adm-attention__meta">
						<code className="xz-mono">{row.task_key}</code>
						{row.description ? ` · ${row.description}` : ""}
					</div>
				</div>
			),
		},
		{
			key: "trigger",
			header: "触发",
			render: (row) => (
				<div className="xz-xs">
					<Badge tone="info">{row.trigger_type}</Badge>{" "}
					{row.trigger_type === "cron" && row.cron_expr ? (
						<code className="xz-mono">{row.cron_expr}</code>
					) : row.execute_at ? (
						<span>{formatDateTime(row.execute_at)}</span>
					) : null}
				</div>
			),
		},
		{
			key: "status",
			header: "状态",
			render: (row) => (
				<div className="xz-col" style={{ gap: 4 }}>
					<div className="xz-row" style={{ gap: "var(--xz-sp-2)" }}>
						<Badge tone={statusTone(row.status)}>{row.status || "—"}</Badge>
						{row.locked_at ? <Badge tone="gold" title={`locked_at ${row.locked_at}`}>执行中</Badge> : null}
					</div>
					<Switch
						label={`${row.enabled ? "停用" : "启用"}任务 ${row.task_name}`}
						checked={row.enabled}
						disabled={toggleMutation.isPending}
						onChange={(next) => toggleMutation.mutate({ id: row.id, enabled: next })}
					/>
				</div>
			),
		},
		{
			key: "last_run_at",
			header: "上次运行",
			render: (row) =>
				row.last_run_at ? (
					<div>
						<div>{formatDateTime(row.last_run_at)}</div>
						<div className="xz-adm-hint">{formatRelative(row.last_run_at)}</div>
					</div>
				) : (
					<span className="xz-muted">从未运行</span>
				),
		},
		{
			key: "attempts",
			header: "重试",
			numeric: true,
			render: (row) => (
				<span className="xz-mono xz-xs">
					{row.attempt_count}/{row.max_attempts}
				</span>
			),
		},
		{
			key: "error",
			header: "最近错误",
			render: (row) => (
				<TextCell value={row.last_error || row.error_msg} max={56} />
			),
		},
		{ key: "id", header: "ID", render: (row) => <IdCell id={row.id} /> },
		{
			key: "actions",
			header: "操作",
			align: "right",
			width: 150,
			render: (row) => (
				<RowActions>
					<IconButton
						icon="edit"
						label={`编辑 ${row.task_name}`}
						onClick={() => setForm({ key: `edit-${row.id}`, task: row })}
					/>
					<IconButton
						icon="play"
						label={`立即运行 ${row.task_name}`}
						onClick={() => void askRun(row)}
					/>
					<IconButton
						icon="trash"
						label={
							row.protected
								? `受保护任务不可删除（${row.task_name}）`
								: `删除 ${row.task_name}`
						}
						disabled={row.protected}
						onClick={() => void askRemove(row)}
					/>
				</RowActions>
			),
		},
	];

	return (
		<div className="xz-page xz-page--wide">
			<AdminPageHead
				title="计划任务"
				desc="平台调度器的任务定义。任务键由后端校验（未知键会被拒绝），手动运行会立刻产生真实副作用。"
				actions={
					<Button
						variant="primary"
						icon="plus"
						onClick={() => setForm({ key: "create", task: null })}
					>
						新建任务
					</Button>
				}
			/>

			<div style={{ marginBottom: "var(--xz-sp-5)" }}>
				<Banner tone="warn" title="手动运行 = 立即产生副作用">
					手动运行不受「启用」开关限制，也不等下一个触发时刻。对推进 AWD 轮次、评测结算这类任务，
					误触会直接改变比赛状态。
				</Banner>
			</div>

			<Card>
				<CardHead icon="clock" title="任务列表" sub={`共 ${meta.total} 个任务`} />
				<CardBody flush>
					<div style={{ padding: "var(--xz-sp-4) var(--xz-sp-5) 0" }}>
						<ListToolbar
							search={state.search}
							onSearch={state.setSearch}
							placeholder="搜索任务名 / 任务键 / 状态 / 错误"
							hint={
								state.search
									? `本页匹配 ${page.matched} / ${page.loaded} 条（本地过滤）`
									: "搜索在已加载的当前页内过滤"
							}
							actions={
								<Button
									size="sm"
									icon="refresh"
									loading={query.isFetching}
									onClick={() => void query.refetch()}
								>
									刷新
								</Button>
							}
						/>
					</div>
					<QueryBoundary
						isPending={query.isPending}
						isError={query.isError}
						error={query.error}
						refetch={query.refetch}
						loadingLabel="正在加载计划任务…"
					>
						<DataTable
							columns={columns}
							rows={page.rows}
							rowKey={(row) => row.id}
							empty={state.search ? "当前页没有匹配的任务。" : "还没有计划任务。"}
						/>
						<div style={{ padding: "0 var(--xz-sp-5) var(--xz-sp-4)" }}>
							<Pagination
								page={meta.page}
								pageSize={meta.pageSize}
								total={meta.total}
								onPageChange={state.setPage}
								onPageSizeChange={state.setPageSize}
							/>
						</div>
					</QueryBoundary>
				</CardBody>
			</Card>

			<FormModal
				open={form !== null}
				title={form?.task ? "编辑任务" : "新建任务"}
				description="任务键必须是后端 TaskKey 已注册的键；cron 需要 Cron 表达式，once 需要执行时间。"
				onClose={() => setForm(null)}
			>
				{form ? (
					<TaskForm
						key={form.key}
						task={form.task}
						pending={createMutation.isPending || patchMutation.isPending}
						onClose={() => setForm(null)}
						onSubmit={(draft) => {
							if (form.task) patchMutation.mutate({ id: form.task.id, draft });
							else createMutation.mutate(draft);
						}}
					/>
				) : null}
			</FormModal>
		</div>
	);
}
