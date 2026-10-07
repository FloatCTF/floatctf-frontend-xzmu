/**
 * 展示格式化工具。
 *
 * 全部使用平台返回的原始值（时间戳字符串 / 数字），不推测、不编造：
 * 无法解析的时间一律显示 `—`，而不是伪造一个时间。
 */

const DATE_TIME = new Intl.DateTimeFormat("zh-CN", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

const DATE_ONLY = new Intl.DateTimeFormat("zh-CN", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

const TIME_ONLY = new Intl.DateTimeFormat("zh-CN", {
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});

function toDate(value: string | number | Date | null | undefined): Date | null {
	if (value === null || value === undefined || value === "") return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
	const date = toDate(value);
	return date ? DATE_TIME.format(date) : "—";
}

export function formatDate(value: string | number | Date | null | undefined): string {
	const date = toDate(value);
	return date ? DATE_ONLY.format(date) : "—";
}

export function formatTime(value: string | number | Date | null | undefined): string {
	const date = toDate(value);
	return date ? TIME_ONLY.format(date) : "—";
}

/** 相对时间（用于动态流水）；超过 7 天回退到绝对日期。 */
export function formatRelative(value: string | number | Date | null | undefined): string {
	const date = toDate(value);
	if (!date) return "—";
	const diff = date.getTime() - Date.now();
	const abs = Math.abs(diff);
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		["second", 1000],
		["minute", 60_000],
		["hour", 3_600_000],
		["day", 86_400_000],
	];
	const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
	if (abs < 60_000) return formatter.format(Math.round(diff / 1000), "second");
	for (let index = units.length - 1; index >= 0; index -= 1) {
		const entry = units[index];
		if (!entry) continue;
		const [unit, ms] = entry;
		if (abs >= ms || index === 0) {
			if (unit === "day" && abs > 7 * 86_400_000) return formatDateTime(date);
			return formatter.format(Math.round(diff / ms), unit);
		}
	}
	return formatDateTime(date);
}

/** 把两个时间戳之间的剩余时长格式化为 `1天 02:03:04`。 */
export function formatCountdown(target: string | number | Date | null | undefined): string {
	const date = toDate(target);
	if (!date) return "—";
	let seconds = Math.floor((date.getTime() - Date.now()) / 1000);
	const negative = seconds < 0;
	seconds = Math.abs(seconds);
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;
	const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
	return `${negative ? "-" : ""}${days > 0 ? `${days}天 ` : ""}${clock}`;
}

/** 秒数 → `1:02:03` / `02:03`。 */
export function formatSeconds(total: number | null | undefined): string {
	if (total === null || total === undefined || Number.isNaN(total)) return "—";
	const seconds = Math.max(0, Math.floor(total));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;
	const pad = (value: number) => String(value).padStart(2, "0");
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

/** 字节 → 人类可读。 */
export function formatBytes(bytes: number | null | undefined): string {
	if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—";
	const units = ["B", "KiB", "MiB", "GiB", "TiB"];
	let value = bytes;
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatNumber(value: number | null | undefined): string {
	if (value === null || value === undefined || Number.isNaN(value)) return "—";
	return new Intl.NumberFormat("zh-CN").format(value);
}

/** 平台实体名：优先昵称，退到用户名，最后是 ID 前缀。 */
export function displayName(entity: { nickname?: string | null; username?: string | null; name?: string | null; id?: string } | null | undefined): string {
	if (!entity) return "未知";
	return entity.nickname || entity.name || entity.username || (entity.id ? `${entity.id.slice(0, 8)}…` : "未知");
}

/** 赛事 / 标题的安全截断。 */
export function truncate(value: string, max = 42): string {
	return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** 把搜索关键词与字段做大小写无关匹配（列表页前端过滤用）。 */
export function matches(haystack: readonly (string | null | undefined)[], needle: string): boolean {
	const trimmed = needle.trim().toLowerCase();
	if (!trimmed) return true;
	return haystack.some((value) => (value ?? "").toLowerCase().includes(trimmed));
}
