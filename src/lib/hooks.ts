/**
 * 定时重渲染（用于倒计时 / 相对时间）。返回当前时间戳。
 *
 * 只在页面可见时计时，避免后台标签页无谓唤醒。
 */

import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000): number {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		let timer: number | null = null;

		const tick = () => setNow(Date.now());
		const start = () => {
			if (timer !== null) window.clearInterval(timer);
			timer = window.setInterval(tick, intervalMs);
		};
		const stop = () => {
			if (timer !== null) window.clearInterval(timer);
			timer = null;
		};

		const onVisibility = () => {
			if (document.visibilityState === "visible") {
				tick();
				start();
			} else {
				stop();
			}
		};

		if (document.visibilityState === "visible") start();
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			stop();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [intervalMs]);

	return now;
}

/** 通用防抖值（搜索框使用）。 */
export function useDebounced<T>(value: T, delayMs = 250): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = window.setTimeout(() => setDebounced(value), delayMs);
		return () => window.clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}
