/**
 * 社区功能域 · 共享组件与数据 hooks。
 *
 * 只依赖平台公共包（`@floatctf/sdk` / `@floatctf/react` / `@tanstack/react-query` / react）
 * 与本仓库 `src/**`（AGENTS.md 硬规则 1）。
 *
 * 几个**逐字核对过后端源码**的关键事实（不是猜的）：
 *
 * 1. 评论列表后端返回的是 `CommentWithAuthor`
 *    （`comment/mod.rs`：`#[serde(flatten)] comment + author_nickname + author_avatar`），
 *    而 SDK 类型只声明了实体字段（`DiscussionComments`）。因此这里用**可选**的
 *    `author_nickname` / `author_avatar` 读取：取不到就回落到 `author_id` 前缀，
 *    **绝不编造昵称**。
 * 2. `GET /discussions` 列表把 `is_liked` 硬编码为 `false`（`player.rs:77`），
 *    只有 `GET /discussions/{id}` 返回真实点赞状态 → 列表行不展示「已赞」。
 * 3. `GET /discussions/{id}` 对**非作者**会 `view_count + 1`（`player.rs:125-130`），
 *    所以评论/点赞成功后**不重取详情**：点赞走缓存内更新（服务端确认后），
 *    评论数直接取评论接口的 `meta.total`。
 * 4. 删除评论**不会**级联删除回复（`comment/player.rs:203`）；父评论消失后
 *    子回复会作为顶层评论继续显示。
 */

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryParams, UniResponse } from "@floatctf/sdk";
import type { DiscussionComments } from "@floatctf/sdk/entity";

import { call, unwrapNullable } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { errorText } from "../../api/errors.ts";
import { qk } from "../../api/keys.ts";
import { formatRelative } from "../../lib/format.ts";
import { MarkdownEditor, MarkdownView } from "../../ui/Markdown.tsx";
import { Icon } from "../../ui/icons.tsx";
import { Modal, useConfirm, useToast } from "../../ui/overlays.tsx";
import { Avatar, Button, Field, TextArea, TextInput } from "../../ui/primitives.tsx";
import { Pagination } from "../../ui/Table.tsx";

/* ── 信封工具 ─────────────────────────────────────────────────────── */

/**
 * 平台里有若干方法声明 `UniResponse<null>` 且后端返回 `ok_none()`（`data` 为 `null`）：
 * `discussions.remove` / `like` / `unlike` / `deleteComment`。
 * `call()` 会在 `data === null` 时抛「接口未返回…」，所以这些调用统一走这里：
 * 只校验信封（`code === 0`），不要求 `data`。
 */
export async function callVoid(promise: Promise<UniResponse<null>>): Promise<void> {
	unwrapNullable(await promise);
}

/* ── 查询键前缀（全部基于 qk，只做「去掉末级参数」的收窄）────────────── */

/** `["discussions", "list"]` —— 命中所有分页/筛选变体。 */
export function discussionListKey(): readonly unknown[] {
	return [...qk.discussions.all, "list"];
}

/** `["discussions", "comments", id]` —— 命中该帖所有分页变体。 */
export function discussionCommentsKey(id: string): readonly unknown[] {
	return [...qk.discussions.all, "comments", id];
}

/* ── 页头 / 工具条 ────────────────────────────────────────────────── */

export function CommunityHead({
	title,
	desc,
	actions,
}: {
	title: ReactNode;
	desc?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className="xz-page__head">
			<div>
				<h1 className="xz-page__title">{title}</h1>
				{desc ? <p className="xz-page__desc">{desc}</p> : null}
			</div>
			{actions ? <div className="xz-page__actions">{actions}</div> : null}
		</header>
	);
}

/** 页面级搜索框：`data-page-search` 让全局 `/` 快捷键能聚焦它。 */
export function SearchInput({
	value,
	onChange,
	placeholder,
	label,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	label?: string;
}) {
	return (
		<span className="xz-search">
			<span className="xz-search__icon">
				<Icon name="search" size={14} />
			</span>
			<input
				className="xz-input"
				data-page-search
				type="search"
				aria-label={label ?? placeholder ?? "搜索"}
				placeholder={placeholder}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</span>
	);
}

/**
 * 列表筛选提示。
 * 本前端的搜索/筛选一律在**本地**做（`QueryParams` 只有 offset/limit/page/total/filter），
 * 因此必须如实告诉用户它只作用于当前这一页，避免"搜不到 = 数据不存在"的误解。
 */
export function LocalFilterHint({ shown, total, unit = "条" }: { shown: number; total: number; unit?: string }) {
	return (
		<span className="xz-com-hint">
			本页 {shown} / {total} {unit}（筛选作用于当前页）
		</span>
	);
}

/* ── 分页 hooks ───────────────────────────────────────────────────── */
export interface ServerPaging {
	page: number;
	limit: number;
	params: QueryParams;
	setPage: (page: number) => void;
	setLimit: (limit: number) => void;
}

/** 服务端分页（`page` + `limit` 交给后端，`meta.total` 回填总数）。 */
export function useServerPaging(initialLimit = 20): ServerPaging {
	const [page, setPage] = useState(1);
	const [limit, setLimitState] = useState(initialLimit);
	const params = useMemo<QueryParams>(() => ({ page, limit }), [page, limit]);
	return {
		page,
		limit,
		params,
		setPage,
		setLimit: (next) => {
			setLimitState(next);
			setPage(1);
		},
	};
}

export interface ClientPaging {
	page: number;
	pageSize: number;
	offset: number;
	setPage: (page: number) => void;
	setPageSize: (size: number) => void;
}

/** 前端分页（用于后端不分页的接口：武器库等）。 */
export function useClientPaging(total: number, initialSize = 20): ClientPaging {
	const [page, setPage] = useState(1);
	const [pageSize, setPageSizeState] = useState(initialSize);
	const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
	const safePage = Math.min(Math.max(1, page), totalPages);
	return {
		page: safePage,
		pageSize,
		offset: (safePage - 1) * pageSize,
		setPage,
		setPageSize: (size) => {
			setPageSizeState(size);
			setPage(1);
		},
	};
}

/* ── 卡片底部分页条 ───────────────────────────────────────────────── */

/** `.xz-card__foot` 内的分页条（服务端分页列表共用）。 */
export function CardFootPager({
	page,
	limit,
	total,
	onPageChange,
	onLimitChange,
}: {
	page: number;
	limit: number;
	total: number;
	onPageChange: (page: number) => void;
	onLimitChange: (limit: number) => void;
}) {
	return (
		<footer className="xz-card__foot">
			<Pagination
				page={page}
				pageSize={limit}
				total={total}
				onPageChange={onPageChange}
				onPageSizeChange={onLimitChange}
			/>
		</footer>
	);
}

/* ── 发帖 / 改帖 ──────────────────────────────────────────────────── */
export function DiscussionFormModal({
	open,
	onClose,
	heading,
	description,
	initialTitle = "",
	initialContent = "",
	submitLabel = "发布",
	pending,
	onSubmit,
}: {
	open: boolean;
	onClose: () => void;
	heading: string;
	description?: ReactNode;
	initialTitle?: string;
	initialContent?: string;
	submitLabel?: string;
	pending: boolean;
	onSubmit: (input: { title: string; content: string }) => void;
}) {
	const [title, setTitle] = useState(initialTitle);
	const [content, setContent] = useState(initialContent);
	const [touched, setTouched] = useState(false);

	// 打开时同步初值（同一弹窗组件被「发帖 / 改帖」两种场景复用）。
	useEffect(() => {
		if (!open) return;
		setTitle(initialTitle);
		setContent(initialContent);
		setTouched(false);
	}, [open, initialTitle, initialContent]);

	const titleError = touched && !title.trim() ? "标题不能为空" : undefined;
	const contentError = touched && !content.trim() ? "正文不能为空" : undefined;
	const ready = Boolean(title.trim() && content.trim()) && !pending;

	return (
		<Modal
			open={open}
			onClose={onClose}
			title={heading}
			description={description}
			size="wide"
			persistent={pending}
			footer={
				<>
					<Button variant="quiet" onClick={onClose} disabled={pending}>
						取消
					</Button>
					<Button
						variant="primary"
						icon="send"
						loading={pending}
						disabled={!ready}
						onClick={() => {
							setTouched(true);
							if (!title.trim() || !content.trim()) return;
							onSubmit({ title: title.trim(), content: content.trim() });
						}}
					>
						{submitLabel}
					</Button>
				</>
			}
		>
			<div className="xz-col" style={{ gap: 12 }}>
				<Field label="标题" required error={titleError}>
					{(props) => (
						<TextInput
							{...props}
							value={title}
							maxLength={120}
							placeholder="一句话说明你要讨论的问题"
							onChange={(event) => setTitle(event.target.value)}
						/>
					)}
				</Field>
				<Field label="正文" required error={contentError} hint="支持 Markdown。请勿粘贴 flag、密码或任何凭据。">
					{() => (
						<MarkdownEditor
							value={content}
							onChange={setContent}
							minHeight={220}
							placeholder="描述你的思路、复现步骤或结论…"
						/>
					)}
				</Field>
			</div>
		</Modal>
	);
}

/* ── 评论 ─────────────────────────────────────────────────────────── */

/**
 * 评论行：实体字段 + 后端实际返回、但 SDK 类型未声明的作者字段。
 * 见文件头注释 1。
 */
export interface CommentRow extends DiscussionComments {
	author_nickname?: string | null;
	author_avatar?: string | null;
}

/** 评论作者展示名：优先真实昵称，缺失时回落到作者 ID 前缀（不编造）。 */
export function commentAuthorName(comment: CommentRow): string {
	const nickname = comment.author_nickname?.trim();
	if (nickname) return nickname;
	return `用户 ${comment.author_id.slice(0, 8)}`;
}

export interface CommentNode {
	comment: CommentRow;
	replies: CommentNode[];
}

function createdAt(comment: CommentRow): number {
	const time = new Date(comment.created_at).getTime();
	return Number.isNaN(time) ? 0 : time;
}

/**
 * 用 `parent_id` 在前端建树（与后端一致：父不存在 → 当作顶层）。
 * 排序沿用 Default 已核实的口径：根节点按回复数降序，回复按时间降序。
 */
export function buildCommentTree(items: readonly CommentRow[]): CommentNode[] {
	const nodes = new Map<string, CommentNode>();
	for (const item of items) nodes.set(item.id, { comment: item, replies: [] });

	const roots: CommentNode[] = [];
	for (const item of items) {
		const node = nodes.get(item.id);
		if (!node) continue;
		const parent = item.parent_id ? nodes.get(item.parent_id) : undefined;
		if (parent && parent !== node) parent.replies.push(node);
		else roots.push(node);
	}

	const byTimeDesc = (a: CommentNode, b: CommentNode) => createdAt(b.comment) - createdAt(a.comment);
	const arrange = (list: CommentNode[], isRoot: boolean, depth: number): CommentNode[] => {
		if (depth > 20) return list; // 病态数据兜底，避免无限递归
		for (const node of list) node.replies = arrange(node.replies, false, depth + 1);
		list.sort((a, b) =>
			isRoot ? b.replies.length - a.replies.length || byTimeDesc(a, b) : byTimeDesc(a, b),
		);
		return list;
	};

	return arrange(roots, true, 0);
}

export interface FlatComment {
	node: CommentNode;
	depth: number;
}

/**
 * 深度优先展开评论树 —— **迭代**实现。
 *
 * 为什么不用递归渲染：`parent_id` 允许任意层楼中楼，一条超长的回复链会把
 * React 的渲染栈打爆。展开成扁平列表后 JSX 深度恒为 1，只用缩进表达层级。
 * 缩进上限 `maxDepth`（更深的回复不再增加缩进，但仍会完整显示）。
 */
export function flattenCommentTree(tree: readonly CommentNode[], maxDepth = 5): FlatComment[] {
	const result: FlatComment[] = [];
	const stack: FlatComment[] = [];
	for (let index = tree.length - 1; index >= 0; index -= 1) {
		const node = tree[index];
		if (node) stack.push({ node, depth: 0 });
	}
	while (stack.length > 0) {
		const entry = stack.pop();
		if (!entry) break;
		result.push(entry);
		const childDepth = Math.min(entry.depth + 1, maxDepth);
		for (let index = entry.node.replies.length - 1; index >= 0; index -= 1) {
			const child = entry.node.replies[index];
			if (child) stack.push({ node: child, depth: childDepth });
		}
	}
	return result;
}

/** 评论编辑器：发表 / 回复 / 编辑共用。`onSubmit` 返回 `true` 才清空输入。 */
export function CommentComposer({
	initialValue = "",
	placeholder,
	submitLabel = "发表评论",
	pending,
	autoFocus,
	onCancel,
	onSubmit,
}: {
	initialValue?: string;
	placeholder?: string;
	submitLabel?: string;
	pending: boolean;
	autoFocus?: boolean;
	onCancel?: () => void;
	onSubmit: (content: string) => Promise<boolean>;
}) {
	const [value, setValue] = useState(initialValue);
	const [error, setError] = useState<string | null>(null);
	const trimmed = value.trim();

	return (
		<div className="xz-col" style={{ gap: 8 }}>
			<TextArea
				value={value}
				rows={3}
				autoFocus={autoFocus}
				aria-label={submitLabel}
				placeholder={placeholder ?? "支持 Markdown…"}
				onChange={(event) => setValue(event.target.value)}
			/>
			{error ? (
				<p className="xz-field__error" role="alert">
					{error}
				</p>
			) : null}
			<div className="xz-row xz-com-actions">
				<span className="xz-muted xz-xs">{trimmed.length > 0 ? `${trimmed.length} 字符` : "内容不能为空"}</span>
				{onCancel ? (
					<Button size="sm" variant="quiet" onClick={onCancel} disabled={pending}>
						取消
					</Button>
				) : null}
				<Button
					size="sm"
					variant="primary"
					icon="send"
					loading={pending}
					disabled={!trimmed || pending}
					onClick={() => {
						if (!trimmed) {
							setError("内容不能为空");
							return;
						}
						setError(null);
						void onSubmit(trimmed).then((ok) => {
							if (ok) setValue("");
						});
					}}
				>
					{submitLabel}
				</Button>
			</div>
		</div>
	);
}

function CommentItem({
	node,
	depth,
	discussionId,
	currentUserId,
}: {
	node: CommentNode;
	depth: number;
	discussionId: string;
	currentUserId: string | null;
}) {
	const client = useClient();
	const toast = useToast();
	const confirm = useConfirm();
	const queryClient = useQueryClient();
	const [replyOpen, setReplyOpen] = useState(false);
	const [editing, setEditing] = useState(false);

	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: discussionCommentsKey(discussionId) });
		void queryClient.invalidateQueries({ queryKey: discussionListKey() });
	};

	const createReply = useMutation({
		mutationFn: (content: string) =>
			call(
				client.service.discussions.createComment(discussionId, {
					content,
					parent_id: node.comment.id,
				}),
				"回复",
			),
		onSuccess: () => {
			toast.success("回复已发布");
			refresh();
		},
		onError: (error) => toast.error("回复失败", errorText(error)),
	});

	const patchComment = useMutation({
		mutationFn: (content: string) =>
			call(client.service.discussions.patchComment(discussionId, node.comment.id, { content }), "评论"),
		onSuccess: () => {
			toast.success("评论已更新");
			setEditing(false);
			refresh();
		},
		onError: (error) => toast.error("评论更新失败", errorText(error)),
	});

	const deleteComment = useMutation({
		mutationFn: () => callVoid(client.service.discussions.deleteComment(discussionId, node.comment.id)),
		onSuccess: () => {
			toast.success("评论已删除");
			refresh();
		},
		onError: (error) => toast.error("评论删除失败", errorText(error)),
	});

	const isMine = currentUserId !== null && node.comment.author_id === currentUserId;
	const edited = node.comment.updated_at !== node.comment.created_at;

	return (
		<div
			className={depth > 0 ? "xz-comment xz-com-nested" : "xz-comment"}
			style={depth > 0 ? { marginLeft: depth * 16 } : undefined}
		>
			<Avatar src={node.comment.author_avatar ?? null} name={commentAuthorName(node.comment)} />
			<div className="xz-comment__main">
				<div className="xz-comment__head">
					<span className="xz-comment__author">{commentAuthorName(node.comment)}</span>
					<span aria-hidden="true">·</span>
					<span title={node.comment.created_at}>{formatRelative(node.comment.created_at)}</span>
					{edited ? <span className="xz-muted xz-xs">已编辑</span> : null}
					{isMine ? <span className="xz-com-you">我的评论</span> : null}
				</div>

				{editing ? (
					<CommentComposer
						initialValue={node.comment.content}
						submitLabel="保存修改"
						pending={patchComment.isPending}
						autoFocus
						onCancel={() => setEditing(false)}
						onSubmit={async (content) => {
							try {
								await patchComment.mutateAsync(content);
								return true;
							} catch {
								return false;
							}
						}}
					/>
				) : (
					<div className="xz-com-commentbody">
						<MarkdownView>{node.comment.content}</MarkdownView>
					</div>
				)}

				<div className="xz-row xz-com-actions">
					<Button size="sm" variant="quiet" icon="chat" onClick={() => setReplyOpen((open) => !open)}>
						回复
					</Button>
					{isMine ? (
						<>
							<Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing(true)}>
								编辑
							</Button>
							<Button
								size="sm"
								variant="danger-ghost"
								icon="trash"
								loading={deleteComment.isPending}
								onClick={() => {
									void confirm({
										title: "删除这条评论？",
										description: "删除后无法恢复。",
										consequences:
											"该评论会被永久删除；它的回复不会被一并删除，父评论消失后会作为顶层评论继续显示。",
										tone: "danger",
										confirmText: "删除",
									}).then((ok) => {
										if (ok) deleteComment.mutate();
									});
								}}
							>
								删除
							</Button>
						</>
					) : null}
				</div>

				{replyOpen ? (
					<div className="xz-com-replybox">
						<CommentComposer
							placeholder={`回复 ${commentAuthorName(node.comment)}…`}
							submitLabel="回复"
							pending={createReply.isPending}
							autoFocus
							onCancel={() => setReplyOpen(false)}
							onSubmit={async (content) => {
								try {
									await createReply.mutateAsync(content);
									setReplyOpen(false);
									return true;
								} catch {
									return false;
								}
							}}
						/>
					</div>
				) : null}
			</div>
		</div>
	);
}

/** 评论树（含楼中楼）。展开为扁平列表渲染，缩进表达层级。 */
export function CommentThread({
	comments,
	discussionId,
	currentUserId,
}: {
	comments: readonly CommentRow[];
	discussionId: string;
	currentUserId: string | null;
}) {
	const flat = useMemo(() => flattenCommentTree(buildCommentTree(comments)), [comments]);
	return (
		<div className="xz-com-thread">
			{flat.map((entry) => (
				<CommentItem
					key={entry.node.comment.id}
					node={entry.node}
					depth={entry.depth}
					discussionId={discussionId}
					currentUserId={currentUserId}
				/>
			))}
		</div>
	);
}
