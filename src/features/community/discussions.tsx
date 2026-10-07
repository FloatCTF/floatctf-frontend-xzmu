/**
 * 选手工作区 · 社区讨论（列表 / 我的帖子 / 详情 + 评论）。
 *
 * 语义全部跟随后端（已逐条核对源码）：
 * - 发帖 `create({title, content})`；改帖 `patch({id, title?, content?})` —— **`id` 必填**（SDK 用它拼 URL）；
 *   两者后端都会校验作者身份（非作者 403「Not enough permission」）。
 * - 「我的帖子」= `fetch` + 按当前用户过滤：服务端支持 `filter=author_id:<uuid>`
 *   （`discussion/player.rs` 的 FilterMapping），这样分页才是准的；
 *   返回行**再**按 `author_id` 本地兜底，避免任何串号。
 * - 评论楼中楼靠 `parent_id`；删除自己的帖子 / 评论都要二次确认（平台级破坏性操作要求）。
 */

import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DiscussionWithAuthor, QueryParams } from "@floatctf/sdk";

import { call, callList } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { errorText } from "../../api/errors.ts";
import { qk } from "../../api/keys.ts";
import { useAuth } from "../../auth/store.ts";
import { formatRelative, matches } from "../../lib/format.ts";
import { useDebounced } from "../../lib/hooks.ts";
import { Link } from "../../router/Link.tsx";
import type { PageProps } from "../../router/pages.ts";
import { useDocumentTitle, useNavigate } from "../../router/router.tsx";
import { Icon } from "../../ui/icons.tsx";
import { MarkdownView } from "../../ui/Markdown.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../ui/overlays.tsx";
import {
	Avatar,
	Badge,
	Button,
	Card,
	CardBody,
	CardHead,
	EmptyState,
	InlineLoading,
} from "../../ui/primitives.tsx";
import { readMeta } from "../../ui/Table.tsx";
import {
	callVoid,
	CardFootPager,
	CommentComposer,
	CommentThread,
	type CommentRow,
	CommunityHead,
	discussionCommentsKey,
	discussionListKey,
	DiscussionFormModal,
	LocalFilterHint,
	SearchInput,
	useServerPaging,
} from "./components.tsx";

/* ── 行渲染 ───────────────────────────────────────────────────────── */

function DiscussionRow({ discussion }: { discussion: DiscussionWithAuthor }) {
	return (
		<Link to={`/community/discussions/${discussion.id}`} className="xz-list__row">
			<Avatar src={discussion.author_avatar ?? null} name={discussion.author_nickname} />
			<div className="xz-list__main">
				<div className="xz-list__title">{discussion.title}</div>
				<div className="xz-list__meta">
					<span>{discussion.author_nickname || "（未知作者）"}</span>
					<span title={discussion.updated_at}>更新于 {formatRelative(discussion.updated_at)}</span>
					<span>浏览 {discussion.view_count}</span>
				</div>
			</div>
			<span className="xz-com-counts">
				<span title="点赞数">
					<Icon name="heart" size={13} /> {discussion.like_count}
				</span>
				<span title="评论数">
					<Icon name="chat" size={13} /> {discussion.comment_count}
				</span>
			</span>
			<Icon name="chevronRight" size={15} />
		</Link>
	);
}

/* ── /community/discussions ───────────────────────────────────────── */

export function DiscussionsPage() {
	useDocumentTitle("讨论区");
	const client = useClient();
	const paging = useServerPaging(20);
	const [search, setSearch] = useState("");
	const [composeOpen, setComposeOpen] = useState(false);
	const toast = useToast();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const debounced = useDebounced(search);

	const query = useQuery({
		queryKey: qk.discussions.list(paging.params),
		queryFn: () => callList(client.service.discussions.fetch(paging.params)),
		placeholderData: keepPreviousData,
	});

	const create = useMutation({
		mutationFn: (input: { title: string; content: string }) =>
			call(client.service.discussions.create(input), "帖子"),
		onSuccess: (discussion) => {
			toast.success("帖子已发布");
			setComposeOpen(false);
			void queryClient.invalidateQueries({ queryKey: qk.discussions.all });
			navigate(`/community/discussions/${discussion.id}`);
		},
		onError: (error) => toast.error("发帖失败", errorText(error)),
	});

	const items = query.data?.items ?? [];
	const filtered = useMemo(
		() => items.filter((item) => matches([item.title, item.content, item.author_nickname], debounced)),
		[items, debounced],
	);
	const meta = readMeta(query.data?.meta, paging.limit);

	return (
		<div className="xz-page">
			<CommunityHead
				title="讨论区"
				desc="选手之间的技术讨论。可以在帖子下评论、回复（楼中楼）与点赞。"
				actions={
					<>
						<Link to="/community/discussions/mine">
							<Button icon="user">我的帖子</Button>
						</Link>
						<Button variant="primary" icon="plus" onClick={() => setComposeOpen(true)}>
							发帖
						</Button>
					</>
				}
			/>

			<div className="xz-filters">
				<SearchInput value={search} onChange={setSearch} placeholder="搜索标题 / 正文 / 作者" />
				<LocalFilterHint shown={filtered.length} total={items.length} unit="条" />
			</div>

			<Card>
				<CardHead title="全部讨论" icon="chat" sub={query.isSuccess ? `共 ${meta.total} 帖` : undefined} />
				<CardBody flush>
					<QueryBoundary
						isPending={query.isPending}
						isError={query.isError}
						error={query.error}
						refetch={() => void query.refetch()}
						loadingLabel="正在加载讨论列表…"
					>
						{filtered.length === 0 ? (
							<EmptyState
								icon="chat"
								title={items.length === 0 ? "还没有人发帖" : "当前页没有匹配的帖子"}
								desc={
									items.length === 0
										? "成为第一个发起讨论的人：分享你的解题思路或遇到的问题。"
										: "换个关键词，或翻到其它页看看。"
								}
								actions={
									<Button variant="primary" icon="plus" onClick={() => setComposeOpen(true)}>
										发帖
									</Button>
								}
							/>
						) : (
							<div className="xz-list">
								{filtered.map((item) => (
									<DiscussionRow key={item.id} discussion={item} />
								))}
							</div>
						)}
					</QueryBoundary>
				</CardBody>
				{meta.total > 0 ? (
					<CardFootPager
						page={paging.page}
						limit={paging.limit}
						total={meta.total}
						onPageChange={paging.setPage}
						onLimitChange={paging.setLimit}
					/>
				) : null}
			</Card>

			<DiscussionFormModal
				open={composeOpen}
				onClose={() => setComposeOpen(false)}
				heading="发布新帖"
				description="正文支持 Markdown。请勿泄露 flag、密码或任何凭据。"
				submitLabel="发布"
				pending={create.isPending}
				onSubmit={(input) => create.mutate(input)}
			/>
		</div>
	);
}

/* ── /community/discussions/mine ──────────────────────────────────── */

export function MyDiscussionsPage() {
	useDocumentTitle("我的帖子");
	const client = useClient();
	const { me, sessionChecked, userToken } = useAuth();
	const paging = useServerPaging(20);
	const [search, setSearch] = useState("");
	const [editing, setEditing] = useState<DiscussionWithAuthor | null>(null);
	const [composeOpen, setComposeOpen] = useState(false);
	const toast = useToast();
	const confirm = useConfirm();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const debounced = useDebounced(search);

	// 服务端按作者过滤（分页才准）；返回行再本地兜底。
	const params = useMemo<QueryParams>(
		() => ({ ...paging.params, filter: me ? `author_id:${me.id}` : undefined }),
		[paging.params, me],
	);

	const query = useQuery({
		queryKey: qk.discussions.list(params),
		queryFn: () => callList(client.service.discussions.fetch(params)),
		enabled: Boolean(me?.id),
		placeholderData: keepPreviousData,
	});

	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: qk.discussions.all });
	};

	const create = useMutation({
		mutationFn: (input: { title: string; content: string }) =>
			call(client.service.discussions.create(input), "帖子"),
		onSuccess: (discussion) => {
			toast.success("帖子已发布");
			setComposeOpen(false);
			refresh();
			navigate(`/community/discussions/${discussion.id}`);
		},
		onError: (error) => toast.error("发帖失败", errorText(error)),
	});

	const patch = useMutation({
		// SDK 用 `data.id` 拼 URL：id 必须随 payload 一起传（见 SDK-API-REFERENCE §5 陷阱 24）。
		mutationFn: (input: { id: string; title: string; content: string }) =>
			call(client.service.discussions.patch(input), "帖子"),
		onSuccess: () => {
			toast.success("帖子已更新");
			setEditing(null);
			refresh();
		},
		onError: (error) => toast.error("更新失败", errorText(error)),
	});

	const remove = useMutation({
		mutationFn: (id: string) => callVoid(client.service.discussions.remove(id)),
		onSuccess: () => {
			toast.success("帖子已删除");
			refresh();
		},
		onError: (error) => toast.error("删帖失败", errorText(error)),
	});

	if (!me) {
		return (
			<div className="xz-page">
				<CommunityHead title="我的帖子" desc="这里只显示你自己的帖子；可以编辑正文或删除。" />
				{sessionChecked && !userToken ? null : sessionChecked ? (
					<EmptyState
						icon="user"
						title="暂时拿不到当前账号资料"
						desc="「我的帖子」需要知道当前用户是谁。请刷新页面；若持续如此，请重新登录。"
					/>
				) : (
					<InlineLoading>正在确认账号身份…</InlineLoading>
				)}
			</div>
		);
	}

	const items = (query.data?.items ?? []).filter((item) => item.author_id === me.id);
	const filtered = items.filter((item) => matches([item.title, item.content], debounced));
	const meta = readMeta(query.data?.meta, paging.limit);

	return (
		<div className="xz-page">
			<CommunityHead
				title="我的帖子"
				desc="只显示你自己的帖子。编辑或删除都由后端再次校验作者身份。"
				actions={
					<>
						<Link to="/community/discussions">
							<Button icon="arrowLeft">全部讨论</Button>
						</Link>
						<Button variant="primary" icon="plus" onClick={() => setComposeOpen(true)}>
							发帖
						</Button>
					</>
				}
			/>

			<div className="xz-filters">
				<SearchInput value={search} onChange={setSearch} placeholder="搜索我的帖子标题 / 正文" />
				<LocalFilterHint shown={filtered.length} total={items.length} unit="条" />
			</div>

			<Card>
				<CardHead title="我的帖子" icon="user" sub={query.isSuccess ? `共 ${meta.total} 帖` : undefined} />
				<CardBody flush>
					<QueryBoundary
						isPending={query.isPending}
						isError={query.isError}
						error={query.error}
						refetch={() => void query.refetch()}
						loadingLabel="正在加载我的帖子…"
					>
						{filtered.length === 0 ? (
							<EmptyState
								icon="chat"
								title={items.length === 0 ? "你还没有发过帖子" : "当前页没有匹配的帖子"}
								desc="发帖后可以在这里编辑或删除。"
								actions={
									<Button variant="primary" icon="plus" onClick={() => setComposeOpen(true)}>
										发帖
									</Button>
								}
							/>
						) : (
							<div className="xz-list">
								{filtered.map((item) => (
									<div key={item.id} className="xz-list__row">
										<div className="xz-list__main">
											<Link to={`/community/discussions/${item.id}`} className="xz-list__title">
												{item.title}
											</Link>
											<div className="xz-list__meta">
												<span title={item.updated_at}>更新于 {formatRelative(item.updated_at)}</span>
												<span>浏览 {item.view_count}</span>
												<span>点赞 {item.like_count}</span>
												<span>评论 {item.comment_count}</span>
											</div>
										</div>
										<div className="xz-list__aside">
											<Button size="sm" icon="edit" onClick={() => setEditing(item)}>
												编辑
											</Button>
											<Button
												size="sm"
												variant="danger-ghost"
												icon="trash"
												loading={remove.isPending && remove.variables === item.id}
												onClick={() => {
													void confirm({
														title: `删除帖子「${item.title}」？`,
														description: "删除后无法恢复。",
														consequences: `该帖及其全部评论（${item.comment_count} 条）会一起从社区消失。`,
														tone: "danger",
														confirmText: "删除",
													}).then((ok) => {
														if (ok) remove.mutate(item.id);
													});
												}}
											>
												删除
											</Button>
										</div>
									</div>
								))}
							</div>
						)}
					</QueryBoundary>
				</CardBody>
				{meta.total > 0 ? (
					<CardFootPager
						page={paging.page}
						limit={paging.limit}
						total={meta.total}
						onPageChange={paging.setPage}
						onLimitChange={paging.setLimit}
					/>
				) : null}
			</Card>

			<DiscussionFormModal
				open={composeOpen}
				onClose={() => setComposeOpen(false)}
				heading="发布新帖"
				description="正文支持 Markdown。请勿泄露 flag、密码或任何凭据。"
				submitLabel="发布"
				pending={create.isPending}
				onSubmit={(input) => create.mutate(input)}
			/>

			<DiscussionFormModal
				open={editing !== null}
				onClose={() => setEditing(null)}
				heading="编辑帖子"
				initialTitle={editing?.title ?? ""}
				initialContent={editing?.content ?? ""}
				submitLabel="保存修改"
				pending={patch.isPending}
				onSubmit={(input) => {
					if (!editing) return;
					patch.mutate({ id: editing.id, ...input });
				}}
			/>
		</div>
	);
}

/* ── /community/discussions/:id ───────────────────────────────────── */

export function DiscussionDetailPage({ params }: PageProps) {
	const id = params.id ?? "";
	const client = useClient();
	const { me } = useAuth();
	const toast = useToast();
	const confirm = useConfirm();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [editOpen, setEditOpen] = useState(false);
	const [commentsLimit, setCommentsLimit] = useState(100);

	const detail = useQuery({
		queryKey: qk.discussions.detail(id),
		queryFn: () => call(client.service.discussions.get(id), "讨论详情"),
		enabled: Boolean(id),
	});

	const commentParams = useMemo<QueryParams>(() => ({ page: 1, limit: commentsLimit }), [commentsLimit]);
	const comments = useQuery({
		queryKey: qk.discussions.comments(id, commentParams),
		queryFn: () => callList(client.service.discussions.getComments(id, commentParams)),
		enabled: Boolean(id),
		placeholderData: keepPreviousData,
	});

	const discussion = detail.data ?? null;
	useDocumentTitle(discussion?.title ?? "讨论详情");

	const isAuthor = Boolean(discussion && me && discussion.author_id === me.id);

	const refreshComments = () => {
		void queryClient.invalidateQueries({ queryKey: discussionCommentsKey(id) });
		void queryClient.invalidateQueries({ queryKey: discussionListKey() });
	};

	/**
	 * 点赞只改**已知的**服务端状态：接口成功后把缓存里的 `is_liked` / `like_count`
	 * 就地更新。**不重新拉详情** —— 后端 `GET /discussions/{id}` 对非作者会把
	 * `view_count + 1`，重取会把浏览量刷虚。
	 */
	const like = useMutation({
		mutationFn: () => callVoid(client.service.discussions.like(id)),
		onSuccess: () => {
			queryClient.setQueryData<DiscussionWithAuthor>(qk.discussions.detail(id), (current) =>
				current ? { ...current, is_liked: true, like_count: current.like_count + 1 } : current,
			);
			void queryClient.invalidateQueries({ queryKey: discussionListKey() });
			toast.success("已点赞");
		},
		onError: (error) => toast.error("点赞失败", errorText(error)),
	});

	const unlike = useMutation({
		mutationFn: () => callVoid(client.service.discussions.unlike(id)),
		onSuccess: () => {
			queryClient.setQueryData<DiscussionWithAuthor>(qk.discussions.detail(id), (current) =>
				current
					? { ...current, is_liked: false, like_count: Math.max(0, current.like_count - 1) }
					: current,
			);
			void queryClient.invalidateQueries({ queryKey: discussionListKey() });
			toast.success("已取消点赞");
		},
		onError: (error) => toast.error("取消点赞失败", errorText(error)),
	});

	const patch = useMutation({
		mutationFn: (input: { title: string; content: string }) =>
			call(client.service.discussions.patch({ id, ...input }), "帖子"),
		onSuccess: (updated) => {
			toast.success("帖子已更新");
			setEditOpen(false);
			// 详情缓存就地合并（`patch` 只回实体字段，作者/点赞状态保留）。
			queryClient.setQueryData<DiscussionWithAuthor>(qk.discussions.detail(id), (current) =>
				current ? { ...current, ...updated } : current,
			);
			void queryClient.invalidateQueries({ queryKey: discussionListKey() });
		},
		onError: (error) => toast.error("更新失败", errorText(error)),
	});

	const remove = useMutation({
		mutationFn: () => callVoid(client.service.discussions.remove(id)),
		onSuccess: () => {
			toast.success("帖子已删除");
			// 先移除本页缓存，避免失效后立刻重取一个已删除的帖子（会 404 闪一下）。
			queryClient.removeQueries({ queryKey: qk.discussions.detail(id) });
			queryClient.removeQueries({ queryKey: discussionCommentsKey(id) });
			void queryClient.invalidateQueries({ queryKey: discussionListKey() });
			navigate("/community/discussions");
		},
		onError: (error) => toast.error("删帖失败", errorText(error)),
	});

	const createComment = useMutation({
		mutationFn: (content: string) =>
			call(client.service.discussions.createComment(id, { content }), "评论"),
		onSuccess: () => {
			toast.success("评论已发布");
			refreshComments();
		},
		onError: (error) => toast.error("评论发布失败", errorText(error)),
	});

	const commentRows = (comments.data?.items ?? []) as CommentRow[];
	const commentMeta = readMeta(comments.data?.meta, commentsLimit);
	const hasMoreComments = commentMeta.total > commentRows.length;

	return (
		<div className="xz-page">
			<CommunityHead
				title="讨论详情"
				actions={
					<Link to="/community/discussions">
						<Button icon="arrowLeft">返回讨论区</Button>
					</Link>
				}
			/>

			<QueryBoundary
				isPending={detail.isPending}
				isError={detail.isError}
				error={detail.error}
				refetch={() => void detail.refetch()}
				loadingLabel="正在加载帖子…"
			>
				{discussion ? (
					<article className="xz-post">
						<header className="xz-post__head">
							<Avatar src={discussion.author_avatar ?? null} name={discussion.author_nickname} size="lg" />
							<div className="xz-grow">
								<h2 className="xz-com-title">{discussion.title}</h2>
								<div className="xz-list__meta">
									<span>{discussion.author_nickname || "（未知作者）"}</span>
									<span title={discussion.created_at}>发表于 {formatRelative(discussion.created_at)}</span>
									{discussion.updated_at !== discussion.created_at ? (
										<span title={discussion.updated_at}>更新于 {formatRelative(discussion.updated_at)}</span>
									) : null}
									<span>浏览 {discussion.view_count}</span>
									{isAuthor ? <Badge tone="crimson">我的帖子</Badge> : null}
								</div>
							</div>
							<div className="xz-row">
								<Button
									variant={discussion.is_liked ? "primary" : "ghost"}
									icon="heart"
									aria-pressed={discussion.is_liked}
									loading={like.isPending || unlike.isPending}
									onClick={() => {
										if (discussion.is_liked) unlike.mutate();
										else like.mutate();
									}}
								>
									{discussion.is_liked ? "已点赞" : "点赞"} {discussion.like_count}
								</Button>
								{isAuthor ? (
									<>
										<Button icon="edit" onClick={() => setEditOpen(true)}>
											编辑
										</Button>
										<Button
											variant="danger-ghost"
											icon="trash"
											loading={remove.isPending}
											onClick={() => {
												void confirm({
													title: `删除帖子「${discussion.title}」？`,
													description: "删除后无法恢复。",
													// 用评论接口的权威计数（详情里的 comment_count 在本次浏览期间可能已滞后）。
													consequences: `该帖正文与它的全部评论${
														commentMeta.total > 0 ? `（${commentMeta.total} 条）` : ""
													}会一起消失，且无法恢复。`,
													tone: "danger",
													confirmText: "删除",
												}).then((ok) => {
													if (ok) remove.mutate();
												});
											}}
										>
											删除
										</Button>
									</>
								) : null}
							</div>
						</header>
						<div className="xz-post__body">
							<MarkdownView>{discussion.content}</MarkdownView>
						</div>
					</article>
				) : null}
			</QueryBoundary>

			<section className="xz-com-section">
				<Card>
					<CardHead
						title="评论"
						icon="chat"
						sub={comments.isSuccess ? `共 ${commentMeta.total} 条` : undefined}
					/>
					<CardBody>
						<CommentComposer
							placeholder="写下你的看法…支持 Markdown"
							submitLabel="发表评论"
							pending={createComment.isPending}
							onSubmit={async (content) => {
								try {
									await createComment.mutateAsync(content);
									return true;
								} catch {
									return false;
								}
							}}
						/>
						<hr className="xz-com-divider" />
						<QueryBoundary
							isPending={comments.isPending}
							isError={comments.isError}
							error={comments.error}
							refetch={() => void comments.refetch()}
							loadingLabel="正在加载评论…"
						>
							{commentRows.length === 0 ? (
								<EmptyState icon="chat" title="还没有评论" desc="第一条评论往往最有价值。" />
							) : (
								<CommentThread
									comments={commentRows}
									discussionId={id}
									currentUserId={me?.id ?? null}
								/>
							)}
						</QueryBoundary>
						{hasMoreComments ? (
							<div style={{ marginTop: 12 }}>
								<Button
									block
									icon="chevronDown"
									loading={comments.isFetching}
									onClick={() => setCommentsLimit((limit) => limit + 100)}
								>
									加载更多评论（还有 {commentMeta.total - commentRows.length} 条）
								</Button>
							</div>
						) : null}
					</CardBody>
				</Card>
			</section>

			<DiscussionFormModal
				open={editOpen}
				onClose={() => setEditOpen(false)}
				heading="编辑帖子"
				initialTitle={discussion?.title ?? ""}
				initialContent={discussion?.content ?? ""}
				submitLabel="保存修改"
				pending={patch.isPending}
				onSubmit={(input: { title: string; content: string }) => patch.mutate(input)}
			/>
		</div>
	);
}
