/**
 * 管理控制台 · Web 终端（`/admin/terminal`）。
 *
 * ## 逃生舱声明（AI-FRONTEND-GUIDE §5.4；CAPABILITY-MATRIX「Gaps found」中的 class B）
 * SDK 门面 **没有**终端抽象（`client.admin.*` 里没有任何 terminal 方法），
 * 因此本页按**文档化的低层公共接口**实现，而不是臆造 SDK 方法、也不抄 packages 内部实现：
 *
 * 1. `await client.adminHttp.post("/terminal/session")`
 *    → 后端 `POST /api/admin/terminal/session`：用常规管理员 JWT（`Authorization` 头，
 *      由 SDK 注入）签发 **60 秒有效、一次性消费的 HttpOnly ticket cookie**
 *      （`floatctf_terminal_ticket`，`Path=/api/admin/terminal/ws`，`SameSite=Strict`）。
 *      token **绝不进 URL / query string**，浏览器在 WS 握手里自动带上该 cookie。
 * 2. `new WebSocket(wsUrl)`
 *    → 后端 `GET /api/admin/terminal/ws`：原子消费 ticket 后升级协议，在 PTY 里跑 login shell。
 *      - **控制消息（文本帧 JSON）**：`{ type: "resize", cols, rows }`
 *      - **终端数据（二进制帧）**：stdout / stderr 以二进制帧下发；按键也以二进制帧上送
 *        （后端 `Message::Binary` 直接写进 shell stdin）。
 * 3. WS URL 由 **`client.adminBaseUrl`**（`useRuntime().client.adminBaseUrl`，管理端权威 base）
 *    推导：`http(s)` → `ws(s)`，再拼 `/terminal/ws`。**不硬编码 `/api/admin`**。
 *
 * ## 为什么不是 xterm.js
 * 本前端禁止新增依赖（仓库 AGENTS.md 硬规则 1：只允许 sdk / frontend-runtime / react 等），
 * 因此这里是 `<pre>` + `keydown` + `ResizeObserver` 的**最小可用实现**。
 * 它支持交互式行式命令，但不做 VT 光标定位与全屏渲染 —— 该限制在页面上**如实说明**，
 * 不假装功能完整。
 */

import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { useRuntime } from "../../../api/client.ts";
import { errorText } from "../../../api/errors.ts";
import { useDocumentTitle } from "../../../router/router.tsx";
import { useToast } from "../../../ui/overlays.tsx";
import {
	Badge,
	Banner,
	Button,
	Card,
	CardBody,
	CardHead,
	CopyButton,
	KeyValue,
	Switch,
} from "../../../ui/primitives.tsx";

/** 本地保留的输出上限（字符）。超出后丢弃最旧的部分。 */
const MAX_BUFFER = 200_000;

const KEY_ENCODER = new TextEncoder();

type TermStatus =
	| "idle"
	| "authorizing"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "closed"
	| "error";

const STATUS_VIEW: Record<
	TermStatus,
	{ label: string; tone: "neutral" | "info" | "warn" | "ok" | "danger" }
> = {
	idle: { label: "未连接", tone: "neutral" },
	authorizing: { label: "申请 ticket", tone: "info" },
	connecting: { label: "连接中", tone: "warn" },
	connected: { label: "已连接", tone: "ok" },
	reconnecting: { label: "重连中", tone: "warn" },
	closed: { label: "已断开", tone: "neutral" },
	error: { label: "错误", tone: "danger" },
};

/** 特殊键 → 终端字节序列（xterm 默认映射的子集）。 */
const KEY_SEQUENCES: Record<string, string> = {
	Enter: "\r",
	Backspace: "\u007f",
	Tab: "\t",
	Escape: "\u001b",
	ArrowUp: "\u001b[A",
	ArrowDown: "\u001b[B",
	ArrowRight: "\u001b[C",
	ArrowLeft: "\u001b[D",
	Home: "\u001b[H",
	End: "\u001b[F",
	Insert: "\u001b[2~",
	Delete: "\u001b[3~",
	PageUp: "\u001b[5~",
	PageDown: "\u001b[6~",
};

/**
 * 由**管理端权威 base URL** 推导 WebSocket 地址。
 * 相对 base（开发时是 `/api` → `/api/admin`）会用当前页面来源补全；
 * 绝对 base 直接改写协议。任何情况下都不硬编码路径。
 */
export function buildWsUrl(adminBaseUrl: string): string {
	const base = adminBaseUrl.replace(/\/+$/, "");
	const path = `${base}/terminal/ws`;
	if (typeof window === "undefined") return path;
	try {
		const url = new URL(path, window.location.href);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		return url.toString();
	} catch {
		return path;
	}
}

/**
 * 把 PTY 输出压成可读文本。
 *
 * - `\r\n` → `\n`；孤立的 `\r` 视为「回到行首重写」，丢弃当前行已累积内容；
 * - `\b` 删除前一个字符；
 * - ANSI 转义序列（CSI / OSC / 其它两字符转义）整体丢弃，`ESC[K` 额外清空当前行；
 * - 其余 C0 控制字符丢弃（`\t` 保留）。
 *
 * **不做**光标定位（CUP / CUU / CUD 等只是被丢弃），所以全屏程序无法正确渲染。
 */
export function applyChunk(buffer: string, chunk: string): string {
	let text = buffer;
	let index = 0;

	const clearLine = () => {
		const cut = text.lastIndexOf("\n");
		text = cut === -1 ? "" : text.slice(0, cut + 1);
	};

	while (index < chunk.length) {
		const char = chunk[index];
		const next = chunk[index + 1];

		if (char === "\u001b") {
			if (next === "[") {
				let cursor = index + 2;
				while (cursor < chunk.length && !/[@-~]/.test(chunk[cursor] ?? "")) cursor += 1;
				if (chunk[cursor] === "K") clearLine();
				index = cursor + 1;
				continue;
			}
			if (next === "]") {
				let cursor = index + 2;
				while (
					cursor < chunk.length &&
					chunk[cursor] !== "\u0007" &&
					!(chunk[cursor] === "\u001b" && chunk[cursor + 1] === "\\")
				) {
					cursor += 1;
				}
				index = chunk[cursor] === "\u001b" ? cursor + 2 : cursor + 1;
				continue;
			}
			index += 2;
			continue;
		}

		if (char === "\r") {
			if (next === "\n") {
				text += "\n";
				index += 2;
				continue;
			}
			clearLine();
			index += 1;
			continue;
		}

		if (char === "\b") {
			text = text.slice(0, -1);
			index += 1;
			continue;
		}

		if (char !== undefined && char < " " && char !== "\n" && char !== "\t") {
			index += 1;
			continue;
		}

		text += char;
		index += 1;
	}

	return text.length > MAX_BUFFER ? text.slice(text.length - MAX_BUFFER) : text;
}

export function AdminTerminalPage() {
	useDocumentTitle("Web 终端");
	// `adminBaseUrl` 取管理端的**权威** base（不硬编码 `/api/admin`）。
	const { client } = useRuntime();
	const toast = useToast();
	const adminBaseUrl = client.adminBaseUrl;
	const wsUrl = useMemo(() => buildWsUrl(adminBaseUrl), [adminBaseUrl]);

	const shellRef = useRef<HTMLDivElement | null>(null);
	const screenRef = useRef<HTMLPreElement | null>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<number | null>(null);
	const disposedRef = useRef(false);
	/** 会话代次：每次挂载/卸载自增，用于作废旧连接的异步续体（防 StrictMode 双挂载竞态）。 */
	const epochRef = useRef(0);
	const attemptRef = useRef(0);
	const autoReconnectRef = useRef(true);
	const connectRef = useRef<() => void>(() => undefined);
	const decoderRef = useRef<TextDecoder | null>(null);
	const lastErrorRef = useRef<string | null>(null);
	const lastWarnAtRef = useRef(0);
	const sizeRef = useRef({ cols: 80, rows: 24 });

	const [status, setStatus] = useState<TermStatus>("idle");
	const [detail, setDetail] = useState("尚未建立连接。");
	const [output, setOutput] = useState("");
	const [autoReconnect, setAutoReconnect] = useState(true);
	const [attempt, setAttempt] = useState(0);

	const appendText = useCallback((text: string) => {
		if (!text) return;
		setOutput((current) => applyChunk(current, text));
	}, []);

	const appendBytes = useCallback(
		(bytes: Uint8Array) => {
			if (!decoderRef.current) decoderRef.current = new TextDecoder("utf-8");
			// `stream: true` 让跨帧的多字节 UTF-8 字符能正确拼回来。
			appendText(decoderRef.current.decode(bytes, { stream: true }));
		},
		[appendText],
	);

	/** 按估算的字符宽高把容器尺寸换算成行列数。 */
	const measure = useCallback((): { cols: number; rows: number } => {
		const shell = shellRef.current;
		if (!shell) return { cols: 80, rows: 24 };
		const shellStyle = window.getComputedStyle(shell);
		const screenStyle = window.getComputedStyle(screenRef.current ?? shell);
		const fontSize = Number.parseFloat(screenStyle.fontSize) || 13;
		const parsedLineHeight = Number.parseFloat(screenStyle.lineHeight);
		const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.45;

		let charWidth = fontSize * 0.6;
		const context = document.createElement("canvas").getContext("2d");
		if (context) {
			context.font = `${screenStyle.fontWeight || "400"} ${fontSize}px ${screenStyle.fontFamily}`;
			const width = context.measureText("MMMMMMMMMM").width;
			if (width > 0) charWidth = width / 10;
		}

		const padX =
			(Number.parseFloat(shellStyle.paddingLeft) || 0) +
			(Number.parseFloat(shellStyle.paddingRight) || 0);
		const padY =
			(Number.parseFloat(shellStyle.paddingTop) || 0) +
			(Number.parseFloat(shellStyle.paddingBottom) || 0);

		return {
			cols: Math.max(20, Math.floor((shell.clientWidth - padX) / charWidth)),
			rows: Math.max(6, Math.floor((shell.clientHeight - padY) / lineHeight)),
		};
	}, []);

	/**
	 * 发送控制消息（**文本帧 JSON**）：`{ type: "resize", cols, rows }`。
	 * 后端收到后会 `stty rows/cols`，因此这是真实生效的窗口尺寸同步。
	 */
	const sendResize = useCallback(
		(force = false) => {
			const socket = socketRef.current;
			if (!socket || socket.readyState !== WebSocket.OPEN) return;
			const size = measure();
			if (!force && size.cols === sizeRef.current.cols && size.rows === sizeRef.current.rows) {
				return;
			}
			sizeRef.current = size;
			socket.send(JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows }));
		},
		[measure],
	);

	const scheduleReconnect = useCallback(() => {
		if (disposedRef.current || !autoReconnectRef.current) return;
		if (reconnectTimerRef.current !== null) return;
		attemptRef.current += 1;
		setAttempt(attemptRef.current);
		const delay = Math.min(15_000, 1_500 * 2 ** Math.min(attemptRef.current - 1, 4));
		reconnectTimerRef.current = window.setTimeout(() => {
			reconnectTimerRef.current = null;
			connectRef.current();
		}, delay);
	}, []);

	const connect = useCallback(
		async (epoch: number) => {
			const stale = () => disposedRef.current || epochRef.current !== epoch;
			if (stale()) return;

			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}

			// 主动丢弃旧连接（重连时 ticket 与 shell 都是新的）。
			const previous = socketRef.current;
			socketRef.current = null;
			if (previous) {
				previous.onopen = null;
				previous.onmessage = null;
				previous.onerror = null;
				previous.onclose = null;
				try {
					previous.close(1000, "reconnect");
				} catch {
					/* 关闭异常不影响新建连接。 */
				}
			}

			lastErrorRef.current = null;
			const firstAttempt = attemptRef.current === 0;
			setStatus(firstAttempt ? "authorizing" : "reconnecting");
			setDetail(
				firstAttempt
					? "正在申请一次性终端 ticket（POST /api/admin/terminal/session）…"
					: `正在第 ${attemptRef.current} 次重连（重新申请 ticket）…`,
			);

			// ── 逃生舱 1：一次性 HttpOnly ticket cookie ──────────────────────────
			try {
				await client.adminHttp.post("/terminal/session");
			} catch (error) {
				if (stale()) return;
				setStatus("error");
				setDetail(`申请终端会话失败：${errorText(error)}`);
				scheduleReconnect();
				return;
			}
			if (stale()) return;

			setStatus("connecting");
			setDetail("ticket 已签发，正在升级 WebSocket（GET /api/admin/terminal/ws）…");

			// ── 逃生舱 2：原生 WebSocket ────────────────────────────────────────
			let socket: WebSocket;
			try {
				socket = new WebSocket(wsUrl);
			} catch (error) {
				setStatus("error");
				setDetail(`无法建立 WebSocket：${errorText(error)}`);
				scheduleReconnect();
				return;
			}
			socket.binaryType = "arraybuffer";
			socketRef.current = socket;

			socket.onopen = () => {
				if (stale()) {
					socket.close(1000, "disposed");
					return;
				}
				attemptRef.current = 0;
				setAttempt(0);
				setStatus("connected");
				setDetail("已连接。后端在 PTY 中运行 login shell；点击下方区域后即可输入。");
				// 连上后立刻同步一次尺寸（force，保证后端 stty 生效）。
				sendResize(true);
			};

			socket.onmessage = (event: MessageEvent<string | ArrayBuffer | Blob>) => {
				if (stale()) return;
				const data = event.data;
				if (typeof data === "string") {
					appendText(data);
					return;
				}
				if (data instanceof ArrayBuffer) {
					appendBytes(new Uint8Array(data));
					return;
				}
				if (typeof Blob !== "undefined" && data instanceof Blob) {
					void data.arrayBuffer().then((buffer) => {
						if (!stale()) appendBytes(new Uint8Array(buffer));
					});
				}
			};

			socket.onerror = () => {
				if (stale()) return;
				const message =
					"WebSocket 发生错误：可能是 ticket 过期、连接被中断，或反向代理没有转发 upgrade" +
					"（Vite 开发服务器需要为该代理开启 ws，生产由网关直接升级）。";
				lastErrorRef.current = message;
				setStatus("error");
				setDetail(message);
			};

			socket.onclose = (event) => {
				if (socketRef.current === socket) socketRef.current = null;
				if (stale()) return;
				const reason = event.reason ? ` · ${event.reason}` : "";
				const cause = lastErrorRef.current ? ` ${lastErrorRef.current}` : "";
				setStatus("closed");
				setDetail(
					`连接已关闭（code ${event.code}${reason}）。${cause}${
						autoReconnectRef.current ? " 将自动重连。" : ""
					}`,
				);
				scheduleReconnect();
			};
		},
		[appendBytes, appendText, client, scheduleReconnect, sendResize, wsUrl],
	);

	useEffect(() => {
		connectRef.current = () => {
			void connect(epochRef.current);
		};
	}, [connect]);

	// 挂载即连接；**卸载（离开路由 / 关闭页面）必须关闭 WebSocket 并清掉重连定时器**。
	useEffect(() => {
		epochRef.current += 1;
		const epoch = epochRef.current;
		disposedRef.current = false;
		void connect(epoch);
		return () => {
			disposedRef.current = true;
			epochRef.current += 1;
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
			const socket = socketRef.current;
			socketRef.current = null;
			if (socket) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				try {
					socket.close(1000, "页面已离开");
				} catch {
					/* 已经关闭的连接无需处理。 */
				}
			}
		};
	}, [connect]);

	// 容器尺寸变化 → 计算行列并发送 `{ type: "resize" }` 控制消息。
	useEffect(() => {
		const shell = shellRef.current;
		if (!shell || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => sendResize());
		observer.observe(shell);
		return () => observer.disconnect();
	}, [sendResize]);

	// 有新输出时把终端滚到底部。
	useEffect(() => {
		const shell = shellRef.current;
		if (shell) shell.scrollTop = shell.scrollHeight;
	}, [output]);

	useEffect(() => {
		autoReconnectRef.current = autoReconnect;
	}, [autoReconnect]);

	const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
		const socket = socketRef.current;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			// 限流，避免断线时连续按键刷屏。
			const now = Date.now();
			if (now - lastWarnAtRef.current > 2_000) {
				lastWarnAtRef.current = now;
				toast.warn("终端未连接", "当前按键没有发送；可先点击「重新连接」。");
			}
			return;
		}

		let payload: string | null = null;
		if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
			// Ctrl+A..Ctrl+Z → 0x01..0x1A；Ctrl+[ → ESC；Ctrl+\ → 0x1C…
			const code = event.key.toUpperCase().charCodeAt(0);
			if (code >= 64 && code <= 95) payload = String.fromCharCode(code - 64);
		} else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
			const sequence = KEY_SEQUENCES[event.key];
			if (sequence) payload = sequence;
			else if (event.key.length === 1) payload = event.key;
		}

		if (payload === null) return;
		event.preventDefault();
		// 终端数据走**二进制帧**（后端 Message::Binary 直接写入 shell stdin）。
		socket.send(KEY_ENCODER.encode(payload));
	};

	const disconnect = () => {
		autoReconnectRef.current = false;
		setAutoReconnect(false);
		if (reconnectTimerRef.current !== null) {
			window.clearTimeout(reconnectTimerRef.current);
			reconnectTimerRef.current = null;
		}
		const socket = socketRef.current;
		socketRef.current = null;
		if (socket) {
			socket.onopen = null;
			socket.onmessage = null;
			socket.onerror = null;
			socket.onclose = null;
			try {
				socket.close(1000, "手动断开");
			} catch {
				/* 已断开。 */
			}
		}
		setStatus("closed");
		setDetail("已手动断开连接。重新连接会重新申请一次性 ticket。");
	};

	const reconnectNow = () => {
		attemptRef.current = 0;
		setAttempt(0);
		disposedRef.current = false;
		void connect(epochRef.current);
	};

	const view = STATUS_VIEW[status];

	return (
		<div className="xz-page xz-page--wide">
			<header className="xz-page__head">
				<div>
					<h1 className="xz-page__title">Web 终端</h1>
					<p className="xz-page__desc">
						在 API 容器内打开一个真实 PTY shell（后端按 fish → zsh → bash → sh 顺序选择）。
						终端会话由一次性 ticket 授权，输入输出都是真实字节流，不做任何模拟。
					</p>
				</div>
			</header>

			<Banner tone="warn" title="本页使用了文档化逃生舱（不是 SDK 门面能力）">
				SDK 没有终端抽象（CAPABILITY-MATRIX 记录的 class B 缺口），因此这里用{" "}
				<code className="xz-code">client.adminHttp</code> + 原生{" "}
				<code className="xz-code">WebSocket</code>：先{" "}
				<code className="xz-code">POST /api/admin/terminal/session</code> 取一次性 HttpOnly ticket
				cookie（token 只走 Authorization 头，绝不进 URL），再升级{" "}
				<code className="xz-code">GET /api/admin/terminal/ws</code>。WebSocket 地址由{" "}
				<code className="xz-code">useRuntime().client.adminBaseUrl</code> 推导（http→ws / https→wss），
				没有硬编码 <code className="xz-code">/api/admin</code>。
			</Banner>

			<Card>
				<CardHead
					title="会话"
					icon="terminal"
					sub={<Badge tone={view.tone}>{view.label}</Badge>}
					actions={
						<>
							<CopyButton value={output} label="复制全部输出" />
							<Button
								size="sm"
								icon="refresh"
								disabled={status === "authorizing" || status === "connecting"}
								onClick={reconnectNow}
							>
								重新连接
							</Button>
							<Button size="sm" variant="quiet" icon="stop" onClick={disconnect}>
								断开
							</Button>
						</>
					}
				/>
				<CardBody>
					<div className="xz-inf-term__bar">
						<Switch
							checked={autoReconnect}
							label="自动重连"
							onChange={(next) => {
								autoReconnectRef.current = next;
								setAutoReconnect(next);
							}}
						/>
						<span className="xz-xs xz-muted">自动重连</span>
						{attempt > 0 ? <Badge tone="warn">已重试 {attempt} 次</Badge> : null}
						<span className="xz-inf-term__url" title={wsUrl}>
							WebSocket：{wsUrl}
						</span>
					</div>

					{status !== "connected" ? (
						<Banner
							tone={status === "error" ? "danger" : status === "closed" ? "warn" : "info"}
							title={view.label}
						>
							{detail}
						</Banner>
					) : null}

					<div className="xz-inf-term" onClick={() => screenRef.current?.focus()}>
						<div className="xz-term" ref={shellRef}>
							<pre
								ref={screenRef}
								className="xz-inf-term__screen"
								tabIndex={0}
								aria-label="终端输入与输出（点击后输入）"
								onKeyDown={onKeyDown}
							>
								{output || <span className="xz-term__hint">{detail}</span>}
							</pre>
						</div>
					</div>

					<p className="xz-xs xz-muted" style={{ marginTop: "var(--xz-sp-3)", marginBottom: 0 }}>
						点击终端区域获取键盘焦点后即可输入（依赖远端 PTY 回显；本地不做回显）。
					</p>
				</CardBody>
			</Card>

			<Card className="xz-inf-create">
				<CardHead title="实现边界（如实说明）" icon="info" />
				<CardBody>
					<ul className="xz-inf-term__notes">
						<li>
							未引入 xterm.js（本前端禁止新增依赖），这里是{" "}
							<code className="xz-code">{"<pre>"}</code> + 键盘事件 +{" "}
							<code className="xz-code">ResizeObserver</code> 的最小实现。
						</li>
						<li>
							ANSI 转义序列会被解析并丢弃，不做光标定位与全屏渲染：
							<code className="xz-code">vim</code> / <code className="xz-code">top</code> /{" "}
							<code className="xz-code">htop</code> 等全屏程序无法正确显示，请使用行式命令（
							<code className="xz-code">ls</code>、<code className="xz-code">cat</code>、
							<code className="xz-code">journalctl -n 50</code> 等）。
						</li>
						<li>
							本地不渲染输入字符：看到的是远端 PTY 的回显，因此{" "}
							<code className="xz-code">stty -echo</code> 的程序（如输入密码）不会在屏幕上显示任何输入。
						</li>
						<li>
							<code className="xz-code">Ctrl+C</code> 会作为 SIGINT 上送给远端，所以不能用它在终端区域内复制
							文本；请使用右上角的「复制全部输出」。
						</li>
						<li>
							输出只保留最近 {MAX_BUFFER.toLocaleString("zh-CN")} 个字符；行列数按容器尺寸与等宽字体估算，
							后端收到 resize 后会执行 <code className="xz-code">stty rows/cols</code>。
						</li>
						<li>
							离开本路由或关闭页面时会立即 <code className="xz-code">ws.close()</code>
							，同时清理重连定时器；后端在连接关闭后会终止 PTY 子进程。
						</li>
					</ul>
				</CardBody>
			</Card>

			<Card>
				<CardHead title="逃生舱明细" icon="warn" />
				<CardBody>
					<KeyValue
						items={[
							{
								k: "逃生舱 1",
								v: <code className="xz-code">{'await client.adminHttp.post("/terminal/session")'}</code>,
							},
							{
								k: "对应后端端点",
								v: (
									<>
										<code className="xz-code">POST /api/admin/terminal/session</code>
										（管理员 JWT 走 Authorization 头，签发 60 秒一次性 HttpOnly ticket cookie）
									</>
								),
							},
							{
								k: "逃生舱 2",
								v: <code className="xz-code">new WebSocket(buildWsUrl())</code>,
							},
							{
								k: "对应后端端点",
								v: (
									<>
										<code className="xz-code">GET /api/admin/terminal/ws</code>
										（升级后 stdout / stderr 走二进制帧，resize 走文本帧 JSON）
									</>
								),
							},
							{
								k: "WS URL 来源",
								v: (
									<>
										<code className="xz-code">useRuntime().client.adminBaseUrl</code> ={" "}
										<code className="xz-code">{adminBaseUrl}</code> →{" "}
										<code className="xz-code">{wsUrl}</code>
									</>
								),
							},
							{
								k: "记录依据",
								v: "AI-FRONTEND-GUIDE §5.4：B 类能力必须使用文档化逃生舱并在代码与交付说明中记录，不得臆造 SDK 方法",
							},
						]}
					/>
				</CardBody>
			</Card>
		</div>
	);
}
