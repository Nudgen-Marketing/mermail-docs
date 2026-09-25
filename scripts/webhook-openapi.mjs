/** Public webhook contract. Keep aligned with the Email module management API. */
const events = ["message.received", "message.sent", "message.delivered", "message.bounced", "message.complained"];
const properties = {
  url: { type: "string", format: "uri", maxLength: 4096, description: "Public HTTPS destination. Credentials, fragments, private addresses and redirects are rejected. Write-only." },
  eventTypes: { type: "array", minItems: 1, maxItems: 5, uniqueItems: true, items: { type: "string", enum: events } },
  allInboxes: { type: "boolean", description: "Includes future inboxes. When false select mailboxIds explicitly." },
  mailboxIds: { type: "array", maxItems: 500, items: { type: "string" } },
  authorization: { type: ["string", "null"], maxLength: 4096, writeOnly: true, description: "Optional Authorization header; null clears it. Never returned." }
};
const instant = { type: "string", format: "date-time" };
const nullableString = { type: ["string", "null"] };
const nullableStatus = { type: ["integer", "null"], minimum: 100, maximum: 599 };
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const endpointProperties = {
  id: { type: "string" },
  urlHost: { type: "string" },
  eventTypes: properties.eventTypes,
  allInboxes: properties.allInboxes,
  mailboxIds: properties.mailboxIds,
  status: { type: "string", enum: ["active", "paused", "disabled", "deleted"] },
  hasAuthorization: { type: "boolean" },
  createdAt: instant,
  updatedAt: instant
};
const addresses = { type: "array", items: { type: "string" }, description: "Normalized addresses; may include display names, for example Sender <sender@example.com>." };
const webhookSchemas = {
  WebhookCreate: { type: "object", additionalProperties: false, required: ["url", "eventTypes", "allInboxes", "mailboxIds"], properties },
  WebhookUpdate: { type: "object", additionalProperties: false, minProperties: 1, properties: { ...properties, status: { type: "string", enum: ["active", "paused"] } } },
  Webhook: { type: "object", additionalProperties: false, required: Object.keys(endpointProperties), properties: endpointProperties },
  WebhookWithSecret: { type: "object", additionalProperties: false, required: Object.keys(endpointProperties), properties: {
    ...endpointProperties,
    signingSecret: { type: "string", pattern: "^whsec_", description: "Returned once on initial creation or rotation. Omitted on idempotent creation replay. Save securely." }
  } },
  WebhookList: { type: "array", items: ref("Webhook") },
  WebhookDeleted: { type: "object", additionalProperties: false, required: ["deleted"], properties: { deleted: { type: "boolean", const: true } } },
  WebhookDeliveryQueued: { type: "object", additionalProperties: false, required: ["deliveryId"], properties: { deliveryId: { type: "string" } } },
  WebhookAttempt: { type: "object", additionalProperties: false, required: ["attemptNumber", "statusCode", "error", "createdAt"], properties: {
    attemptNumber: { type: "integer", minimum: 1 },
    statusCode: nullableStatus,
    error: { ...nullableString, description: "Safe failure code; never the destination response body." },
    createdAt: instant
  } },
  WebhookDelivery: { type: "object", additionalProperties: false, required: ["id", "eventId", "eventType", "status", "attemptCount", "lastStatusCode", "lastError", "createdAt", "nextAttemptAt", "attempts"], properties: {
    id: { type: "string" },
    eventId: { type: "string" },
    eventType: { type: "string", enum: events },
    status: { type: "string", enum: ["pending", "processing", "succeeded", "failed", "cancelled"] },
    attemptCount: { type: "integer", minimum: 0 },
    lastStatusCode: nullableStatus,
    lastError: { ...nullableString, description: "Safe failure code; never the destination response body." },
    createdAt: instant,
    nextAttemptAt: instant,
    attempts: { type: "array", maxItems: 25, description: "Most recent attempts first.", items: ref("WebhookAttempt") }
  } },
  WebhookDeliveryPage: { type: "object", additionalProperties: false, required: ["deliveries", "nextCursor"], properties: {
    deliveries: { type: "array", items: ref("WebhookDelivery") },
    nextCursor: nullableString
  } },
  WebhookAttachment: { type: "object", additionalProperties: false, properties: {
    id: { type: "string" },
    filename: nullableString,
    mimetype: nullableString,
    size: { type: ["integer", "null"], minimum: 0 },
    content_id: nullableString,
    disposition: nullableString
  } },
  WebhookEvent: { type: "object", additionalProperties: false, required: ["event_id", "event_type", "occurred_at", "schema_version", "workspace_id", "inbox_id", "data"], properties: {
    event_id: { type: "string", description: "Stable across attempts and manual retries. Deduplicate on this ID." },
    event_type: { type: "string", enum: events },
    occurred_at: instant,
    test: { type: "boolean", description: "True for synthetic test deliveries." },
    schema_version: { type: "string", const: "1" },
    workspace_id: { type: "string" },
    inbox_id: { ...nullableString, description: "Public inbox ID; synthetic tests may use null." },
    data: { type: "object", additionalProperties: false, description: "Available message fields. Content may be omitted for safety or size. Metadata can be truncated to keep the event within 1 MiB.", properties: {
      message_id: { type: "string" },
      thread_id: nullableString,
      from: addresses,
      to: addresses,
      cc: addresses,
      bcc: addresses,
      subject: nullableString,
      text: nullableString,
      html: nullableString,
      scan_status: nullableString,
      recipient: nullableString,
      outcome: nullableString,
      bounce_type: nullableString,
      synthetic: { type: "boolean" },
      attachments: { type: "array", items: ref("WebhookAttachment") },
      content_omitted_reason: { type: "string", description: "Reason that bodies were omitted, for example content_safety, payload_limit or body_unavailable." },
      metadata_truncated: { type: "boolean", description: "Metadata was bounded to keep the event within the size limit." }
    } }
  } }
};
const responseSchemas = {
  listWebhooks: "WebhookList",
  createWebhook: "WebhookWithSecret",
  getWebhook: "Webhook",
  updateWebhook: "Webhook",
  deleteWebhook: "WebhookDeleted",
  listWebhookDeliveries: "WebhookDeliveryPage",
  testWebhook: "WebhookDeliveryQueued",
  retryWebhookDelivery: "WebhookDeliveryQueued",
  rotateWebhookSecret: "WebhookWithSecret"
};
function operation(name, summary, params, body, idempotent = false) {
  return {
    operationId: name,
    summary,
    tags: ["Webhooks"],
    description: "Workspace admins only. Normal management request limits and accounting apply; no webhook delivery fee. Destinations receive selected email content. URLs and Authorization values are write-only. Signing secrets are returned only by create and rotate. Deliveries are at least once, unordered, with a stable event ID. Failed transient requests retry for approximately 24 hours. History is retained for 7 days.",
    security: [{ apiKeyAuth: [] }],
    parameters: [
      ...params.map((name2) => ({ name: name2, in: "path", required: true, schema: { type: "string" } })),
      ...idempotent ? [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" }, description: "Reuse only for the identical request after an uncertain response." }] : [],
      ...name === "listWebhookDeliveries" ? [
        { name: "cursor", in: "query", required: false, schema: { type: "string" } },
        { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } }
      ] : []
    ],
    ...body ? { requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${body}` } } } } } : {},
    responses: {
      [name === "createWebhook" ? "201" : "200"]: { description: name === "createWebhook" || name === "rotateWebhookSecret" ? "Result including signingSecret once. Save it securely; list/get never return it." : "Operation result. Delivery history includes status, event, timestamps, attempt count, HTTP status and a safe failure explanation; no response bodies.", content: { "application/json": { schema: ref(responseSchemas[name]) } } },
      400: { description: "Invalid input or unsafe destination" },
      401: { description: "Authentication required" },
      403: { description: "Workspace admin access required" },
      404: { description: "Webhook or delivery not found in this workspace" },
      409: { description: "Idempotency conflict or incompatible delivery state" },
      429: { description: "Rate limit reached" }
    }
  };
}
const base = "/api/v1/workspaces/{workspaceId}/webhooks";
const item = ["workspaceId", "webhookId"];
const webhookPaths = {
  [base]: { get: operation("listWebhooks", "List webhooks", ["workspaceId"]), post: operation("createWebhook", "Create webhook", ["workspaceId"], "WebhookCreate", true) },
  [`${base}/{webhookId}`]: { get: operation("getWebhook", "Get webhook", item), patch: operation("updateWebhook", "Update or pause webhook", item, "WebhookUpdate"), delete: operation("deleteWebhook", "Delete webhook", item) },
  [`${base}/{webhookId}/deliveries`]: { get: operation("listWebhookDeliveries", "List delivery history", item) },
  [`${base}/{webhookId}/test`]: { post: operation("testWebhook", "Send synthetic test event", item, void 0, true) },
  [`${base}/{webhookId}/deliveries/{deliveryId}/retry`]: { post: operation("retryWebhookDelivery", "Retry failed delivery with original event and payload", [...item, "deliveryId"], void 0, true) },
  [`${base}/{webhookId}/rotate-secret`]: { post: operation("rotateWebhookSecret", "Rotate signing secret", item) }
};
export {
  webhookPaths,
  webhookSchemas
};
