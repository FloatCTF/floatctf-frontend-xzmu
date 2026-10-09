/**
 * 选手工作区 · 社区（公告 / 解题流水 / Top15 / 题解 / 武器库）。
 *
 * 数据全部来自真实接口，三态（loading / empty / error）齐全，**没有任何占位数据**。
 *
 * 已核对的字段事实：
 * - `TopUser = { no, nickname, avatar?, solved_count, solved_last_at }` —— 没有 username、没有 points；
 * - `SolveResult = JeopardyChallengeSolves & { nickname, avatar?, challenge_name }`，
 *   分值字段是 `obtained_points` / `bonus_points`（**不是** `points`）；
 * - `UnifiedWriteupResult.id` 对 gamebox 类型就是 `run_id`，详情统一走 `getWriteup(id)`；
 * - 武器库 `file_url` 存的是 S3 key（`weapons/<文件名>`，见 `weapon/application.rs:85`），
 *   公开下载地址是 `/public/<file_url>`（与 Default 一致，dev 由 Vite 代理到 API）。
 */

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SolveResult, TopUser, UnifiedWriteupResult } from "@floatctf/sdk";
import type { Announcements, Weapons } from "@floatctf/sdk/entity";

import { call, callList } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { qk } from "../../api/keys.ts";
import { useAuth } from "../../auth/store.ts";
import { formatDateTime, formatRelative, matches } from "../../lib/format.ts";
import { useDebounced } from "../../lib/hooks.ts";
import { Link } from "../../router/Link.tsx";
import type { PageProps } from "../../router/pages.ts";
import { useDocumentTitle } from "../../router/router.tsx";
import { Icon } from "../../ui/icons.tsx";
import { MarkdownView } from "../../ui/Markdown.tsx";
import { QueryBoundary } from "../../ui/overlays.tsx";
import {
	Avatar,
	Badge,
	Button,
	Card,
	CardBody,
	CardHead,
	EmptyState,
	Segmented,
	Select,
} from "../../ui/primitives.tsx";
import { DataTable, Pagination, readMeta } from "../../ui/Table.tsx";
import {
	CardFootPager,
	CommunityHead,
	LocalFilterHint,
	SearchInput,
	useClientPaging,
	useServerPaging,
} from "./components.tsx";

/* ── /community/announcements ─────────────────────────────────────── */

function AnnouncementCard({ item }: { item: Announcements }) {
	const [open, setOpen] = useState(false);
	const content = item.content ?? "";
	const edited = item.updated_at !== item.created_at;

	return (
		<article className="xz-post xz-com-post">
			<header className="xz-post__head">
				<div className="xz-grow">
					<h3 className="xz-com-title">{item.title}</h3>
					<div className="xz-list__meta">
						<span>
							<Icon name="user" size={12} /> {item.publisher || "平台"}
						</span>
						<span title={item.created_at}>发布 {formatDateTime(item.created_at)}</span>
						{edited ? <span title={item.updated_at}>更新 {formatDateTime(item.updated_at)}</span> : null}
					</div>
				</div>
				<Button
					size="sm"
					variant={open ? "ghost" : "primary"}
					icon={open ? "chevronDown" : "chevronRight"}
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
				>
					{open ? "收起" : "展开详情"}
				</Button>
			</header>
			{open ? (
				<div className="xz-post__body">
					{content.trim() ? (
						<MarkdownView>{content}</MarkdownView>
					) : (
						<p className="xz-muted">这条公告没有正文。</p>
					)}
				</div>
			) : null}
		</article>
	);
}

export function AnnouncementsPage() {
	useDocumentTitle("全站公告");
	const client = useClient();
	const paging = useServerPaging(20);
	const [search, setSearch] = useState("");
	const debounced = useDebounced(search);

	const query = useQuery({
		queryKey: qk.announcements.list(paging.params),
		queryFn: () => callList(client.service.announcements.fetch(paging.params)),
		placeholderData: keepPreviousData,
	});

	const items = query.data?.items ?? [];
	const filtered = useMemo(
		() => items.filter((item) => matches([item.title, item.content, item.publisher], debounced)),
		[items, debounced],
	);
	const meta = readMeta(query.data?.meta, paging.limit);

	return (
		<div className="xz-page">
			<CommunityHead
				title="全站公告"
				desc="平台发布的赛程、规则与运维通知。点击「展开详情」阅读完整正文。"
			/>

			<div className="xz-filters">
				<SearchInput value={search} onChange={setSearch} placeholder="搜索标题 / 正文 / 发布人" />
				<LocalFilterHint shown={filtered.length} total={items.length} unit="条" />
			</div>

			<QueryBoundary
				isPending={query.isPending}
				isError={query.isError}
				error={query.error}
				refetch={() => void query.refetch()}
				loadingLabel="正在加载公告…"
			>
				{filtered.length === 0 ? (
					<Card flat>
						<EmptyState
							icon="bell"
							title={items.length === 0 ? "暂无公告" : "当前页没有匹配的公告"}
							desc={items.length === 0 ? "平台还没有发布任何公告。" : "换个关键词，或翻到其它页看看。"}
						/>
					</Card>
				) : (
					<div className="xz-com-posts">
						{filtered.map((item) => (
							<AnnouncementCard key={item.id} item={item} />
						))}
					</div>
				)}
			</QueryBoundary>

			{meta.total > 0 ? (
				<Card className="xz-com-pager">
					<CardFootPager
						page={paging.page}
						limit={paging.limit}
						total={meta.total}
						onPageChange={paging.setPage}
						onLimitChange={paging.setLimit}
					/>
				</Card>
			) : null}
		</div>
	);
}

/* ── /community/solves ────────────────────────────────────────────── */

export function SolvesPage() {
	useDocumentTitle("解题流水");
	const client = useClient();
	const paging = useServerPaging(20);
	const [search, setSearch] = useState("");
	const debounced = useDebounced(search);

	const query = useQuery({
		queryKey: qk.solves.list(paging.params),
		queryFn: () => callList(client.service.solves.fetch(paging.params)),
		placeholderData: keepPreviousData,
	});

	const items = query.data?.items ?? [];
	const rows = useMemo(
		() => items.filter((item) => matches([item.challenge_name, item.nickname], debounced)),
		[items, debounced],
	);
	const meta = readMeta(query.data?.meta, paging.limit);

	return (
		<div className="xz-page xz-page--wide">
			<CommunityHead
				title="解题流水"
				desc="全站题目解出记录（按时间倒序）。得分 = 解出得分（obtained_points）+ 奖励分（bonus_points，若有）。"
			/>

			<div className="xz-filters">
				<SearchInput value={search} onChange={setSearch} placeholder="搜索题目 / 选手" />
				<LocalFilterHint shown={rows.length} total={items.length} unit="条" />
			</div>

			<Card>
				<CardHead title="解出记录" icon="bolt" sub={query.isSuccess ? `共 ${meta.total} 条` : undefined} />
				<CardBody flush>
					<QueryBoundary
						isPending={query.isPending}
						isError={query.isError}
						error={query.error}
						refetch={() => void query.refetch()}
						loadingLabel="正在加载解题流水…"
					>
						<DataTable<SolveResult>
							rows={rows}
							rowKey={(row) => row.id}
							compact
							empty={<EmptyState icon="bolt" title="没有解出记录" desc="第一道题解出后会出现在这里。" />}
							columns={[
								{
									key: "challenge_name",
									header: "题目",
									render: (row) => (
										<Link to={`/challenges/${row.challenge_id}`} className="xz-com-strong">
											{row.challenge_name || "（题目）"}
										</Link>
									),
								},
								{
									key: "nickname",
									header: "选手",
									render: (row) => (
										<span className="xz-com-user">
											<Avatar src={row.avatar ?? null} name={row.nickname} />
											{row.nickname || "（匿名）"}
										</span>
									),
								},
								{
									key: "points",
									header: "得分",
									numeric: true,
									render: (row) => (
										<span className="xz-com-score">
											{row.obtained_points + row.bonus_points}
											{row.bonus_points > 0 ? (
												<span className="xz-muted xz-xs">（含奖励 {row.bonus_points}）</span>
											) : null}
										</span>
									),
								},
								{
									key: "created_at",
									header: "解出时间",
									render: (row) => <span title={row.created_at}>{formatDateTime(row.created_at)}</span>,
								},
							]}
						/>
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
		</div>
	);
}

/* ── /community/top ───────────────────────────────────────────────── */

export function TopPage() {
	useDocumentTitle("Top15 排行榜");
	const client = useClient();
	const { me } = useAuth();

	const query = useQuery({
		queryKey: qk.solves.top15,
		queryFn: () => callList(client.service.solves.getTop15Users()),
	});

	const items = query.data?.items ?? [];
	const myNickname = me?.nickname ?? null;

	return (
		<div className="xz-page">
			<CommunityHead
				title="Top15 排行榜"
				desc="按平台练习赛事的解出记录统计的前 15 位选手；解出题数相同时，最近解出时间更晚者靠前"
			/>

			<Card>
				<CardHead title="解出题数榜" icon="crown" sub={query.isSuccess ? `${items.length} 位选手` : undefined} />
				<CardBody flush>
					<QueryBoundary
						isPending={query.isPending}
						isError={query.isError}
						error={query.error}
						refetch={() => void query.refetch()}
						loadingLabel="正在加载排行榜…"
					>
						{items.length === 0 ? (
							<EmptyState icon="crown" title="榜单暂时为空" desc="还没有人解出题目。" />
						) : (
							<div className="xz-tablewrap">
								<table className="xz-board">
									<thead>
										<tr>
											<th style={{ width: 72 }}>名次</th>
											<th>选手</th>
											<th className="xz-board__num">解出题数</th>
											<th>最近解出</th>
										</tr>
									</thead>
									<tbody>
										{items.map((entry: TopUser) => {
											const isMe = Boolean(myNickname && entry.nickname === myNickname);
											return (
												<tr
													key={`${entry.no}-${entry.nickname}`}
													className={isMe ? "xz-board__row--me" : undefined}
												>
													<td>
														<span className="xz-board__rank" data-top={entry.no}>
															#{entry.no}
														</span>
													</td>
													<td>
														<span className="xz-com-user">
															<Avatar src={entry.avatar ?? null} name={entry.nickname} />
															{entry.nickname || "（匿名）"}
															{isMe ? <Badge tone="gold">我</Badge> : null}
														</span>
													</td>
													<td className="xz-board__num">
														<span className="xz-board__score">{entry.solved_count}</span>
													</td>
													<td title={entry.solved_last_at}>{formatRelative(entry.solved_last_at)}</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</QueryBoundary>
				</CardBody>
			</Card>
		</div>
	);
}

/* ── /community/writeups + /community/writeups/:id ────────────────── */

function WriteupTypeBadge({ type }: { type: UnifiedWriteupResult["writeup_type"] }) {
	return type === "gamebox" ? <Badge tone="ok">GameBox</Badge> : <Badge tone="crimson">题目</Badge>;
}

export function WriteupsPage() {
	useDocumentTitle("全站题解");
	const client = useClient();
	const paging = useServerPaging(20);
	const [search, setSearch] = useState("");
	const [type, setType] = useState<"all" | "challenge" | "gamebox">("all");
	const debounced = useDebounced(search);

	const query = useQuery({
		queryKey: qk.writeups.list(paging.params),
		queryFn: () => callList(client.service.challenges.getAllWriteups(paging.params)),
		placeholderData: keepPreviousData,
	});

	const items = query.data?.items ?? [];
	const rows = useMemo(
		() =>
			items.filter(
				(item) =>
					(type === "all" || item.writeup_type === type) &&
					matches([item.content_name, item.nickname], debounced),
			),
		[items, type, debounced],
	);
	const meta = readMeta(query.data?.meta, paging.limit);

	return (
		<div className="xz-page">
			<CommunityHead
				title="全站题解"
				desc="题目题解公开可见；练习（GameBox）题解只有本人能在列表里看到，详情同样仅作者可读。"
				actions={
					<Link to="/me/writeups">
						<Button icon="user">我的题解</Button>
					</Link>
				}
			/>

			<div className="xz-filters">
				<SearchInput value={search} onChange={setSearch} placeholder="搜索题解名称 / 作者" />
				<Segmented
					ariaLabel="题解类型"
					value={type}
					onChange={setType}
					options={[
						{ value: "all", label: "全部" },
						{ value: "challenge", label: "题目" },
						{ value: "gamebox", label: "GameBox" },
					]}
				/>
				<LocalFilterHint shown={rows.length} total={items.length} unit="条" />
			</div>

			<Card>
				<CardHead title="题解列表" icon="book" sub={query.isSuccess ? `共 ${meta.total} 条` : undefined} />
				<CardBody flush>
					<QueryBoundary
						isPending={query.isPending}
						isError={query.isError}
						error={query.error}
						refetch={() => void query.refetch()}
						loadingLabel="正在加载题解…"
					>
						{rows.length === 0 ? (
							<EmptyState
								icon="book"
								title={items.length === 0 ? "还没有公开题解" : "当前页没有匹配的题解"}
								desc="在题目详情或练习 Run 里写下题解后，会出现在这里。"
							/>
						) : (
							<div className="xz-list">
								{rows.map((item) => (
									<Link key={`${item.writeup_type}-${item.id}`} to={`/community/writeups/${item.id}`} className="xz-list__row">
										<Avatar src={item.avatar ?? null} name={item.nickname} />
										<div className="xz-list__main">
											<div className="xz-list__title">{item.content_name || "（未命名内容）"}</div>
											<div className="xz-list__meta">
												<span>{item.nickname || "（未知作者）"}</span>
												<span title={item.updated_at}>更新于 {formatRelative(item.updated_at)}</span>
											</div>
										</div>
										<WriteupTypeBadge type={item.writeup_type} />
										<Icon name="chevronRight" size={15} />
									</Link>
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
		</div>
	);
}

export function WriteupDetailPage({ params }: PageProps) {
	const id = params.id ?? "";
	const client = useClient();

	const query = useQuery({
		queryKey: qk.writeups.detail(id),
		queryFn: () => call(client.service.challenges.getWriteup(id), "题解详情"),
		enabled: Boolean(id),
	});

	const writeup = query.data ?? null;
	useDocumentTitle(writeup?.content_name ?? "题解详情");

	return (
		<div className="xz-page">
			<CommunityHead
				title="题解详情"
				actions={
					<Link to="/community/writeups">
						<Button icon="arrowLeft">返回题解列表</Button>
					</Link>
				}
			/>

			<QueryBoundary
				isPending={query.isPending}
				isError={query.isError}
				error={query.error}
				refetch={() => void query.refetch()}
				loadingLabel="正在加载题解…"
			>
				{writeup ? (
					<article className="xz-post">
						<header className="xz-post__head">
							<Avatar src={writeup.avatar ?? null} name={writeup.nickname} size="lg" />
							<div className="xz-grow">
								<h2 className="xz-com-title">
									{writeup.content_name || "（未命名内容）"}{" "}
									<WriteupTypeBadge type={writeup.writeup_type} />
								</h2>
								<div className="xz-list__meta">
									<span>{writeup.nickname || "（未知作者）"}</span>
									{writeup.category ? <span>分类 {writeup.category}</span> : null}
									<span title={writeup.created_at}>创建 {formatDateTime(writeup.created_at)}</span>
									{writeup.updated_at !== writeup.created_at ? (
										<span title={writeup.updated_at}>更新 {formatDateTime(writeup.updated_at)}</span>
									) : null}
								</div>
							</div>
							{writeup.writeup_type === "challenge" ? (
								<Link to={`/challenges/${writeup.content_id}`}>
									<Button icon="puzzle">打开题目</Button>
								</Link>
							) : null}
						</header>
						<div className="xz-post__body">
							{writeup.content.trim() ? (
								<MarkdownView>{writeup.content}</MarkdownView>
							) : (
								<p className="xz-muted">这条题解没有正文。</p>
							)}
						</div>
					</article>
				) : null}
			</QueryBoundary>
		</div>
	);
}

/* ── /community/arsenal ───────────────────────────────────────────── */

/** 武器库公开下载地址：`file_url` 是 S3 key（`weapons/<文件名>`），公开前缀是 `/public/`。 */
function publicFileUrl(fileUrl: string): string {
	if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
	const key = fileUrl.replace(/^\/+/, "").replace(/^public\//, "");
	return `/public/${key}`;
}

export function ArsenalPage() {
	useDocumentTitle("武器库");
	const client = useClient();
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState("all");
	const debounced = useDebounced(search);

	// 选手端武器库接口一次返回全部条目（`weapon/api.rs:37-78` 不分页），分页在前端做。
	const query = useQuery({
		queryKey: qk.weapons.list(),
		queryFn: () => callList(client.service.weapons.fetch()),
	});

	const items = query.data?.items ?? [];
	const categories = useMemo(
		() => Array.from(new Set(items.map((item) => item.category).filter(Boolean))).sort(),
		[items],
	);
	const rows = useMemo(
		() =>
			items.filter(
				(item) =>
					(category === "all" || item.category === category) &&
					matches([item.name, item.category, item.description], debounced),
			),
		[items, category, debounced],
	);
	const paging = useClientPaging(rows.length, 20);
	const pageRows = rows.slice(paging.offset, paging.offset + paging.pageSize);

	return (
		<div className="xz-page">
			<CommunityHead
				title="武器库"
				desc="平台维护的工具与脚本集合。有附件的条目可直接下载；下载次数由管理员维护（平台没有自动计数端点）。"
			/>

			<div className="xz-filters">
				<SearchInput value={search} onChange={setSearch} placeholder="搜索名称 / 分类 / 描述" />
				<Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="分类">
					<option value="all">全部分类</option>
					{categories.map((entry) => (
						<option key={entry} value={entry}>
							{entry}
						</option>
					))}
				</Select>
				<LocalFilterHint shown={rows.length} total={items.length} unit="件" />
			</div>

			<Card>
				<CardHead title="工具与脚本" icon="sword" sub={query.isSuccess ? `共 ${items.length} 件` : undefined} />
				<CardBody flush>
					<QueryBoundary
						isPending={query.isPending}
						isError={query.isError}
						error={query.error}
						refetch={() => void query.refetch()}
						loadingLabel="正在加载武器库…"
					>
						{pageRows.length === 0 ? (
							<EmptyState
								icon="sword"
								title={items.length === 0 ? "武器库还是空的" : "没有匹配的条目"}
								desc={items.length === 0 ? "管理员还没有上传任何工具。" : "换个关键词或分类试试。"}
							/>
						) : (
							<div className="xz-list">
								{pageRows.map((item: Weapons) => (
									<div key={item.id} className="xz-list__row">
										<div className="xz-list__main">
											<div className="xz-list__title">{item.name}</div>
											{item.description ? (
												<div className="xz-com-desc">{item.description}</div>
											) : null}
											<div className="xz-list__meta">
												<span>
													<Badge tone="neutral" icon="tag">
														{item.category || "未分类"}
													</Badge>
												</span>
												<span>下载次数 {item.download_count}</span>
												<span title={item.updated_at}>更新 {formatDateTime(item.updated_at)}</span>
											</div>
										</div>
										<div className="xz-list__aside">
											{item.has_file && item.file_url ? (
												<a
													href={publicFileUrl(item.file_url)}
													target="_blank"
													rel="noopener noreferrer"
													download
												>
													<Button size="sm" variant="primary" icon="download">
														下载
													</Button>
												</a>
											) : (
												<Badge tone="neutral">无附件</Badge>
											)}
										</div>
									</div>
								))}
							</div>
						)}
					</QueryBoundary>
				</CardBody>
				{rows.length > 0 ? (
					<footer className="xz-card__foot">
						<Pagination
							page={paging.page}
							pageSize={paging.pageSize}
							total={rows.length}
							onPageChange={paging.setPage}
							onPageSizeChange={paging.setPageSize}
						/>
					</footer>
				) : null}
			</Card>
		</div>
	);
}
