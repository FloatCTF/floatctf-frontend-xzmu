/**
 * 动态设置（`/admin/settings`）—— 平台运行期配置 CRUD。
 *
 * 后端语义（CAPABILITY-BEHAVIOR-MAP「管理端：总览与内容」+ SDK §2.2.3）：
 * - `fetch()` **无参数、不分页**（本页因此在前端分页，且明确标注）；
 * - `SettingsDto = Settings & { resolved_value }`：
 *   `value` 是数据库原值（保留 `{{WORK_DIR}}` 这类模板），`resolved_value` 是后端解析后的生效值
 *   —— 两者必须分开展示；
 * - `type` 取值来自 `SettingValueType = string | integer | boolean | float`；
 * - `protected === true` 的设置**可以改，但删除会被后端拒绝**
 *   （`protected setting can not be deleted`）→ 删除按钮禁用并说明原因。
 */

import { type FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SettingValueType } from "@floatctf/sdk/entity";
import type { SettingsDto } from "@floatctf/sdk";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { Link } from "../../../router/Link.tsx";
import { useDocumentTitle } from "../../../router/router.tsx";
import { Icon } from "../../../ui/icons.tsx";
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
	Select,
	TextArea,
	TextInput,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, type Column } from "../../../ui/Table.tsx";
import {
	AdminPageHead,
	FormModal,
	IdCell,
	inv,
	ListToolbar,
	RowActions,
	filterRows,
	slicePage,
	TextCell,
	useInvalidate,
	useTableState,
} from "./shared.tsx";

const FRONTEND_ACTIVE_KEY = "FRONTEND_ACTIVE";

const TYPE_OPTIONS: readonly SettingValueType[] = [
	SettingValueType.String,
	SettingValueType.Integer,
	SettingValueType.Boolean,
	SettingValueType.Float,
];

const TYPE_LABEL: Record<string, string> = {
	string: "字符串",
	integer: "整数",
	boolean: "布尔",
	float: "浮点",
};

const searchFields = (row: SettingsDto) => [
	row.key,
	row.value,
	row.resolved_value,
	row.description,
	row.type,
	row.id,
];

function typeTone(value: SettingValueType): "neutral" | "info" | "gold" | "ok" {
	switch (value) {
		case SettingValueType.Integer:
			return "info";
		case SettingValueType.Boolean:
			return "ok";
		case SettingValueType.Float:
			return "gold";
		default:
			return "neutral";
	}
}

interface SettingDraft {
	key: string;
	value: string;
	description: string;
	type: SettingValueType;
	protected: boolean;
}

function SettingForm({
	setting,
	pending,
	onClose,
	onSubmit,
}: {
	setting: SettingsDto | null;
	pending: boolean;
	onClose: () => void;
	onSubmit: (draft: SettingDraft) => void;
}) {
	const [draft, setDraft] = useState<SettingDraft>({
		key: setting?.key ?? "",
		value: setting?.value ?? "",
		description: setting?.description ?? "",
		type: setting?.type ?? SettingValueType.String,
		protected: setting?.protected ?? false,
	});
	const [error, setError] = useState<string | null>(null);

	const keyLocked = Boolean(setting?.protected);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!draft.key.trim()) {
			setError("设置键不能为空。");
			return;
		}
		setError(null);
		onSubmit({ ...draft, key: draft.key.trim() });
	};

	return (
		<form className="xz-col" onSubmit={submit}>
			<div className="xz-formgrid">
				<Field
					label="设置键"
					required
					hint={keyLocked ? "受保护设置的键不允许修改（避免破坏平台自身引用）" : undefined}
				>
					{(props) => (
						<TextInput
							{...props}
							value={draft.key}
							disabled={keyLocked}
							autoComplete="off"
							onChange={(event) => setDraft({ ...draft, key: event.target.value })}
						/>
					)}
				</Field>
				<Field label="类型" hint="决定消费方如何解析该值">
					{(props) => (
						<Select
							{...props}
							value={draft.type}
							onChange={(event) => {
								const next = TYPE_OPTIONS.find(
									(option) => String(option) === event.target.value,
								);
								setDraft({ ...draft, type: next ?? SettingValueType.String });
							}}
						>
							{TYPE_OPTIONS.map((option) => (
								<option key={option} value={option}>
									{TYPE_LABEL[option] ?? option}（{option}）
								</option>
							))}
						</Select>
					)}
				</Field>
			</div>
			<Field
				label="值"
				required
				hint="数据库原值：可以保留 {{VAR}} 模板，生效值由后端解析后写入 resolved_value"
			>
				{(props) => (
					<TextArea
						{...props}
						rows={3}
						value={draft.value}
						onChange={(event) => setDraft({ ...draft, value: event.target.value })}
					/>
				)}
			</Field>
			<Field label="说明">
				{(props) => (
					<TextInput
						{...props}
						value={draft.description}
						onChange={(event) => setDraft({ ...draft, description: event.target.value })}
					/>
				)}
			</Field>
			<Checkbox
				label="受保护（后端禁止删除该设置）"
				checked={draft.protected}
				onChange={(checked) => setDraft({ ...draft, protected: checked })}
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
					{setting ? "保存修改" : "创建设置"}
				</Button>
			</div>
		</form>
	);
}

export function AdminSettingsPage() {
	useDocumentTitle("动态设置");
	const client = useClient();
	const toast = useToast();
	const confirm = useConfirm();
	const invalidate = useInvalidate();
	const state = useTableState(20);

	// 设置列表接口不接受参数、不分页（SDK §2.2.3）：一次取全量，前端做搜索 + 分页。
	const query = useQuery({
		queryKey: qk.admin.settings,
		queryFn: () => callList(client.admin.settings.fetch()),
	});

	const all = query.data?.items ?? [];
	const filtered = useMemo(() => filterRows(all, state.search, searchFields), [all, state.search]);
	const rows = slicePage(filtered, state.page, state.pageSize);

	const [form, setForm] = useState<{ key: string; setting: SettingsDto | null } | null>(null);

	const createMutation = useMutation({
		mutationFn: (draft: SettingDraft) =>
			call(
				client.admin.settings.create({
					key: draft.key,
					value: draft.value,
					description: draft.description,
					type: draft.type,
					protected: draft.protected,
				}),
				"创建设置结果",
			),
		onSuccess: (setting) => {
			toast.success("设置已创建", setting.key);
			setForm(null);
			invalidate([inv.settings]);
		},
		onError: (error) => toast.error("创建设置失败", errorText(error)),
	});

	const patchMutation = useMutation({
		mutationFn: ({ id, draft }: { id: string; draft: SettingDraft }) =>
			call(
				client.admin.settings.patch({
					// `patch` 用 `setting.id` 拼 URL —— payload 必须带 id。
					id,
					key: draft.key,
					value: draft.value,
					description: draft.description,
					type: draft.type,
					protected: draft.protected,
				}),
				"修改设置结果",
			),
		onSuccess: (setting) => {
			toast.success("设置已更新", `${setting.key} = ${setting.resolved_value}`);
			setForm(null);
			invalidate([inv.settings]);
		},
		onError: (error) => toast.error("更新设置失败", errorText(error)),
	});

	const removeMutation = useMutation({
		mutationFn: (id: string) => call(client.admin.settings.remove([id]), "删除设置结果"),
		onSuccess: (_count, id) => {
			toast.success("设置已删除", `ID ${id}`);
			invalidate([inv.settings]);
		},
		onError: (error) => toast.error("删除设置失败", errorText(error)),
	});

	const askRemove = async (row: SettingsDto) => {
		if (row.protected) {
			toast.warn("受保护设置不可删除", `${row.key} 被标记为 protected，后端会拒绝该请求。`);
			return;
		}
		const ok = await confirm({
			title: `删除设置「${row.key}」？`,
			description: <>当前值 {row.resolved_value || row.value}</>,
			consequences: (
				<>
					删除后消费该键的代码会回落到代码内置默认值（如果存在），或读取失败。属于不可恢复操作；
					若只是要改值，请使用「编辑」。
				</>
			),
			tone: "danger",
			confirmText: "删除设置",
		});
		if (ok) removeMutation.mutate(row.id);
	};

	const columns: readonly Column<SettingsDto>[] = [
		{
			key: "key",
			header: "设置键",
			render: (row) => (
				<span className="xz-adm-id">
					<code className="xz-mono">{row.key}</code>
					{row.key === FRONTEND_ACTIVE_KEY ? <Badge tone="gold">前端开关</Badge> : null}
				</span>
			),
		},
		{
			key: "type",
			header: "类型",
			render: (row) => <Badge tone={typeTone(row.type)}>{TYPE_LABEL[row.type] ?? row.type}</Badge>,
		},
		{
			key: "value",
			header: "原值（value）",
			render: (row) => <TextCell value={row.value} max={48} />,
		},
		{
			key: "resolved_value",
			header: "生效值（resolved_value）",
			render: (row) => (
				<span>
					<TextCell value={row.resolved_value} max={48} />
					{row.resolved_value !== row.value ? (
						<span className="xz-adm-hint"> （已解析模板）</span>
					) : null}
				</span>
			),
		},
		{
			key: "description",
			header: "说明",
			render: (row) => <TextCell value={row.description} max={56} />,
		},
		{
			key: "protected",
			header: "保护",
			render: (row) =>
				row.protected ? (
					<Badge tone="warn" icon="lock">
						受保护
					</Badge>
				) : (
					<span className="xz-muted">—</span>
				),
		},
		{ key: "updated_at", header: "更新时间", render: (row) => formatDateTime(row.updated_at) },
		{ key: "id", header: "ID", render: (row) => <IdCell id={row.id} /> },
		{
			key: "actions",
			header: "操作",
			align: "right",
			width: 110,
			render: (row) => (
				<RowActions>
					<IconButton
						icon="edit"
						label={`编辑 ${row.key}`}
						onClick={() => setForm({ key: `edit-${row.id}`, setting: row })}
					/>
					<IconButton
						icon="trash"
						label={
							row.protected
								? `受保护设置不可删除（${row.key}）`
								: `删除 ${row.key}`
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
				title="动态设置"
				desc="平台运行期配置。value 是数据库原值（可含模板），resolved_value 是后端解析后的生效值，两者可能不同。"
				actions={
					<Button
						variant="primary"
						icon="plus"
						onClick={() => setForm({ key: "create", setting: null })}
					>
						新建设置
					</Button>
				}
			/>

			<div style={{ marginBottom: "var(--xz-sp-5)" }}>
				<Banner tone="info" title="关于受保护设置">
					标记为 protected 的设置可以修改，但删除会被后端拒绝（返回
					「protected setting can not be deleted」），因此列表里的删除按钮对它们禁用。前端切换开关{" "}
					<code className="xz-mono">FRONTEND_ACTIVE</code> 有专门的可视化入口：
					<Link to="/admin/frontends">已安装前端</Link>。
				</Banner>
			</div>

			<Card>
				<CardHead
					icon="settings"
					title="设置列表"
					sub={`共 ${all.length} 项 · 设置接口不分页，此处为前端分页`}
				/>
				<CardBody flush>
					<div style={{ padding: "var(--xz-sp-4) var(--xz-sp-5) 0" }}>
						<ListToolbar
							search={state.search}
							onSearch={state.setSearch}
							placeholder="搜索设置键 / 值 / 说明"
							hint={
								state.search
									? `匹配 ${filtered.length} / ${all.length} 项（全量本地过滤）`
									: "设置接口一次返回全量，搜索作用于全部设置"
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
						loadingLabel="正在加载设置…"
					>
						<DataTable
							columns={columns}
							rows={rows}
							rowKey={(row) => row.id}
							empty={state.search ? "没有匹配的设置。" : "平台还没有动态设置。"}
						/>
						<div style={{ padding: "0 var(--xz-sp-5) var(--xz-sp-4)" }}>
							<Pagination
								page={state.page}
								pageSize={state.pageSize}
								total={filtered.length}
								onPageChange={state.setPage}
								onPageSizeChange={state.setPageSize}
							/>
						</div>
					</QueryBoundary>
				</CardBody>
			</Card>

			<p className="xz-adm-note" style={{ marginTop: "var(--xz-sp-4)" }}>
				<Icon name="info" size={13} /> 设置列表不分页是后端契约（
				<code className="xz-mono">client.admin.settings.fetch()</code> 无参数）；
				条目很多时请使用搜索框缩小范围。
			</p>

			<FormModal
				open={form !== null}
				title={form?.setting ? "编辑设置" : "新建设置"}
				description="修改设置会立即影响消费该键的平台功能，请确认取值口径。"
				onClose={() => setForm(null)}
			>
				{form ? (
					<SettingForm
						key={form.key}
						setting={form.setting}
						pending={createMutation.isPending || patchMutation.isPending}
						onClose={() => setForm(null)}
						onSubmit={(draft) => {
							if (form.setting) patchMutation.mutate({ id: form.setting.id, draft });
							else createMutation.mutate(draft);
						}}
					/>
				) : null}
			</FormModal>
		</div>
	);
}
