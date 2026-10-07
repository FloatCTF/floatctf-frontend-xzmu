/**
 * 管理端「赛事与资产」域 —— 各页面/标签共用的构件。
 *
 * 这里只放**纯展示与解析**逻辑：分页状态、时间/数字输入解析、JSON 文本草稿、
 * 预检报告解析、状态标签。任何业务判定都直接来自后端字段，不在前端自造。
 */

import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { QueryParams } from "@floatctf/sdk";
import { EventFamily, EventPurpose, ParticipantMode } from "@floatctf/sdk/entity";

import { callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { Icon } from "../../../ui/icons.tsx";
import { Modal, QueryBoundary } from "../../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	CodeBlock,
	EmptyState,
	Field,
	TextArea,
	TextInput,
} from "../../../ui/primitives.tsx";
import { DataTable } from "../../../ui/Table.tsx";

/* ── 前缀失效根键 ─────────────────────────────────────────────────── */

/**
 * `qk` 的工厂键都是 `[根..., 参数]`；做前缀失效时需要「根」而不是某个具体参数。
 * 这些根与 `src/api/keys.ts` 里对应工厂的层级完全一致（不在页面里写裸数组）。
 */
export const ROOT = {
	adminEvents: ["admin", "events"] as const,
	adminChallenges: ["admin", "challenges"] as const,
	adminChallengeSets: ["admin", "challenge-sets"] as const,
	events: ["events"] as const,
	challenges: ["challenges"] as const,
	awdAdmin: ["awd", "admin"] as const,
	awdLibrary: ["awd", "library"] as const,
	awdPlatformNetwork: ["awd", "platform-network"] as const,
	awdpAdmin: ["awdp", "admin"] as const,
} as const;

/* ── 合法赛事模式组合（与后端 `event_mode.rs` 校验一致）────────────── */

export interface ModeCombo {
	family: EventFamily;
	purpose: EventPurpose;
	mode: ParticipantMode;
}

export const MODE_COMBOS: readonly ModeCombo[] = [
	{ family: EventFamily.Jeopardy, purpose: EventPurpose.Practice, mode: ParticipantMode.Individual },
	{ family: EventFamily.Jeopardy, purpose: EventPurpose.Competition, mode: ParticipantMode.Individual },
	{ family: EventFamily.Jeopardy, purpose: EventPurpose.Competition, mode: ParticipantMode.Team },
	{ family: EventFamily.Awd, purpose: EventPurpose.Competition, mode: ParticipantMode.Team },
	{ family: EventFamily.Awdp, purpose: EventPurpose.Practice, mode: ParticipantMode.Individual },
	{ family: EventFamily.Awdp, purpose: EventPurpose.Competition, mode: ParticipantMode.Individual },
	{ family: EventFamily.Awdp, purpose: EventPurpose.Competition, mode: ParticipantMode.Team },
];

export function purposesFor(family: string): EventPurpose[] {
	const set = new Set<EventPurpose>();
	for (const combo of MODE_COMBOS) if (combo.family === family) set.add(combo.purpose);
	return [...set];
}

export function modesFor(family: string, purpose: string): ParticipantMode[] {
	const set = new Set<ParticipantMode>();
	for (const combo of MODE_COMBOS) {
		if (combo.family === family && combo.purpose === purpose) set.add(combo.mode);
	}
	return [...set];
}

export function normalizeMode(family: string, purpose: string, mode: string): ParticipantMode {
	const modes = modesFor(family, purpose);
	return modes.find((entry) => entry === mode) ?? modes[0] ?? ParticipantMode.Individual;
}

/* ── 分页状态 ─────────────────────────────────────────────────────── */

export interface Pager {
	page: number;
	pageSize: number;
	params: QueryParams;
	setPage: (page: number) => void;
	setPageSize: (size: number) => void;
	reset: () => void;
}

/** 列表页统一的「页码 + 每页条数 → QueryParams」状态。 */
export function usePager(initialSize = 20): Pager {
	const [page, setPageState] = useState(1);
	const [pageSize, setPageSizeState] = useState(initialSize);

	const setPage = useCallback((next: number) => setPageState(Math.max(1, next)), []);
	const setPageSize = useCallback((size: number) => {
		setPageSizeState(size);
		setPageState(1);
	}, []);
	const reset = useCallback(() => setPageState(1), []);

	const params = useMemo<QueryParams>(() => ({ page, limit: pageSize }), [page, pageSize]);

	return { page, pageSize, params, setPage, setPageSize, reset };
}

/* ── 时间输入（`datetime-local` ↔ ISO/UTC）──────────────────────────── */

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

/** ISO 时间 → `datetime-local` 输入值（本地时区，分钟精度）。 */
export function toLocalInput(iso: string | null | undefined): string {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** `datetime-local` 输入值 → UTC ISO 字符串（空值 → `null`）。 */
export function fromLocalInput(value: string): string | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* ── 数字/JSON 文本解析 ───────────────────────────────────────────── */

export function numberText(value: number | null | undefined): string {
	return value === null || value === undefined ? "" : String(value);
}

export type NumberParse = { ok: true; value: number | null } | { ok: false; error: string };

/** 空文本 → `null`（清空语义）；非数字 → 可见错误。 */
export function parseNumberText(text: string): NumberParse {
	const trimmed = text.trim();
	if (trimmed === "") return { ok: true, value: null };
	const value = Number(trimmed);
	if (!Number.isFinite(value)) return { ok: false, error: "请输入数字" };
	return { ok: true, value };
}

/** JSON 文本草稿的三态：清空 / 保持原值 / 写入新 JSON。 */
export interface JsonDraft {
	clear: boolean;
	text: string;
}

export function draftFromJson(value: unknown): JsonDraft {
	if (value === null || value === undefined) return { clear: false, text: "" };
	try {
		return { clear: false, text: JSON.stringify(value, null, 2) };
	} catch {
		return { clear: false, text: String(value) };
	}
}

export type JsonResolve =
	| { kind: "omit" }
	| { kind: "clear" }
	| { kind: "set"; text: string }
	| { kind: "error"; message: string };

/**
 * `healthchecks_json` / `judge_args_json` 的提交解析。
 * 空白 = 不修改（省略字段）；勾选清空 = 显式 `null`；其余必须能 `JSON.parse`。
 */
export function resolveJsonDraft(draft: JsonDraft): JsonResolve {
	if (draft.clear) return { kind: "clear" };
	const trimmed = draft.text.trim();
	if (trimmed === "") return { kind: "omit" };
	try {
		JSON.parse(trimmed);
		return { kind: "set", text: trimmed };
	} catch (error) {
		return { kind: "error", message: error instanceof Error ? error.message : "JSON 解析失败" };
	}
}

/** 只读展示任意 JSON 值（预处理为文本，避免 React 渲染对象报错）。 */
export function JsonDump({ value, empty = "—" }: { value: unknown; empty?: string }) {
	const text = useMemo(() => {
		if (value === null || value === undefined || value === "") return "";
		if (typeof value === "string") return value;
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}, [value]);
	if (!text) return <span className="xz-muted">{empty}</span>;
	return <CodeBlock>{text}</CodeBlock>;
}

/** JSON 文本编辑控件（库条目 / 赛事 GameBox 等）。 */
export function JsonPatchField({
	label,
	hint,
	initial,
	draft,
	onChange,
	rows = 6,
}: {
	label: string;
	hint?: ReactNode;
	initial: unknown;
	draft: JsonDraft;
	onChange: (next: JsonDraft) => void;
	rows?: number;
}) {
	const parsed = resolveJsonDraft(draft);
	const error = parsed.kind === "error" ? parsed.message : undefined;
	return (
		<div className="xz-aev-jsonfield">
			<Field
				label={label}
				hint={hint}
				error={error}
			>
				{(props) => (
					<TextArea
						{...props}
						rows={rows}
						className="xz-input--mono"
						value={draft.text}
						disabled={draft.clear}
						placeholder={initial === null || initial === undefined ? "（后端当前为 null）" : "留空表示不修改"}
						onChange={(event) => onChange({ ...draft, text: event.target.value })}
					/>
				)}
			</Field>
			<label className="xz-checkbox xz-aev-jsonfield__clear">
				<input
					type="checkbox"
					checked={draft.clear}
					onChange={(event) => onChange({ ...draft, clear: event.target.checked })}
				/>
				清空该字段（提交 `null`）
			</label>
		</div>
	);
}

/* ── 预检报告（`error_msg` 是 JSON 文本）───────────────────────────── */

export interface PrecheckReportItem {
	component: string;
	text: string;
}

export interface PrecheckReport {
	errors: PrecheckReportItem[];
	notes: PrecheckReportItem[];
	raw: string;
	/** 解析失败时保留原文，避免吞掉后端信息。 */
	parseFailed: boolean;
}

/**
 * 解析 `AwdPrecheckRun.error_msg`：
 * `{"errors":[{"component","error"}],"notes":[{"component","note"}]}`。
 * 非 JSON 时**原样降级**为一条错误（不丢信息）。
 */
export function parsePrecheckReport(text: string | null | undefined): PrecheckReport {
	const raw = text ?? "";
	if (!raw.trim()) return { errors: [], notes: [], raw, parseFailed: false };
	try {
		const parsed = JSON.parse(raw) as {
			errors?: { component?: unknown; error?: unknown }[];
			notes?: { component?: unknown; note?: unknown }[];
		};
		const errors = Array.isArray(parsed.errors)
			? parsed.errors.map((entry) => ({
					component: String(entry?.component ?? "unknown"),
					text: String(entry?.error ?? ""),
				}))
			: [];
		const notes = Array.isArray(parsed.notes)
			? parsed.notes.map((entry) => ({
					component: String(entry?.component ?? "unknown"),
					text: String(entry?.note ?? ""),
				}))
			: [];
		return { errors, notes, raw, parseFailed: false };
	} catch {
		return { errors: [{ component: "precheck", text: raw }], notes: [], raw, parseFailed: true };
	}
}

/** 预检报告渲染（解析失败时明确说明「原样展示」）。 */
export function PrecheckReportView({ report }: { report: PrecheckReport }) {
	if (!report.raw.trim()) return <span className="xz-muted">无报告内容</span>;
	return (
		<div className="xz-aev-report">
			{report.parseFailed ? (
				<Banner tone="warn" title="报告不是合法 JSON，以下为原文">
					后端返回的 `error_msg` 无法解析为结构化报告，已原样展示以免丢失信息。
				</Banner>
			) : null}
			{report.errors.map((entry, index) => (
				<div key={`e-${index}`} className="xz-aev-report__item" data-tone="danger">
					<Icon name="alert" size={15} />
					<div>
						<code className="xz-code">{entry.component}</code>
						<div className="xz-aev-report__text">{entry.text}</div>
					</div>
				</div>
			))}
			{report.notes.map((entry, index) => (
				<div key={`n-${index}`} className="xz-aev-report__item" data-tone="info">
					<Icon name="info" size={15} />
					<div>
						<code className="xz-code">{entry.component}</code>
						<div className="xz-aev-report__text">{entry.text}</div>
					</div>
				</div>
			))}
			{report.errors.length === 0 && report.notes.length === 0 ? (
				<div className="xz-aev-report__ok">
					<Icon name="check" size={15} /> 报告为空（无错误、无备注）
				</div>
			) : null}
		</div>
	);
}

/* ── 状态标签 ─────────────────────────────────────────────────────── */

export type Tone = "neutral" | "crimson" | "gold" | "ok" | "warn" | "danger" | "info" | "solid";

const AWD_STATUS_LABEL: Record<string, string> = {
	draft: "草稿",
	configuring: "配置中",
	deploying: "部署中",
	deployed: "已部署",
	prechecking: "预检中",
	verified: "预检通过",
	running: "进行中",
	paused: "已暂停",
	network_error: "网络故障",
	start_blocked: "开赛受阻",
	finished: "已结束",
	archived: "已归档",
	deploy_failed: "部署失败",
	verification_failed: "预检失败",
};

const AWD_STATUS_TONE: Record<string, Tone> = {
	draft: "neutral",
	configuring: "neutral",
	deploying: "info",
	deployed: "ok",
	prechecking: "info",
	verified: "ok",
	running: "gold",
	paused: "warn",
	network_error: "danger",
	start_blocked: "danger",
	finished: "neutral",
	archived: "neutral",
	deploy_failed: "danger",
	verification_failed: "danger",
};

export function awdStatusLabel(status: string | null | undefined): string {
	if (!status) return "未配置";
	return AWD_STATUS_LABEL[status] ?? status;
}

export function awdStatusTone(status: string | null | undefined): Tone {
	if (!status) return "neutral";
	return AWD_STATUS_TONE[status] ?? "neutral";
}

export function AwdStatusBadge({ status }: { status: string | null | undefined }) {
	return <Badge tone={awdStatusTone(status)}>{awdStatusLabel(status)}</Badge>;
}

const AWD_PHASE_LABEL: Record<string, string> = {
	hardening: "加固期",
	attack: "攻击期",
	pause: "暂停",
};

export function awdPhaseLabel(phase: string | null | undefined): string {
	if (!phase) return "—";
	return AWD_PHASE_LABEL[phase] ?? phase;
}

const AWDP_PHASE_LABEL: Record<string, string> = {
	pending: "待开始",
	break: "攻破阶段",
	preparing_fix: "准备修复",
	fix: "修复阶段",
	ended: "已结束",
};

const AWDP_PHASE_TONE: Record<string, Tone> = {
	pending: "neutral",
	break: "danger",
	preparing_fix: "warn",
	fix: "info",
	ended: "neutral",
};

export function awdpPhaseLabel(phase: string | null | undefined): string {
	if (!phase) return "—";
	return AWDP_PHASE_LABEL[phase] ?? phase;
}

export function AwdpPhaseBadge({ phase }: { phase: string | null | undefined }) {
	return <Badge tone={AWDP_PHASE_TONE[phase ?? ""] ?? "neutral"}>{awdpPhaseLabel(phase)}</Badge>;
}

const OP_STATUS_LABEL: Record<string, string> = {
	pending: "等待中",
	running: "执行中",
	passed: "通过",
	failed: "失败",
	error: "错误",
	added: "已新增",
	skipped: "已跳过",
};

export function opStatusLabel(status: string | null | undefined): string {
	if (!status) return "—";
	return OP_STATUS_LABEL[status] ?? status;
}

export function opStatusTone(status: string | null | undefined): Tone {
	if (status === "passed" || status === "added") return "ok";
	if (status === "failed" || status === "error") return "danger";
	if (status === "pending" || status === "running") return "info";
	if (status === "skipped") return "warn";
	return "neutral";
}

export function instanceTypeTone(type: string): Tone {
	return type === "challenge" ? "crimson" : "gold";
}

/** 实例/GamerBox 运行时状态 → 徽标色（取值来自 `GameboxStatus` 等后端枚举）。 */
export function runtimeStateTone(state: string | null | undefined): Tone {
	switch (state) {
		case "ready":
		case "running":
			return "ok";
		case "pending":
		case "creating":
		case "resetting":
			return "info";
		case "missing":
		case "orphan":
		case "conflict":
		case "start_failed":
		case "reset_failed":
			return "danger";
		case "stopped":
			return "neutral";
		default:
			return "neutral";
	}
}

export function logLevelTone(level: string | null | undefined): Tone {
	switch ((level ?? "").toLowerCase()) {
		case "error":
		case "fatal":
			return "danger";
		case "warn":
		case "warning":
			return "warn";
		case "info":
			return "info";
		default:
			return "neutral";
	}
}

/* ── 批量操作结果（导入 / 校验 / 构建 / 扫描 / 预检）────────────────── */

export interface OpResultRow {
	key: string;
	name: ReactNode;
	ok: boolean | null;
	message?: ReactNode;
}

export function OpResultList({
	title,
	rows,
	onClear,
}: {
	title: ReactNode;
	rows: readonly OpResultRow[];
	onClear?: () => void;
}) {
	if (rows.length === 0) return null;
	const okCount = rows.filter((row) => row.ok === true).length;
	const failCount = rows.filter((row) => row.ok === false).length;
	return (
		<Card>
			<CardHead
				title={title}
				sub={`${rows.length} 条 · 成功 ${okCount} · 失败 ${failCount}`}
				icon="clipboard"
				actions={
					onClear ? (
						<Button size="sm" variant="quiet" icon="close" onClick={onClear}>
							清除结果
						</Button>
					) : null
				}
			/>
			<CardBody flush>
				<DataTable
					compact
					rows={rows as OpResultRow[]}
					rowKey={(row) => row.key}
					columns={[
						{ key: "name", header: "对象", render: (row) => row.name },
						{
							key: "ok",
							header: "结果",
							width: 96,
							render: (row) =>
								row.ok === null ? (
									<Badge tone="neutral">未知</Badge>
								) : row.ok ? (
									<Badge tone="ok" icon="check">
										成功
									</Badge>
								) : (
									<Badge tone="danger" icon="alert">
										失败
									</Badge>
								),
						},
						{ key: "message", header: "说明", render: (row) => row.message ?? "—" },
					]}
				/>
			</CardBody>
		</Card>
	);
}

/* ── 小工具 ───────────────────────────────────────────────────────── */

/** 文件选择 + 立即触发处理（导入题目包 / GameBox 包）。 */
export function ImportFileButton({
	accept,
	label = "选择文件导入",
	icon = "upload",
	loading,
	onFile,
	variant = "primary",
}: {
	accept: string;
	label?: string;
	icon?: string;
	loading?: boolean;
	onFile: (file: File) => void;
	variant?: "primary" | "ghost" | "gold";
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	return (
		<>
			<input
				ref={inputRef}
				type="file"
				accept={accept}
				style={{ display: "none" }}
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) onFile(file);
				}}
			/>
			<Button variant={variant} icon={icon} loading={loading} onClick={() => inputRef.current?.click()}>
				{label}
			</Button>
		</>
	);
}

/** 行内操作按钮组。 */
export function RowActions({ children }: { children: ReactNode }) {
	return <div className="xz-aev-rowactions">{children}</div>;
}

/**
 * 题目选择器（赛事挂题 / 题集加题共用）。
 * 数据来自 `client.admin.challenges.fetch({ page, limit })`；`excludedIds` 用于隐藏已加入的题目。
 */
export function ChallengePickerModal({
	open,
	title,
	description,
	excludedIds,
	busy,
	onClose,
	onConfirm,
}: {
	open: boolean;
	title: string;
	description?: ReactNode;
	excludedIds?: ReadonlySet<string>;
	busy?: boolean;
	onClose: () => void;
	onConfirm: (ids: string[]) => void;
}) {
	const client = useClient();
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const params = useMemo(() => ({ page: 1, limit: 200 }), []);
	const list = useQuery({
		queryKey: qk.admin.challenges(params),
		queryFn: () => callList(client.admin.challenges.fetch(params)),
		// 选择器只在打开时取数，避免进入页面就白拉一次题库。
		enabled: open,
	});

	const items = (list.data?.items ?? []).filter((challenge) => !excludedIds?.has(challenge.id));
	const needle = search.trim().toLowerCase();
	const visible = needle
		? items.filter((challenge) =>
				[challenge.name, challenge.category, challenge.safe_name].some((value) =>
					value.toLowerCase().includes(needle),
				),
			)
		: items;

	return (
		<Modal
			open={open}
			onClose={onClose}
			size="wide"
			persistent={busy}
			title={title}
			description={description}
			footer={
				<>
					<Button variant="quiet" onClick={onClose} disabled={busy}>
						取消
					</Button>
					<Button
						variant="primary"
						icon="plus"
						loading={busy}
						disabled={selected.size === 0}
						onClick={() => onConfirm([...selected])}
					>
						加入选中（{selected.size}）
					</Button>
				</>
			}
		>
			<div className="xz-aev-col">
				<span className="xz-search">
					<span className="xz-search__icon">
						<Icon name="search" size={14} />
					</span>
					<input
						className="xz-input"
						placeholder="搜索题目名称 / 分类"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</span>
				<QueryBoundary
					isPending={list.isPending}
					isError={list.isError}
					error={list.error}
					refetch={() => void list.refetch()}
					loadingLabel="正在加载题库…"
				>
					{visible.length === 0 ? (
						<EmptyState
							icon="puzzle"
							title={items.length === 0 ? "题库里没有可加入的题目" : "没有匹配的题目"}
							desc={items.length === 0 ? "先用包导入或手工新建题目。" : "换个关键词试试。"}
						/>
					) : (
						<div className="xz-aev-pick">
							{visible.map((challenge) => (
								<label key={challenge.id} className="xz-aev-pick__row">
									<input
										type="checkbox"
										checked={selected.has(challenge.id)}
										onChange={(event) =>
											setSelected((current) => {
												const next = new Set(current);
												if (event.target.checked) next.add(challenge.id);
												else next.delete(challenge.id);
												return next;
											})
										}
									/>
									<span className="xz-aev-pick__main">
										<div>{challenge.name}</div>
										<div className="xz-aev-pick__meta">
											{challenge.category} · {challenge.safe_name}
											{challenge.build_status ? ` · 构建：${challenge.build_status}` : ""}
											{challenge.hidden ? " · 已隐藏" : ""}
										</div>
									</span>
									<span className="xz-aev-pick__aside">
										<code className="xz-code">{challenge.id.slice(0, 8)}</code>
									</span>
								</label>
							))}
						</div>
					)}
				</QueryBoundary>
			</div>
		</Modal>
	);
}

/** 列表为空时的统一空态。 */
export function ListEmpty({ title, desc, icon = "folder" }: { title?: string; desc?: ReactNode; icon?: string }) {
	return <EmptyState icon={icon} title={title ?? "暂无数据"} desc={desc} />;
}

/** 只读键值行（用于详情卡）。 */
export function DetailRows({ rows }: { rows: readonly { k: string; v: ReactNode }[] }) {
	return (
		<dl className="xz-aev-rows">
			{rows.map((row, index) => (
				<div key={index} className="xz-aev-rows__row">
					<dt>{row.k}</dt>
					<dd>{row.v}</dd>
				</div>
			))}
		</dl>
	);
}

/** ISO 时间 + 相对/绝对展示。 */
export function TimeCell({ value }: { value: string | null | undefined }) {
	if (!value) return <span className="xz-muted">—</span>;
	return <span className="xz-nowrap">{formatDateTime(value)}</span>;
}

/** 文本输入（受控，带 Field 包装的常用组合）。 */
export function TextField({
	label,
	hint,
	error,
	required,
	value,
	onChange,
	placeholder,
	type = "text",
	disabled,
	mono,
}: {
	label: ReactNode;
	hint?: ReactNode;
	error?: ReactNode;
	required?: boolean;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	type?: string;
	disabled?: boolean;
	mono?: boolean;
}) {
	return (
		<Field label={label} hint={hint} error={error} required={required}>
			{(props) => (
				<TextInput
					{...props}
					type={type}
					value={value}
					placeholder={placeholder}
					disabled={disabled}
					className={mono ? "xz-input--mono" : undefined}
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
		</Field>
	);
}

/** 多行文本（受控）。 */
export function TextAreaField({
	label,
	hint,
	error,
	required,
	value,
	onChange,
	placeholder,
	rows = 4,
	disabled,
	mono,
}: {
	label: ReactNode;
	hint?: ReactNode;
	error?: ReactNode;
	required?: boolean;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	rows?: number;
	disabled?: boolean;
	mono?: boolean;
}) {
	return (
		<Field label={label} hint={hint} error={error} required={required}>
			{(props) => (
				<TextArea
					{...props}
					rows={rows}
					value={value}
					placeholder={placeholder}
					disabled={disabled}
					className={mono ? "xz-input--mono" : undefined}
					onChange={(event) => onChange(event.target.value)}
				/>
			)}
		</Field>
	);
}
