/**
 * 认证页面：选手登录 / 注册 / 忘记密码 / 凭 token 重置 / 管理端登录。
 *
 * 鉴权语义（与后端一致）：
 * - 选手与管理端是**两个独立作用域**，各自写自己的 token；
 * - 登录成功后如果 URL 带 `next`，回到该路径（否则回各自工作区首页）；
 * - 认证失败显示平台返回的真实文案 —— 不自造提示。
 */

import { type FormEvent, useState } from "react";

import { call } from "../../api/call.ts";
import { useClient } from "../../api/client.ts";
import { toErrorView } from "../../api/errors.ts";
import { setAdminToken, setMe, setUserToken } from "../../auth/store.ts";
import { Link } from "../../router/Link.tsx";
import { useDocumentTitle, useNavigate, useSearchParams } from "../../router/router.tsx";
import { Banner, Button, Field, TextInput } from "../../ui/primitives.tsx";

function useNextTarget(fallback: string): string {
	const search = useSearchParams();
	const next = search.get("next");
	// 只接受站内相对路径，避免开放重定向。
	if (next && next.startsWith("/") && !next.startsWith("//")) return next;
	return fallback;
}

function ErrorBanner({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<div role="alert">
			<Banner tone="danger" title="登录未成功">
				{message}
			</Banner>
		</div>
	);
}

export function PlayerLoginPage() {
	useDocumentTitle("登录");
	const client = useClient();
	const navigate = useNavigate();
	const next = useNextTarget("/");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const token = await call(client.service.users.login({ username, password }), "登录凭证");
			setUserToken(token);
			// 立刻拉一次资料，把昵称 / 头像填进外壳（失败不阻断登录）。
			try {
				setMe(await call(client.service.users.getMe(), "用户资料"));
			} catch {
				setMe(null);
			}
			navigate(next, { replace: true });
		} catch (cause) {
			const view = toErrorView(cause);
			setError(view.message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<form className="xz-auth__form" onSubmit={submit} noValidate>
			<div>
				<h1 className="xz-auth__title">登录训练场</h1>
				<p className="xz-auth__sub">使用平台账号登录，参加比赛与训练。</p>
			</div>
			<ErrorBanner message={error} />
			<Field label="账号" required>
				{(props) => (
					<TextInput
						{...props}
						name="username"
						autoComplete="username"
						value={username}
						required
						onChange={(event) => setUsername(event.target.value)}
					/>
				)}
			</Field>
			<Field label="密码" required>
				{(props) => (
					<TextInput
						{...props}
						type="password"
						name="password"
						autoComplete="current-password"
						value={password}
						required
						onChange={(event) => setPassword(event.target.value)}
					/>
				)}
			</Field>
			<Button type="submit" variant="primary" size="lg" block loading={busy} icon="login">
				登录
			</Button>
			<div className="xz-auth__foot">
				<Link to="/register">注册新账号</Link>
				<Link to="/reset-password">忘记密码？</Link>
			</div>
			<div className="xz-auth__foot" style={{ borderTop: "none", marginTop: 0, paddingTop: 0 }}>
				<Link to="/admin/login" className="xz-muted xz-xs">
					管理员登录 →
				</Link>
			</div>
		</form>
	);
}

export function AdminLoginPage() {
	useDocumentTitle("管理端登录");
	const client = useClient();
	const navigate = useNavigate();
	const next = useNextTarget("/admin");
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const token = await call(client.admin.login({ username, password }), "管理端登录凭证");
			setAdminToken(token);
			navigate(next, { replace: true });
		} catch (cause) {
			setError(toErrorView(cause).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<form className="xz-auth__form" onSubmit={submit} noValidate>
			<div>
				<h1 className="xz-auth__title">管理控制台</h1>
				<p className="xz-auth__sub">仅平台管理员使用。管理端会话与选手会话互相独立。</p>
			</div>
			<ErrorBanner message={error} />
			<Field label="管理员账号" required>
				{(props) => (
					<TextInput
						{...props}
						name="admin-username"
						autoComplete="username"
						value={username}
						required
						onChange={(event) => setUsername(event.target.value)}
					/>
				)}
			</Field>
			<Field label="密码" required>
				{(props) => (
					<TextInput
						{...props}
						type="password"
						name="admin-password"
						autoComplete="current-password"
						value={password}
						required
						onChange={(event) => setPassword(event.target.value)}
					/>
				)}
			</Field>
			<Button type="submit" variant="primary" size="lg" block loading={busy} icon="shield">
				进入控制台
			</Button>
			<div className="xz-auth__foot">
				<Link to="/login" className="xz-muted xz-xs">
					← 返回选手登录
				</Link>
			</div>
		</form>
	);
}

export function RegisterPage() {
	useDocumentTitle("注册");
	const client = useClient();
	const navigate = useNavigate();
	const [form, setForm] = useState({ username: "", password: "", nickname: "", email: "" });
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const token = await call(client.service.users.register(form), "注册结果");
			if (token) setUserToken(token);
			navigate("/", { replace: true });
		} catch (cause) {
			setError(toErrorView(cause).message);
		} finally {
			setBusy(false);
		}
	};

	const update = (key: keyof typeof form) => (value: string) =>
		setForm((current) => ({ ...current, [key]: value }));

	return (
		<form className="xz-auth__form" onSubmit={submit} noValidate>
			<div>
				<h1 className="xz-auth__title">注册账号</h1>
				<p className="xz-auth__sub">填写信息后即可参加公开赛事与训练。</p>
			</div>
			<ErrorBanner message={error} />
			<Field label="账号" required hint="登录用的唯一标识，注册后不可修改。">
				{(props) => (
					<TextInput
						{...props}
						autoComplete="username"
						value={form.username}
						required
						onChange={(event) => update("username")(event.target.value)}
					/>
				)}
			</Field>
			<Field label="昵称" required hint="显示在排行榜与讨论区。">
				{(props) => (
					<TextInput
						{...props}
						value={form.nickname}
						required
						onChange={(event) => update("nickname")(event.target.value)}
					/>
				)}
			</Field>
			<Field label="邮箱" required hint="用于找回密码。">
				{(props) => (
					<TextInput
						{...props}
						type="email"
						autoComplete="email"
						value={form.email}
						required
						onChange={(event) => update("email")(event.target.value)}
					/>
				)}
			</Field>
			<Field label="密码" required>
				{(props) => (
					<TextInput
						{...props}
						type="password"
						autoComplete="new-password"
						value={form.password}
						required
						onChange={(event) => update("password")(event.target.value)}
					/>
				)}
			</Field>
			<Button type="submit" variant="primary" size="lg" block loading={busy} icon="plus">
				创建账号
			</Button>
			<div className="xz-auth__foot">
				<Link to="/login">已有账号，去登录</Link>
			</div>
		</form>
	);
}

export function ResetRequestPage() {
	useDocumentTitle("找回密码");
	const client = useClient();
	const [username, setUsername] = useState("");
	const [email, setEmail] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [sent, setSent] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const message = await call(
				client.service.users.resetPassword({ username: username || undefined, email: email || undefined }),
				"重置结果",
			);
			setSent(message || "重置请求已提交，请查收邮件。");
		} catch (cause) {
			setError(toErrorView(cause).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<form className="xz-auth__form" onSubmit={submit} noValidate>
			<div>
				<h1 className="xz-auth__title">找回密码</h1>
				<p className="xz-auth__sub">填写账号或邮箱，我们会发送重置链接。</p>
			</div>
			{sent ? (
				<Banner tone="ok" title="请求已提交">
					{sent}
				</Banner>
			) : null}
			<ErrorBanner message={error} />
			<Field label="账号" hint="与邮箱二者至少填一项。">
				{(props) => (
					<TextInput {...props} value={username} onChange={(event) => setUsername(event.target.value)} />
				)}
			</Field>
			<Field label="邮箱">
				{(props) => (
					<TextInput
						{...props}
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
					/>
				)}
			</Field>
			<Button
				type="submit"
				variant="primary"
				size="lg"
				block
				loading={busy}
				disabled={!username && !email}
				icon="send"
			>
				发送重置邮件
			</Button>
			<div className="xz-auth__foot">
				<Link to="/login">← 返回登录</Link>
			</div>
		</form>
	);
}

export function ResetPage() {
	useDocumentTitle("重置密码");
	const client = useClient();
	const navigate = useNavigate();
	const search = useSearchParams();
	const token = search.get("token") ?? "";
	const [password, setPassword] = useState("");
	const [confirmed, setConfirmed] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy) return;
		if (password !== confirmed) {
			setError("两次输入的密码不一致。");
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await call(
				client.service.users.reset({ token, password, confirmed_password: confirmed }),
				"重置结果",
			);
			navigate("/login", { replace: true });
		} catch (cause) {
			setError(toErrorView(cause).message);
		} finally {
			setBusy(false);
		}
	};

	if (!token) {
		return (
			<div className="xz-col" style={{ gap: 16 }}>
				<h1 className="xz-auth__title">重置密码</h1>
				<Banner tone="danger" title="链接无效">
					重置链接缺少 token 参数。请从邮件中的完整链接重新打开。
				</Banner>
				<Link to="/reset-password">重新申请重置邮件</Link>
			</div>
		);
	}

	return (
		<form className="xz-auth__form" onSubmit={submit} noValidate>
			<div>
				<h1 className="xz-auth__title">设置新密码</h1>
				<p className="xz-auth__sub">重置链接一次性有效，提交后请用新密码登录。</p>
			</div>
			<ErrorBanner message={error} />
			<Field label="新密码" required>
				{(props) => (
					<TextInput
						{...props}
						type="password"
						autoComplete="new-password"
						value={password}
						required
						onChange={(event) => setPassword(event.target.value)}
					/>
				)}
			</Field>
			<Field label="确认新密码" required>
				{(props) => (
					<TextInput
						{...props}
						type="password"
						autoComplete="new-password"
						value={confirmed}
						required
						onChange={(event) => setConfirmed(event.target.value)}
					/>
				)}
			</Field>
			<Button type="submit" variant="primary" size="lg" block loading={busy} icon="key">
				提交新密码
			</Button>
		</form>
	);
}
