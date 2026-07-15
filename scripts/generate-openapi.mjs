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
	if (pathname.includes("/task-triager")) return true;
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
add(
	"/api/v1/workspaces/{workspaceId}/usage/credits",
	"get",
	op({
		summary: "Get API credit usage",
		description:
			"Returns the workspace plan, billing period, credit limit, used credits, and remaining balance. Use this before running batch jobs against the sold API.",
		tags: ["Usage"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		responses: {
			"200": jsonResponse(
				"Credit usage for the current period",
				{ $ref: "#/components/schemas/ApiCreditUsage" },
				{
					plan: "developer",
					periodStart: "2026-07-01T00:00:00.000Z",
					periodEnd: "2026-08-01T00:00:00.000Z",
					limit: 50000,
					used: 1240,
					remaining: 48760,
				},
			),
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/usage/email",
	"get",
	slimOp({
		summary: "Get email usage",
		description:
			"Returns email send usage for the workspace subscription period (distinct from API credits).",
		tags: ["Usage"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		successExample: {
			plan: "developer",
			limit: 10000,
			used: 320,
			remaining: 9680,
		},
	}),
);

// —— Workspaces ——
add(
	"/api/v1/workspaces",
	"get",
	op({
		summary: "List workspaces",
		description:
			"Lists workspaces the caller can access. With an API key (`x-api-key`), the list is limited to the **single workspace** the key is bound to.",
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
			"Returns a single workspace the caller can access. With an API key, `workspaceId` must match the key’s workspace (`403` otherwise).",
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
				description: "Not found",
				...errorContent({ error: "Not found" }),
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
			"Updates workspace settings. Requires workspace **admin**. At least one of `name` or `timezone` is required. With an API key, `workspaceId` must match the key’s workspace.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: {
					name: { type: "string", example: "Acme Agents" },
					timezone: {
						type: "string",
						nullable: true,
						example: "America/New_York",
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
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}",
	"delete",
	slimOp({
		summary: "Delete workspace",
		description: "Deletes a workspace. Requires workspace **admin**.",
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
		description: "Returns Harbor / R2 storage provisioning status for the workspace.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		successExample: workspaceExample.storage,
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/storage",
	"put",
	slimOp({
		summary: "Update workspace storage",
		description:
			"Updates storage settings. **Developer or Enterprise** plan required.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{},
			false,
		),
		successExample: workspaceExample.storage,
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/members",
	"get",
	slimOp({
		summary: "List workspace members",
		description: "Lists members and roles for the workspace.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		successExample: [
			{
				address: "0xabc123def456",
				email: "owner@acme.com",
				role: "admin",
				name: "Owner",
			},
		],
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/members/{memberId}",
	"put",
	op({
		summary: "Update member role",
		description:
			"Updates a member role. `memberId` is the member's Sui wallet address. Requires workspace **admin**.",
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
					properties: { status: { type: "string" } },
				},
				{ status: "updated" },
			),
			"404": {
				description: "Member not found",
				...errorContent({ error: "Not found" }),
			},
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/members/{memberId}",
	"delete",
	slimOp({
		summary: "Remove member",
		description: "Removes a member from the workspace. Requires **admin**.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
			pathParam("memberId", "Member wallet address", "0xmember…"),
		],
		xCredits: 2,
		successStatus: "204",
		successDescription: "Removed",
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/invites",
	"post",
	slimOp({
		summary: "Invite member",
		description: "Sends a workspace invite email. Requires **admin**.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: {
					email: { type: "string", format: "email", example: "dev@acme.com" },
					role: { type: "string", enum: ["admin", "member"], example: "member" },
				},
			},
			{ email: "dev@acme.com", role: "member" },
		),
		successStatus: "201",
		successDescription: "Invite created",
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/invites/{inviteId}/resend",
	"post",
	slimOp({
		summary: "Resend invite",
		description: "Resends a pending invite. Requires **admin**.",
		tags: ["Workspaces"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
			pathParam("inviteId", "Invite id", "inv_01xyz"),
		],
		xCredits: 2,
		successDescription: "Invite resent",
	}),
);

// —— Domains ——
add(
	"/api/v1/workspaces/{workspaceId}/email-domains",
	"get",
	slimOp({
		summary: "List email domains",
		description:
			"Lists custom email domains. **Developer or Enterprise** required.",
		tags: ["Domains"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		successExample: [
			{
				id: "ed_01xyz",
				workspace_id: "ws_01abc",
				domain: "mail.acme.com",
				provider: "resend",
				status: "pending",
				dns_records: [],
				last_error: null,
				verified_at: null,
			},
		],
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/email-domains",
	"post",
	op({
		summary: "Add email domain",
		description:
			"Starts custom domain provisioning. Domain must be a subdomain (for example `mail.acme.com`). **Developer or Enterprise** required.",
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
						description: "Subdomain used for agent mailboxes",
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
				{
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
					],
					last_error: null,
					verified_at: null,
					created_at: "2026-07-15T10:00:00.000Z",
					updated_at: "2026-07-15T10:00:00.000Z",
				},
			),
			"400": {
				description: "Invalid domain shape",
				...errorContent({ error: "Invalid request" }),
			},
		},
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/email-domains/{domainId}",
	"delete",
	slimOp({
		summary: "Delete email domain",
		description: "Removes a custom domain. **Developer or Enterprise** required.",
		tags: ["Domains"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
			pathParam("domainId", "Email domain id", "ed_01xyz"),
		],
		xCredits: 2,
		successDescription: "Domain deleted",
	}),
);

add(
	"/api/v1/workspaces/{workspaceId}/email-domains/{domainId}/verify",
	"post",
	slimOp({
		summary: "Verify email domain",
		description:
			"Checks DNS records and marks the domain verified when ready. **Developer or Enterprise** required.",
		tags: ["Domains"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
			pathParam("domainId", "Email domain id", "ed_01xyz"),
		],
		xCredits: 2,
		successExample: {
			id: "ed_01xyz",
			status: "verified",
			verified_at: "2026-07-15T11:00:00.000Z",
		},
	}),
);

// —— Mailboxes ——
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
			description: "Display name",
			example: "Acme Support",
		},
		workspaceId: {
			type: "string",
			description: "Required for POST /api/v1/mailboxes",
			example: "ws_01abc",
		},
		settings: {
			type: "object",
			additionalProperties: true,
			description: "Optional mailbox settings object",
		},
	},
};

add(
	"/api/v1/workspaces/{workspaceId}/mailboxes",
	"get",
	slimOp({
		summary: "List workspace mailboxes",
		description: "Lists mailboxes in a workspace.",
		tags: ["Mailboxes"],
		parameters: [
			pathParam("workspaceId", "Workspace id", "ws_01abc"),
		],
		xCredits: 1,
		successExample: [mailboxExample],
	}),
);

add(
	"/api/v1/mailboxes",
	"get",
	op({
		summary: "List mailboxes",
		description:
			"Lists mailboxes visible to the user. Optionally filter by workspace. Includes unread category counts when listing.",
		tags: ["Mailboxes"],
		parameters: [
			queryParam("workspaceId", {
				description: "Filter by workspace id",
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
				[
					{
						...mailboxExample,
						inbox_unread_by_category: {
							customer_support: 3,
							partnership: 0,
							technical: 1,
							other: 2,
						},
					},
				],
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
			"Provisions a mailbox. `workspaceId` is required in the body for this route.",
		tags: ["Mailboxes"],
		xCredits: 10,
		requestBody: jsonBody(createMailboxBody, {
			email: "ops@mail.acme.com",
			name: "Acme Ops",
			workspaceId: "ws_01abc",
		}),
		responses: {
			"201": jsonResponse(
				"Mailbox created",
				{ $ref: "#/components/schemas/Mailbox" },
				{ ...mailboxExample, email: "ops@mail.acme.com", name: "Acme Ops" },
			),
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}",
	"get",
	op({
		summary: "Get mailbox",
		description: "Returns a single mailbox by id (usually the email address).",
		tags: ["Mailboxes"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
		],
		xCredits: 1,
		responses: {
			"200": jsonResponse(
				"Mailbox",
				{ $ref: "#/components/schemas/Mailbox" },
				mailboxExample,
			),
		},
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}",
	"put",
	slimOp({
		summary: "Update mailbox",
		description: "Updates mailbox name or settings.",
		tags: ["Mailboxes"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: {
					name: { type: "string", example: "Acme Support" },
					settings: { type: "object", additionalProperties: true },
				},
			},
			{ name: "Acme Support" },
		),
		successExample: mailboxExample,
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/storage",
	"get",
	slimOp({
		summary: "Get mailbox storage",
		description: "Returns storage usage for a mailbox.",
		tags: ["Mailboxes"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
		],
		xCredits: 1,
		successExample: { usedBytes: 1048576, limitBytes: 10737418240 },
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
	pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
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
			"Lists emails in a mailbox. When `folder` or `is_starred` is set, the response is `{ emails, totalCount }`; otherwise a bare array may be returned.",
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
			"Sends a new outbound email from the mailbox. Provide `html` and/or `text`. Subject to send rate limits and API credits.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
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
	slimOp({
		summary: "Get email",
		description: "Fetches a single email with body and metadata.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("emailId", "Email id", "msg_7f3a2c1b"),
		],
		xCredits: 1,
		successExample: emailListItem,
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
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
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
		description: "Deletes or trashes an email.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("emailId", "Email id", "msg_7f3a2c1b"),
		],
		xCredits: 2,
		successDescription: "Deleted",
	}),
);

for (const [suffix, summary, desc] of [
	["bulk-delete", "Bulk delete emails", "Deletes multiple emails by id."],
	["bulk-read", "Bulk mark emails read", "Marks multiple emails read/unread."],
	["bulk-move", "Bulk move emails", "Moves multiple emails to a folder."],
]) {
	add(
		`/api/v1/mailboxes/{mailboxId}/emails/${suffix}`,
		"post",
		slimOp({
			summary,
			description: desc,
			tags: ["Emails"],
			parameters: [
				pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			],
			xCredits: 2,
			requestBody: jsonBody(
				{
					type: "object",
					properties: {
						ids: {
							type: "array",
							items: { type: "string" },
							example: ["msg_1", "msg_2"],
						},
						folderId: { type: "string" },
						read: { type: "boolean" },
					},
				},
				{ ids: ["msg_7f3a2c1b"] },
			),
			successDescription: "Bulk operation completed",
		}),
	);
}

add(
	"/api/v1/mailboxes/{mailboxId}/emails/{emailId}/move",
	"post",
	slimOp({
		summary: "Move email",
		description: "Moves one email into a folder.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("emailId", "Email id", "msg_7f3a2c1b"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: { folderId: { type: "string", example: "ARCHIVE" } },
			},
			{ folderId: "ARCHIVE" },
		),
		successDescription: "Moved",
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
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
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
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
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
	slimOp({
		summary: "Download attachment",
		description: "Downloads an email attachment.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("emailId", "Email id", "msg_7f3a2c1b"),
			pathParam("attachmentId", "Attachment id", "att_01"),
		],
		xCredits: 1,
		successDescription: "Attachment bytes / metadata",
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/drafts",
	"post",
	slimOp({
		summary: "Save draft",
		description: "Creates or updates a draft message.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{
				to: ["hello@example.com"],
				subject: "Draft",
				text: "Working…",
			},
		),
		successDescription: "Draft saved",
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/drafts/regenerate",
	"post",
	slimOp({
		summary: "Regenerate draft with AI",
		description: "Uses AI to regenerate a draft body for review.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
		],
		xCredits: 15,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{ draftId: "dft_01" },
		),
		successDescription: "Draft regenerated",
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/scheduled-sends",
	"post",
	slimOp({
		summary: "Schedule send",
		description: "Schedules an outbound email for a future time.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
		],
		xCredits: 5,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{
				to: ["hello@example.com"],
				from: "support@mail.acme.com",
				subject: "Later",
				text: "See you",
				sendAt: "2026-07-16T15:00:00.000Z",
			},
		),
		successDescription: "Scheduled",
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/trash/empty",
	"post",
	slimOp({
		summary: "Empty trash",
		description: "Permanently deletes messages in trash.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
		],
		xCredits: 2,
		successDescription: "Trash emptied",
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/threads/{threadId}",
	"get",
	slimOp({
		summary: "Get thread",
		description: "Returns a conversation thread and its messages.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("threadId", "Thread id", "thr_9aabb"),
		],
		xCredits: 1,
		successExample: { id: "thr_9aabb", emails: [emailListItem] },
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
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("threadId", "Thread id", "thr_9aabb"),
		],
		xCredits: 2,
		successDescription: "Marked read",
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
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
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
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
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
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
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
		description: "Deletes a custom folder.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("folderId", "Folder id", "vip-customers"),
		],
		xCredits: 2,
		successDescription: "Deleted",
	}),
);

add(
	"/api/v1/mailboxes/{mailboxId}/search",
	"get",
	op({
		summary: "Search emails",
		description:
			"Full-text / field search across mailbox messages. Returns `{ emails, totalCount }`.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
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
add(
	"/api/v1/mailboxes/{mailboxId}/custom-labels",
	"get",
	slimOp({
		summary: "List custom labels",
		description: "Lists custom labels for a mailbox.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
		],
		xCredits: 1,
		successExample: [{ id: "lbl_1", name: "VIP", slug: "vip", color: "#43c9cb" }],
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/custom-labels",
	"post",
	slimOp({
		summary: "Create custom label",
		description: "Creates a custom label.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: {
					name: { type: "string", example: "VIP" },
					color: { type: "string", example: "#43c9cb" },
				},
			},
			{ name: "VIP", color: "#43c9cb" },
		),
		successStatus: "201",
		successDescription: "Label created",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/custom-labels/{labelId}",
	"put",
	slimOp({
		summary: "Update custom label",
		description: "Updates a custom label.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("labelId", "Label id", "lbl_1"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{ name: "VIP+" },
		),
		successDescription: "Updated",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/custom-labels/{labelId}",
	"delete",
	slimOp({
		summary: "Delete custom label",
		description: "Deletes a custom label.",
		tags: ["Emails"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("labelId", "Label id", "lbl_1"),
		],
		xCredits: 2,
		successDescription: "Deleted",
	}),
);

// —— AI agent ——
add(
	"/api/v1/mailboxes/{mailboxId}/agent-conversations",
	"get",
	slimOp({
		summary: "List agent conversations",
		description: "Lists AI agent chat conversations for a mailbox.",
		tags: ["AI agent"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
		],
		xCredits: 1,
		successExample: [
			{
				id: "conv_01",
				title: "Billing help",
				updatedAt: "2026-07-15T10:00:00.000Z",
			},
		],
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/agent-conversations",
	"post",
	slimOp({
		summary: "Create agent conversation",
		description: "Creates a new agent conversation thread.",
		tags: ["AI agent"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: { title: { type: "string" } },
			},
			{ title: "Billing help" },
			false,
		),
		successStatus: "201",
		successExample: { id: "conv_01", title: "Billing help" },
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/agent-conversations/{conversationId}",
	"patch",
	slimOp({
		summary: "Update agent conversation",
		description: "Updates conversation metadata (for example title).",
		tags: ["AI agent"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("conversationId", "Conversation id", "conv_01"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{ type: "object", properties: { title: { type: "string" } } },
			{ title: "Updated" },
		),
		successDescription: "Updated",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/agent-conversations/{conversationId}",
	"delete",
	slimOp({
		summary: "Delete agent conversation",
		description: "Deletes an agent conversation.",
		tags: ["AI agent"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("conversationId", "Conversation id", "conv_01"),
		],
		xCredits: 2,
		successDescription: "Deleted",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/agent-conversations/{conversationId}/messages",
	"get",
	slimOp({
		summary: "List agent messages",
		description: "Lists messages in an agent conversation.",
		tags: ["AI agent"],
		parameters: [
			pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
			pathParam("conversationId", "Conversation id", "conv_01"),
		],
		xCredits: 1,
		successExample: [
			{ id: "m1", role: "user", content: "Summarize inbox" },
			{ id: "m2", role: "assistant", content: "You have 3 unread…" },
		],
	}),
);

add(
	"/api/agent/mailbox",
	"post",
	op({
		summary: "Chat with mailbox agent",
		description:
			"Streams an AI agent chat turn for a mailbox conversation. Response is an AI SDK UI message stream (not a plain JSON object). The latest message must be from the user.",
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
						description: "AI SDK UIMessage array",
					},
					thread_id: { type: "string", nullable: true },
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
			"409": {
				description: "Duplicate message submit",
				...errorContent({ error: "Conflict" }),
			},
		},
	}),
);

// —— Task triage ——
const triagerParams = [
	pathParam("mailboxId", "Mailbox id (email)", "support@mail.acme.com"),
];
add(
	"/api/v1/mailboxes/{mailboxId}/task-triagers",
	"get",
	slimOp({
		summary: "List task triagers",
		description: "Lists task triagers. **Developer or Enterprise** required.",
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
		description: "Creates a task triager. **Developer or Enterprise** required.",
		tags: ["Task triage"],
		parameters: triagerParams,
		xCredits: 2,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{ name: "Support queue" },
		),
		successStatus: "201",
		successDescription: "Created",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/task-triager-runs/recent",
	"get",
	slimOp({
		summary: "List recent triager runs",
		description: "Recent triager execution history. **Developer+** required.",
		tags: ["Task triage"],
		parameters: triagerParams,
		xCredits: 1,
		successExample: [],
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/task-triagers/{triagerId}",
	"put",
	slimOp({
		summary: "Update task triager",
		description: "Updates a task triager. **Developer+** required.",
		tags: ["Task triage"],
		parameters: [
			...triagerParams,
			pathParam("triagerId", "Triager id", "tr_01"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{ type: "object", additionalProperties: true },
			{ name: "Support queue" },
		),
		successDescription: "Updated",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/task-triagers/{triagerId}",
	"delete",
	slimOp({
		summary: "Delete task triager",
		description: "Deletes a task triager. **Developer+** required.",
		tags: ["Task triage"],
		parameters: [
			...triagerParams,
			pathParam("triagerId", "Triager id", "tr_01"),
		],
		xCredits: 2,
		successDescription: "Deleted",
	}),
);
add(
	"/api/v1/mailboxes/{mailboxId}/task-triagers/{triagerId}/default",
	"post",
	slimOp({
		summary: "Set default task triager",
		description: "Marks a triager as the mailbox default. **Developer+**.",
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
		summary: "Attach agent conversation to triager",
		description: "Links an agent conversation to a triager. **Developer+**.",
		tags: ["Task triage"],
		parameters: [
			...triagerParams,
			pathParam("triagerId", "Triager id", "tr_01"),
		],
		xCredits: 2,
		requestBody: jsonBody(
			{
				type: "object",
				properties: { conversationId: { type: "string" } },
			},
			{ conversationId: "conv_01" },
			false,
		),
		successDescription: "Attached",
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
		description: "Lists available Composio toolkits. **Developer+** required.",
		tags: ["Integrations"],
		xCredits: 1,
		successExample: [{ slug: "gmail", name: "Gmail" }],
	}),
);
add(
	"/api/v1/integrations/composio/toolkits/{slug}/connect",
	"post",
	slimOp({
		summary: "Connect Composio toolkit",
		description: "Starts OAuth connect for a toolkit. **Developer+**.",
		tags: ["Integrations"],
		parameters: [pathParam("slug", "Toolkit slug", "gmail")],
		xCredits: 10,
		successDescription: "Connect URL / status",
	}),
);
add(
	"/api/v1/integrations/composio/toolkits/{slug}/connection",
	"delete",
	slimOp({
		summary: "Disconnect Composio toolkit",
		description: "Removes a toolkit connection. **Developer+**.",
		tags: ["Integrations"],
		parameters: [pathParam("slug", "Toolkit slug", "gmail")],
		xCredits: 2,
		successDescription: "Disconnected",
	}),
);
add(
	"/api/v1/integrations/composio/connections",
	"get",
	slimOp({
		summary: "List Composio connections",
		description: "Lists active Composio connections. **Developer+**.",
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
		description: "Refreshes connection state from Composio. **Developer+**.",
		tags: ["Integrations"],
		xCredits: 2,
		successDescription: "Synced",
	}),
);
add(
	"/api/v1/integrations/composio/calendar/account",
	"get",
	slimOp({
		summary: "Get Composio calendar account",
		description: "Returns calendar account binding. **Developer+**.",
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
	info: {
		title: "Mermail API",
		version: "1.0.0",
		description: `Programmatic Mermail API for scripts, agents, and integrations.

## Authentication

Authorize with an API key from **Settings → API Keys**:

\`\`\`
x-api-key: mm_key_…
\`\`\`

## Plans

Each endpoint page shows plan badges (**Public**, **All plans**, or **Developer+**). Free can call the core catalog; Developer-gated paths need Developer or Enterprise.

## Try it

Every endpoint page includes an interactive playground. Click **Try it**, paste your API key into the \`x-api-key\` field, fill path/query/body fields (prefilled from examples), and send a live request to \`https://console.mermail.app\`. You can also copy the generated cURL / JavaScript / Python snippet.

## Credits

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
		{ name: "Task triage", description: "Task triagers (Developer+)" },
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
					"API key (`mm_key_…`) from Settings → API Keys. Required for sold API calls outside the Mermail console.",
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
					periodStart: { type: "string", format: "date-time" },
					periodEnd: { type: "string", format: "date-time" },
					limit: { type: "number", example: 50000 },
					used: { type: "number", example: 1240 },
					remaining: { type: "number", example: 48760 },
				},
			},
			Workspace: {
				type: "object",
				properties: {
					id: { type: "string" },
					name: { type: "string" },
					owner_address: { type: "string" },
					timezone: { type: "string", nullable: true },
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
					id: { type: "string" },
					workspace_id: { type: "string" },
					email: { type: "string" },
					name: { type: "string" },
					settings: { type: "object", additionalProperties: true },
					inbox_unread_by_category: {
						type: "object",
						additionalProperties: { type: "integer" },
					},
				},
			},
			Email: {
				type: "object",
				properties: {
					id: { type: "string" },
					subject: { type: "string" },
					sender: { type: "string" },
					recipient: { type: "string" },
					date: { type: "string", format: "date-time" },
					read: { type: "boolean" },
					starred: { type: "boolean" },
					category: { type: "string" },
					folder_id: { type: "string" },
					thread_id: { type: "string" },
					snippet: { type: "string" },
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
					provider: { type: "string" },
					status: { type: "string" },
					dns_records: { type: "array", items: { type: "object" } },
					verified_at: { type: "string", format: "date-time", nullable: true },
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

const outPath = path.join(root, "openapi", "openapi.json");
fs.writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`);
const count = Object.values(paths).reduce(
	(n, methods) => n + Object.keys(methods).length,
	0,
);
console.log(`Wrote ${outPath} (${count} operations)`);
