/**
 * 会话状态 —— **归本前端所有**。
 *
 * SDK 从不触碰 `localStorage`、从不导航（AI-FRONTEND-GUIDE §6）。本模块负责：
 * - 两个**互相独立**的 token 作用域（选手 `user` / 管理员 `admin`）；
 * - 持久化策略（localStorage，读写都做异常兜底）；
 * - 通过 `useSyncExternalStore` 暴露给 React。
 *
 * 安全约定：token **绝不**进入 URL / query string；日志与界面也绝不回显 token。
 * 注意 `Users` 实体带 `password` 字段：它只用于类型完整，**任何界面都不得渲染**。
 */

import type { Users } from "@floatctf/sdk/entity";
import { useSyncExternalStore } from "react";

const USER_TOKEN_KEY = "xzmu.user.token";
const ADMIN_TOKEN_KEY = "xzmu.admin.token";

export type AuthScope = "user" | "admin";

export interface AuthSnapshot {
	userToken: string | null;
	adminToken: string | null;
	/** 当前选手资料（会话恢复后填充）；未登录为 null。 */
	me: Users | null;
	/** `/users/me` 是否已完成一次校验。 */
	sessionChecked: boolean;
}

function readStored(key: string): string | null {
	try {
		const value = window.localStorage.getItem(key);
		return value && value.length > 0 ? value : null;
	} catch {
		return null;
	}
}

function writeStored(key: string, value: string | null): void {
	try {
		if (value === null) window.localStorage.removeItem(key);
		else window.localStorage.setItem(key, value);
	} catch {
		/* 隐私模式 / 配额不足：退化为仅内存会话，不阻断使用。 */
	}
}

let snapshot: AuthSnapshot = {
	userToken: typeof window === "undefined" ? null : readStored(USER_TOKEN_KEY),
	adminToken: typeof window === "undefined" ? null : readStored(ADMIN_TOKEN_KEY),
	me: null,
	sessionChecked: false,
};

const listeners = new Set<() => void>();

function setSnapshot(patch: Partial<AuthSnapshot>): void {
	snapshot = { ...snapshot, ...patch };
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function getSnapshot(): AuthSnapshot {
	return snapshot;
}

/** 供 SDK 的 `getUserToken` / `getAdminToken` 使用（SDK 只问“当前 token 是什么”）。 */
export function getUserToken(): string | null {
	return snapshot.userToken;
}

export function getAdminToken(): string | null {
	return snapshot.adminToken;
}

export function setUserToken(token: string | null): void {
	writeStored(USER_TOKEN_KEY, token);
	setSnapshot({ userToken: token, ...(token === null ? { me: null, sessionChecked: false } : {}) });
}

export function setAdminToken(token: string | null): void {
	writeStored(ADMIN_TOKEN_KEY, token);
	setSnapshot({ adminToken: token });
}

export function setMe(me: Users | null): void {
	setSnapshot({ me, sessionChecked: true });
}

export function clearScope(scope: AuthScope): void {
	if (scope === "admin") setAdminToken(null);
	else setUserToken(null);
}

export function clearAll(): void {
	setUserToken(null);
	setAdminToken(null);
}

export function useAuth(): AuthSnapshot {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useMe(): Users | null {
	return useAuth().me;
}

export function useIsUserAuthed(): boolean {
	return useAuth().userToken !== null;
}

export function useIsAdminAuthed(): boolean {
	return useAuth().adminToken !== null;
}

/** 供非 React 代码（路由守卫、SSE 装配）读取当前快照。 */
export function readAuth(): AuthSnapshot {
	return snapshot;
}
