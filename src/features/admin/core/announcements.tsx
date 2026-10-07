/**
 * 全局公告管理（`/admin/announcements`）—— 平台公告 CRUD。
 *
 * 后端语义（SDK-API-REFERENCE §2.2.4）：
 * - `fetch(params)` / `create({title, content})` / `patch({id, title, content})` / `remove(id_list)`；
 * - `patch` 用 `announcement.id` 拼 URL ⇒ payload 必须带 `id`；
 * - `publisher` 是**字符串**（发布人昵称），不是对象；
 * - 删除是破坏性操作（批量 `id_list`）。
 */

import { type FormEvent, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { Announcements } from "@floatctf/sdk/entity";

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
	TextArea,
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
	TextCell,
	useFilteredPage,
	useInvalidate,
	useTableState,
} from "./shared.tsx";

const searchFields = (row: Announcements) => [row.title, row.content, row.publisher, row.id];

function AnnouncementForm({
	announcement,
	pending,
	onClose,
	onSubmit,
}: {
	announcement: Announcements | null;
	pending: boolean;
	onClose: () => void;
	onSubmit: (draft: { title: string; content: string }) => void;
}) {
	const [title, setTitle] = useState(announcement?.title ?? "");
	const [content, setContent] = useState(announcement?.content ?? "");
	const [error, setError] = useState<string | null>(null);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!title.trim()) {
			setError("公告标题不能为空。");
			return;
		}
		setError(null);
		onSubmit({ title: title.trim(), content });
	};

	return (
		<form className="xz-col" onSubmit={submit}>
			<Field label="标题" required>
				{(props) => (
					<TextInput
						{...props}
						value={title}
						onChange={(event) => setTitle(event.target.value)}
					/>
				)}
			</Field>
			<Field label="正文" hint="纯文本，选手端按原样展示；支持换行">
				{(props) => (
					<TextArea
						{...props}
						rows={10}
						value={content}
						onChange={(event) => setContent(event.target.value)}
					/>
				)}
			</Field>
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
					{announcement ? "保存修改" : "发布公告"}
				</Button>
			</div>
		</form>
	);
}

export function AdminAnnouncementsPage() {
	useDocumentTitle("公告管理");
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
		queryKey: qk.admin.announcements(params),
		queryFn: () => callList(client.admin.announcements.fetch(params)),
		placeholderData: keepPreviousData,
	});

	const meta = readMeta(query.data?.meta, state.pageSize);
	const page = useFilteredPage(query.data?.items ?? [], state.search, searchFields);

	const [form, setForm] = useState<{ key: string; announcement: Announcements | null } | null>(null);

	const createMutation = useMutation({
		mutationFn: (draft: { title: string; content: string }) =>
			call(client.admin.announcements.create(draft), "发布公告结果"),
		onSuccess: (announcement) => {
			toast.success("公告已发布", announcement.title);
			setForm(null);
			invalidate([inv.announcements, inv.dashboard]);
		},
		onError: (error) => toast.error("发布公告失败", errorText(error)),
	});

	const patchMutation = useMutation({
		mutationFn: ({ id, draft }: { id: string; draft: { title: string; content: string } }) =>
			call(client.admin.announcements.patch({ id, ...draft }), "修改公告结果"),
		onSuccess: (announcement) => {
			toast.success("公告已更新", announcement.title);
			setForm(null);
			invalidate([inv.announcements]);
		},
		onError: (error) => toast.error("更新公告失败", errorText(error)),
	});

	const removeMutation = useMutation({
		mutationFn: (id: string) => call(client.admin.announcements.remove([id]), "删除公告结果"),
		onSuccess: (_count, id) => {
			toast.success("公告已删除", `ID ${id}`);
			invalidate([inv.announcements, inv.dashboard]);
		},
		onError: (error) => toast.error("删除公告失败", errorText(error)),
	});

	const askRemove = async (row: Announcements) => {
		const ok = await confirm({
			title: `删除公告「${row.title}」？`,
			description: <>发布于 {formatDateTime(row.created_at)}，发布人 {row.publisher || "—"}</>,
			consequences: (
				<>
					公告会从管理端与选手端同时消失，且无法恢复。如果只是想让选手看不到，请先确认是否还有缓存
					副本（选手端公告列表会重新拉取，删除立即生效）。
				</>
			),
			tone: "danger",
			confirmText: "删除公告",
		});
		if (ok) removeMutation.mutate(row.id);
	};

	const columns: readonly Column<Announcements>[] = [
		{
			key: "title",
			header: "标题",
			render: (row) => <strong>{row.title}</strong>,
		},
		{ key: "content", header: "正文", render: (row) => <TextCell value={row.content} max={80} /> },
		{
			key: "publisher",
			header: "发布人",
			render: (row) => row.publisher || <span className="xz-muted">—</span>,
		},
		{ key: "created_at", header: "发布时间", render: (row) => formatDateTime(row.created_at) },
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
						label={`编辑 ${row.title}`}
						onClick={() => setForm({ key: `edit-${row.id}`, announcement: row })}
					/>
					<IconButton
						icon="trash"
						label={`删除 ${row.title}`}
						onClick={() => void askRemove(row)}
					/>
				</RowActions>
			),
		},
	];

	return (
		<div className="xz-page xz-page--wide">
			<AdminPageHead
				title="公告管理"
				desc="平台级公告，对所有选手可见（与赛事公告相互独立）。"
				actions={
					<Button
						variant="primary"
						icon="plus"
						onClick={() => setForm({ key: "create", announcement: null })}
					>
						发布公告
					</Button>
				}
			/>

			<Card>
				<CardHead icon="bell" title="公告列表" sub={`共 ${meta.total} 条`} />
				<CardBody flush>
					<div style={{ padding: "var(--xz-sp-4) var(--xz-sp-5) 0" }}>
						<ListToolbar
							search={state.search}
							onSearch={state.setSearch}
							placeholder="搜索标题 / 正文 / 发布人"
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
						loadingLabel="正在加载公告列表…"
					>
						<DataTable
							columns={columns}
							rows={page.rows}
							rowKey={(row) => row.id}
							empty={state.search ? "当前页没有匹配的公告。" : "还没有发布任何公告。"}
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
				title={form?.announcement ? "编辑公告" : "发布公告"}
				onClose={() => setForm(null)}
			>
				{form ? (
					<AnnouncementForm
						key={form.key}
						announcement={form.announcement}
						pending={createMutation.isPending || patchMutation.isPending}
						onClose={() => setForm(null)}
						onSubmit={(draft) => {
							if (form.announcement) patchMutation.mutate({ id: form.announcement.id, draft });
							else createMutation.mutate(draft);
						}}
					/>
				) : null}
			</FormModal>
		</div>
	);
}
