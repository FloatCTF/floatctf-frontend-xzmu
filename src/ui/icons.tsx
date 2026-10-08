/**
 * 自研内联图标集（不引入图标库）。
 *
 * 统一 24×24 viewBox、`currentColor` 描边，继承父级字号与颜色。
 * 只用线性图标，与「信息门户左栏白色线性图标」的视觉语言一致。
 */

import type { SVGProps } from "react";

const PATHS: Record<string, string> = {
	home: "M3 10.5 12 3l9 7.5M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5",
	flag: "M5 3v18M5 4h11l-1.6 4L16 12H5",
	trophy: "M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4.5A2.5 2.5 0 0 0 7 8.5M17 6h2.5A2.5 2.5 0 0 1 17 8.5M9 20h6M12 14v6",
	shield: "M12 3 5 6v6c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z",
	sword: "m14.5 3.5 6 6-9 9-3.5.5.5-3.5 9-9ZM4 20l3-3",
	puzzle:
		"M10 4a2 2 0 1 1 4 0v1h3a1 1 0 0 1 1 1v3h1a2 2 0 1 1 0 4h-1v3a1 1 0 0 1-1 1h-3v-1a2 2 0 1 0-4 0v1H7a1 1 0 0 1-1-1v-3H5a2 2 0 1 1 0-4h1V6a1 1 0 0 1 1-1h3V4Z",
	box: "m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 0v18m8-13.5-8 4.5-8-4.5",
	terminal: "m4 5 6 7-6 7M13 19h7",
	users:
		"M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 0c-3.3 0-6 2-6 4.5V20h12v-4.5C15 13 12.3 11 9 11Zm8-8a4 4 0 0 1 0 8m1 2c2.3.6 4 2.3 4 4.5V20h-4",
	user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8v-1.5C5 16 8.1 14 12 14s7 2 7 4.5V20",
	bell: "M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Zm4 9a2 2 0 0 0 4 0",
	search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.5-4.5",
	settings:
		"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a8.4 8.4 0 0 0-2-1.2L15.5 2h-4l-.4 2.6a8.4 8.4 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a8.4 8.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a8.4 8.4 0 0 0 2 1.2l.4 2.6h4l.4-2.6a8.4 8.4 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z",
	refresh: "M20 11a8 8 0 1 0-1.6 6M20 4v7h-7",
	plus: "M12 5v14M5 12h14",
	minus: "M5 12h14",
	close: "M6 6l12 12M18 6 6 18",
	check: "m5 13 4.5 4.5L19 7",
	chevronRight: "m9 5 7 7-7 7",
	chevronDown: "m5 9 7 7 7-7",
	chevronLeft: "m15 5-7 7 7 7",
	arrowUp: "M12 20V4m0 0-6 6m6-6 6 6",
	arrowDown: "M12 4v16m0 0 6-6m-6 6-6-6",
	arrowLeft: "M20 12H4m0 0 6-6m-6 6 6 6",
	external: "M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
	download: "M12 4v11m0 0 4-4m-4 4-4-4M4 19h16",
	upload: "M12 20V9m0 0 4 4m-4-4-4 4M4 5h16",
	copy: "M9 9h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Zm-4 6H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1",
	trash: "M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7m3 4v6m4-6v6",
	edit: "M4 20h4L20 8l-4-4L4 16v4Zm10-14 4 4",
	save: "M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 0v6h7V4M8 21v-6h8v6",
	filter: "M4 5h16l-6 7v6l-4 2v-8L4 5Z",
	play: "m7 4 12 8-12 8V4Z",
	stop: "M6 6h12v12H6z",
	pause: "M9 5v14M15 5v14",
	rocket: "M14 4c4 0 6 2 6 6 0 3-2.5 6-6 9l-2-2-2 2c-3.5-3-6-6-6-9 0-4 2-6 6-6h4Zm-1 5h.01",
	clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3.5 2",
	calendar: "M4 6h16v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Zm0 5h16M8 3v5m8-5v5",
	link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1",
	info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9v5m0-9h.01",
	warn: "M12 3 2 20h20L12 3Zm0 6v5m0 3h.01",
	alert: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5m0 3h.01",
	eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Zm10 2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
	eyeOff: "M4 4l16 16M9.9 5.2A9.9 9.9 0 0 1 12 5c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.4 7.6A16.6 16.6 0 0 0 2 11s3.5 6 10 6c1 0 1.9-.1 2.7-.4M10.6 10.6a2 2 0 0 0 2.8 2.8",
	lock: "M6 11V8a6 6 0 1 1 12 0v3M5 11h14v10H5V11Zm7 4v2",
	key: "M14 7a4 4 0 1 1 3.5 4l-1.7 1.7-1.6-1.6-1.4 1.4 1.6 1.6-1.4 1.4-1.6-1.6L9 16.4l1.6 1.6-1.4 1.4L4 14.2 9.6 8.6",
	globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.5 3.5 5.5 3.5 9S14.5 18.5 12 21c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3Z",
	server: "M4 4h16v6H4V4Zm0 10h16v6H4v-6Zm3-7h.01M7 17h.01",
	database: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Zm8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6m16 6c0 1.7-3.6 3-8 3s-8-1.3-8-3",
	network: "M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm-7 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm14 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 9v3m0 0H6.5a1 1 0 0 0-1 1v2M12 12h5.5a1 1 0 0 1 1 1v2",
	task: "M4 6h16M4 12h16M4 18h10",
	file: "M6 3h8l4 4v14H6V3Zm8 0v4h4",
	folder: "M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z",
	chart: "M4 20V10m5 10V4m5 16v-7m5 7V8",
	trendUp: "M4 16l5-5 3.5 3.5L20 7m0 0h-5m5 0v5",
	sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z",
	crown: "M3 18h18M4 7l4 4 4-6 4 6 4-4-2 11H6L4 7Z",
	medal: "M12 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 0v6m-3-3h6M8 3l2.5 5M16 3l-2.5 5",
	pin: "M12 21s7-6.4 7-11a7 7 0 1 0-14 0c0 4.6 7 11 7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
	menu: "M4 7h16M4 12h16M4 17h16",
	logout: "M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M11 8 7 12l4 4M7 12h9",
	login: "M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4m4-12 4 4-4 4m4-4H9",
	wrench: "M15.5 4a5 5 0 0 0-4.6 7L4 17.9 6.1 20l6.9-6.9A5 5 0 0 0 20 8.5L17 11l-2.5-2.5L17 6a5 5 0 0 0-1.5-2Z",
	target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-4.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0-3.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
	bolt: "M13 3 4 14h6l-1 7 9-11h-6l1-7Z",
	chat: "M4 5h16v11H9l-5 4V5Z",
	heart: "M12 20s-7-4.4-7-9.5A4.5 4.5 0 0 1 12 7.6 4.5 4.5 0 0 1 19 10.5c0 5.1-7 9.5-7 9.5Z",
	clipboard: "M9 4h6v3H9V4Zm-2 0H6a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1h-1M9 12h6M9 16h4",
	list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
	grid: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z",
	book: "M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5Zm3 0h9v14H7",
	cap: "M12 4 2 9l10 5 10-5-10-5Zm-6 7.5V16c0 1.7 3 3 6 3s6-1.3 6-3v-4.5",
	bulb: "M9 18h6m-5 3h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3Z",
	beaker: "M9 3h6M10 3v6L5 19a1 1 0 0 0 .9 1.5h12.2A1 1 0 0 0 19 19l-5-10V3M7 14h10",
	archive: "M3 6h18v4H3V6Zm2 4h14v10H5V10Zm4 4h6",
	flame: "M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.6.8-3 1.6-4C9.4 9.6 12 7.5 12 3Z",
	ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM5.6 5.6l12.8 12.8",
	undo: "M4 10h9a5 5 0 0 1 0 10H8m-4-10 4-4m-4 4 4 4",
	tag: "M4 4h7l9 9-7 7-9-9V4Zm3.5 3.5h.01",
	code: "m9 8-5 4 5 4m6-8 5 4-5 4",
	send: "M4 12 20 4l-8 16-2-6-6-2Z",
	star: "m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z",
	sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-14v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4",
	moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z",
	terminalSquare: "M4 4h16v16H4V4Zm4 5 3 3-3 3m6 0h4",
	layers: "m12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5",
};

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
	name: IconName | string;
	size?: number;
	/** 线宽（默认 1.7，与门户线性图标一致）。 */
	weight?: number;
}

export function Icon({ name, size = 18, weight = 1.7, ...rest }: IconProps) {
	const d = PATHS[name] ?? PATHS.info;
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={weight}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			{...rest}
		>
			<path d={d} />
		</svg>
	);
}

export function hasIcon(name: string): boolean {
	return Object.hasOwn(PATHS, name);
}
