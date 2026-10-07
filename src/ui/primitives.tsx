/**
 * 设计系统基元 —— 全部自研，不使用任何第三方组件库。
 * 样式在 `src/styles/components.css`，本文件只负责结构与可访问性语义。
 */

import {
	type ButtonHTMLAttributes,
	type CSSProperties,
	type ChangeEvent,
	type InputHTMLAttributes,
	type ReactNode,
	type SelectHTMLAttributes,
	type TextareaHTMLAttributes,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";

import { Icon, type IconName } from "./icons.tsx";

/* ── 按钮 ─────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "ghost" | "quiet" | "gold" | "danger" | "danger-ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: "sm" | "md" | "lg";
	block?: boolean;
	loading?: boolean;
	icon?: IconName | string;
}

export function Button({
	variant = "ghost",
	size = "md",
	block,
	loading,
	icon,
	children,
	className,
	disabled,
	...rest
}: ButtonProps) {
	const classes = [
		"xz-btn",
		`xz-btn--${variant}`,
		size !== "md" ? `xz-btn--${size}` : null,
		block ? "xz-btn--block" : null,
		className,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<button
			type="button"
			className={classes}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			{...rest}
		>
			{loading ? <span className="xz-btn__spinner" aria-hidden="true" /> : null}
			{!loading && icon ? <Icon name={icon} size={15} /> : null}
			{children}
		</button>
	);
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	icon: IconName | string;
	/** 无障碍标签（图标按钮必须提供）。 */
	label: string;
	size?: number;
}

export function IconButton({ icon, label, size = 17, className, ...rest }: IconButtonProps) {
	return (
		<button
			type="button"
			className={["xz-iconbtn", className].filter(Boolean).join(" ")}
			title={label}
			aria-label={label}
			{...rest}
		>
			<Icon name={icon} size={size} />
		</button>
	);
}

/* ── 卡片 ─────────────────────────────────────────────────────────── */

export function Card({
	children,
	className,
	flat,
	tight,
	style,
}: {
	children: ReactNode;
	className?: string;
	flat?: boolean;
	tight?: boolean;
	style?: CSSProperties;
}) {
	return (
		<section
			className={["xz-card", flat ? "xz-card--flat" : null, tight ? "xz-card--tight" : null, className]
				.filter(Boolean)
				.join(" ")}
			style={style}
		>
			{children}
		</section>
	);
}

export function CardHead({
	title,
	sub,
	icon,
	actions,
	children,
}: {
	title?: ReactNode;
	sub?: ReactNode;
	icon?: IconName | string;
	actions?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<header className="xz-card__head">
			{title ? (
				<h2 className="xz-card__title">
					{icon ? <Icon name={icon} size={16} /> : null}
					{title}
					{sub ? <span className="xz-card__sub">{sub}</span> : null}
				</h2>
			) : null}
			{children}
			{actions ? <div className="xz-card__actions">{actions}</div> : null}
		</header>
	);
}

export function CardBody({ children, flush }: { children: ReactNode; flush?: boolean }) {
	return <div className={["xz-card__body", flush ? "xz-card__body--flush" : null].filter(Boolean).join(" ")}>{children}</div>;
}

export function CardFoot({ children }: { children: ReactNode }) {
	return <footer className="xz-card__foot">{children}</footer>;
}

/* ── 徽标 / 状态 ──────────────────────────────────────────────────── */

type BadgeTone = "neutral" | "crimson" | "gold" | "ok" | "warn" | "danger" | "info" | "solid";

export function Badge({
	children,
	tone = "neutral",
	icon,
	title,
}: {
	children: ReactNode;
	tone?: BadgeTone;
	icon?: IconName | string;
	title?: string;
}) {
	return (
		<span className={["xz-badge", tone !== "neutral" ? `xz-badge--${tone}` : null].filter(Boolean).join(" ")} title={title}>
			{icon ? <Icon name={icon} size={12} weight={2} /> : null}
			{children}
		</span>
	);
}

export function Stat({
	label,
	value,
	foot,
	icon,
	gold,
}: {
	label: ReactNode;
	value: ReactNode;
	foot?: ReactNode;
	icon?: IconName | string;
	gold?: boolean;
}) {
	return (
		<div className="xz-stat">
			<span className="xz-stat__label">
				{icon ? <Icon name={icon} size={14} /> : null}
				{label}
			</span>
			<span className={["xz-stat__value", gold ? "xz-stat__value--gold" : null].filter(Boolean).join(" ")}>
				{value}
			</span>
			{foot ? <span className="xz-stat__foot">{foot}</span> : null}
		</div>
	);
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
	return (
		<div className="xz-section__head">
			<h3 className="xz-section__title">{children}</h3>
			{actions ? <div className="xz-card__actions">{actions}</div> : null}
		</div>
	);
}

/* ── 表单字段 ─────────────────────────────────────────────────────── */

export interface FieldProps {
	label?: ReactNode;
	hint?: ReactNode;
	error?: ReactNode;
	required?: boolean;
	children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}

export function Field({ label, hint, error, required, children }: FieldProps) {
	const id = useId();
	const hintId = `${id}-hint`;
	const errorId = `${id}-error`;
	const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

	return (
		<div className="xz-field">
			{label ? (
				<label className="xz-field__label" htmlFor={id}>
					{label}
					{required ? (
						<span className="xz-field__req" aria-hidden="true">
							*
						</span>
					) : null}
				</label>
			) : null}
			{children({ id, "aria-describedby": describedBy, "aria-invalid": Boolean(error) })}
			{hint ? (
				<p className="xz-field__hint" id={hintId}>
					{hint}
				</p>
			) : null}
			{error ? (
				<p className="xz-field__error" id={errorId} role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
	return <input className={["xz-input", className].filter(Boolean).join(" ")} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return <textarea className={["xz-textarea", className].filter(Boolean).join(" ")} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
	return (
		<select className={["xz-select", className].filter(Boolean).join(" ")} {...rest}>
			{children}
		</select>
	);
}

export function Checkbox({
	label,
	checked,
	onChange,
	disabled,
}: {
	label: ReactNode;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
}) {
	const id = useId();
	return (
		<label className="xz-checkbox" htmlFor={id}>
			<input
				id={id}
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.checked)}
			/>
			{label}
		</label>
	);
}

export function Switch({
	checked,
	onChange,
	label,
	disabled,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			className="xz-switch"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onChange(!checked)}
		/>
	);
}

export function Segmented<T extends string>({
	value,
	options,
	onChange,
	ariaLabel,
}: {
	value: T;
	options: readonly { value: T; label: ReactNode }[];
	onChange: (value: T) => void;
	ariaLabel?: string;
}) {
	return (
		<div className="xz-seg" role="group" aria-label={ariaLabel}>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					className="xz-seg__item"
					aria-pressed={value === option.value}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

/* ── 三态 ─────────────────────────────────────────────────────────── */

export function Spinner({ label = "加载中" }: { label?: string }) {
	return <span className="xz-spinner" role="status" aria-label={label} />;
}

export function InlineLoading({ children = "加载中…" }: { children?: ReactNode }) {
	return (
		<div className="xz-inline-loading" role="status">
			<Spinner />
			{children}
		</div>
	);
}

export function Skeleton({ width, height = 12 }: { width?: number | string; height?: number }) {
	return <div className="xz-skeleton" style={{ width: width ?? "100%", height }} />;
}

export function EmptyState({
	title = "暂无数据",
	desc,
	icon = "folder",
	actions,
}: {
	title?: ReactNode;
	desc?: ReactNode;
	icon?: IconName | string;
	actions?: ReactNode;
}) {
	return (
		<div className="xz-state">
			<span className="xz-state__icon">
				<Icon name={icon} size={38} weight={1.4} />
			</span>
			<div className="xz-state__title">{title}</div>
			{desc ? <p className="xz-state__desc">{desc}</p> : null}
			{actions ? <div className="xz-row">{actions}</div> : null}
		</div>
	);
}

export function ErrorState({
	title = "加载失败",
	message,
	retryable,
	onRetry,
	detail,
}: {
	title?: ReactNode;
	message: ReactNode;
	retryable?: boolean;
	onRetry?: () => void;
	detail?: ReactNode;
}) {
	return (
		<div className="xz-state xz-state--error" role="alert">
			<span className="xz-state__icon">
				<Icon name="alert" size={38} weight={1.4} />
			</span>
			<div className="xz-state__title">{title}</div>
			<p className="xz-state__desc">{message}</p>
			{detail ? <p className="xz-state__desc xz-mono xz-xs">{detail}</p> : null}
			{retryable && onRetry ? (
				<div className="xz-row">
					<Button icon="refresh" onClick={onRetry}>
						重试
					</Button>
				</div>
			) : null}
		</div>
	);
}

export function Banner({
	tone = "info",
	title,
	children,
	actions,
}: {
	tone?: "info" | "warn" | "danger" | "ok";
	title?: ReactNode;
	children: ReactNode;
	actions?: ReactNode;
}) {
	const icon: IconName = tone === "ok" ? "check" : tone === "danger" ? "alert" : tone === "warn" ? "warn" : "info";
	return (
		<div className={`xz-banner xz-banner--${tone}`} role={tone === "danger" ? "alert" : "status"}>
			<Icon name={icon} size={17} />
			<div className="xz-banner__body">
				{title ? <div className="xz-banner__title">{title}</div> : null}
				<div>{children}</div>
			</div>
			{actions ? <div className="xz-row">{actions}</div> : null}
		</div>
	);
}

export function KeyValue({ items }: { items: readonly { k: ReactNode; v: ReactNode }[] }) {
	return (
		<dl className="xz-kv">
			{items.map((item, index) => (
				<div key={index} style={{ display: "contents" }}>
					<dt className="xz-kv__k">{item.k}</dt>
					<dd className="xz-kv__v" style={{ margin: 0 }}>
						{item.v}
					</dd>
				</div>
			))}
		</dl>
	);
}

export function ProgressBar({
	value,
	max = 100,
	tone = "crimson",
}: {
	value: number;
	max?: number;
	tone?: "crimson" | "gold" | "ok" | "danger";
}) {
	const percent = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
	return (
		<div className="xz-bar" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
			<div
				className={["xz-bar__fill", tone !== "crimson" ? `xz-bar__fill--${tone}` : null].filter(Boolean).join(" ")}
				style={{ width: `${percent}%` }}
			/>
		</div>
	);
}

export function Avatar({
	src,
	name,
	size,
}: {
	src?: string | null;
	name?: string | null;
	size?: "sm" | "lg";
}) {
	const classes = ["xz-avatar", size === "lg" ? "xz-avatar--lg" : null].filter(Boolean).join(" ");
	if (src) {
		return <img className={classes} src={src} alt={name ? `${name} 的头像` : "头像"} loading="lazy" />;
	}
	const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
	return (
		<span className={classes} aria-hidden="true">
			{initial}
		</span>
	);
}

/* ── 复制 ─────────────────────────────────────────────────────────── */

export function useClipboard(): [boolean, (text: string) => void] {
	const [copied, setCopied] = useState(false);
	const timer = useRef<number | null>(null);

	const copy = useCallback((text: string) => {
		const done = () => {
			setCopied(true);
			if (timer.current !== null) window.clearTimeout(timer.current);
			timer.current = window.setTimeout(() => setCopied(false), 1600);
		};
		if (navigator.clipboard?.writeText) {
			void navigator.clipboard.writeText(text).then(done, () => undefined);
			return;
		}
		// 无 Clipboard API（非安全上下文）时的兜底。
		const element = document.createElement("textarea");
		element.value = text;
		element.style.position = "fixed";
		element.style.opacity = "0";
		document.body.appendChild(element);
		element.select();
		try {
			document.execCommand("copy");
			done();
		} catch {
			/* 复制失败时保持静默——调用方仍可让用户手动选择文本。 */
		}
		document.body.removeChild(element);
	}, []);

	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		},
		[],
	);

	return [copied, copy];
}

export function CopyButton({ value, label = "复制" }: { value: string; label?: string }) {
	const [copied, copy] = useClipboard();
	return (
		<button type="button" className="xz-copybtn" onClick={() => copy(value)} title={`${label}到剪贴板`}>
			<Icon name={copied ? "check" : "copy"} size={12} />
			{copied ? "已复制" : label}
		</button>
	);
}

export function CodeBlock({ children, copyable = true }: { children: string; copyable?: boolean }) {
	return (
		<pre className="xz-codeblock">
			{copyable ? (
				<span className="xz-codeblock__copy">
					<CopyButton value={children} />
				</span>
			) : null}
			{children}
		</pre>
	);
}

/** 敏感值（密码 / 凭据）：默认模糊，点击或聚焦后显示。 */
export function Secret({ value }: { value: string }) {
	const [revealed, setRevealed] = useState(false);
	return (
		<span className="xz-cred">
			<span className="xz-secret" data-revealed={revealed} onClick={() => setRevealed((v) => !v)}>
				{value}
			</span>
			<IconButton
				icon={revealed ? "eyeOff" : "eye"}
				label={revealed ? "隐藏" : "显示"}
				size={13}
				onClick={() => setRevealed((v) => !v)}
			/>
			<CopyButton value={value} label="" />
		</span>
	);
}
