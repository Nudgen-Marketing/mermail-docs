# Mermail docs

This repository contains the Mintlify documentation site for Mermail.

Mermail gives AI agents their own inboxes and a user-controlled Agent Wallet, so they can sign up, receive verification codes, and complete approved payments. The docs cover mailboxes, Agent Wallet, AI integrations, API surfaces, and public discovery routes.

## Local preview

Install or run the Mintlify CLI from the repository root:

```bash
npx mint dev
```

The local preview runs at `http://localhost:3000`.

To regenerate the API Reference OpenAPI document:

```bash
node scripts/generate-openapi.mjs
```

## Validation

Run these checks before publishing:

```bash
npx mint validate
npx mint broken-links
```

If your system Node version is too new for the Mintlify CLI, run the commands with an LTS Node version.

## Structure

- `docs.json` controls site navigation, branding, links, API playground, and global settings.
- `openapi/openapi.json` powers interactive API Reference pages (Try it + copyable examples).
- `scripts/generate-openapi.mjs` regenerates the OpenAPI document with schemas and examples.
- `index.mdx` and `quickstart.mdx` introduce the product and first setup flow.
- `concepts/` explains product concepts.
- `agent-wallet/` explains Agent Wallet setup, Funding, transfers, swaps, x402, and AI connections.
- `guides/` contains task-based setup docs.
- `integrations/` covers provider integrations.
- `api-reference/` covers app API intro, auth, and discovery.
- `resources/` covers plans.
