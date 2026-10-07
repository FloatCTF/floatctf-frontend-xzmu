/**
 * 顶栏「实时链路」状态条 —— 有 SSE 的面板通过 `useSetLiveStatus` 注入状态，
 * Shell 只负责展示。独立成模块，避免 App ↔ Shell 的循环依赖与初始化顺序问题。
 */

import { createContext, useContext, type ReactNode } from "react";

export interface LiveStripState {
	/** 展示文案，例如「AWD 实时 · 第 3 轮」。 */
	label: string;
	/** `SseConnectionState` 的 state 取值（或自定义）。 */
	state: string;
	/** 补充说明（连接时间 / 最近事件）。 */
	detail?: string;
}

interface LiveContextValue {
	live: LiveStripState | null;
	setLive: (value: LiveStripState | null) => void;
}

export const LiveContext = createContext<LiveContextValue>({
	live: null,
	setLive: () => undefined,
});

export function useLiveStatus(): LiveContextValue {
	return useContext(LiveContext);
}

export function LiveProvider({
	value,
	children,
}: {
	value: LiveContextValue;
	children: ReactNode;
}) {
	return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
