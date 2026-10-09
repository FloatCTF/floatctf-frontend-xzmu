/**
 * 超管账号管理（`/admin/super-admins`）—— 平台最高权限账号治理。
 *
 * 后端语义（SDK-API-REFERENCE §2.2.22 + §5 陷阱 22）：
 * - `client.admin.super_admin.fetch(params)` / `create(data)` / `remove(id_list)`；
 * - **`patch(id, data)` 是位置参数两个，且内部发的是 `POST /super_admin/{id}`（不是 PATCH）**；
 * - 删除超管是平台最高风险操作：除后果说明外还要求**输入确认词**；
 * - `SuperAdmin` 实体带 `password` 字段 —— 本页面任何位置都不渲染它。
 */

import { type FormEvent, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { SuperAdmin } from "@floatctf/sdk/entity";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { useDocumentTitle } from "../../../router/router.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import {
	Badge,
	Button,
	Card,
	CardBody,
	CardHead,
	Field,
	IconButton,
	TextInput,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta, type Column } from "../../../ui/Table.tsx";
import {
	AdminPageHead,
	FormModal,
	IdCell,
	inv,
	ListToolbar,
	pageParams,
	RowActions,
	useFilteredPage,
	useInvalidate,
	useTableState,
} from "./shared.tsx";

const MIN_PASSWORD = 8;

const searchFields = (row: SuperAdmin) => [row.username, row.email, row.id];

interface AdminDraft {
	username: string;
	email: string;
	password: string;
}

function SuperAdminForm({
	mode,
	account,
	pending,
	onClose,
	onSubmit,
}: {
	mode: "create" | "edit";
	account: SuperAdmin | null;
	pending: boolean;
	onClose: () => void;
	onSubmit: (draft: AdminDraft) => void;
}) {
	const [draft, setDraft] = useState<AdminDraft>({
		username: account?.username ?? "",
		email: account?.email ?? "",
		password: "",
	});
	const [error, setError] = useState<string | null>(null);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!draft.username.trim()) {
			setError("用户名不能为空。");
			return;
		}
		if (mode === "create" && draft.password.length < MIN_PASSWORD) {
			setError(`密码至少 ${MIN_PASSWORD} 位。`);
			return;
		}
		if (mode === "edit" && draft.password && draft.password.length < MIN_PASSWORD) {
			setError(`新密码至少 ${MIN_PASSWORD} 位（留空表示不修改）。`);
			return;
		}
		setError(null);
		onSubmit({ ...draft, username: draft.username.trim() });
	};

	return (
		<form className="xz-col" onSubmit={submit}>
			<div className="xz-formgrid">
				<Field label="用户名" required>
					{(props) => (
						<TextInput
							{...props}
							value={draft.username}
							autoComplete="off"
							onChange={(event) => setDraft({ ...draft, username: event.target.value })}
						/>
					)}
				</Field>
				<Field label="邮箱">
					{(props) => (
						<TextInput
							{...props}
							type="email"
							value={draft.email}
							autoComplete="off"
							onChange={(event) => setDraft({ ...draft, email: event.target.value })}
						/>
					)}
				</Field>
				<Field
					label={mode === "create" ? "密码" : "重置密码"}
					required={mode === "create"}
					hint={mode === "create" ? `至少 ${MIN_PASSWORD} 位` : "留空表示不修改当前密码"}
				>
					{(props) => (
						<TextInput
							{...props}
							type="password"
							value={draft.password}
							autoComplete="new-password"
							placeholder={mode === "edit" ? "不修改则留空" : undefined}
							onChange={(event) => setDraft({ ...draft, password: event.target.value })}
						/>
					)}
				</Field>
			</div>
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
					{mode === "create" ? "创建管理员" : "保存修改"}
				</Button>
			</div>
		</form>
	);
}

export function AdminSuperAdminsPage() {
	useDocumentTitle("管理员账号");
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
		queryKey: qk.admin.superAdmins(params),
		queryFn: () => callList(client.admin.super_admin.fetch(params)),
		placeholderData: keepPreviousData,
	});

	const meta = readMeta(query.data?.meta, state.pageSize);
	const page = useFilteredPage(query.data?.items ?? [], state.search, searchFields);

	const [form, setForm] = useState<{
		key: string;
		mode: "create" | "edit";
		account: SuperAdmin | null;
	} | null>(null);

	const createMutation = useMutation({
		mutationFn: (draft: AdminDraft) =>
			call(
				client.admin.super_admin.create({
					username: draft.username,
					password: draft.password,
					email: draft.email,
				}),
				"创建管理员结果",
			),
		onSuccess: (account) => {
			toast.success("管理员已创建", account.username);
			setForm(null);
			invalidate([inv.superAdmins]);
		},
		onError: (error) => toast.error("创建管理员失败", errorText(error)),
	});

	const patchMutation = useMutation({
		mutationFn: ({ id, draft }: { id: string; draft: AdminDraft }) =>
			call(
				// 位置参数 (id, data)；SDK 内部发的是 POST，不是 PATCH。
				client.admin.super_admin.patch(id, {
					username: draft.username,
					email: draft.email,
					...(draft.password ? { password: draft.password } : {}),
				}),
				"修改管理员结果",
			),
		onSuccess: (account) => {
			toast.success("管理员已更新", account.username);
			setForm(null);
			invalidate([inv.superAdmins]);
		},
		onError: (error) => toast.error("更新管理员失败", errorText(error)),
	});

	const removeMutation = useMutation({
		mutationFn: (id: string) => call(client.admin.super_admin.remove([id]), "删除管理员结果"),
		onSuccess: (_count, id) => {
			toast.success("管理员已删除", `ID ${id}`);
			invalidate([inv.superAdmins]);
		},
		onError: (error) => toast.error("删除管理员失败", errorText(error)),
	});

	const askRemove = async (row: SuperAdmin) => {
		const ok = await confirm({
			title: `删除管理员「${row.username}」？`,
			description: (
				<>
					管理员 ID <code className="xz-mono">{row.id}</code>
				</>
			),
			consequences: (
				<>
					该管理员将立刻失去全部管理权限且账号被永久删除，不可恢复。如果这是最后一个管理员账号，
					平台将没有人能再登录管理控制台。请输入确认词以继续。
				</>
			),
			tone: "danger",
			confirmText: "删除管理员",
			confirmPhrase: "删除管理员",
		});
		if (ok) removeMutation.mutate(row.id);
	};

	const columns: readonly Column<SuperAdmin>[] = [
		{
			key: "username",
			header: "用户名",
			render: (row) => <strong>{row.username}</strong>,
		},
		{
			key: "email",
			header: "邮箱",
			render: (row) => row.email || <span className="xz-muted">—</span>,
		},
		{ key: "created_at", header: "创建时间", render: (row) => formatDateTime(row.created_at) },
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
						label={`编辑 ${row.username}`}
						onClick={() => setForm({ key: `edit-${row.id}`, mode: "edit", account: row })}
					/>
					<IconButton
						icon="trash"
						label={`删除 ${row.username}`}
						onClick={() => void askRemove(row)}
					/>
				</RowActions>
			),
		},
	];

	return (
		<div className="xz-page xz-page--wide">
			<AdminPageHead
				title="管理员账号"
				desc="SuperAdmin 拥有平台全部管理权限（管理端登录与选手端登录是两个独立作用域）。"
				actions={
					<Button
						variant="primary"
						icon="plus"
						onClick={() => setForm({ key: "create", mode: "create", account: null })}
					>
						新建管理员
					</Button>
				}
			/>

			<div className="xz-danger-zone" style={{ marginBottom: "var(--xz-sp-5)" }}>
				<div className="xz-danger-zone__title">
					<Icon name="alert" size={16} /> 高权限账号 · 危险区
				</div>
				<p className="xz-adm-note">
					管理员可以删除平台数据、运行计划任务、切换生效前端等。删除管理员是不可恢复的最高风险操作：
					本页要求逐字输入确认词，且删除的是账号本身。请为每位运维人员分配独立账号，不要共用；
					删除最后一个管理员会让平台彻底失去管理入口。
				</p>
			</div>

			<Card>
				<CardHead
					icon="shield"
					title="管理员列表"
					sub={`共 ${meta.total} 个账号`}
					actions={<Badge tone="crimson">SuperAdmin</Badge>}
				/>
				<CardBody flush>
					<div style={{ padding: "var(--xz-sp-4) var(--xz-sp-5) 0" }}>
						<ListToolbar
							search={state.search}
							onSearch={state.setSearch}
							placeholder="搜索用户名 / 邮箱 / ID"
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
						loadingLabel="正在加载管理员列表…"
					>
						<DataTable
							columns={columns}
							rows={page.rows}
							rowKey={(row) => row.id}
							empty={state.search ? "当前页没有匹配的管理员。" : "还没有管理员账号。"}
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
				title={form?.mode === "edit" ? "编辑管理员" : "新建管理员"}
				description="修改接口走 POST /super_admin/{id}，密码留空表示不修改"
				onClose={() => setForm(null)}
			>
				{form ? (
					<SuperAdminForm
						key={form.key}
						mode={form.mode}
						account={form.account}
						pending={createMutation.isPending || patchMutation.isPending}
						onClose={() => setForm(null)}
						onSubmit={(draft) => {
							if (form.mode === "create") createMutation.mutate(draft);
							else if (form.account) patchMutation.mutate({ id: form.account.id, draft });
						}}
					/>
				) : null}
			</FormModal>

			<p className="xz-adm-note" style={{ marginTop: "var(--xz-sp-4)" }}>
				<Icon name="info" size={13} /> 列表接口返回的实体包含{" "}
				<code className="xz-mono">password</code> 字段（哈希）；本前端任何位置都不渲染它。
			</p>
		</div>
	);
}
