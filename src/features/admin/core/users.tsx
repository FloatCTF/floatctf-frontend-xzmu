/**
 * 用户管理（`/admin/users`）—— 平台账号治理。
 *
 * 后端语义（CAPABILITY-BEHAVIOR-MAP「管理端：总览与内容」）：
 * - `client.admin.users.fetch(params)` / `create(user)` / `patch(user)` / `remove(id_list)`；
 * - **`patch` 用 `user.id` 拼 URL**，所以 payload 必须带 `id`；
 * - 密码只在创建 / 重置时作为**输入**；`Users` 实体带 `password` 字段，
 *   本页面任何位置都**不渲染**它；
 * - 删除是破坏性操作（批量 `id_list`），必须二次确认并写明后果。
 */

import { type FormEvent, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { Users } from "@floatctf/sdk/entity";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { useDocumentTitle } from "../../../router/router.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import {
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

const searchFields = (row: Users) => [row.username, row.nickname, row.email, row.id];

interface UserDraft {
	username: string;
	nickname: string;
	email: string;
	password: string;
}

function UserForm({
	mode,
	user,
	pending,
	onClose,
	onSubmit,
}: {
	mode: "create" | "edit";
	user: Users | null;
	pending: boolean;
	onClose: () => void;
	onSubmit: (draft: UserDraft) => void;
}) {
	const [draft, setDraft] = useState<UserDraft>({
		username: user?.username ?? "",
		nickname: user?.nickname ?? "",
		email: user?.email ?? "",
		password: "",
	});
	const [error, setError] = useState<string | null>(null);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const username = draft.username.trim();
		if (!username) {
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
		if (draft.email.trim() && !draft.email.includes("@")) {
			setError("邮箱格式不正确。");
			return;
		}
		setError(null);
		onSubmit({ ...draft, username });
	};

	return (
		<form className="xz-col" onSubmit={submit}>
			<div className="xz-formgrid">
				<Field label="用户名" required hint="用户名最长 64 个字符">
					{(props) => (
						<TextInput
							{...props}
							value={draft.username}
							autoComplete="off"
							onChange={(event) => setDraft({ ...draft, username: event.target.value })}
						/>
					)}
				</Field>
				<Field label="昵称" hint="选手端展示名；留空时选手端回落显示用户名">
					{(props) => (
						<TextInput
							{...props}
							value={draft.nickname}
							autoComplete="off"
							onChange={(event) => setDraft({ ...draft, nickname: event.target.value })}
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
					{mode === "create" ? "创建用户" : "保存修改"}
				</Button>
			</div>
		</form>
	);
}

export function AdminUsersPage() {
	useDocumentTitle("用户管理");
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
		queryKey: qk.admin.users(params),
		queryFn: () => callList(client.admin.users.fetch(params)),
		placeholderData: keepPreviousData,
	});

	const meta = readMeta(query.data?.meta, state.pageSize);
	const page = useFilteredPage(query.data?.items ?? [], state.search, searchFields);

	const [form, setForm] = useState<{ key: string; mode: "create" | "edit"; user: Users | null } | null>(
		null,
	);

	const createMutation = useMutation({
		mutationFn: (draft: UserDraft) =>
			call(
				client.admin.users.create({
					username: draft.username,
					password: draft.password,
					nickname: draft.nickname,
					email: draft.email,
				}),
				"创建用户结果",
			),
		onSuccess: (user) => {
			toast.success("用户已创建", user.username);
			setForm(null);
			invalidate([inv.users, inv.dashboard]);
		},
		onError: (error) => toast.error("创建用户失败", errorText(error)),
	});

	const patchMutation = useMutation({
		mutationFn: ({ id, draft }: { id: string; draft: UserDraft }) =>
			call(
				client.admin.users.patch({
					// `patch` 用 `user.id` 拼 URL —— payload 必须带 id。
					id,
					username: draft.username,
					nickname: draft.nickname,
					email: draft.email,
					...(draft.password ? { password: draft.password } : {}),
				}),
				"修改用户结果",
			),
		onSuccess: (user) => {
			toast.success("用户已更新", user.username);
			setForm(null);
			invalidate([inv.users]);
		},
		onError: (error) => toast.error("更新用户失败", errorText(error)),
	});

	const removeMutation = useMutation({
		mutationFn: (id: string) => call(client.admin.users.remove([id]), "删除用户结果"),
		onSuccess: (_count, id) => {
			toast.success("用户已删除", `ID ${id}`);
			invalidate([inv.users, inv.dashboard]);
		},
		onError: (error) => toast.error("删除用户失败", errorText(error)),
	});

	const askRemove = async (row: Users) => {
		const ok = await confirm({
			title: `删除用户「${row.username}」？`,
			description: (
				<>
					用户 ID <code className="xz-mono">{row.id}</code>
				</>
			),
			consequences: (
				<>
					该账号会被永久删除且无法恢复，其登录凭据立即失效（该用户名将不再对应任何账号）。
					这是平台高风险操作，请确认不是误点。
				</>
			),
			tone: "danger",
			confirmText: "删除用户",
		});
		if (ok) removeMutation.mutate(row.id);
	};

	const columns: readonly Column<Users>[] = [
		{
			key: "username",
			header: "用户名",
			render: (row) => <strong>{row.username}</strong>,
		},
		{
			key: "nickname",
			header: "昵称",
			render: (row) => row.nickname || <span className="xz-muted">—</span>,
		},
		{
			key: "email",
			header: "邮箱",
			render: (row) => row.email || <span className="xz-muted">—</span>,
		},
		{ key: "created_at", header: "注册时间", render: (row) => formatDateTime(row.created_at) },
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
						onClick={() => setForm({ key: `edit-${row.id}`, mode: "edit", user: row })}
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
				title="用户管理"
				desc="选手账号的创建、改名与删除"
				actions={
					<Button
						variant="primary"
						icon="plus"
						onClick={() => setForm({ key: "create", mode: "create", user: null })}
					>
						新建用户
					</Button>
				}
			/>

			<Card>
				<CardHead icon="users" title="账号列表" sub={`共 ${meta.total} 个账号`} />
				<CardBody flush>
					<div style={{ padding: "var(--xz-sp-4) var(--xz-sp-5) 0" }}>
						<ListToolbar
							search={state.search}
							onSearch={state.setSearch}
							placeholder="搜索用户名 / 昵称 / 邮箱 / ID"
							hint={
								state.search
									? `本页匹配 ${page.matched} / ${page.loaded} 条（搜索只在已加载的当前页内过滤）`
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
						loadingLabel="正在加载用户列表…"
					>
						<DataTable
							columns={columns}
							rows={page.rows}
							rowKey={(row) => row.id}
							empty={state.search ? "当前页没有匹配的账号。" : "平台还没有用户。"}
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
				title={form?.mode === "edit" ? "编辑用户" : "新建用户"}
				description="用户名 / 邮箱由后端校验；密码至少 8 位。"
				onClose={() => setForm(null)}
			>
				{form ? (
					<UserForm
						key={form.key}
						mode={form.mode}
						user={form.user}
						pending={createMutation.isPending || patchMutation.isPending}
						onClose={() => setForm(null)}
						onSubmit={(draft) => {
							if (form.mode === "create") createMutation.mutate(draft);
							else if (form.user) patchMutation.mutate({ id: form.user.id, draft });
						}}
					/>
				) : null}
			</FormModal>
		</div>
	);
}
