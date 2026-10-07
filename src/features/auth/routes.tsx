import { AdminLoginPage, PlayerLoginPage, RegisterPage, ResetPage, ResetRequestPage } from "./pages.tsx";
import type { PageDef } from "../../router/pages.ts";

export const authPages: PageDef[] = [
	{ path: "/login", auth: "public", title: "登录", render: () => <PlayerLoginPage /> },
	{ path: "/register", auth: "public", title: "注册", render: () => <RegisterPage /> },
	{
		path: "/reset-password",
		auth: "public",
		title: "找回密码",
		render: () => <ResetRequestPage />,
	},
	{ path: "/reset", auth: "public", title: "重置密码", render: () => <ResetPage /> },
	{ path: "/admin/login", auth: "public", title: "管理端登录", render: () => <AdminLoginPage /> },
];
