import type { PageDef } from "../../router/pages.ts";
import { PlayerDashboardPage } from "./Page.tsx";

export const dashboardPages: PageDef[] = [
	{ path: "/", auth: "user", title: "总览", render: () => <PlayerDashboardPage /> },
];
