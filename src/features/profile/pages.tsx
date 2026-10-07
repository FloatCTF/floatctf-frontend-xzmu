/**
 * 选手工作区 · 我的（`/me`）与我的题解（`/me/writeups`）。
 *
 * 关键事实（逐字核对过 SDK 与后端源码）：
 * - `users.getMe()` 返回 `Users`，后端把 `password` 置空串（`identity/user/mod.rs` 的 `get_me`），
 *   但**本文件任何位置都不渲染该字段**（AGENTS.md 硬规则 8）。
 * - `users.patchMe(data)` 的 SDK 声明是 `UniResponse<Users>`，后端实际是
 *   `UniResponse::ok_none()`（`patch_me` 返回 `UniResult<()>`）→ `data` 为 `null`。
 *   因此保存后不用返回值，改为失效 `qk.me` 重新拉权威资料。
 * - `uploads.upload_avatar(image_file)` 是 **PATCH /api/uploads/avatar**（multipart，字段 `image_file`），
 *   返回新头像的公开地址（后端写 `/public/<path>`）。
 * - 平台**没有**「我的题解」专用端点：`GET /api/writeups` 返回全部公开的题目题解
 *   **加上**「我自己的」练习 GameBox 题解（`challenge/writeup/mod.rs:305-330`）。
 *   因此 `/me/writeups` 用作者身份（题目题解按邮箱匹配）在本地筛出我的条目，
 *   并在界面上如实说明这一口径。
 */

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryParams, UnifiedWriteupResult } from "@floatctf/sdk";
import type { Users } from "@floatctf/sdk/entity";

import { call, callList, unwrapNullable } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { errorText } from "../../api/errors.ts";
import { qk } from "../../api/keys.ts";
import { clearScope, setMe, useAuth } from "../../auth/store.ts";
import { formatDateTime, formatRelative } from "../../lib/format.ts";
import { Link } from "../../router/Link.tsx";
import { useDocumentTitle, useNavigate } from "../../router/router.tsx";
import { Icon } from "../../ui/icons.tsx";
import { QueryBoundary, useConfirm, useToast } from "../../ui/overlays.tsx";
import {
	Avatar,
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	EmptyState,
	Field,
	InlineLoading,
	KeyValue,
	TextInput,
} from "../../ui/primitives.tsx";
import { Pagination } from "../../ui/Table.tsx";

/* ── 本地小组件 ───────────────────────────────────────────────────── */

function MeHead({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
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

/** 前端分页（用于 `/me/writeups` 这种一次性取回后在本地分页的列表）。 */
function useLocalPaging(total: number, initialSize = 20) {
	const [page, setPage] = useState(1);
	const [pageSize, setPageSizeState] = useState(initialSize);
	const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
	const safePage = Math.min(Math.max(1, page), totalPages);
	return {
		page: safePage,
		pageSize,
		offset: (safePage - 1) * pageSize,
		setPage,
		setPageSize: (size: number) => {
			setPageSizeState(size);
			setPage(1);
		},
	};
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ── /me ──────────────────────────────────────────────────────────── */

interface ProfileDraft {
	nickname: string;
	email: string;
	password: string;
	confirmed: string;
}

/** 只把**真正改动**的字段发给后端（Default 的 `diffToPatch` 口径）。 */
function diffToPatch(profile: Users, draft: ProfileDraft): Partial<Users> {
	const patch: Partial<Users> = {};
	const nickname = draft.nickname.trim();
	const email = draft.email.trim();
	if (nickname && nickname !== profile.nickname) patch.nickname = nickname;
	if (email !== profile.email) patch.email = email;
	if (draft.password) patch.password = draft.password;
	return patch;
}

function ProfileForm({
	profile,
	pending,
	onSubmit,
}: {
	profile: Users;
	pending: boolean;
	onSubmit: (patch: Partial<Users>) => void;
}) {
	const [draft, setDraft] = useState<ProfileDraft>({
		nickname: profile.nickname,
		email: profile.email,
		password: "",
		confirmed: "",
	});
	const [touched, setTouched] = useState(false);

	const nicknameError = !draft.nickname.trim() ? "昵称不能为空" : undefined;
	const emailError =
		draft.email.trim() && !EMAIL_PATTERN.test(draft.email.trim()) ? "邮箱格式不正确" : undefined;
	const passwordError = draft.password && draft.password.length < 8 ? "密码至少 8 位" : undefined;
	const confirmError =
		draft.password && draft.confirmed !== draft.password ? "两次输入的密码不一致" : undefined;
	const hasError = Boolean(nicknameError || emailError || passwordError || confirmError);

	const patch = diffToPatch(profile, draft);
	const changed = Object.keys(patch).length > 0;

	return (
		<form
			className="xz-col"
			style={{ gap: 14 }}
			onSubmit={(event) => {
				event.preventDefault();
				setTouched(true);
				if (hasError) return;
				if (!changed) return;
				onSubmit(patch);
			}}
		>
			<Field label="用户名" hint="用户名注册后不可修改，仅用于登录。">
				{(props) => <TextInput {...props} value={profile.username} readOnly disabled />}
			</Field>

			<Field label="昵称" required error={touched ? nicknameError : undefined} hint="展示在排行榜、题解与讨论区。">
				{(props) => (
					<TextInput
						{...props}
						value={draft.nickname}
						maxLength={64}
						onChange={(event) => setDraft((current) => ({ ...current, nickname: event.target.value }))}
					/>
				)}
			</Field>

			<Field label="邮箱" error={touched ? emailError : undefined} hint="用于找回密码。留空表示不修改。">
				{(props) => (
					<TextInput
						{...props}
						type="email"
						autoComplete="email"
						value={draft.email}
						onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
					/>
				)}
			</Field>

			<Field
				label="新密码"
				error={touched ? passwordError : undefined}
				hint="留空表示不修改密码；如修改则至少 8 位。修改后当前登录仍有效（JWT 无状态，不会被强制下线）。"
			>
				{(props) => (
					<TextInput
						{...props}
						type="password"
						autoComplete="new-password"
						value={draft.password}
						onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
					/>
				)}
			</Field>

			<Field label="确认新密码" error={touched ? confirmError : undefined}>
				{(props) => (
					<TextInput
						{...props}
						type="password"
						autoComplete="new-password"
						value={draft.confirmed}
						onChange={(event) => setDraft((current) => ({ ...current, confirmed: event.target.value }))}
					/>
				)}
			</Field>

			<div className="xz-row" style={{ justifyContent: "flex-end" }}>
				<Button
					variant="quiet"
					disabled={pending}
					onClick={() =>
						setDraft({
							nickname: profile.nickname,
							email: profile.email,
							password: "",
							confirmed: "",
						})
					}
				>
					重置
				</Button>
				<Button type="submit" variant="primary" icon="save" loading={pending} disabled={!changed}>
					{changed ? "保存修改" : "没有改动"}
				</Button>
			</div>
		</form>
	);
}

export function MePage() {
	useDocumentTitle("我的资料");
	const client = useClient();
	const toast = useToast();
	const confirm = useConfirm();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const fileRef = useRef<HTMLInputElement | null>(null);

	const profile = useQuery({
		queryKey: qk.me,
		queryFn: () => call(client.service.users.getMe(), "我的资料"),
		staleTime: 5 * 60_000,
	});

	const me = profile.data ?? null;

	// 让外壳（顶栏头像 / 昵称）与资料页保持一致 —— 会话恢复时也会走同一条 store。
	useEffect(() => {
		if (profile.data) setMe(profile.data);
	}, [profile.data]);

	const save = useMutation({
		// `patchMe` 的 SDK 返回类型声明为 `UniResponse<Users>`，但后端返回 `ok_none()`
		// （data 为 null）→ 用 unwrapNullable 只校验信封，成功后重新拉取权威资料。
		mutationFn: async (patch: Partial<Users>) => unwrapNullable(await client.service.users.patchMe(patch)),
		onSuccess: () => {
			toast.success("资料已更新");
			void queryClient.invalidateQueries({ queryKey: qk.me });
		},
		onError: (error) => toast.error("资料更新失败", errorText(error)),
	});

	const uploadAvatar = useMutation({
		// 注意：这是 **PATCH** /api/uploads/avatar（multipart，字段 image_file）。
		mutationFn: (file: File) => call(client.service.uploads.upload_avatar(file), "头像地址"),
		onSuccess: (url) => {
			toast.success("头像已更新");
			if (me) setMe({ ...me, avatar: url });
			void queryClient.invalidateQueries({ queryKey: qk.me });
		},
		onError: (error) => toast.error("头像上传失败", errorText(error)),
	});

	const logout = () => {
		void confirm({
			title: "退出登录？",
			description: "将清除本机保存的登录凭证。",
			consequences: "退出后需要重新输入用户名与密码；未保存的表单内容不会保留。",
			tone: "danger",
			confirmText: "退出登录",
		}).then((ok) => {
			if (!ok) return;
			clearScope("user");
			queryClient.clear();
			navigate("/login", { replace: true });
		});
	};

	return (
		<div className="xz-page">
			<MeHead
				title="我的资料"
				desc="查看并修改账号资料、上传头像。用户名不可修改；密码留空表示不变。"
				actions={
					<Button icon="refresh" loading={profile.isFetching} onClick={() => void profile.refetch()}>
						刷新
					</Button>
				}
			/>

			<QueryBoundary
				isPending={profile.isPending}
				isError={profile.isError}
				error={profile.error}
				refetch={() => void profile.refetch()}
				loadingLabel="正在加载账号资料…"
			>
				{me ? (
					<div className="xz-me-grid">
						<div className="xz-col" style={{ gap: 16 }}>
							<Card>
								<CardHead title="头像" icon="user" />
								<CardBody>
									<div className="xz-me-avatar">
										<Avatar src={me.avatar ?? null} name={me.nickname || me.username} size="lg" />
										<div className="xz-col" style={{ gap: 6 }}>
											<Button
												icon="upload"
												loading={uploadAvatar.isPending}
												onClick={() => fileRef.current?.click()}
											>
												上传新头像
											</Button>
											<span className="xz-muted xz-xs">支持常见图片格式；上传后立即生效。</span>
										</div>
									</div>
									<input
										ref={fileRef}
										type="file"
										accept="image/*"
										className="xz-sr"
										onChange={(event) => {
											const file = event.target.files?.[0];
											event.target.value = "";
											if (file) uploadAvatar.mutate(file);
										}}
									/>
								</CardBody>
							</Card>

							<Card>
								<CardHead title="账号信息" icon="key" />
								<CardBody>
									<KeyValue
										items={[
											{ k: "用户名", v: <span className="xz-mono">{me.username}</span> },
											{ k: "昵称", v: me.nickname || "—" },
											{ k: "邮箱", v: me.email || "—" },
											{ k: "注册时间", v: formatDateTime(me.created_at) },
											{ k: "资料更新时间", v: formatDateTime(me.updated_at) },
										]}
									/>
								</CardBody>
							</Card>

							<Card>
								<CardHead
									title="我的题解"
									icon="book"
									actions={
										<Link to="/me/writeups" className="xz-xs">
											查看我的题解 →
										</Link>
									}
								/>
								<CardBody>
									<p className="xz-muted" style={{ marginTop: 0 }}>
										题目题解在题目详情页写作；练习（GameBox）题解在 AWDP 练习 Run 里写作。
										已有题解可以在「我的题解」里集中查看，或浏览
										<Link to="/community/writeups"> 全站题解</Link>。
									</p>
								</CardBody>
							</Card>

							<div className="xz-danger-zone">
								<div className="xz-danger-zone__title">
									<Icon name="logout" size={16} />
									退出登录
								</div>
								<p className="xz-muted" style={{ marginTop: 0 }}>
									本机保存的登录凭证会被清除；服务端会话（JWT）本身无状态，无法在服务端注销。
								</p>
								<Button variant="danger" icon="logout" onClick={logout}>
									退出登录
								</Button>
							</div>
						</div>

						<Card>
							<CardHead title="修改资料" icon="edit" sub="只提交发生改动的字段" />
							<CardBody>
								<ProfileForm
									key={`${me.updated_at}-${me.nickname}-${me.email}`}
									profile={me}
									pending={save.isPending}
									onSubmit={(patch) => save.mutate(patch)}
								/>
							</CardBody>
						</Card>
					</div>
				) : null}
			</QueryBoundary>
		</div>
	);
}

/* ── /me/writeups ─────────────────────────────────────────────────── */

export function MyWriteupsPage() {
	useDocumentTitle("我的题解");
	const client = useClient();
	const { me, sessionChecked } = useAuth();
	const [search, setSearch] = useState("");

	// 平台没有「我的题解」端点：全局列表 = 全部公开题目题解 + 我自己的练习题解。
	// 一次取回（上限 500，避免逐页请求），再按作者身份在本地筛。
	const params = useMemo<QueryParams>(() => ({ page: 1, limit: 500 }), []);
	const query = useQuery({
		queryKey: qk.writeups.list(params),
		queryFn: () => callList(client.service.challenges.getAllWriteups(params)),
		enabled: Boolean(me?.email || me?.id),
	});

	const mine = useMemo(() => {
		if (!me) return [];
		const items = query.data?.items ?? [];
		return items.filter(
			(item: UnifiedWriteupResult) =>
				// GameBox（练习）题解在全局列表里只会出现我自己的（后端按 user_id 过滤）。
				item.writeup_type === "gamebox" ||
				// 题目题解是公开的，按作者邮箱（账号唯一标识）匹配出我的。
				Boolean(me.email) && item.email === me.email,
		);
	}, [query.data, me]);

	const rows = useMemo(() => {
		const key = search.trim().toLowerCase();
		if (!key) return mine;
		return mine.filter((item) => item.content_name.toLowerCase().includes(key));
	}, [mine, search]);

	const paging = useLocalPaging(rows.length, 20);
	const pageRows = rows.slice(paging.offset, paging.offset + paging.pageSize);

	return (
		<div className="xz-page">
			<MeHead
				title="我的题解"
				desc="平台没有「我的题解」专用接口：本页从全站题解列表中按作者身份筛出你的条目。"
				actions={
					<>
						<Link to="/me">
							<Button icon="user">我的资料</Button>
						</Link>
						<Link to="/community/writeups">
							<Button icon="book">全站题解</Button>
						</Link>
					</>
				}
			/>

			<div className="xz-me-banner">
				<Banner tone="info" title="筛选口径">
					题目题解按当前账号的邮箱匹配作者；练习（GameBox）题解在全局列表中只会出现你自己的。
					若列表为空，说明你还没有写过公开题解（也可能是账号邮箱与题解作者不一致）。
				</Banner>
			</div>

			<div className="xz-filters">
				<span className="xz-search">
					<span className="xz-search__icon">
						<Icon name="search" size={14} />
					</span>
					<input
						className="xz-input"
						data-page-search
						placeholder="搜索我的题解名称"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
				</span>
				<span className="xz-me-hint">共 {rows.length} 条</span>
			</div>

			<Card>
				<CardHead title="我的题解" icon="book" sub={query.isSuccess ? `${rows.length} 条` : undefined} />
				<CardBody flush>
					{!me ? (
						sessionChecked ? (
							<EmptyState
								icon="user"
								title="暂时拿不到当前账号资料"
								desc="需要知道当前用户是谁才能筛出你的题解。请刷新页面；若持续如此，请重新登录。"
							/>
						) : (
							<InlineLoading>正在确认账号身份…</InlineLoading>
						)
					) : (
						<QueryBoundary
							isPending={query.isPending}
							isError={query.isError}
							error={query.error}
							refetch={() => void query.refetch()}
							loadingLabel="正在加载全站题解…"
						>
							{pageRows.length === 0 ? (
								<EmptyState
									icon="book"
									title="没有找到你的题解"
									desc="在题目详情或练习 Run 中写下题解后，会出现在这里。"
								/>
							) : (
								<div className="xz-list">
									{pageRows.map((item) => (
										<Link
											key={`${item.writeup_type}-${item.id}`}
											to={`/community/writeups/${item.id}`}
											className="xz-list__row"
										>
											<Avatar src={item.avatar ?? null} name={item.nickname} />
											<div className="xz-list__main">
												<div className="xz-list__title">{item.content_name || "（未命名内容）"}</div>
												<div className="xz-list__meta">
													<span title={item.updated_at}>更新于 {formatRelative(item.updated_at)}</span>
												</div>
											</div>
											{item.writeup_type === "gamebox" ? (
												<Badge tone="ok">GameBox</Badge>
											) : (
												<Badge tone="crimson">题目</Badge>
											)}
											<Icon name="chevronRight" size={15} />
										</Link>
									))}
								</div>
							)}
						</QueryBoundary>
					)}
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
