#!/usr/bin/env node
/**
 * Generates openapi/openapi.json for Mermail Mintlify API Reference.
 * Run: node scripts/generate-openapi.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

/** Sold API auth: x-api-key only (OpenAPI apiKey in header). */
const apiKeySecurity = [{ apiKeyAuth: [] }];

const AGENT_INBOX_PROFILE_OPERATIONS = [
	{
		name: "get_api_credit_usage",
		method: "GET",
		path: "/api/v1/workspaces/{workspaceId}/usage/credits",
	},
	{
		name: "list_workspaces",
		method: "GET",
		path: "/api/v1/workspaces",
	},
	{
		name: "get_workspace",
		method: "GET",
		path: "/api/v1/workspaces/{workspaceId}",
	},
	{
		name: "list_email_domains",
		method: "GET",
		path: "/api/v1/workspaces/{workspaceId}/email-domains",
	},
	{
		name: "list_workspace_mailboxes",
		method: "GET",
		path: "/api/v1/workspaces/{workspaceId}/mailboxes",
	},
	{
		name: "list_mailboxes",
		method: "GET",
		path: "/api/v1/mailboxes",
	},
	{
		name: "create_mailbox",
		method: "POST",
		path: "/api/v1/mailboxes",
	},
	{
		name: "get_mailbox",
		method: "GET",
		path: "/api/v1/mailboxes/{mailboxId}",
	},
	{
		name: "list_emails",
		method: "GET",
		path: "/api/v1/mailboxes/{mailboxId}/emails",
	},
	{
		name: "search_emails",
		method: "GET",
		path: "/api/v1/mailboxes/{mailboxId}/search",
	},
	{
		name: "get_email",
		method: "GET",
		path: "/api/v1/mailboxes/{mailboxId}/emails/{emailId}",
	},
];

const errorSchema = { $ref: "#/components/schemas/Error" };
const errorContent = (example) => ({
	content: {
		"application/json": {
			schema: errorSchema,
			example,
		},
	},
});

const commonErrors = {
	"401": {
		description: "Missing, invalid, expired, or revoked API key / token",
		...errorContent({ error: "Unauthorized" }),
	},
	"402": {
		description: "API credits exhausted for this workspace period",
		...errorContent({ error: "Invalid request" }),
	},
	"403": {
		description: "Forbidden — plan gate, wrong workspace, or missing role",
		...errorContent({ error: "Forbidden" }),
	},
	"429": {
		description: "Rate limit exceeded (workspace RPM or email send limits)",
		...errorContent({ error: "Too many requests" }),
		headers: {
			"Retry-After": {
				schema: { type: "integer" },
				description: "Seconds until the rate limit window resets",
			},
		},
	},
};

function pathParam(name, description, example = "ws_01abc") {
	return {
		name,
		in: "path",
		required: true,
		description,
		schema: { type: "string" },
		example,
	};
}

/** Preferred route id: stable public_id, then hosted alias PK, then current email. */
const MAILBOX_ID_PARAM_DESCRIPTION =
	"Mailbox public_id (UUID), hosted alias id, or current email";
const MAILBOX_ID_PARAM_EXAMPLE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function mailboxIdParam() {
	return pathParam(
		"mailboxId",
		MAILBOX_ID_PARAM_DESCRIPTION,
		MAILBOX_ID_PARAM_EXAMPLE,
	);
}

function queryParam(name, opts = {}) {
	const {
		description = name,
		required = false,
		schema = { type: "string" },
		example,
	} = opts;
	const p = {
		name,
		in: "query",
		required,
		description,
		schema,
	};
	if (example !== undefined) p.example = example;
	return p;
}

function idempotencyKeyParam() {
	return {
		name: "Idempotency-Key",
		in: "header",
		required: false,
		description:
			"Optional key for a repeated attempt of the same mailbox create. Reuse it only for identical intent. It does not guarantee exactly-once execution; after a conflict or uncertain response, list mailboxes and resolve the exact normalized address before deciding whether to retry. Authenticated requests carrying this header have a 50 MiB request-fingerprint body limit; larger bodies return 413 `idempotency_payload_too_large` before the operation runs.",
		schema: { type: "string", minLength: 1, maxLength: 255 },
		example: "mailbox-ensure-v1-7f3a2c1b",
	};
}

function jsonBody(schema, example, required = true) {
	return {
		required,
		content: {
			"application/json": {
				schema,
				...(example !== undefined ? { example } : {}),
			},
		},
	};
}

function jsonResponse(description, schema, example) {
	return {
		description,
		content: {
			"application/json": {
				schema,
				...(example !== undefined ? { example } : {}),
			},
		},
	};
}

function op({
	summary,
	description,
	tags,
	security = apiKeySecurity,
	parameters = [],
	requestBody,
	responses,
	operationId,
	xCredits,
	deprecated,
}) {
	const out = {
		summary,
		description,
		tags,
		security,
		parameters,
		responses: { ...commonErrors, ...responses },
	};
	if (requestBody) out.requestBody = requestBody;
	if (operationId) out.operationId = operationId;
	if (xCredits != null) {
		out["x-credits"] = xCredits;
		out.description = `${description}\n\n**API credits:** ${xCredits} (${creditLabel(xCredits)}).`;
	}
	if (deprecated) out.deprecated = true;
	return out;
}

function creditLabel(n) {
	const map = {
		1: "read",
		2: "write",
		5: "email_send",
		10: "provision",
		15: "ai_light",
		25: "ai_heavy",
	};
	return map[n] ?? "custom";
}

/** Plan access for Mintlify API pages (sidebar tag + description badges). */
const PLAN_ACCESS = {
	public: {
		tag: "Public",
		plans: ["Public"],
		xBadges: [{ name: "Public", color: "grey" }],
	},
	all: {
		tag: "All plans",
		plans: ["Free", "Developer", "Enterprise"],
		xBadges: [
			{ name: "Free", color: "green" },
			{ name: "Developer", color: "blue" },
			{ name: "Enterprise", color: "purple" },
		],
	},
	developer: {
		tag: "Developer+",
		plans: ["Developer", "Enterprise"],
		xBadges: [
			{ name: "Developer", color: "blue" },
			{ name: "Enterprise", color: "purple" },
		],
	},
};

function isDeveloperGatedApiPath(pathname, method = "GET") {
	const m = method.toUpperCase();
	if (pathname.includes("/email-domains")) return true;
	if (pathname.includes("/integrations/composio")) return true;
	if (/\/workspaces\/[^/]+\/storage$/.test(pathname) && m !== "GET") {
		return true;
	}
	if (pathname.includes("/rag/credentials/")) return true;
	if (/\/rag\/documents$/.test(pathname) && m === "POST") return true;
	if (/\/rag\/documents\/[^/]+$/.test(pathname) && m === "DELETE") return true;
	if (pathname.includes("/rag/documents/") && pathname.endsWith("/verify")) {
		return true;
	}
	return false;
}

function classifyPlanAccess(pathname, method, operation) {
	const security = operation.security;
	const isPublic =
		Array.isArray(security) &&
		(security.length === 0 ||
			security.some((entry) => Object.keys(entry).length === 0));
	if (isPublic) return "public";
	if (isDeveloperGatedApiPath(pathname, method)) return "developer";
	return "all";
}

function applyPlanBadges(operation, accessKey) {
	const access = PLAN_ACCESS[accessKey] ?? PLAN_ACCESS.all;
	const planLine =
		accessKey === "public"
			? "**Plans:** `Public` (no auth)"
			: `**Plans:** ${access.plans.map((p) => `\`${p}\``).join(" · ")}`;

	const body = (operation.description ?? "").trim();
	if (!body.startsWith("**Plans:**")) {
		operation.description = body ? `${planLine}\n\n${body}` : planLine;
	}

	operation["x-badges"] = access.xBadges;
	operation["x-plan-access"] = access.plans.map((p) => p.toLowerCase());
	const title =
		typeof operation.summary === "string" && operation.summary.trim()
			? operation.summary.trim()
			: undefined;
	operation["x-mint"] = {
		...(operation["x-mint"] ?? {}),
		metadata: {
			...(operation["x-mint"]?.metadata ?? {}),
			tag: access.tag,
			...(title
				? {
						title,
						sidebarTitle: title,
					}
				: {}),
		},
	};
}

function applyPlanBadgesToPaths(pathMap) {
	const httpMethods = new Set([
		"get",
		"put",
		"post",
		"delete",
		"options",
		"head",
		"patch",
		"trace",
	]);
	for (const [pathname, item] of Object.entries(pathMap)) {
		for (const [method, operation] of Object.entries(item)) {
			if (!httpMethods.has(method)) continue;
			if (!operation || typeof operation !== "object") continue;
			applyPlanBadges(
				operation,
				classifyPlanAccess(pathname, method, operation),
			);
		}
	}
}

function slimOp({
	summary,
	description,
	tags,
	parameters = [],
	requestBody,
	xCredits = 1,
	successStatus = "200",
	successDescription = "Success",
	successSchema = { type: "object", additionalProperties: true },
	successExample,
	security = apiKeySecurity,
}) {
	return op({
		summary,
		description,
		tags,
		parameters,
		requestBody,
		xCredits,
		security,
		responses: {
			[successStatus]: jsonResponse(
				successDescription,
				successSchema,
				successExample,
			),
		},
	});
}

const workspaceExample = {
	id: "ws_01abc",
	name: "Acme Agents",
	owner_address: "0xabc123def456",
	timezone: "America/New_York",
	role: "admin",
	mailbox_count: 2,
	storage: {
		provider: "harbor_r2",
		status: "ready",
		redundancy_enabled: true,
		storage_key_status: "ready",
		storage_key_last_error: null,
		space_id: "spc_01xyz",
		bucket_id: "bkt_01xyz",
		owner_address: "0xabc123def456",
		has_api_key: true,
		has_service_private_key: true,
		harbor_provisioning_status: "ready",
		harbor_last_error: null,
		r2_bucket_name: "mermail-ws-01abc",
		r2_provisioning_status: "ready",
		r2_last_error: null,
		last_error: null,
	},
	created_at: "2026-07-01T12:00:00.000Z",
	updated_at: "2026-07-15T08:00:00.000Z",
};

const mailboxExample = {
	id: "support@mail.acme.com",
	public_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
	workspace_id: "ws_01abc",
	email: "support@mail.acme.com",
	name: "Acme Support",
	email_domain_id: "ed_01xyz",
	inbound_provider: "cloudflare_routing",
	outbound_provider: "cloudflare_email",
	provider_metadata: { domain: "mail.acme.com", provider: "resend" },
	bucket_id: "bkt_01xyz",
	settings: {
		forwarding: { enabled: false, email: "" },
		signature: { enabled: false, text: "" },
		autoReply: { enabled: false, subject: "", message: "" },
		agentAutoResponse: { requireApproval: true },
		fromName: "Acme Support",
	},
	disabled_at: null,
	disabled_reason: null,
	can_receive: true,
	receiving_status: "ready",
	welcome_onboarding_status: "pending",
};

const emailListItem = {
	id: "msg_7f3a2c1b",
	subject: "Order question",
	sender: "alice@example.com",
	recipient: "support@mail.acme.com",
	cc: null,
	bcc: null,
	date: "2026-07-14T09:00:00.000Z",
	read: false,
	starred: false,
	is_urgent: false,
	category: "customer_support",
	body: "Hi, where is my order?",
	folder_id: "INBOX",
	folder_name: "Inbox",
	thread_id: "thr_9aabb",
	snippet: "Hi, where is my order?",
	scan_status: null,
	attachments: [],
};

const paths = {};
function add(p, method, definition) {
	if (!paths[p]) paths[p] = {};
	paths[p][method] = definition;
}

// —— Public ——
add(
	"/api/status",
	"get",
	op({
		summary: "Get API health status",
		description:
			"Public health check for load balancers and uptime monitors. No authentication or credits required.",
		tags: ["Public"],
		security: [],
		responses: {
			"200": jsonResponse(
				"Service is healthy",
				{ type: "object", additionalProperties: true },
				{ ok: true },
			),
		},
	}),
);

add(
	"/api/v1/config",
	"get",
	op({
		summary: "Get public app config",
		description:
			"Returns public client configuration such as hosted domains, VAPID public key, and MemWal network settings. No authentication required.",
		tags: ["Public"],
		security: [],
		responses: {
			"200": jsonResponse(
				"Public configuration",
				{ type: "object", additionalProperties: true },
				{
					domains: ["mail.example.com"],
					vapidPublicKey: "BNpublic…",
					webPushConfigured: true,
				},
			),
		},
	}),
);

// —— Usage ——
const apiCreditUsageExample = {
	plan: "developer",
	plan_name: "Developer",
	period_start: "2026-07-01T00:00:00.000Z",
	period_end: "2026-08-01T00:00:00.000Z",
	limit: 50000,
	used: 1240,
	remaining: 48760,
};

const emailUsageExample = {
	workspace_id: "ws_01abc",
	plan: "developer",
	plan_name: "Developer",
	period_start: "2026-07-01T00:00:00.000Z",
	period_end: "2026-08-01T00:00:00.000Z",
	quota: 10000,
	used: 320,
	remaining: 9680,
	legacy_sent_count: 12,
	mailboxes: [
		{
			id: "support@mail.acme.com",
			name: "Acme Support",
			email: "support@mail.acme.com",
			sent: 200,
			providers: { cloudflare_email: 180, legacy: 20 },
		},
		{
			id: "ops@mail.acme.com",
			name: "Acme Ops",
			email: "ops@mail.acme.com",
			sent: 120,
			providers: { resend: 120 },
		},
	],
};

add(
	"/api/v1/workspaces/{workspaceId}/usage/credits",
	"get",
	op({
		summary: "Get API credit usage",
		description:
			"Returns sold-API credit usage for the current billing period (snake_case fields). Free workspaces use the UTC calendar month; paid workspaces use the subscription period. `limit` / `remaining` are `null` when the plan has unlimited credits. Requires workspace membership. This call itself costs **1** read credit.",
		tags: ["Usage"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		responses: {
			"200": jsonResponse(
				"Credit usage for the current period",
				{ $ref: "#/components/schemas/ApiCreditUsage" },
				apiCreditUsageExample,
			),
			"503": {
				description: "Paid subscription period is stale / out of range",
				...errorContent({
					error: "subscription_period_stale",
					code: "subscription_period_stale",
				}),
			},
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/usage/email",
	"get",
	op({
		summary: "Get email usage",
		description:
			"Returns outbound email send usage (recipient counts) for the workspace subscription period — distinct from API credits. Field is `quota` (not `limit`). Includes per-mailbox breakdown and `legacy_sent_count` for pre-ledger sends. Requires workspace membership.",
		tags: ["Usage"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		responses: {
			"200": jsonResponse(
				"Email send usage for the current period",
				{ $ref: "#/components/schemas/EmailUsage" },
				emailUsageExample,
			),
		},
	}),
);

// —— Workspaces ——
const workspaceMembersExample = {
	members: [
		{
			user_address: "0xabc123def456",
			email: "owner@acme.com",
			name: "Owner",
			role: "admin",
			display_role: "owner",
			created_at: "2026-07-01T12:00:00.000Z",
		},
		{
			user_address: "0xmember…",
			email: "dev@acme.com",
			name: "Dev",
			role: "member",
			display_role: "member",
			created_at: "2026-07-10T09:00:00.000Z",
		},
	],
	invites: [
		{
			id: "inv_01xyz",
			email: "new@acme.com",
			role: "member",
			invite_url: "https://console.mermail.app/invite/…",
			created_at: "2026-07-15T08:00:00.000Z",
		},
	],
};

add(
	"/api/v1/workspaces",
	"get",
	op({
		summary: "List workspaces",
		description:
			"Lists workspaces the caller can access. Response shape is `{ user, workspaces }`. With an API key (`x-api-key`), `workspaces` is limited to the **single workspace** the key is bound to.",
		tags: ["Workspaces"],
		xCredits: 1,
		responses: {
			"200": jsonResponse(
				"Workspace list",
				{ $ref: "#/components/schemas/WorkspaceListResponse" },
				{ user: { is_admin: false }, workspaces: [workspaceExample] },
			),
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}",
	"get",
	op({
		summary: "Get workspace",
		description:
			"Returns a single workspace the caller can access (includes nested `storage`). With an API key, `workspaceId` must match the key’s workspace (`403` otherwise).",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		responses: {
			"200": jsonResponse(
				"Workspace",
				{ $ref: "#/components/schemas/Workspace" },
				workspaceExample,
			),
			"404": {
				description: "Workspace not found",
				...errorContent({ error: "Workspace not found" }),
			},
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}",
	"put",
	op({
		summary: "Update workspace",
		description:
			"Updates workspace settings. Requires workspace **admin**. At least one of `name` or `timezone` is required (`timezone` may be `null` to clear). With an API key, `workspaceId` must match the key’s workspace.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: {
					name: {
						type: "string",
						minLength: 1,
						maxLength: 120,
						example: "Acme Agents",
					},
					timezone: {
						type: ["string", "null"],
						example: "America/New_York",
						description: "IANA timezone, or null to clear",
					},
				},
			},
			{ name: "Acme Agents", timezone: "America/New_York" },
		),
		responses: {
			"200": jsonResponse(
				"Updated workspace",
				{ $ref: "#/components/schemas/Workspace" },
				workspaceExample,
			),
			"400": {
				description: "Validation error (missing fields or invalid timezone)",
				...errorContent({ error: "Invalid timezone" }),
			},
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}",
	"delete",
	slimOp({
		summary: "Delete workspace",
		description:
			"Deletes a workspace and tombstones its blobs. Requires workspace **admin**. Returns **204** with an empty body.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 2,
		successStatus: "204",
		successDescription: "Deleted",
		successSchema: { type: "object" },
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/storage",
	"get",
	slimOp({
		summary: "Get workspace storage",
		description:
			"Returns Harbor / R2 storage provisioning status wrapped as `{ storage }`. Requires workspace **admin**.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		successExample: { storage: workspaceExample.storage },
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/members",
	"get",
	slimOp({
		summary: "List workspace members",
		description:
			"Returns `{ members, invites }`. `invites` (with `invite_url`) is only populated for workspace **admins**; members see an empty `invites` array. `memberId` elsewhere is the member’s `user_address` (Sui wallet).",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		successExample: workspaceMembersExample,
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/members/{memberId}",
	"put",
	op({
		summary: "Update member role",
		description:
			"Updates a member role. `memberId` is the member's Sui wallet address (`user_address`). Requires workspace **admin**. Owners cannot be demoted; the last admin cannot be demoted.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
			pathParam("memberId", "Member wallet address", "0xmember…"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["role"],
				properties: {
					role: {
						type: "string",
						enum: ["admin", "member"],
						example: "member",
					},
				},
			},
			{ role: "member" },
		),
		responses: {
			"200": jsonResponse(
				"Role updated",
				{
					type: "object",
					properties: { status: { type: "string", example: "updated" } },
				},
				{ status: "updated" },
			),
			"400": {
				description: "Protected role change",
				...errorContent({ error: "Workspace owners cannot be demoted" }),
			},
			"404": {
				description: "Member not found",
				...errorContent({ error: "Member not found" }),
			},
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/members/{memberId}",
	"delete",
	slimOp({
		summary: "Remove member",
		description:
			"Removes a member from the workspace. Requires **admin**. Owners cannot be removed. Returns **204** with an empty body.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
			pathParam("memberId", "Member wallet address", "0xmember…"),
		],
		xCredits: 2,
		successStatus: "204",
		successDescription: "Removed",
		successSchema: { type: "object" },
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/invites",
	"post",
	op({
		summary: "Invite member",
		description:
			"Invites a user by email. Requires **admin**. If the email already belongs to a Mermail user, they may be added immediately (`member_added`); otherwise a pending invite is created (`invited` / `invite_updated`).",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["email"],
				properties: {
					email: { type: "string", format: "email", example: "dev@acme.com" },
					role: {
						type: "string",
						enum: ["admin", "member"],
						default: "member",
						example: "member",
					},
				},
			},
			{ email: "dev@acme.com", role: "member" },
		),
		responses: {
			"201": jsonResponse(
				"Invite result",
				{
					type: "object",
					properties: {
						status: {
							type: "string",
							enum: ["invited", "invite_updated", "member_added"],
						},
						invite_id: { type: "string" },
						invite_url: { type: "string" },
					},
				},
				{
					status: "invited",
					invite_id: "inv_01xyz",
					invite_url: "https://console.mermail.app/invite/…",
				},
			),
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/invites/{inviteId}/resend",
	"post",
	slimOp({
		summary: "Resend invite",
		description: "Resends a pending invite email. Requires **admin**.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
			pathParam("inviteId", "Invite id", "inv_01xyz"),
		],
		xCredits: 2,
		successExample: {
			status: "resent",
			invite_id: "inv_01xyz",
			invite_url: "https://console.mermail.app/invite/…",
		},
	}),
);

// —— Domains ——
const emailDomainExample = {
	id: "ed_01xyz",
	workspace_id: "ws_01abc",
	domain: "mail.acme.com",
	provider: "resend",
	status: "pending",
	provider_domain_id: "d_01",
	region: "us-east-1",
	dns_records: [
		{
			type: "TXT",
			name: "resend._domainkey.mail.acme.com",
			value: "p=MIGf…",
		},
		{
			type: "MX",
			name: "mail.acme.com",
			value: "feedback-smtp.us-east-1.amazonses.com",
		},
	],
	last_error: null,
	verified_at: null,
	created_at: "2026-07-15T10:00:00.000Z",
	updated_at: "2026-07-15T10:00:00.000Z",
};

add(
	"/api/v1/workspaces/{workspaceId}/email-domains",
	"get",
	slimOp({
		summary: "List email domains",
		description:
			"Lists active custom email domains for a workspace (excludes tombstoned `deleted` rows). Requires workspace membership. **Developer or Enterprise** plan required.",
		tags: ["Domains"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		successExample: [emailDomainExample],
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/email-domains",
	"post",
	op({
		summary: "Add email domain",
		description:
			"Starts custom domain provisioning with Resend. Domain must be a **subdomain** with ≥3 labels (for example `mail.acme.com` or `support.yourdomain.com`) — apex domains are rejected. Requires workspace **admin**. Subject to plan custom-domain limits. **Developer or Enterprise** required. Returns **201**. Costs **provision** credits (10).",
		tags: ["Domains"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 10,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["domain"],
				properties: {
					domain: {
						type: "string",
						description: "Custom subdomain used for agent mailboxes",
						example: "mail.acme.com",
					},
				},
			},
			{ domain: "mail.acme.com" },
		),
		responses: {
			"201": jsonResponse(
				"Domain created (DNS verification pending)",
				{ $ref: "#/components/schemas/EmailDomain" },
				emailDomainExample,
			),
			"400": {
				description: "Invalid domain shape (e.g. apex domain)",
				...errorContent({
					error:
						"Use a custom subdomain such as support.yourdomain.com or mail.yourdomain.com.",
				}),
			},
			"403": {
				description: "Plan limit or Free plan",
				...errorContent({
					error: "Upgrade to Developer to add custom email domains.",
				}),
			},
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/email-domains/{domainId}",
	"delete",
	op({
		summary: "Delete email domain",
		description:
			"Removes the domain from Resend and deletes the local row. Fails with **409** if any mailboxes still use the domain. Requires workspace **admin**. **Developer or Enterprise** required. Returns `{ status: \"deleted\" }` (HTTP 200).",
		tags: ["Domains"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
			pathParam("domainId", "Email domain id", "ed_01xyz"),
		],
		xCredits: 2,
		responses: {
			"200": jsonResponse(
				"Domain deleted",
				{
					type: "object",
					properties: {
						status: { type: "string", example: "deleted" },
					},
				},
				{ status: "deleted" },
			),
			"404": {
				description: "Email domain not found",
				...errorContent({ error: "Email domain not found" }),
			},
			"409": {
				description: "Mailboxes still attached",
				...errorContent({
					error: "Remove mailboxes from this domain before deleting it.",
				}),
			},
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/email-domains/{domainId}/verify",
	"post",
	op({
		summary: "Verify email domain",
		description:
			"Asks Resend to re-check DNS and returns the updated domain object. `verified_at` is set when `status` becomes `verified`. Requires workspace **admin**. **Developer or Enterprise** required.\n\n**Note:** This path is metered as **provision** (10 credits) because all `POST …/email-domains…` routes share that credit class.",
		tags: ["Domains"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
			pathParam("domainId", "Email domain id", "ed_01xyz"),
		],
		xCredits: 10,
		responses: {
			"200": jsonResponse(
				"Domain verification result",
				{ $ref: "#/components/schemas/EmailDomain" },
				{
					...emailDomainExample,
					status: "verified",
					verified_at: "2026-07-15T11:00:00.000Z",
					updated_at: "2026-07-15T11:00:00.000Z",
				},
			),
			"404": {
				description: "Email domain not found",
				...errorContent({ error: "Email domain not found" }),
			},
			"409": {
				description: "Missing provider domain id",
				...errorContent({
					error: "Email domain is missing a Resend domain id",
				}),
			},
		},
	}),
);

// —— Mailboxes ——
const mailboxListExample = [
	{
		...mailboxExample,
		inbox_unread_by_category: {
			customer_support: 3,
			partnership: 0,
			technical: 1,
			other: 2,
		},
	},
];

const mailboxSettingsSchema = {
	type: "object",
	additionalProperties: true,
	properties: {
		agentInbox: {
			type: "object",
			additionalProperties: true,
			description:
				"Optional agent-inbox purpose and automation controls. Omit this object to keep standard mailbox behavior.",
			properties: {
				mode: {
					type: "string",
					enum: ["standard", "verification"],
					description:
						"Mailbox purpose. Use `verification` only for a verification-focused inbox.",
				},
				automationsEnabled: {
					type: "boolean",
					description:
						"Whether automatic agent workflows can run for this mailbox. Set to false for a verification-only inbox.",
				},
				requireCleanScanForAutomation: {
					type: "boolean",
					description:
						"When true, a skipped or unavailable scan suppresses model-backed inbound classification and automation without rejecting delivery. Verification mode enables this behavior implicitly.",
				},
			},
		},
	},
};

const createMailboxBody = {
	type: "object",
	required: ["email", "name"],
	properties: {
		email: {
			type: "string",
			format: "email",
			description: "Mailbox address on an allowed Mermail or custom domain",
			example: "support@mail.acme.com",
		},
		name: {
			type: "string",
			description: "Display name (also seeds settings.fromName)",
			example: "Acme Support",
		},
		workspaceId: {
			type: "string",
			description:
				"Optional for a workspace-bound API key or MCP OAuth grant. If supplied, it must match the credential workspace.",
			example: "ws_01abc",
		},
		settings: {
			...mailboxSettingsSchema,
			description:
				"Optional mailbox settings merged over defaults. For a verification-only inbox, set `agentInbox` to `{ \"mode\": \"verification\", \"automationsEnabled\": false }`.",
		},
	},
};

add(
	"/api/v1/workspaces/{workspaceId}/mailboxes",
	"get",
	slimOp({
		summary: "List workspace mailboxes",
		description:
			"Lists mailboxes in a workspace. Each item includes `inbox_unread_by_category`. Requires workspace membership. API keys are bound to one workspace.",
		tags: ["Mailboxes"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		successExample: mailboxListExample,
	}),
);

add(
	"/api/v1/mailboxes",
	"get",
	op({
		summary: "List mailboxes",
		description:
			"Lists mailboxes visible to the caller. Pass `workspaceId` to scope a session user; API keys are always scoped to their bound workspace. Each item includes `inbox_unread_by_category`.",
		tags: ["Mailboxes"],
		parameters: [
			queryParam("workspaceId", {
				description:
					"Filter by workspace id (session users). API keys ignore cross-workspace values and stay on the key’s workspace.",
				example: "ws_01abc",
			}),
		],
		xCredits: 1,
		responses: {
			"200": jsonResponse(
				"Mailbox list",
				{
					type: "array",
					items: { $ref: "#/components/schemas/Mailbox" },
				},
				mailboxListExample,
			),
		},
	}),
);

add(
	"/api/v1/mailboxes",
	"post",
	op({
		summary: "Create mailbox",
		description:
			"Provisions a mailbox. `email` and `name` are required. `workspaceId` is optional for a workspace-bound API key; when supplied, it must match that workspace. Requires workspace **admin**. Returns **201**. A successful create costs 10 **provision credits** from the API-credit balance; these are usage units, not currency. Pass `Idempotency-Key` for a repeated attempt with identical intent. Do not blind-retry: after a conflict or uncertain response, list mailboxes and resolve the exact normalized address first.",
		tags: ["Mailboxes"],
		parameters: [idempotencyKeyParam()],
		xCredits: 10,
		requestBody: jsonBody(
			createMailboxBody,
			{
				email: "ops@mail.acme.com",
				name: "Acme Ops",
				workspaceId: "ws_01abc",
				settings: {
					agentInbox: {
						mode: "verification",
						automationsEnabled: false,
					},
				},
			},
		),
		responses: {
			"201": jsonResponse(
				"Mailbox created",
				{ $ref: "#/components/schemas/Mailbox" },
				{ ...mailboxExample, email: "ops@mail.acme.com", name: "Acme Ops" },
			),
			"400": {
				description:
					"Validation error, or no workspace can be resolved from the credential or body",
				...errorContent({ error: "Invalid request" }),
			},
			"413": {
				description:
					"Authenticated idempotency request body exceeds the 50 MiB fingerprint limit",
				...errorContent({
					error: "idempotency_payload_too_large",
					code: "idempotency_payload_too_large",
				}),
			},
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}",
	"get",
	op({
		summary: "Get mailbox",
		description:
			"Returns a single mailbox by `public_id` (UUID), hosted alias id, or current email. Does not include `inbox_unread_by_category` (use list endpoints for unread counts).",
		tags: ["Mailboxes"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 1,
		responses: {
			"200": jsonResponse(
				"Mailbox",
				{ $ref: "#/components/schemas/Mailbox" },
				mailboxExample,
			),
			"404": {
				description: "Mailbox not found",
				...errorContent({ error: "Not found" }),
			},
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}",
	"put",
	slimOp({
		summary: "Update mailbox settings",
		description:
			"Replaces the mailbox `settings` JSON object. Body shape is `{ settings }` only — there is no top-level `name` field on this route. Requires mailbox **admin**.",
		tags: ["Mailboxes"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["settings"],
				properties: {
					settings: {
						type: "object",
						additionalProperties: true,
						description: "Full settings object to store on the mailbox",
						example: mailboxExample.settings,
					},
				},
			},
			{ settings: mailboxExample.settings },
		),
		successExample: mailboxExample,
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/storage",
	"get",
	slimOp({
		summary: "Get mailbox storage",
		description:
			"Returns stored-blob usage for a mailbox (`storage_gb` and `blob_count`). Not a plan quota limit.",
		tags: ["Mailboxes"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 1,
		successSchema: { $ref: "#/components/schemas/MailboxStorage" },
		successExample: {
			mailbox_id: "support@mail.acme.com",
			email: "support@mail.acme.com",
			storage_gb: 1.25,
			blob_count: 42,
		},
	}),
);

// —— Emails ——
const sendEmailSchema = {
	type: "object",
	required: ["to", "from", "subject"],
	properties: {
		to: {
			oneOf: [
				{ type: "string", format: "email" },
				{ type: "array", items: { type: "string", format: "email" } },
			],
			description: "Recipient email or list",
			example: ["hello@example.com"],
		},
		cc: {
			oneOf: [
				{ type: "string" },
				{ type: "array", items: { type: "string" } },
			],
		},
		bcc: {
			oneOf: [
				{ type: "string" },
				{ type: "array", items: { type: "string" } },
			],
		},
		from: {
			oneOf: [
				{ type: "string", format: "email" },
				{
					type: "object",
					properties: {
						email: { type: "string" },
						name: { type: "string" },
					},
				},
			],
			example: "support@mail.acme.com",
		},
		subject: { type: "string", example: "Hello from Mermail" },
		html: { type: "string", example: "<p>Hi there</p>" },
		text: { type: "string", example: "Hi there" },
		attachments: {
			type: "array",
			items: {
				type: "object",
				properties: {
					content: { type: "string", description: "Base64 content" },
					filename: { type: "string" },
					type: { type: "string" },
					disposition: {
						type: "string",
						enum: ["attachment", "inline"],
					},
					contentId: { type: "string" },
				},
			},
		},
		in_reply_to: { type: "string" },
		references: { type: "array", items: { type: "string" } },
		thread_id: { type: "string" },
		source_draft_id: { type: "string" },
	},
};

const listEmailParams = [
	mailboxIdParam(),
	queryParam("folder", { description: "Folder id", example: "INBOX" }),
	queryParam("thread_id", { description: "Filter by thread id" }),
	queryParam("category", {
		description: "Email category",
		schema: {
			type: "string",
			enum: ["customer_support", "technical", "partnership", "other"],
		},
	}),
	queryParam("custom_label", { description: "Custom label slug" }),
	queryParam("is_starred", {
		description: "true/1 or false/0",
		example: "true",
	}),
	queryParam("is_read", { description: "true/1 or false/0" }),
	queryParam("threaded", {
		description: "Set to true/1 to aggregate by thread",
	}),
	queryParam("metadata_only", {
		description:
			"Set to true to omit body, snippet, raw headers, and threat URLs from returned email items",
		schema: { type: "boolean" },
	}),
	queryParam("include_held", {
		description:
			"Set to true only for a scoped verification flow that must inspect messages temporarily held for auto-draft processing",
		schema: { type: "boolean" },
	}),
	queryParam("require_scan_status", {
		description:
			"Require the exact stored scan status; non-matching messages are excluded",
		schema: {
			type: "string",
			enum: ["clean", "flagged", "skipped"],
		},
	}),
	queryParam("agent_safe_content", {
		description:
			"Set to true to omit raw headers, provider metadata, threat details, attachment metadata, and storage diagnostics, and to normalize untrusted text fields to bounded plain text. The response retains `attachment_count` and remains untrusted.",
		schema: { type: "boolean", default: false },
	}),
	queryParam("page", {
		description: "Page number (≥1)",
		schema: { type: "integer", minimum: 1 },
		example: 1,
	}),
	queryParam("limit", {
		description: "Page size (1–100, default 25)",
		schema: { type: "integer", minimum: 1, maximum: 100 },
		example: 25,
	}),
	queryParam("sortColumn", {
		description: "Sort column",
		schema: {
			type: "string",
			enum: ["id", "subject", "sender", "recipient", "date", "read", "starred"],
		},
	}),
	queryParam("sortDirection", {
		description: "ASC for ascending; otherwise descending",
		example: "DESC",
	}),
];

add(
	"/api/v1/mailboxes/{mailboxId}/emails",
	"get",
	op({
		summary: "List emails",
		description:
			"Lists emails in a mailbox. Set `metadata_only=true` for candidate discovery, `require_scan_status=clean` to exclude non-clean candidates, and `agent_safe_content=true` to remove sensitive metadata and normalize untrusted text to bounded plain text. Use `include_held=true` only for an explicitly scoped verification flow. All safe-read controls are optional and preserve the existing full response by default. When `folder` or `is_starred` is set, the response is `{ emails, totalCount }`; otherwise a bare array may be returned.",
		tags: ["Emails"],
		parameters: listEmailParams,
		xCredits: 1,
		responses: {
			"200": jsonResponse(
				"Email list",
				{ $ref: "#/components/schemas/EmailListResponse" },
				{ emails: [emailListItem], totalCount: 42 },
			),
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/emails",
	"post",
	op({
		summary: "Send email",
		description:
			"Sends a new outbound email from the mailbox. Provide `html` and/or `text` (at least one required). Subject to send rate limits and API credits. Returns **202** with `{ id, status: \"sent\" }`.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 5,
		requestBody: jsonBody(sendEmailSchema, {
			to: ["hello@example.com"],
			from: "support@mail.acme.com",
			subject: "Hello from Mermail",
			text: "Hi there — thanks for writing in.",
		}),
		responses: {
			"202": jsonResponse(
				"Accepted for sending",
				{ $ref: "#/components/schemas/SendEmailResult" },
				{ id: "msg_7f3a2c1b", status: "sent" },
			),
			"400": {
				description: "Validation error",
				...errorContent({ error: "Invalid request" }),
			},
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/emails/{emailId}",
	"get",
	op({
		summary: "Get email",
		description:
			"Fetches a single email with body and metadata without marking it read. Set `metadata_only=true` to omit body content, `require_scan_status=clean` to return only a clean stored message, `max_body_chars` to bound the returned body without mutating storage, and `agent_safe_content=true` to remove sensitive metadata and normalize untrusted text to bounded plain text. `include_held=true` is intended only for an explicitly scoped verification wait. All controls are optional and preserve the existing full response by default.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("emailId", "Email id", "msg_7f3a2c1b"),
			queryParam("metadata_only", {
				description:
					"Set to true to omit body, snippet, raw headers, and threat URLs",
				schema: { type: "boolean" },
			}),
				queryParam("include_held", {
					description:
						"Set to true only for a scoped verification flow that must inspect a message temporarily held for auto-draft processing",
					schema: { type: "boolean" },
				}),
				queryParam("require_scan_status", {
					description:
						"Return the message only when its stored scan status exactly matches. A mismatch returns 404.",
					schema: {
						type: "string",
						enum: ["clean", "flagged", "skipped"],
					},
				}),
				queryParam("max_body_chars", {
					description:
						"Positive character cap for the returned body without mutating the stored message. The effective server ceiling is 100000 characters.",
					schema: { type: "integer", minimum: 1 },
				}),
				queryParam("agent_safe_content", {
					description:
						"Set to true to omit raw headers, provider metadata, threat details, attachment metadata, and storage diagnostics, and to normalize untrusted text fields to bounded plain text. The response retains `attachment_count` and remains untrusted.",
					schema: { type: "boolean", default: false },
				}),
			],
		xCredits: 1,
		responses: {
			"200": jsonResponse(
				"Email",
				{ $ref: "#/components/schemas/Email" },
				emailListItem,
			),
			"404": {
				description: "Email not found",
				...errorContent({ error: "Email not found" }),
			},
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/emails/{emailId}",
	"put",
	slimOp({
		summary: "Update email",
		description: "Updates flags such as read/starred or moves metadata.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("emailId", "Email id", "msg_7f3a2c1b"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: {
					read: { type: "boolean" },
					starred: { type: "boolean" },
				},
			},
			{ read: true },
		),
		successExample: { ...emailListItem, read: true },
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/emails/{emailId}",
	"delete",
	slimOp({
		summary: "Delete email",
		description:
			"Trashes an email by default. Pass `permanent=true` to hard-delete (also used for messages already in trash). Returns **204** with an empty body.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("emailId", "Email id", "msg_7f3a2c1b"),
			queryParam("permanent", {
				description: "Set to `true` to permanently delete instead of moving to trash",
				example: "true",
			}),
		],
		xCredits: 2,
		successStatus: "204",
		successDescription: "Deleted",
		successSchema: { type: "object" },
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/emails/bulk-delete",
	"post",
	slimOp({
		summary: "Bulk delete emails",
		description:
			"Deletes or trashes multiple emails by id. With `permanent: true`, hard-deletes; otherwise moves to trash (scheduled drafts are cancelled).",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["ids"],
				properties: {
					ids: {
						type: "array",
						items: { type: "string" },
						example: ["msg_1", "msg_2"],
					},
					permanent: { type: "boolean", description: "Hard-delete when true" },
				},
			},
			{ ids: ["msg_7f3a2c1b"], permanent: false },
		),
		successExample: {
			deletedCount: 0,
			trashedCount: 1,
			cancelledScheduledCount: 0,
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/emails/bulk-read",
	"post",
	slimOp({
		summary: "Bulk mark emails read",
		description:
			"Marks multiple emails read or unread. Marking read on a multi-message thread may update the whole thread.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["ids", "read"],
				properties: {
					ids: {
						type: "array",
						items: { type: "string" },
						example: ["msg_1", "msg_2"],
					},
					read: { type: "boolean" },
				},
			},
			{ ids: ["msg_7f3a2c1b"], read: true },
		),
		successExample: { updatedCount: 1 },
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/emails/bulk-move",
	"post",
	slimOp({
		summary: "Bulk move emails",
		description: "Moves multiple emails into a folder. Returns `400` if the folder does not exist.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["ids", "folderId"],
				properties: {
					ids: {
						type: "array",
						items: { type: "string" },
						example: ["msg_1", "msg_2"],
					},
					folderId: { type: "string", example: "ARCHIVE" },
				},
			},
			{ ids: ["msg_7f3a2c1b"], folderId: "ARCHIVE" },
		),
		successExample: { movedCount: 1 },
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/emails/{emailId}/move",
	"post",
	slimOp({
		summary: "Move email",
		description:
			"Moves one email into a folder. Returns `{ status: \"moved\" }` or `400` if the folder is missing.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("emailId", "Email id", "msg_7f3a2c1b"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["folderId"],
				properties: { folderId: { type: "string", example: "ARCHIVE" } },
			},
			{ folderId: "ARCHIVE" },
		),
		successExample: { status: "moved" },
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/emails/{emailId}/reply",
	"post",
	op({
		summary: "Reply to email",
		description:
			"Sends a reply. Server injects `in_reply_to`, `references`, and `thread_id` from the original message.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("emailId", "Original email id", "msg_7f3a2c1b"),
		],
		xCredits: 5,
		requestBody: jsonBody(sendEmailSchema, {
			to: ["alice@example.com"],
			from: "support@mail.acme.com",
			subject: "Re: Order question",
			text: "Thanks — shipping tomorrow.",
		}),
		responses: {
			"202": jsonResponse(
				"Accepted",
				{ $ref: "#/components/schemas/SendEmailResult" },
				{ id: "msg_reply01", status: "sent" },
			),
			"404": {
				description: "Original email not found",
				...errorContent({ error: "Not found" }),
			},
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/emails/{emailId}/forward",
	"post",
	op({
		summary: "Forward email",
		description: "Forwards an existing email to new recipients.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("emailId", "Original email id", "msg_7f3a2c1b"),
		],
		xCredits: 5,
		requestBody: jsonBody(sendEmailSchema, {
			to: ["team@acme.com"],
			from: "support@mail.acme.com",
			subject: "Fwd: Order question",
			text: "FYI",
		}),
		responses: {
			"202": jsonResponse(
				"Accepted",
				{ $ref: "#/components/schemas/SendEmailResult" },
				{ id: "msg_fwd01", status: "sent" },
			),
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/emails/{emailId}/attachments/{attachmentId}",
	"get",
	op({
		summary: "Download attachment",
		description:
			"Downloads raw attachment bytes. Response `Content-Type` and `Content-Disposition` come from the stored attachment metadata.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("emailId", "Email id", "msg_7f3a2c1b"),
			pathParam("attachmentId", "Attachment id", "att_01"),
		],
		xCredits: 1,
		responses: {
			"200": {
				description: "Attachment file bytes",
				content: {
					"application/octet-stream": {
						schema: { type: "string", format: "binary" },
					},
				},
			},
			"404": {
				description: "Attachment file not found",
				...errorContent({ error: "Attachment file not found" }),
			},
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/drafts",
	"post",
	slimOp({
		summary: "Save draft",
		description:
			"Creates a draft (or replaces an existing draft when `draft_id` is set). Body is HTML/text in the `body` field — not `html`/`text`. Do not send `scheduled_send_at` here; use `POST /scheduled-sends`. Returns **201**.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["body"],
				properties: {
					to: { type: "string", example: "hello@example.com" },
					cc: { type: "string" },
					bcc: { type: "string" },
					subject: { type: "string", example: "Draft" },
					body: {
						type: "string",
						description: "Draft body (HTML or plain text)",
						example: "<p>Working…</p>",
					},
					in_reply_to: { type: "string" },
					thread_id: { type: "string" },
					draft_id: {
						type: "string",
						description: "Existing draft id to replace",
					},
				},
			},
			{
				to: "hello@example.com",
				subject: "Draft",
				body: "<p>Working…</p>",
			},
		),
		successStatus: "201",
		successExample: {
			id: "dft_01",
			draft_id: "dft_01",
			status: "draft",
			subject: "Draft",
			recipient: "hello@example.com",
			date: "2026-07-16T10:00:00.000Z",
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/drafts/regenerate",
	"post",
	slimOp({
		summary: "Regenerate draft with AI",
		description:
			"Uses AI to revise the editable portion of a draft. Requires `draftId`, revision `prompt`, and current draft `body`.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 15,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["draftId", "prompt", "body"],
				properties: {
					draftId: { type: "string", example: "dft_01" },
					prompt: {
						type: "string",
						example: "Make this shorter and more formal",
					},
					body: {
						type: "string",
						description: "Current draft HTML/body to revise",
					},
				},
			},
			{
				draftId: "dft_01",
				prompt: "Make this shorter and more formal",
				body: "<p>Thanks for your note…</p>",
			},
		),
		successExample: { body: "<p>Thank you for your note.</p>" },
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/scheduled-sends",
	"post",
	slimOp({
		summary: "Schedule send",
		description:
			"Schedules an outbound email for a future time. Uses draft-style fields (`body`, `scheduled_send_at`) rather than send-email `html`/`text`. Returns **201**.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 5,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["body", "scheduled_send_at"],
				properties: {
					to: {
						oneOf: [
							{ type: "string" },
							{ type: "array", items: { type: "string" } },
						],
						example: ["hello@example.com"],
					},
					cc: {
						oneOf: [
							{ type: "string" },
							{ type: "array", items: { type: "string" } },
						],
					},
					bcc: {
						oneOf: [
							{ type: "string" },
							{ type: "array", items: { type: "string" } },
						],
					},
					subject: { type: "string", example: "Later" },
					body: { type: "string", example: "<p>See you</p>" },
					in_reply_to: { type: "string" },
					thread_id: { type: "string" },
					draft_id: { type: "string" },
					scheduled_send_at: {
						type: "string",
						format: "date-time",
						description: "Must be in the future (ISO-8601)",
						example: "2026-07-16T15:00:00.000Z",
					},
				},
			},
			{
				to: ["hello@example.com"],
				subject: "Later",
				body: "<p>See you</p>",
				scheduled_send_at: "2026-07-16T15:00:00.000Z",
			},
		),
		successStatus: "201",
		successExample: {
			id: "dft_sched01",
			draft_id: "dft_sched01",
			status: "scheduled",
			subject: "Later",
			recipient: "hello@example.com",
			scheduled_send_at: "2026-07-16T15:00:00.000Z",
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/trash/empty",
	"post",
	slimOp({
		summary: "Empty trash",
		description: "Permanently deletes all messages currently in trash.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 2,
		successExample: { deletedCount: 12 },
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/threads/{threadId}",
	"get",
	slimOp({
		summary: "Get thread",
		description:
			"Returns the conversation thread as an **array** of email objects (oldest → newest), including bodies.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("threadId", "Thread id", "thr_9aabb"),
		],
		xCredits: 1,
		successSchema: {
			type: "array",
			items: { $ref: "#/components/schemas/Email" },
		},
		successExample: [emailListItem],
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/threads/{threadId}/read",
	"post",
	slimOp({
		summary: "Mark thread read",
		description: "Marks all messages in a thread as read.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("threadId", "Thread id", "thr_9aabb"),
		],
		xCredits: 2,
		successExample: { status: "marked_read" },
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/folders",
	"get",
	slimOp({
		summary: "List folders",
		description: "Lists mailbox folders with unread counts.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 1,
		successExample: [
			{ id: "INBOX", name: "Inbox", unreadCount: 5 },
			{ id: "vip-customers", name: "VIP Customers", unreadCount: 0 },
		],
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/folders",
	"post",
	op({
		summary: "Create folder",
		description: "Creates a custom folder. Name is slugified into the folder id.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: {
					name: { type: "string", example: "VIP Customers" },
				},
			},
			{ name: "VIP Customers" },
		),
		responses: {
			"201": jsonResponse(
				"Folder created",
				{ $ref: "#/components/schemas/Folder" },
				{ id: "vip-customers", name: "VIP Customers", unreadCount: 0 },
			),
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/folders/{folderId}",
	"put",
	slimOp({
		summary: "Update folder",
		description: "Renames a custom folder.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("folderId", "Folder id", "vip-customers"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: { name: { type: "string", example: "VIP" } },
			},
			{ name: "VIP" },
		),
		successExample: { id: "vip-customers", name: "VIP", unreadCount: 0 },
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/folders/{folderId}",
	"delete",
	slimOp({
		summary: "Delete folder",
		description:
			"Deletes a custom folder. Returns **204** on success, or **400** if the folder is missing or cannot be deleted (e.g. system folders).",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("folderId", "Folder id", "vip-customers"),
		],
		xCredits: 2,
		successStatus: "204",
		successDescription: "Deleted",
		successSchema: { type: "object" },
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/search",
	"get",
	op({
		summary: "Search emails",
		description:
			"Full-text / field search across mailbox messages. `from`, `to`, and `subject` are substring candidate filters; re-check normalized addresses on the selected detail before acting. Returns `{ emails, totalCount }`.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			queryParam("query", {
				description: "Free-text query across subject, body, sender, recipients",
				example: "order shipping",
			}),
			queryParam("folder", { description: "Folder id filter" }),
			queryParam("from", { description: "Sender contains" }),
			queryParam("to", { description: "Recipient contains" }),
			queryParam("subject", { description: "Subject contains" }),
			queryParam("date_start", {
				description: "ISO start date",
				example: "2026-07-01T00:00:00.000Z",
			}),
			queryParam("date_end", { description: "ISO end date" }),
			queryParam("is_read", { description: "true/1 for read only" }),
			queryParam("is_starred", { description: "true/1 for starred only" }),
			queryParam("category", { description: "Category filter" }),
			queryParam("has_attachment", {
				description: "Truthy to require attachments",
			}),
			queryParam("metadata_only", {
				description:
					"Set to true to omit body, snippet, raw headers, and threat URLs from candidates",
				schema: { type: "boolean" },
			}),
			queryParam("include_held", {
				description:
					"Set to true only for a scoped verification flow that must inspect messages temporarily held for auto-draft processing",
				schema: { type: "boolean" },
			}),
			queryParam("require_scan_status", {
				description:
					"Require an exact scan status such as `clean`; non-matching messages are excluded",
				schema: {
					type: "string",
					enum: ["clean", "flagged", "skipped"],
				},
			}),
			queryParam("agent_safe_content", {
				description:
					"Set to true to omit raw headers, provider metadata, threat details, attachment metadata, and storage diagnostics, and to normalize untrusted text fields to bounded plain text. The response retains `attachment_count` and remains untrusted.",
				schema: { type: "boolean", default: false },
			}),
			queryParam("page", {
				schema: { type: "integer" },
				example: 1,
			}),
			queryParam("limit", {
				schema: { type: "integer" },
				example: 25,
			}),
		],
		xCredits: 1,
		responses: {
			"200": jsonResponse(
				"Search results",
				{ $ref: "#/components/schemas/EmailListResponse" },
				{ emails: [emailListItem], totalCount: 42 },
			),
		},
	}),
);

// custom labels
const customLabelExample = {
	id: "lbl_1",
	mailbox_id: "support@mail.acme.com",
	name: "VIP",
	slug: "vip",
	rules: "from:vip@example.com",
	color: "#43c9cb",
	sort_order: 0,
	created_at: "2026-07-14T09:00:00.000Z",
	updated_at: "2026-07-14T09:00:00.000Z",
};

add(
	"/api/v1/mailboxes/{mailboxId}/custom-labels",
	"get",
	slimOp({
		summary: "List custom labels",
		description: "Lists custom labels for a mailbox (sorted by `sort_order`).",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 1,
		successExample: [customLabelExample],
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/custom-labels",
	"post",
	slimOp({
		summary: "Create custom label",
		description:
			"Creates a custom label. Requires `name` and `rules`. Mailbox **admin** role required.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["name", "rules"],
				properties: {
					name: { type: "string", example: "VIP", maxLength: 80 },
					rules: {
						type: "string",
						description: "Label matching rules text",
						example: "from:vip@example.com",
					},
					color: {
						type: ["string", "null"],
						example: "#43c9cb",
						description: "Optional hex color",
					},
				},
			},
			{ name: "VIP", rules: "from:vip@example.com", color: "#43c9cb" },
		),
		successStatus: "201",
		successExample: customLabelExample,
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/custom-labels/{labelId}",
	"put",
	slimOp({
		summary: "Update custom label",
		description:
			"Updates a custom label (`name`, `rules`, and/or `color`). Mailbox **admin** role required.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("labelId", "Label id", "lbl_1"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: {
					name: { type: "string", maxLength: 80 },
					rules: { type: "string" },
					color: { type: ["string", "null"] },
				},
			},
			{ name: "VIP+" },
		),
		successExample: { ...customLabelExample, name: "VIP+" },
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/custom-labels/{labelId}",
	"delete",
	slimOp({
		summary: "Delete custom label",
		description:
			"Deletes a custom label. Mailbox **admin** role required. Returns **204** with an empty body.",
		tags: ["Emails"],
		parameters: [
			mailboxIdParam(),
			pathParam("labelId", "Label id", "lbl_1"),
		],
		xCredits: 2,
		successStatus: "204",
		successDescription: "Deleted",
		successSchema: { type: "object" },
	}),
);

// —— AI agent ——
const agentConversationExample = {
	id: "conv_01",
	title: "Billing help",
	systemKey: null,
	isSystem: false,
	isTriager: false,
	messageCount: 2,
	lastMessageAt: "2026-07-15T10:00:00.000Z",
	createdAt: "2026-07-15T09:00:00.000Z",
	updatedAt: "2026-07-15T10:00:00.000Z",
};

add(
	"/api/v1/mailboxes/{mailboxId}/agent-conversations",
	"get",
	slimOp({
		summary: "List agent conversations",
		description:
			"Lists AI agent chat conversations for the authenticated user in this mailbox (newest activity first).",
		tags: ["AI agent"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 1,
		successExample: { conversations: [agentConversationExample] },
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/agent-conversations",
	"post",
	slimOp({
		summary: "Create agent conversation",
		description:
			"Creates a new agent conversation. Pass `title` for a normal chat (defaults to `New chat`), or `threadId` to find/create the conversation linked to an email thread.",
		tags: ["AI agent"],
		parameters: [
			mailboxIdParam(),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: {
					title: {
						type: "string",
						minLength: 1,
						maxLength: 80,
						description: "Required when creating a normal chat if provided; 1–80 chars",
						example: "Billing help",
					},
					threadId: {
						type: "string",
						description:
							"When set, finds or creates the thread-linked conversation (title optional; defaults to “(No subject)”)",
						example: "thread_01",
					},
				},
			},
			{ title: "Billing help" },
			false,
		),
		successStatus: "201",
		successExample: agentConversationExample,
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/agent-conversations/{conversationId}",
	"patch",
	slimOp({
		summary: "Rename agent conversation",
		description:
			"Renames a conversation. `title` is required (1–80 chars). System/triager conversations cannot be renamed (`400`).",
		tags: ["AI agent"],
		parameters: [
			mailboxIdParam(),
			pathParam("conversationId", "Conversation id", "conv_01"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["title"],
				properties: {
					title: { type: "string", minLength: 1, maxLength: 80, example: "Updated" },
				},
			},
			{ title: "Updated" },
		),
		successDescription: "Updated",
		successExample: { ...agentConversationExample, title: "Updated" },
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/agent-conversations/{conversationId}",
	"delete",
	slimOp({
		summary: "Delete agent conversation",
		description:
			"Deletes an agent conversation. System/triager conversations cannot be deleted (`400`). Returns **204** with an empty body.",
		tags: ["AI agent"],
		parameters: [
			mailboxIdParam(),
			pathParam("conversationId", "Conversation id", "conv_01"),
		],
		xCredits: 2,
		successStatus: "204",
		successDescription: "Deleted",
		successSchema: { type: "object" },
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/agent-conversations/{conversationId}/messages",
	"get",
	slimOp({
		summary: "List agent messages",
		description:
			"Lists AI SDK UI messages in a conversation (chronological). Supports cursor pagination.",
		tags: ["AI agent"],
		parameters: [
			mailboxIdParam(),
			pathParam("conversationId", "Conversation id", "conv_01"),
			queryParam("limit", {
				description: "Page size (1–50, default 50)",
				schema: { type: "integer", minimum: 1, maximum: 50, default: 50 },
				example: 50,
			}),
			queryParam("cursor", {
				description: "Opaque cursor from a previous `nextCursor` value",
				example: "msg_row_id",
			}),
		],
		xCredits: 1,
		successExample: {
			messages: [
				{
					id: "m1",
					role: "user",
					parts: [{ type: "text", text: "Summarize inbox" }],
				},
				{
					id: "m2",
					role: "assistant",
					parts: [{ type: "text", text: "You have 3 unread…" }],
				},
			],
			nextCursor: null,
		},
	}),
);

add(
	"/api/agent/mailbox",
	"post",
	op({
		summary: "Chat with mailbox agent",
		description:
			"Streams an AI agent chat turn for a mailbox conversation. Response is an AI SDK UI message stream (not a plain JSON object). The latest message must be from the user. Duplicate message ids return `409`.",
		tags: ["AI agent"],
		xCredits: 25,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["mailboxId", "conversationId", "messages"],
				properties: {
					mailboxId: {
						type: "string",
						example: "support@mail.acme.com",
					},
					conversationId: { type: "string", example: "conv_01" },
					messages: {
						type: "array",
						items: { type: "object", additionalProperties: true },
						description: "AI SDK UIMessage array (id, role, parts)",
					},
					thread_id: { type: ["string", "null"] },
					trigger: {
						type: "string",
						enum: ["submit-message", "regenerate-message"],
					},
				},
			},
			{
				mailboxId: "support@mail.acme.com",
				conversationId: "conv_01",
				messages: [
					{
						id: "u1",
						role: "user",
						parts: [{ type: "text", text: "What needs a reply?" }],
					},
				],
				trigger: "submit-message",
			},
		),
		responses: {
			"200": {
				description: "UI message stream",
				content: {
					"text/plain": {
						schema: { type: "string" },
						example: "(streaming AI SDK UI message response)",
					},
				},
			},
			"400": {
				description: "Latest message is not from the user, or invalid body",
				...errorContent({ error: "Invalid request" }),
			},
			"409": {
				description: "Duplicate message submit",
				...errorContent({ error: "Conflict" }),
			},
		},
	}),
);

// —— Task triage ——
const triagerParams = [
	mailboxIdParam(),
];
const taskTriagerBodySchema = {
	type: "object",
	properties: {
		name: { type: "string", example: "Support queue" },
		instructions: {
			type: "string",
			description: "Required non-empty instructions for create/update",
			example: "Draft a polite reply for inbound support mail.",
		},
		triggers: {
			type: "array",
			description: "At least one trigger is required",
			items: {
				type: "object",
				required: ["id", "kind", "enabled"],
				properties: {
					id: { type: "string", example: "trg_01" },
					kind: {
						type: "string",
						example: "mail.received",
						description:
							"calendar.event_created | calendar.event_updated | calendar.event_canceled | mail.received | mail.sent | mail.received_or_sent",
					},
					enabled: { type: "boolean", example: true },
					calendars: { type: "array", items: { type: "string" } },
					mailDomains: { type: "array", items: { type: "string" } },
					inboxes: { type: "array", items: { type: "string" } },
					onlyInbox: { type: "boolean", default: false },
					filters: { type: "array", items: { type: "object" } },
					filterJoin: { type: "string", enum: ["and", "or"], default: "and" },
				},
			},
		},
		tasks: {
			type: "array",
			items: {
				type: "object",
				required: ["id", "kind", "enabled"],
				properties: {
					id: { type: "string" },
					kind: { type: "string" },
					enabled: { type: "boolean" },
					priority: { type: "integer", default: 0 },
					config: { type: "object", additionalProperties: true },
				},
			},
		},
	},
};
const taskTriagerBodyExample = {
	name: "Support queue",
	instructions: "Draft a polite reply for inbound support mail.",
	triggers: [
		{
			id: "trg_01",
			kind: "mail.received",
			enabled: true,
			onlyInbox: true,
			filters: [],
			filterJoin: "and",
		},
	],
	tasks: [],
};

add(
	"/api/v1/mailboxes/{mailboxId}/task-triagers",
	"get",
	slimOp({
		summary: "List task triagers",
		description:
			"Lists task triagers for the mailbox. Ensures the default system triager exists.",
		tags: ["Task triage"],
		parameters: triagerParams,
		xCredits: 1,
		successExample: [{ id: "tr_01", name: "Default", isDefault: true }],
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/task-triagers",
	"post",
	slimOp({
		summary: "Create task triager",
		description:
			"Creates a task triager. Requires non-empty `instructions` and at least one trigger. Caller needs mailbox **admin** or **member**.",
		tags: ["Task triage"],
		parameters: triagerParams,
		xCredits: 2,
		requestBody: jsonBody(taskTriagerBodySchema, taskTriagerBodyExample),
		successStatus: "201",
		successDescription: "Created",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/task-triager-runs/recent",
	"get",
	slimOp({
		summary: "List recent triager runs",
		description:
			"Recent succeeded/failed triager runs for the mailbox, newest first.",
		tags: ["Task triage"],
		parameters: [
			...triagerParams,
			queryParam("limit", {
				description: "Max runs to return (1–20, default 10)",
				schema: { type: "integer", minimum: 1, maximum: 20, default: 10 },
				example: 10,
			}),
		],
		xCredits: 1,
		successExample: {
			runs: [
				{
					id: "run_01",
					triager: "Support queue",
					source: "inbound_email",
					status: "SUCCEEDED",
					summary: "Drafted reply",
					finishedAt: "2026-07-15T10:00:00.000Z",
				},
			],
		},
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/task-triagers/{triagerId}",
	"put",
	slimOp({
		summary: "Update task triager",
		description:
			"Updates a task triager. Default system triager blocks changing protected triggers/instructions (`409`).",
		tags: ["Task triage"],
		parameters: [
			...triagerParams,
			pathParam("triagerId", "Triager id", "tr_01"),
		],
		xCredits: 2,
		requestBody: jsonBody(taskTriagerBodySchema, taskTriagerBodyExample),
		successDescription: "Updated",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/task-triagers/{triagerId}",
	"delete",
	slimOp({
		summary: "Delete task triager",
		description: "Deletes a task triager. Returns **204** with an empty body.",
		tags: ["Task triage"],
		parameters: [
			...triagerParams,
			pathParam("triagerId", "Triager id", "tr_01"),
		],
		xCredits: 2,
		successStatus: "204",
		successDescription: "Deleted",
		successSchema: { type: "object" },
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/task-triagers/{triagerId}/default",
	"post",
	slimOp({
		summary: "Set default task triager",
		description:
			"Marks a triager as the mailbox default (clears the previous default).",
		tags: ["Task triage"],
		parameters: [
			...triagerParams,
			pathParam("triagerId", "Triager id", "tr_01"),
		],
		xCredits: 2,
		successDescription: "Default set",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/task-triagers/{triagerId}/agent-conversation",
	"post",
	slimOp({
		summary: "Get or create triager agent conversation",
		description:
			"Returns the dedicated agent conversation for this triager, creating it if missing. No request body is required.",
		tags: ["Task triage"],
		parameters: [
			...triagerParams,
			pathParam("triagerId", "Triager id", "tr_01"),
		],
		xCredits: 2,
		successDescription: "Conversation",
		successExample: {
			id: "conv_01",
			title: "Support queue",
			message_count: 0,
		},
	}),
);

// —— RAG ——
add(
	"/api/v1/rag/documents",
	"get",
	slimOp({
		summary: "List RAG documents",
		description: "Lists knowledge documents for RAG.",
		tags: ["RAG"],
		xCredits: 1,
		successExample: [{ id: "doc_01", name: "handbook.pdf", status: "ready" }],
	}),
);
add(
	"/api/v1/rag/documents",
	"post",
	slimOp({
		summary: "Upload RAG document",
		description:
			"Uploads / registers a document. **Developer or Enterprise** required.",
		tags: ["RAG"],
		xCredits: 25,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{ name: "handbook.pdf" },
		),
		successStatus: "201",
		successDescription: "Document created",
	}),
);
add(
	"/api/v1/rag/documents/{id}",
	"get",
	slimOp({
		summary: "Get RAG document",
		description: "Returns a single RAG document.",
		tags: ["RAG"],
		parameters: [pathParam("id", "Document id", "doc_01")],
		xCredits: 1,
		successExample: { id: "doc_01", name: "handbook.pdf", status: "ready" },
	}),
);
add(
	"/api/v1/rag/documents/{id}",
	"delete",
	slimOp({
		summary: "Delete RAG document",
		description: "Deletes a document. **Developer+** required.",
		tags: ["RAG"],
		parameters: [pathParam("id", "Document id", "doc_01")],
		xCredits: 2,
		successDescription: "Deleted",
	}),
);
add(
	"/api/v1/rag/documents/{id}/download",
	"get",
	slimOp({
		summary: "Download RAG document",
		description: "Downloads document content.",
		tags: ["RAG"],
		parameters: [pathParam("id", "Document id", "doc_01")],
		xCredits: 1,
		successDescription: "File bytes",
	}),
);
add(
	"/api/v1/rag/documents/{id}/verify",
	"post",
	slimOp({
		summary: "Verify RAG document",
		description: "Verifies document integrity / indexing. **Developer+**.",
		tags: ["RAG"],
		parameters: [pathParam("id", "Document id", "doc_01")],
		xCredits: 2,
		successDescription: "Verified",
	}),
);
add(
	"/api/v1/rag/credentials",
	"get",
	slimOp({
		summary: "Get RAG credentials status",
		description: "Returns Walrus Memory / RAG credential status.",
		tags: ["RAG"],
		xCredits: 1,
		successExample: { status: "ready" },
	}),
);
add(
	"/api/v1/rag/credentials/prepare",
	"post",
	slimOp({
		summary: "Prepare RAG credentials",
		description: "Starts credential provisioning. **Developer+**.",
		tags: ["RAG"],
		xCredits: 10,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{},
			false,
		),
		successDescription: "Prepared",
	}),
);
add(
	"/api/v1/rag/credentials/complete",
	"post",
	slimOp({
		summary: "Complete RAG credentials",
		description: "Completes credential provisioning. **Developer+**.",
		tags: ["RAG"],
		xCredits: 10,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{},
			false,
		),
		successDescription: "Completed",
	}),
);
add(
	"/api/v1/rag/credentials/verify",
	"post",
	slimOp({
		summary: "Verify RAG credentials",
		description: "Verifies RAG credentials. **Developer+**.",
		tags: ["RAG"],
		xCredits: 2,
		successDescription: "Verified",
	}),
);
add(
	"/api/v1/rag/recall",
	"post",
	op({
		summary: "Recall from RAG",
		description:
			"Retrieves relevant memory snippets for a query against Walrus Memory / RAG.",
		tags: ["RAG"],
		xCredits: 15,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["ownerAddress", "query"],
				properties: {
					ownerAddress: {
						type: "string",
						pattern: "^0x[0-9a-fA-F]+$",
						description: "Sui owner address / object id",
						example: "0xabc123",
					},
					query: {
						type: "string",
						minLength: 1,
						maxLength: 4000,
						example: "Refund policy for enterprise seats",
					},
					limit: {
						type: "integer",
						minimum: 1,
						maximum: 10,
						default: 5,
						example: 5,
					},
				},
			},
			{
				ownerAddress: "0xabc123",
				query: "Refund policy for enterprise seats",
				limit: 5,
			},
		),
		responses: {
			"200": jsonResponse(
				"Snippets",
				{ $ref: "#/components/schemas/RagRecallResponse" },
				{
					snippets: [
						{
							text: "Enterprise refunds are prorated within 14 days…",
							blobId: "blob_01",
							distance: 0.12,
						},
					],
				},
			),
		},
	}),
);

// —— Integrations ——
add(
	"/api/v1/mailboxes/{mailboxId}/telegram",
	"get",
	slimOp({
		summary: "Get Telegram link",
		description: "Returns Telegram linking status for a mailbox.",
		tags: ["Integrations"],
		parameters: triagerParams,
		xCredits: 1,
		successExample: { linked: false },
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/telegram/link",
	"post",
	slimOp({
		summary: "Link Telegram",
		description: "Starts or completes Telegram linking for a mailbox.",
		tags: ["Integrations"],
		parameters: triagerParams,
		xCredits: 2,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{},
			false,
		),
		successDescription: "Link started",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/telegram",
	"delete",
	slimOp({
		summary: "Unlink Telegram",
		description: "Removes Telegram linking for a mailbox.",
		tags: ["Integrations"],
		parameters: triagerParams,
		xCredits: 2,
		successDescription: "Unlinked",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/push",
	"get",
	slimOp({
		summary: "Get push subscription",
		description: "Returns web push subscription state.",
		tags: ["Integrations"],
		parameters: triagerParams,
		xCredits: 1,
		successExample: { subscribed: false },
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/push/subscribe",
	"post",
	slimOp({
		summary: "Subscribe push",
		description: "Registers a web push subscription.",
		tags: ["Integrations"],
		parameters: triagerParams,
		xCredits: 2,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{ endpoint: "https://push.example/…" },
		),
		successDescription: "Subscribed",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/push/subscribe",
	"delete",
	slimOp({
		summary: "Unsubscribe push",
		description: "Removes a web push subscription.",
		tags: ["Integrations"],
		parameters: triagerParams,
		xCredits: 2,
		successDescription: "Unsubscribed",
	}),
);

add(
	"/api/v1/integrations/composio/toolkits",
	"get",
	slimOp({
		summary: "List Composio toolkits",
		description:
			"Lists available Composio toolkits for the authenticated Mermail user (session, MCP OAuth, or API key).",
		tags: ["Integrations"],
		xCredits: 1,
		successExample: [{ slug: "apollo", name: "Apollo" }],
	}),
);
add(
	"/api/v1/integrations/composio/toolkits/{slug}/connect",
	"post",
	slimOp({
		summary: "Connect Composio toolkit",
		description:
			"Starts hosted OAuth or API-key connect for a toolkit. Returns redirectUrl for browser auth.",
		tags: ["Integrations"],
		parameters: [pathParam("slug", "Toolkit slug", "apollo")],
		xCredits: 10,
		requestBody: jsonBody(
			{
				type: "object",
				properties: {
					callbackUrl: { type: "string" },
					authMethod: { type: "string", enum: ["oauth", "api_key"] },
					apiKey: { type: "string" },
				},
				additionalProperties: false,
			},
			{},
			false,
		),
		successDescription: "Connect URL / status",
	}),
);
add(
	"/api/v1/integrations/composio/toolkits/{slug}/connection",
	"delete",
	slimOp({
		summary: "Disconnect Composio toolkit",
		description: "Removes a toolkit connection for the authenticated Mermail user.",
		tags: ["Integrations"],
		parameters: [pathParam("slug", "Toolkit slug", "apollo")],
		xCredits: 2,
		successDescription: "Disconnected",
	}),
);
add(
	"/api/v1/integrations/composio/connections",
	"get",
	slimOp({
		summary: "List Composio connections",
		description: "Lists Composio connections for the authenticated Mermail user.",
		tags: ["Integrations"],
		xCredits: 1,
		successExample: [],
	}),
);
add(
	"/api/v1/integrations/composio/connections/sync",
	"post",
	slimOp({
		summary: "Sync Composio connections",
		description: "Refreshes connection state from Composio into Mermail.",
		tags: ["Integrations"],
		xCredits: 2,
		successDescription: "Synced",
	}),
);
add(
	"/api/v1/integrations/composio/tools",
	"get",
	slimOp({
		summary: "Search Composio tools",
		description:
			"Search third-party Composio tool actions. Query params: search, toolkit, limit. Gmail/Outlook tools are omitted.",
		tags: ["Integrations"],
		xCredits: 1,
		successExample: {
			configured: true,
			tools: [{ slug: "APOLLO_PEOPLE_SEARCH", toolkitSlug: "apollo", risk: "read" }],
		},
	}),
);
add(
	"/api/v1/integrations/composio/tools/{slug}",
	"get",
	slimOp({
		summary: "Get Composio tool schema",
		description: "Returns input schema and policy metadata for one Composio tool slug.",
		tags: ["Integrations"],
		parameters: [pathParam("slug", "Tool slug", "APOLLO_PEOPLE_SEARCH")],
		xCredits: 1,
		successExample: {
			configured: true,
			tool: { slug: "APOLLO_PEOPLE_SEARCH", connected: true, allowed: true },
		},
	}),
);
add(
	"/api/v1/integrations/composio/tools/execute",
	"post",
	slimOp({
		summary: "Execute Composio tool",
		description:
			"Executes a connected Composio tool for the authenticated Mermail user. Requires an ACTIVE toolkit connection.",
		tags: ["Integrations"],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				required: ["slug"],
				properties: {
					slug: { type: "string" },
					arguments: { type: "object", additionalProperties: true },
					connectedAccountId: { type: "string" },
				},
				additionalProperties: false,
			},
			{ slug: "APOLLO_PEOPLE_SEARCH", arguments: {} },
			true,
		),
		successDescription: "Execution result",
	}),
);
add(
	"/api/v1/integrations/composio/calendar/account",
	"get",
	slimOp({
		summary: "Get Composio calendar account",
		description: "Returns Google Calendar connection status and account email when available.",
		tags: ["Integrations"],
		xCredits: 1,
		successExample: { connected: false },
	}),
);

// —— Affiliate ——
add(
	"/api/v1/affiliate/me",
	"get",
	slimOp({
		summary: "Get affiliate profile",
		description: "Returns the current user's affiliate profile.",
		tags: ["Affiliate"],
		xCredits: 1,
		successExample: { code: "ACME", status: "active" },
	}),
);
add(
	"/api/v1/affiliate/me",
	"patch",
	slimOp({
		summary: "Update affiliate profile",
		description: "Updates affiliate profile fields.",
		tags: ["Affiliate"],
		xCredits: 2,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{ payoutEmail: "finance@acme.com" },
		),
		successDescription: "Updated",
	}),
);
add(
	"/api/v1/affiliate/signup",
	"post",
	slimOp({
		summary: "Sign up as affiliate",
		description: "Registers the current user in the affiliate program.",
		tags: ["Affiliate"],
		xCredits: 2,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{},
			false,
		),
		successStatus: "201",
		successDescription: "Signed up",
	}),
);
add(
	"/api/v1/affiliate/analytics",
	"get",
	slimOp({
		summary: "Get affiliate analytics",
		description: "Returns affiliate click / conversion analytics.",
		tags: ["Affiliate"],
		xCredits: 1,
		successExample: { clicks: 120, signups: 8 },
	}),
);
add(
	"/api/v1/affiliate/payouts",
	"get",
	slimOp({
		summary: "List affiliate payouts",
		description: "Lists payout history.",
		tags: ["Affiliate"],
		xCredits: 1,
		successExample: [],
	}),
);
add(
	"/api/v1/affiliate/commissions",
	"get",
	slimOp({
		summary: "List affiliate commissions",
		description: "Lists commission ledger entries.",
		tags: ["Affiliate"],
		xCredits: 1,
		successExample: [],
	}),
);
add(
	"/api/affiliate/track",
	"get",
	op({
		summary: "Track affiliate click",
		description:
			"Public affiliate tracking redirect / pixel. No Bearer authentication required.",
		tags: ["Affiliate"],
		security: [],
		parameters: [
			queryParam("code", {
				description: "Affiliate referral code",
				required: true,
				example: "ACME",
			}),
		],
		responses: {
			"200": jsonResponse("Tracked", { type: "object" }, { ok: true }),
			"302": { description: "Redirect to landing" },
		},
	}),
);

const spec = {
	openapi: "3.1.0",
	"x-mermail-tool-profiles": {
		"agent-inbox": {
			description:
				"Opt-in least-privilege MCP profile. Hosted clients should connect to `/mcp?profile=agent-inbox`; clients that support fixed headers may instead send `x-mermail-tool-profile: agent-inbox` on every stateless MCP POST. The profile forces metadata-only, clean-scan, agent-safe list/search results; clean-scan, agent-safe get results capped at 12000 body characters; and a 128000-character JSON tool-result ceiling. `/mcp` and an absent selector keep the full catalog.",
			recommendedUrl: "/mcp?profile=agent-inbox",
			defaultUrl: "/mcp",
			header: {
				name: "x-mermail-tool-profile",
				value: "agent-inbox",
			},
			unknownValueError: {
				status: 400,
				code: "invalid_mcp_tool_profile",
			},
			operations: AGENT_INBOX_PROFILE_OPERATIONS,
		},
	},
	info: {
		title: "Mermail API",
		version: "1.0.0",
		description: `Programmatic Mermail API for scripts, agents, and integrations.

## Authentication

Authorize with an API key from **Settings → API Keys**:

\`\`\`
x-api-key: sk-proj-…
\`\`\`

## Plans

Each endpoint page shows plan badges (**Public**, **All plans**, or **Developer+**). Free can call the core catalog; Developer-gated paths need Developer or Enterprise.

## Try it

Every endpoint page includes an interactive playground. Click **Try it**, paste your API key into the \`x-api-key\` field, fill path/query/body fields (prefilled from examples), and send a live request to \`https://console.mermail.app\`. You can also copy the generated cURL / JavaScript / Python snippet.

## Credits

Credits are workspace API-usage units, not currency amounts.

| Class | Cost |
| --- | ---: |
| read | 1 |
| write | 2 |
| email_send | 5 |
| provision | 10 |
| ai_light | 15 |
| ai_heavy | 25 |
`,
		contact: {
			name: "Mermail",
			email: "contact@mermail.app",
			url: "https://mermail.app",
		},
	},
	servers: [
		{ url: "https://console.mermail.app", description: "Production" },
	],
	tags: [
		{ name: "Public", description: "No authentication" },
		{ name: "Usage", description: "Credits and email quotas" },
		{ name: "Workspaces", description: "Workspaces, members, storage" },
		{ name: "Domains", description: "Custom email domains (Developer+)" },
		{ name: "Mailboxes", description: "Agent inboxes" },
		{ name: "Emails", description: "Send, list, search, folders" },
		{ name: "AI agent", description: "Mailbox agent chat" },
		{ name: "Task triage", description: "Task triagers (all plans)" },
		{ name: "RAG", description: "Knowledge documents and recall" },
		{ name: "Integrations", description: "Composio, Telegram, push" },
		{ name: "Affiliate", description: "Affiliate program" },
	],
	security: apiKeySecurity,
	paths,
	components: {
		securitySchemes: {
			apiKeyAuth: {
				type: "apiKey",
				in: "header",
				name: "x-api-key",
				description:
					"API key (`sk-proj-…`) from Settings → API Keys. Required for sold API calls outside the Mermail console.",
			},
		},
		schemas: {
			Error: {
				type: "object",
				required: ["error"],
				properties: {
					error: { type: "string", example: "Unauthorized" },
					code: { type: "string" },
				},
			},
			ApiCreditUsage: {
				type: "object",
				properties: {
					plan: { type: "string", example: "developer" },
					plan_name: { type: "string", example: "Developer" },
					period_start: { type: "string", format: "date-time" },
					period_end: { type: "string", format: "date-time" },
					limit: {
						type: ["number", "null"],
						description: "Null when the plan has unlimited API credits",
						example: 50000,
					},
					used: { type: "number", example: 1240 },
					remaining: {
						type: ["number", "null"],
						description: "Null when unlimited",
						example: 48760,
					},
				},
			},
			EmailUsage: {
				type: "object",
				properties: {
					workspace_id: { type: "string" },
					plan: { type: "string" },
					plan_name: { type: "string" },
					period_start: { type: "string", format: "date-time" },
					period_end: { type: "string", format: "date-time" },
					quota: {
						type: ["number", "null"],
						description: "Plan email send quota (recipient count); null if unlimited",
					},
					used: { type: "number" },
					remaining: { type: ["number", "null"] },
					legacy_sent_count: {
						type: "number",
						description: "Pre-ledger sent recipients included in `used`",
					},
					mailboxes: {
						type: "array",
						items: {
							type: "object",
							properties: {
								id: { type: "string" },
								name: { type: "string" },
								email: { type: "string" },
								sent: { type: "number" },
								providers: {
									type: "object",
									additionalProperties: { type: "number" },
								},
							},
						},
					},
				},
			},
			Workspace: {
				type: "object",
				properties: {
					id: { type: "string" },
					name: { type: "string" },
					owner_address: { type: "string" },
					timezone: { type: ["string", "null"] },
					role: { type: "string", enum: ["admin", "member"] },
					mailbox_count: { type: "integer" },
					storage: { type: "object", additionalProperties: true },
					created_at: { type: "string", format: "date-time" },
					updated_at: { type: "string", format: "date-time" },
				},
			},
			WorkspaceListResponse: {
				type: "object",
				properties: {
					user: {
						type: "object",
						properties: { is_admin: { type: "boolean" } },
					},
					workspaces: {
						type: "array",
						items: { $ref: "#/components/schemas/Workspace" },
					},
				},
			},
			Mailbox: {
				type: "object",
				properties: {
					id: {
						type: "string",
						description: "Hosted alias primary key (also accepted as mailboxId)",
					},
					public_id: {
						type: "string",
						format: "uuid",
						description:
							"Stable public route id; preferred mailboxId for agents and clients",
					},
					workspace_id: { type: "string" },
					email: { type: "string", format: "email" },
					name: { type: "string" },
					email_domain_id: { type: ["string", "null"] },
					inbound_provider: {
						type: "string",
						description: "Provider configured for inbound delivery",
					},
					outbound_provider: {
						type: "string",
						description: "Provider configured for outbound delivery",
					},
					provider_metadata: { type: "object", additionalProperties: true },
					bucket_id: { type: ["string", "null"] },
					settings: mailboxSettingsSchema,
					disabled_at: {
						type: ["string", "null"],
						format: "date-time",
						description:
							"Non-null when the mailbox is disabled and should not be reused",
					},
					disabled_reason: {
						type: ["string", "null"],
						description: "Reason the mailbox was disabled, when present",
					},
					can_receive: {
						type: "boolean",
						description:
							"Current receiving-readiness boolean derived from mailbox lifecycle, inbound-provider state, and the current Receiving MX verification state for custom domains",
					},
					receiving_status: {
						type: "string",
						enum: ["ready", "disabled", "unavailable"],
						description:
							"Current normalized inbound readiness. Custom-domain mailboxes become unavailable when their Receiving MX verification is not ready.",
					},
					welcome_onboarding_status: {
						type: "string",
						description:
							"Internal welcome/demo-message workflow status. This is not inbound receiving readiness.",
					},
					inbox_unread_by_category: {
						type: "object",
						description: "Present on list endpoints only",
						properties: {
							customer_support: { type: "integer" },
							partnership: { type: "integer" },
							technical: { type: "integer" },
							other: { type: "integer" },
						},
					},
				},
			},
			MailboxStorage: {
				type: "object",
				properties: {
					mailbox_id: { type: "string" },
					email: { type: "string" },
					storage_gb: { type: "number" },
					blob_count: { type: "integer" },
				},
			},
			Email: {
				type: "object",
				properties: {
					id: {
						type: "string",
						description:
							"Authoritative Mermail email id. Use this value as the `emailId` path argument and for pre-wait baselines.",
					},
					subject: { type: "string" },
					sender: { type: "string" },
					recipient: { type: "string" },
					cc: {
						type: ["string", "null"],
					},
					bcc: {
						type: ["string", "null"],
					},
					date: { type: "string", format: "date-time" },
					read: { type: "boolean" },
					starred: { type: "boolean" },
					is_urgent: { type: "boolean" },
					category: { type: "string" },
					folder_id: { type: "string" },
					folder_name: {
						type: "string",
						description: "Present on list and search responses",
					},
					thread_id: { type: ["string", "null"] },
					snippet: { type: "string" },
					body: {
						type: "string",
						description:
							"Full body on detail responses unless `metadata_only=true`; list/search responses can contain a preview",
					},
					in_reply_to: { type: ["string", "null"] },
					email_references: { type: ["string", "null"] },
					delivery_status: { type: ["string", "null"] },
					provider_metadata: {
						type: ["object", "null"],
						additionalProperties: true,
					},
					message_id: {
						type: ["string", "null"],
						description:
							"Provider or RFC Message-ID metadata, retained only as secondary correlation. Do not use it in place of the Mermail `id` for resource paths or new baselines.",
					},
					raw_headers: {
						type: ["string", "null"],
						description:
							"Untrusted raw provider headers. Do not use headers alone as authorization.",
					},
					body_storage_status: { type: "string" },
					body_storage_message: { type: "string" },
					scan_status: {
						type: ["string", "null"],
						enum: ["clean", "flagged", "skipped", null],
						description:
							"Content scan outcome. Treat `flagged` as unsafe and `skipped` as unknown.",
					},
					scan_threats: {
						type: "array",
						items: {
							type: "object",
							properties: {
								url: { type: "string" },
								threat_type: { type: "string" },
								source: {
									type: "string",
									enum: ["body", "attachment"],
								},
								attachment_filename: { type: "string" },
							},
						},
					},
					sender_authentication: {
						type: "object",
						description:
							"Sender-authentication verdict derived only from a trusted receiving-provider signal. Raw Authentication-Results and From headers are never promoted to trusted evidence. The current connected providers do not expose a documented per-message verdict, so status is unknown; unknown is not a pass.",
						required: [
							"status",
							"spf",
							"dkim",
							"dmarc",
							"inbound_provider",
							"reason",
						],
						properties: {
							status: {
								type: "string",
								enum: ["pass", "fail", "unknown"],
							},
							spf: {
								type: "string",
								enum: ["pass", "fail", "unknown"],
							},
							dkim: {
								type: "string",
								enum: ["pass", "fail", "unknown"],
							},
							dmarc: {
								type: "string",
								enum: ["pass", "fail", "unknown"],
							},
							inbound_provider: {
								type: ["string", "null"],
								enum: ["cloudflare_routing", "resend", null],
								description:
									"Trusted transport source recorded by Mermail; this is not itself a sender verdict.",
							},
							reason: {
								type: "string",
								enum: [
									"provider_sender_authentication_verdict_unavailable",
									"inbound_provider_unavailable",
								],
							},
						},
						additionalProperties: false,
					},
					attachments: {
						type: "array",
						items: {
							type: "object",
							properties: {
								id: { type: "string" },
								filename: { type: "string" },
								mimetype: { type: "string" },
								size: { type: "integer" },
								content_id: { type: ["string", "null"] },
								disposition: { type: ["string", "null"] },
							},
						},
					},
					content_omitted: {
						type: "boolean",
						description:
							"True when metadata_only omitted body, snippet, raw headers, and threat URLs",
					},
					content_truncated: {
						type: "boolean",
						description:
							"True when `max_body_chars` shortened the returned body",
					},
					body_original_char_count: {
						type: "integer",
						minimum: 0,
						description:
							"Original stored body character count, present when the returned body was truncated",
					},
					agent_safe_content: {
						type: "boolean",
						description:
							"True when raw headers, provider metadata, threat details, attachment metadata, and storage diagnostics were omitted and untrusted text fields were normalized to bounded plain text. This projection does not make email content trusted.",
					},
					attachment_count: {
						type: "integer",
						minimum: 0,
						description:
							"Attachment count retained when `agent_safe_content=true` omits attachment metadata",
					},
				},
			},
			EmailListResponse: {
				type: "object",
				properties: {
					emails: {
						type: "array",
						items: { $ref: "#/components/schemas/Email" },
					},
					totalCount: { type: "integer" },
				},
			},
			SendEmailResult: {
				type: "object",
				properties: {
					id: { type: "string" },
					status: { type: "string", example: "sent" },
				},
			},
			Folder: {
				type: "object",
				properties: {
					id: { type: "string" },
					name: { type: "string" },
					unreadCount: { type: "integer" },
				},
			},
			EmailDomain: {
				type: "object",
				properties: {
					id: { type: "string" },
					workspace_id: { type: "string" },
					domain: { type: "string" },
					provider: { type: "string", example: "resend" },
					status: {
						type: "string",
						description:
							"Provider/local status such as `pending`, `verified`, `deleting`, `deleted`",
					},
					provider_domain_id: { type: ["string", "null"] },
					region: { type: ["string", "null"] },
					dns_records: {
						type: ["array", "null"],
						items: { type: "object", additionalProperties: true },
					},
					last_error: { type: ["string", "null"] },
					verified_at: {
						type: ["string", "null"],
						format: "date-time",
					},
					created_at: { type: "string", format: "date-time" },
					updated_at: { type: "string", format: "date-time" },
				},
			},
			RagRecallResponse: {
				type: "object",
				properties: {
					snippets: {
						type: "array",
						items: {
							type: "object",
							properties: {
								text: { type: "string" },
								blobId: { type: "string" },
								distance: { type: "number" },
							},
						},
					},
				},
			},
		},
	},
};

// Fix: slimOp/op merge — ops that set xCredits already append credit line via op();
// but slimOp passes xCredits to op which duplicates description append. OK.

applyPlanBadgesToPaths(paths);

const agentInboxProfileKeys = new Set(
	AGENT_INBOX_PROFILE_OPERATIONS.map(
		(operation) => `${operation.method} ${operation.path} ${operation.name}`,
	),
);
if (
	AGENT_INBOX_PROFILE_OPERATIONS.length !== 11 ||
	agentInboxProfileKeys.size !== 11
) {
	throw new Error("The agent-inbox profile must contain exactly 11 unique operations");
}
for (const operation of AGENT_INBOX_PROFILE_OPERATIONS) {
	if (!paths[operation.path]?.[operation.method.toLowerCase()]) {
		throw new Error(
			`Agent-inbox profile operation is missing from OpenAPI: ${operation.method} ${operation.path}`,
		);
	}
}

const safeEmailReadContracts = [
	{
		path: "/api/v1/mailboxes/{mailboxId}/emails",
		method: "get",
		parameters: [
			"metadata_only",
			"include_held",
			"require_scan_status",
			"agent_safe_content",
		],
	},
	{
		path: "/api/v1/mailboxes/{mailboxId}/search",
		method: "get",
		parameters: [
			"metadata_only",
			"include_held",
			"require_scan_status",
			"agent_safe_content",
		],
	},
	{
		path: "/api/v1/mailboxes/{mailboxId}/emails/{emailId}",
		method: "get",
		parameters: [
			"metadata_only",
			"include_held",
			"require_scan_status",
			"max_body_chars",
			"agent_safe_content",
		],
	},
];
for (const contract of safeEmailReadContracts) {
	const operation = paths[contract.path]?.[contract.method];
	const parameterNames = new Set(
		operation?.parameters?.map((parameter) => parameter.name) ?? [],
	);
	for (const parameter of contract.parameters) {
		if (!parameterNames.has(parameter)) {
			throw new Error(
				`Safe email read parameter is missing from OpenAPI: ${contract.method.toUpperCase()} ${contract.path} ${parameter}`,
			);
		}
	}
}

if (
	!mailboxSettingsSchema.properties.agentInbox.properties
		.requireCleanScanForAutomation
) {
	throw new Error(
		"Mailbox settings must document requireCleanScanForAutomation",
	);
}
for (const field of [
	"content_truncated",
	"body_original_char_count",
	"agent_safe_content",
	"attachment_count",
	"sender_authentication",
]) {
	if (!spec.components.schemas.Email.properties[field]) {
		throw new Error(`Email schema is missing safe-read field: ${field}`);
	}
}
const senderAuthenticationSchema =
	spec.components.schemas.Email.properties.sender_authentication;
if (
	!senderAuthenticationSchema.description.includes("unknown is not a pass") ||
	senderAuthenticationSchema.properties.inbound_provider.description.includes(
		"sender verdict",
	) === false
) {
	throw new Error(
		"Email sender_authentication must document provider limitations",
	);
}
if (
	spec["x-mermail-tool-profiles"]["agent-inbox"].recommendedUrl !==
	"/mcp?profile=agent-inbox"
) {
	throw new Error("Agent-inbox profile must publish its recommended scoped URL");
}
if (
	!paths["/api/v1/mailboxes"].post.responses["413"] ||
	!idempotencyKeyParam().description.includes(
		"idempotency_payload_too_large",
	)
) {
	throw new Error("Mailbox create must document the idempotency body ceiling");
}

const outPath = path.join(root, "openapi", "openapi.json");
fs.writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);
const count = Object.values(paths).reduce(
	(n, methods) => n + Object.keys(methods).length,
	0,
);
console.log(`Wrote ${outPath} (${count} operations)`);
