/**
 * 覆盖层：对话框 / 抽屉 / 确认框 / Toast。
 *
 * 全部自研（平台禁止在 Default 之外复用 Primer，本前端也不引入任何组件库）。
 * 统一的键盘与无障碍语义：`Esc` 关闭、焦点陷阱、`aria-modal`、关闭后焦点归还触发元素。
 * **绝不**使用原生 `alert` / `confirm` / `prompt`。
 */

import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

import { toErrorView } from "../api/errors.ts";
import { Icon } from "./icons.tsx";
import { Button, ErrorState, TextInput } from "./primitives.tsx";

/* ── 焦点陷阱 + Esc ───────────────────────────────────────────────── */

const FOCUSABLE =
	'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useFocusTrap(active: boolean, onClose: () => void) {
	const ref = useRef<HTMLDivElement | null>(null);
	const restoreTo = useRef<Element | null>(null);

	useEffect(() => {
		if (!active) return;
		restoreTo.current = document.activeElement;
		const node = ref.current;

		const focusFirst = () => {
			if (!node) return;
			const focusable = node.querySelectorAll<HTMLElement>(FOCUSABLE);
			const target = focusable[0] ?? node;
			target.focus({ preventScroll: true });
		};
		const timer = window.setTimeout(focusFirst, 0);

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
				return;
			}
			if (event.key !== "Tab" || !node) return;
			const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
				(element) => element.offsetParent !== null || element === document.activeElement,
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (!first || !last) return;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};

		document.addEventListener("keydown", onKeyDown, true);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener("keydown", onKeyDown, true);
			if (restoreTo.current instanceof HTMLElement) restoreTo.current.focus({ preventScroll: true });
		};
	}, [active, onClose]);

	return ref;
}

/* ── 对话框 ───────────────────────────────────────────────────────── */

export interface ModalProps {
	open: boolean;
	onClose: () => void;
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	footer?: ReactNode;
	size?: "md" | "wide" | "xl";
	tone?: "default" | "danger";
	/** 关闭时是否禁止点击遮罩（表单进行中时用）。 */
	persistent?: boolean;
}

export function Modal({
	open,
	onClose,
	title,
	description,
	children,
	footer,
	size = "md",
	tone = "default",
	persistent,
}: ModalProps) {
	const titleId = useId();
	const descId = useId();
	const trapRef = useFocusTrap(open, onClose);

	if (!open) return null;

	return (
		<div
			className="xz-modal-scrim"
			onMouseDown={(event) => {
				if (persistent) return;
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div
				ref={trapRef}
				className={[
					"xz-modal",
					size !== "md" ? `xz-modal--${size}` : null,
					tone === "danger" ? "xz-modal--danger" : null,
				]
					.filter(Boolean)
					.join(" ")}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
				aria-describedby={description ? descId : undefined}
			>
				<header className="xz-modal__head">
					<div className="xz-grow">
						<h2 className="xz-modal__title" id={titleId}>
							{title}
						</h2>
						{description ? (
							<p className="xz-modal__desc" id={descId}>
								{description}
							</p>
						) : null}
					</div>
					<button type="button" className="xz-iconbtn" aria-label="关闭" onClick={onClose}>
						<Icon name="close" size={17} />
					</button>
				</header>
				{children ? <div className="xz-modal__body">{children}</div> : null}
				{footer ? <footer className="xz-modal__foot">{footer}</footer> : null}
			</div>
		</div>
	);
}

/* ── 抽屉 ─────────────────────────────────────────────────────────── */

export function Drawer({
	open,
	onClose,
	title,
	subtitle,
	children,
	footer,
}: {
	open: boolean;
	onClose: () => void;
	title: ReactNode;
	subtitle?: ReactNode;
	children: ReactNode;
	footer?: ReactNode;
}) {
	const trapRef = useFocusTrap(open, onClose);
	if (!open) return null;

	return (
		<>
			<div className="xz-drawer-scrim" onMouseDown={onClose} />
			<aside ref={trapRef} className="xz-drawer" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "详情"}>
				<header className="xz-drawer__head">
					<div className="xz-grow">
						<div className="xz-drawer__title">{title}</div>
						{subtitle ? <div className="xz-muted xz-xs" style={{ marginTop: 4 }}>{subtitle}</div> : null}
					</div>
					<button type="button" className="xz-iconbtn" aria-label="关闭" onClick={onClose}>
						<Icon name="close" size={17} />
					</button>
				</header>
				<div className="xz-drawer__body">{children}</div>
				{footer ? <footer className="xz-drawer__foot">{footer}</footer> : null}
			</aside>
		</>
	);
}

/* ── 确认框 ───────────────────────────────────────────────────────── */

export interface ConfirmOptions {
	title: ReactNode;
	description?: ReactNode;
	/** 破坏性操作的后果说明（例如「将扣除 10 分」）。 */
	consequences?: ReactNode;
	confirmText?: string;
	cancelText?: string;
	tone?: "default" | "danger";
	/**
	 * 高风险操作：要求用户**逐字输入**该确认词后才可提交
	 * （归档赛事 / 删除用户 / 执行 SQL 等）。字符串通常是实体名。
	 */
	confirmPhrase?: string;
}

interface ConfirmState extends ConfirmOptions {
	resolve: (ok: boolean) => void;
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<ConfirmState | null>(null);
	const [phrase, setPhrase] = useState("");
	const [busy, setBusy] = useState(false);

	const confirm = useCallback(
		(options: ConfirmOptions) =>
			new Promise<boolean>((resolve) => {
				setPhrase("");
				setBusy(false);
				setState({ ...options, resolve });
			}),
		[],
	);

	const settle = useCallback(
		(ok: boolean) => {
			setState((current) => {
				current?.resolve(ok);
				return null;
			});
		},
		[],
	);

	const value = useMemo(() => confirm, [confirm]);
	const phraseOk = !state?.confirmPhrase || phrase.trim() === state.confirmPhrase;

	return (
		<ConfirmContext.Provider value={value}>
			{children}
			<Modal
				open={state !== null}
				onClose={() => settle(false)}
				tone={state?.tone === "danger" ? "danger" : "default"}
				title={state?.title ?? ""}
				description={state?.description}
				footer={
					<>
						<Button variant="quiet" onClick={() => settle(false)}>
							{state?.cancelText ?? "取消"}
						</Button>
						<Button
							variant={state?.tone === "danger" ? "danger" : "primary"}
							disabled={!phraseOk || busy}
							loading={busy}
							onClick={() => {
								if (busy) return;
								setBusy(true);
								settle(true);
							}}
						>
							{state?.confirmText ?? "确认"}
						</Button>
					</>
				}
			>
				{state?.consequences ? (
					<div className={`xz-banner xz-banner--${state.tone === "danger" ? "danger" : "warn"}`} style={{ marginBottom: 16 }}>
						<Icon name="warn" size={17} />
						<div className="xz-banner__body">{state.consequences}</div>
					</div>
				) : null}
				{state?.confirmPhrase ? (
					<div className="xz-field">
						<label className="xz-field__label" htmlFor="xz-confirm-phrase">
							请输入 <code className="xz-code">{state.confirmPhrase}</code> 以确认
						</label>
						<TextInput
							id="xz-confirm-phrase"
							value={phrase}
							autoComplete="off"
							onChange={(event) => setPhrase(event.target.value)}
						/>
					</div>
				) : null}
			</Modal>
		</ConfirmContext.Provider>
	);
}

export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
	const value = useContext(ConfirmContext);
	if (!value) throw new Error("useConfirm 必须在 <ConfirmProvider> 内使用");
	return value;
}

/* ── Toast ────────────────────────────────────────────────────────── */

type ToastTone = "success" | "error" | "warn" | "info";

interface ToastItem {
	id: number;
	tone: ToastTone;
	title: string;
	message?: string;
}

interface ToastApi {
	success: (title: string, message?: string) => void;
	error: (title: string, message?: string) => void;
	warn: (title: string, message?: string) => void;
	info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
	const [items, setItems] = useState<ToastItem[]>([]);
	const counter = useRef(0);

	const push = useCallback((tone: ToastTone, title: string, message?: string) => {
		counter.current += 1;
		const id = counter.current;
		setItems((current) => [...current, { id, tone, title, message }]);
		window.setTimeout(() => {
			setItems((current) => current.filter((item) => item.id !== id));
		}, tone === "error" ? 8000 : 4200);
	}, []);

	const api = useMemo<ToastApi>(
		() => ({
			success: (title, message) => push("success", title, message),
			error: (title, message) => push("error", title, message),
			warn: (title, message) => push("warn", title, message),
			info: (title, message) => push("info", title, message),
		}),
		[push],
	);

	return (
		<ToastContext.Provider value={api}>
			{children}
			<div className="xz-toasts" aria-live="polite" aria-atomic="false">
				{items.map((item) => (
					<div key={item.id} className={`xz-toast xz-toast--${item.tone}`} role={item.tone === "error" ? "alert" : "status"}>
						<Icon
							name={item.tone === "success" ? "check" : item.tone === "error" ? "alert" : item.tone === "warn" ? "warn" : "info"}
							size={17}
						/>
						<div className="xz-grow">
							<div className="xz-toast__title">{item.title}</div>
							{item.message ? <div className="xz-toast__msg">{item.message}</div> : null}
						</div>
						<button
							type="button"
							className="xz-iconbtn"
							aria-label="关闭提示"
							onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
						>
							<Icon name="close" size={14} />
						</button>
					</div>
				))}
			</div>
		</ToastContext.Provider>
	);
}

export function useToast(): ToastApi {
	const value = useContext(ToastContext);
	if (!value) throw new Error("useToast 必须在 <ToastProvider> 内使用");
	return value;
}

/* ── 查询三态包装 ─────────────────────────────────────────────────── */

export function QueryBoundary({
	isPending,
	isError,
	error,
	refetch,
	loadingLabel,
	children,
}: {
	isPending: boolean;
	isError: boolean;
	error: unknown;
	refetch?: () => void;
	loadingLabel?: ReactNode;
	children: ReactNode;
}) {
	if (isPending) {
		return (
			<div className="xz-state" role="status">
				<span className="xz-spinner" />
				<div className="xz-state__desc">{loadingLabel ?? "正在加载…"}</div>
			</div>
		);
	}
	if (isError) {
		// 错误文案的唯一来源是 api/errors.ts（它只依赖 SDK 的公开字段，无循环依赖）。
		const view = toErrorView(error);
		return (
			<ErrorState
				title={view.title}
				message={view.message}
				retryable={view.retryable}
				onRetry={refetch}
				detail={view.detail}
			/>
		);
	}
	return <>{children}</>;
}
