/**
 * 查询键约定 —— 全应用共用一份层级，保证失效（invalidate）不会漏。
 *
 * 约定：`[域, 子域, ...参数]`。前缀失效（`queryClient.invalidateQueries({ queryKey: qk.events.all })`）
 * 会命中该域全部后代，因此页面与实时事件流可以共用同一套常量。
 */

import type { QueryParams } from "@floatctf/sdk";

export const qk = {
	me: ["me"] as const,

	announcements: {
		all: ["announcements"] as const,
		list: (params?: QueryParams) => ["announcements", "list", params ?? {}] as const,
	},

	events: {
		all: ["events"] as const,
		list: (params?: QueryParams) => ["events", "list", params ?? {}] as const,
		detail: (id: string) => ["events", "detail", id] as const,
		challenges: (id: string, params?: QueryParams) => ["events", "challenges", id, params ?? {}] as const,
		instances: (id: string) => ["events", "instances", id] as const,
		scoreboard: (id: string) => ["events", "scoreboard", id] as const,
		trend: (id: string) => ["events", "trend", id] as const,
		announcements: (id: string) => ["events", "announcements", id] as const,
		ownWp: (id: string) => ["events", "own-wp", id] as const,
	},

	challenges: {
		all: ["challenges"] as const,
		list: (params?: QueryParams) => ["challenges", "list", params ?? {}] as const,
		detail: (id: string) => ["challenges", "detail", id] as const,
		instance: (id: string) => ["challenges", "instance", id] as const,
		myWriteup: (id: string) => ["challenges", "my-writeup", id] as const,
		writeups: (id: string) => ["challenges", "writeups", id] as const,
		sets: ["challenges", "sets"] as const,
		set: (id: string) => ["challenges", "set", id] as const,
	},

	instances: {
		all: ["instances"] as const,
		list: (params?: QueryParams) => ["instances", "list", params ?? {}] as const,
	},

	writeups: {
		all: ["writeups"] as const,
		list: (params?: QueryParams) => ["writeups", "list", params ?? {}] as const,
		detail: (id: string) => ["writeups", "detail", id] as const,
	},

	solves: {
		all: ["solves"] as const,
		list: (params?: QueryParams) => ["solves", "list", params ?? {}] as const,
		top15: ["solves", "top15"] as const,
	},

	discussions: {
		all: ["discussions"] as const,
		list: (params?: QueryParams) => ["discussions", "list", params ?? {}] as const,
		detail: (id: string) => ["discussions", "detail", id] as const,
		comments: (id: string, params?: QueryParams) => ["discussions", "comments", id, params ?? {}] as const,
	},

	weapons: {
		all: ["weapons"] as const,
		list: (params?: QueryParams) => ["weapons", "list", params ?? {}] as const,
	},

	awd: {
		player: (eventId: string) => ["awd", "player", eventId] as const,
		status: (eventId: string) => ["awd", "player", eventId, "status"] as const,
		gameboxes: (eventId: string) => ["awd", "player", eventId, "gameboxes"] as const,
		scores: (eventId: string) => ["awd", "player", eventId, "scores"] as const,
		wireguard: (eventId: string) => ["awd", "player", eventId, "wireguard"] as const,
		ssh: (eventId: string) => ["awd", "player", eventId, "ssh"] as const,
		adminStatus: (eventId: string) => ["awd", "admin", eventId, "status"] as const,
		adminPrechecks: (eventId: string) => ["awd", "admin", eventId, "prechecks"] as const,
		adminScores: (eventId: string) => ["awd", "admin", eventId, "scores"] as const,
		adminNetwork: (eventId: string) => ["awd", "admin", eventId, "network"] as const,
		adminEventGameboxes: (eventId: string) => ["awd", "admin", eventId, "gameboxes"] as const,
		gameboxLibrary: (params?: QueryParams) => ["awd", "library", params ?? {}] as const,
		platformNetwork: ["awd", "platform-network"] as const,
		platformNetworkHealth: ["awd", "platform-network", "health"] as const,
		platformNetworkAllocations: ["awd", "platform-network", "allocations"] as const,
	},

	awdp: {
		all: ["awdp"] as const,
		overview: (eventId: string) => ["awdp", "event", eventId, "overview"] as const,
		instance: (eventId: string, egId: string) => ["awdp", "event", eventId, "instance", egId] as const,
		rounds: (eventId: string) => ["awdp", "event", eventId, "rounds"] as const,
		evaluations: (eventId: string) => ["awdp", "event", eventId, "evaluations"] as const,
		scores: (eventId: string) => ["awdp", "event", eventId, "scores"] as const,
		scoreboard: (eventId: string) => ["awdp", "event", eventId, "scoreboard"] as const,
		trend: (eventId: string) => ["awdp", "event", eventId, "trend"] as const,
		config: (eventId: string) => ["awdp", "admin", eventId, "config"] as const,
		adminGameboxes: (eventId: string) => ["awdp", "admin", eventId, "gameboxes"] as const,
		adminInstances: (eventId: string) => ["awdp", "admin", eventId, "instances"] as const,
		adminScores: (eventId: string) => ["awdp", "admin", eventId, "scores"] as const,
		adminData: (eventId: string) => ["awdp", "admin", eventId, "data"] as const,
	},

	training: {
		all: ["training"] as const,
		catalog: (params?: QueryParams) => ["training", "catalog", params ?? {}] as const,
		run: (runId: string) => ["training", "run", runId] as const,
		rounds: (runId: string) => ["training", "run", runId, "rounds"] as const,
		evaluations: (runId: string) => ["training", "run", runId, "evaluations"] as const,
		scores: (runId: string) => ["training", "run", runId, "scores"] as const,
		writeup: (runId: string) => ["training", "run", runId, "writeup"] as const,
		instance: (runId: string, gameboxId: string) =>
			["training", "run", runId, "instance", gameboxId] as const,
	},

	admin: {
		dashboard: ["admin", "dashboard"] as const,
		systemMonitor: ["admin", "system", "monitor"] as const,
		version: ["admin", "system", "version"] as const,
		users: (params?: QueryParams) => ["admin", "users", params ?? {}] as const,
		superAdmins: (params?: QueryParams) => ["admin", "super-admins", params ?? {}] as const,
		settings: ["admin", "settings"] as const,
		logs: (params?: QueryParams) => ["admin", "logs", params ?? {}] as const,
		scheduledTasks: (params?: QueryParams) => ["admin", "scheduled-tasks", params ?? {}] as const,
		events: (params?: QueryParams) => ["admin", "events", params ?? {}] as const,
		event: (id: string) => ["admin", "events", "detail", id] as const,
		eventData: (id: string) => ["admin", "events", "data", id] as const,
		eventReport: (id: string) => ["admin", "events", "report", id] as const,
		eventChallenges: (id: string, params?: QueryParams) =>
			["admin", "events", id, "challenges", params ?? {}] as const,
		eventUsers: (id: string, params?: QueryParams) => ["admin", "events", id, "users", params ?? {}] as const,
		eventTeams: (id: string) => ["admin", "events", id, "teams"] as const,
		eventAnnouncements: (id: string, params?: QueryParams) =>
			["admin", "events", id, "announcements", params ?? {}] as const,
		eventLogs: (id: string, params?: QueryParams) => ["admin", "events", id, "logs", params ?? {}] as const,
		eventWriteups: (id: string, params?: QueryParams) =>
			["admin", "events", id, "writeups", params ?? {}] as const,
		eventInstances: (id: string, params?: QueryParams) =>
			["admin", "events", id, "instances", params ?? {}] as const,
		challenges: (params?: QueryParams) => ["admin", "challenges", params ?? {}] as const,
		challengeSets: (params?: QueryParams) => ["admin", "challenge-sets", params ?? {}] as const,
		challengeSet: (id: string, params?: QueryParams) =>
			["admin", "challenge-sets", id, params ?? {}] as const,
		announcements: (params?: QueryParams) => ["admin", "announcements", params ?? {}] as const,
		discussions: (params?: QueryParams) => ["admin", "discussions", params ?? {}] as const,
		discussion: (id: string) => ["admin", "discussions", id] as const,
		discussionComments: (id: string, params?: QueryParams) =>
			["admin", "discussions", id, "comments", params ?? {}] as const,
		weapons: (params?: QueryParams) => ["admin", "weapons", params ?? {}] as const,
		containers: (params?: QueryParams) => ["admin", "docker", "containers", params ?? {}] as const,
		images: (params?: QueryParams) => ["admin", "docker", "images", params ?? {}] as const,
		networks: (params?: QueryParams) => ["admin", "docker", "networks", params ?? {}] as const,
	},
} as const;
