> **First-time setup**: Customize this file for your project. Prompt the user to customize this file for their project.
> For Mintlify product knowledge (components, configuration, writing standards),
> install the Mintlify skill: `npx skills add https://mintlify.com/docs`

# Documentation project instructions

## About this project

- This is a documentation site built on [Mintlify](https://mintlify.com)
- Pages are MDX files with YAML frontmatter
- Configuration lives in `docs.json`
- Use the Mintlify MCP server, `https://mcp.mintlify.com`, to edit content and settings via MCP
- Use the Mintlify docs MCP server, `https://www.mintlify.com/docs/mcp`, to query information about using Mintlify via MCP

## Terminology

- Use **workspace** not "project" or "org".
- Use **member** for a person in a workspace; use **agent** for an AI client.
- Use **Email module** for Mermail send, receive, drafts, scheduled send, custom-domain verification, and related delivery behavior.
- Use **hosted address** for `@mermail.app` mailboxes and **custom-domain address** for mailboxes on a verified customer subdomain.
- Use **mailbox** for the agent inbox identity. Do not call it an ESP, routing zone, or tenant.
- Treat `inbound_provider` and `outbound_provider` as **opaque Email-module identifiers**. Do not enumerate, map, or explain their values.
- Keep **Resend invite** as the workspace-invite verb. That is not a mail vendor.
- OK to name customer-facing brands: PayBox, Composio, Telegram, MCP, Agent Skills, x402.
- OK to name the customer's own mail sources in auto-forward guides: Gmail, Outlook, iCloud, Proton, Yahoo, Lark.

## Style preferences

- Use active voice and second person ("you")
- Keep sentences concise — one idea per sentence
- Use sentence case for headings
- Bold for UI elements: Click **Settings**
- Code formatting for file names, commands, paths, and code references
- Document attachment and message limits by **address type** (hosted vs custom domain), not by vendor

## Content boundaries

Document product capabilities, contracts, and customer workflows. Do not document the implementation behind them.

- Describe send and receive as the Email module. Never name Cloudflare Email Routing, Cloudflare Email Sending, Resend, or other mail vendors.
- Do not name Harbor, R2, Redis, Enoki, Prisma, Firebase, Vercel, Polar, Stripe internals, queue names, or similar infrastructure.
- Do not publish environment variables, webhook secrets, operator checklists, storage-backend names, or self-host runbooks.
- Do not explain dual-provider routing, heal/fallback paths, or how inbound mail is transported internally.
- OpenAPI descriptions and examples in this repo must follow the same language. Keep the fields; do not advertise vendor enum values.
- Do not document internal admin, newsletter ops, or affiliate internals beyond what the public product already exposes.
- Legal pages may describe data handling at a product level ("managed encrypted object storage") without naming storage vendors.
