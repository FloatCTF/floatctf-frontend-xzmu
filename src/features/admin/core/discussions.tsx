/**
 * 讨论管理（`/admin/discussions`）—— 列表 / 详情 / 删除 / 评论删除。
 *
 * 后端语义（SDK-API-REFERENCE §2.2.20）：
 * - `fetch(params)` 返回**实体 `Discussions`，没有作者昵称字段**（只有 `author_id`）；
 * - 详情 `get(id)`；评论 `getComments(id, params)`（评论同样只有 `author_id`）；
 * - 删除讨论与删除评论都是破坏性操作，均走 `useConfirm()` 并写明后果；
 * - `remove(id_list)` 是批量删除（`DELETE` + body）。
 */

import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import type { DiscussionComments, Discussions } from "@floatctf/sdk/entity";

import { call, callList } from "../../../api/call.ts";
import { useClient } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { qk } from "../../../api/keys.ts";
import { formatDateTime, formatNumber } from "../../../lib/format.ts";
import { useDocumentTitle } from "../../../router/router.tsx";
import { Icon } from "../../../ui/icons.tsx";
import { Drawer, QueryBoundary, useConfirm, useToast } from "../../../ui/overlays.tsx";
import { MarkdownView } from "../../../ui/Markdown.tsx";
import {
	Badge,
	Button,
	Card,
	CardBody,
	CardHead,
	IconButton,
} from "../../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta, type Column } from "../../../ui/Table.tsx";
import {
	AdminPageHead,
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

const searchFields = (row: Discussions) => [row.title, row.content, row.author_id, row.id];

/* ── 评论 ─────────────────────────────────────────────────────────── */

function CommentList({ discussionId }: { discussionId: string }) {
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
		queryKey: qk.admin.discussionComments(discussionId, params),
		queryFn: () => callList(client.admin.discussions.getComments(discussionId, params)),
		placeholderData: keepPreviousData,
	});

	const meta = readMeta(query.data?.meta, state.pageSize);
	const page = useFilteredPage(query.data?.items ?? [], state.search, (row: DiscussionComments) => [
		row.content,
		row.author_id,
		row.id,
	]);

	const removeComment = useMutation({
		mutationFn: (commentId: string) =>
			call(client.admin.discussions.removeComment(discussionId, commentId), "删除评论结果"),
		onSuccess: () => {
			toast.success("评论已删除");
			// 讨论详情里的 comment_count 也会变化，因此连讨论键一起失效。
			invalidate([inv.discussions]);
		},
		onError: (error) => toast.error("删除评论失败", errorText(error)),
	});

	const askRemove = async (comment: DiscussionComments) => {
		const ok = await confirm({
			title: "删除该评论？",
			description: (
				<>
					作者 <code className="xz-mono">{comment.author_id}</code> ·{" "}
					{formatDateTime(comment.created_at)}
				</>
			),
			consequences: (
				<>
					评论正文会被永久删除且无法恢复。若该评论有回复，回复不会随之删除（其中{" "}
					<code className="xz-mono">parent_id</code> 将指向一个已不存在的父评论）。
				</>
			),
			tone: "danger",
			confirmText: "删除评论",
		});
		if (ok) removeComment.mutate(comment.id);
	};

	return (
		<div className="xz-col">
			<ListToolbar
				search={state.search}
				onSearch={state.setSearch}
				placeholder="搜索评论内容 / 作者 ID"
				hint={
					state.search
						? `本页匹配 ${page.matched} / ${page.loaded} 条`
						: "评论接口不返回作者昵称，因此展示 `author_id`"
				}
			/>
			<QueryBoundary
				isPending={query.isPending}
				isError={query.isError}
				error={query.error}
				refetch={query.refetch}
				loadingLabel="正在加载评论…"
			>
				{page.rows.length === 0 ? (
					<div className="xz-adm-inline-empty">
						{state.search ? "当前页没有匹配的评论。" : "该讨论还没有评论。"}
					</div>
				) : (
					<div>
						{page.rows.map((comment) => (
							<div className="xz-comment" key={comment.id}>
								<div className="xz-comment__main">
									<div className="xz-comment__head">
										<div className="xz-comment__author">
											<code className="xz-mono xz-xs">{comment.author_id}</code>
											<span className="xz-adm-hint">
												{" "}
												· {formatDateTime(comment.created_at)}
												{comment.parent_id ? " · 回复" : ""}
											</span>
										</div>
										<IconButton
											icon="trash"
											label="删除该评论"
											onClick={() => void askRemove(comment)}
										/>
									</div>
									<div className="xz-adm-comment__body">{comment.content}</div>
								</div>
							</div>
						))}
					</div>
				)}
				<Pagination
					page={meta.page}
					pageSize={meta.pageSize}
					total={meta.total}
					onPageChange={state.setPage}
					onPageSizeChange={state.setPageSize}
				/>
			</QueryBoundary>
		</div>
	);
}

/* ── 详情抽屉 ─────────────────────────────────────────────────────── */

function DiscussionDrawer({
	row,
	onClose,
}: {
	row: Discussions | null;
	onClose: () => void;
}) {
	const client = useClient();
	const toast = useToast();
	const confirm = useConfirm();
	const invalidate = useInvalidate();
	const id = row?.id ?? "";

	const detail = useQuery({
		queryKey: qk.admin.discussion(id),
		queryFn: () => call(client.admin.discussions.get(id), "讨论详情"),
		enabled: Boolean(row),
	});

	const remove = useMutation({
		mutationFn: (discussionId: string) =>
			call(client.admin.discussions.remove([discussionId]), "删除讨论结果"),
		onSuccess: () => {
			toast.success("讨论已删除");
			onClose();
			invalidate([inv.discussions, inv.dashboard]);
		},
		onError: (error) => toast.error("删除讨论失败", errorText(error)),
	});

	const askRemove = async (discussion: Discussions) => {
		const ok = await confirm({
			title: `删除讨论「${discussion.title}」？`,
			description: <>作者 ID {discussion.author_id}</>,
			consequences: (
				<>
					该讨论将立即从管理端与选手端消失且无法恢复。删除前请确认它不是需要留档的申诉或题解内容；
					若只想屏蔽内容，请先自行保存正文。
				</>
			),
			tone: "danger",
			confirmText: "删除讨论",
		});
		if (ok) remove.mutate(discussion.id);
	};

	const data = detail.data;

	return (
		<Drawer
			open={row !== null}
			onClose={onClose}
			title={row?.title || "讨论详情"}
			subtitle={
				<>
					作者 <code className="xz-mono">{row?.author_id ?? "—"}</code>
				</>
			}
			footer={
				data ? (
					<Button variant="danger-ghost" icon="trash" onClick={() => void askRemove(data)}>
						删除该讨论
					</Button>
				) : null
			}
		>
			<QueryBoundary
				isPending={detail.isPending}
				isError={detail.isError}
				error={detail.error}
				refetch={detail.refetch}
				loadingLabel="正在加载讨论详情…"
			>
				{data ? (
					<div className="xz-col">
						<div className="xz-adm-discussion__head">
							<h2 className="xz-adm-discussion__title">{data.title}</h2>
							<div className="xz-row xz-xs xz-muted" style={{ gap: "var(--xz-sp-3)" }}>
								<span>浏览 {formatNumber(data.view_count)}</span>
								<span>点赞 {formatNumber(data.like_count)}</span>
								<span>评论 {formatNumber(data.comment_count)}</span>
								<span>创建 {formatDateTime(data.created_at)}</span>
								<span>更新 {formatDateTime(data.updated_at)}</span>
							</div>
							<div style={{ marginTop: "var(--xz-sp-2)" }}>
								<IdCell id={data.id} />
							</div>
						</div>

						<MarkdownView>{data.content || "（无正文）"}</MarkdownView>

						<div className="xz-adm-discussion__head" style={{ marginTop: "var(--xz-sp-6)" }}>
							<div className="xz-adm-attention__title">
								<Icon name="chat" size={15} /> 评论管理
								<Badge tone="neutral">{formatNumber(data.comment_count)}</Badge>
							</div>
						</div>
						<CommentList discussionId={data.id} />
					</div>
				) : null}
			</QueryBoundary>
		</Drawer>
	);
}

/* ── 页面 ─────────────────────────────────────────────────────────── */

export function AdminDiscussionsPage() {
	useDocumentTitle("讨论管理");
	const client = useClient();
	const confirm = useConfirm();
	const toast = useToast();
	const invalidate = useInvalidate();
	const state = useTableState(20);

	const params = useMemo(
		() => pageParams(state.page, state.pageSize),
		[state.page, state.pageSize],
	);

	const query = useQuery({
		queryKey: qk.admin.discussions(params),
		queryFn: () => callList(client.admin.discussions.fetch(params)),
		placeholderData: keepPreviousData,
	});

	const meta = readMeta(query.data?.meta, state.pageSize);
	const page = useFilteredPage(query.data?.items ?? [], state.search, searchFields);
	const [selected, setSelected] = useState<Discussions | null>(null);

	const remove = useMutation({
		mutationFn: (id: string) => call(client.admin.discussions.remove([id]), "删除讨论结果"),
		onSuccess: (_count, id) => {
			toast.success("讨论已删除", `ID ${id}`);
			invalidate([inv.discussions, inv.dashboard]);
		},
		onError: (error) => toast.error("删除讨论失败", errorText(error)),
	});

	const askRemove = async (row: Discussions) => {
		const ok = await confirm({
			title: `删除讨论「${row.title}」？`,
			description: <>作者 ID {row.author_id}</>,
			consequences: (
				<>
					讨论及其评论将立即对选手端不可见且无法恢复。删除是不可逆操作，请确认已保存需要留档的内容。
				</>
			),
			tone: "danger",
			confirmText: "删除讨论",
		});
		if (ok) remove.mutate(row.id);
	};

	const columns: readonly Column<Discussions>[] = [
		{
			key: "title",
			header: "标题",
			render: (row) => <strong>{row.title || "（无标题）"}</strong>,
		},
		{
			key: "content",
			header: "正文",
			render: (row) => <TextCell value={row.content} max={72} />,
		},
		{
			key: "author_id",
			header: "作者 ID",
			render: (row) => (
				<code className="xz-mono xz-xs" title={row.author_id}>
					{row.author_id.slice(0, 8)}…
				</code>
			),
		},
		{
			key: "stats",
			header: "浏览 / 赞 / 评论",
			numeric: true,
			render: (row) => (
				<span className="xz-xs">
					{formatNumber(row.view_count)} / {formatNumber(row.like_count)} /{" "}
					{formatNumber(row.comment_count)}
				</span>
			),
		},
		{ key: "created_at", header: "创建时间", render: (row) => formatDateTime(row.created_at) },
		{
			key: "actions",
			header: "操作",
			align: "right",
			width: 110,
			render: (row) => (
				<RowActions>
					<IconButton icon="eye" label={`查看 ${row.title}`} onClick={() => setSelected(row)} />
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
				title="讨论管理"
				desc="选手社区讨论的内容治理。列表接口只返回实体字段（无作者昵称），详情与评论在右侧抽屉内查看与删除。"
			/>

			<Card>
				<CardHead icon="chat" title="讨论列表" sub={`共 ${meta.total} 条`} />
				<CardBody flush>
					<div style={{ padding: "var(--xz-sp-4) var(--xz-sp-5) 0" }}>
						<ListToolbar
							search={state.search}
							onSearch={state.setSearch}
							placeholder="搜索标题 / 正文 / 作者 ID"
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
						loadingLabel="正在加载讨论列表…"
					>
						<DataTable
							columns={columns}
							rows={page.rows}
							rowKey={(row) => row.id}
							activeKey={selected?.id ?? null}
							onRowClick={(row) => setSelected(row)}
							empty={state.search ? "当前页没有匹配的讨论。" : "还没有讨论。"}
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

			<DiscussionDrawer row={selected} onClose={() => setSelected(null)} />
		</div>
	);
}
