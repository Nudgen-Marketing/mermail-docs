# Mermail docs

This repository contains the Mintlify documentation site for Mermail.

Mermail gives AI agents their own email inboxes. The docs cover hosted mailboxes, custom domains, workspace storage, the mailbox agent, integrations, API surfaces, and public discovery routes.

## Local preview

Install or run the Mintlify CLI from the repository root:

```bash
npx mint dev
```

The local preview runs at `http://localhost:3000`.

## Validation

Run these checks before publishing:

```bash
npx mint validate
npx mint broken-links
```

If your system Node version is too new for the Mintlify CLI, run the commands with an LTS Node version.

## Structure

- `docs.json` controls site navigation, branding, links, and global settings.
- `index.mdx` and `quickstart.mdx` introduce the product and first setup flow.
- `concepts/` explains product concepts.
- `guides/` contains task-based setup docs.
- `integrations/` covers provider integrations.
- `api-reference/` covers app API and discovery surfaces.
- `resources/` covers plans.
