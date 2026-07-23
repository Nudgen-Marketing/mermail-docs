```markdown
# mermail-docs Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `mermail-docs` TypeScript codebase. It covers file naming, import/export styles, commit message formats, and testing patterns. By following these guidelines, contributors can maintain consistency and quality across the project.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `apiClient.ts`

### Import Style
- Use **relative imports** for referencing other modules.
  - Example:
    ```typescript
    import { fetchData } from './apiClient';
    ```

### Export Style
- Use **named exports** rather than default exports.
  - Example:
    ```typescript
    // In apiClient.ts
    export function fetchData() { ... }

    // In another file
    import { fetchData } from './apiClient';
    ```

### Commit Messages
- Follow **Conventional Commits** with the `docs` prefix.
  - Example: `docs: update API usage section in README`

## Workflows

### Documenting Code Changes
**Trigger:** When updating or adding documentation.
**Command:** `/docs-update`

1. Make your documentation changes in the appropriate `.md` or source files.
2. Use a commit message with the `docs:` prefix.
   - Example: `docs: add usage example for apiClient`
3. Push your changes and open a pull request.

### Writing and Running Tests
**Trigger:** When adding new features or fixing bugs.
**Command:** `/run-tests`

1. Create or update test files following the `*.test.*` pattern.
   - Example: `apiClient.test.ts`
2. Use your preferred test runner (framework is unspecified; consult project maintainers if unsure).
3. Run the tests locally to ensure they pass.
4. Commit your changes with a relevant message.
   - Example: `docs: add tests for fetchData function`

## Testing Patterns

- Test files should match the `*.test.*` pattern (e.g., `module.test.ts`).
- The testing framework is not specified; check with maintainers or look for existing test files for guidance.
- Place tests alongside the modules they cover or in a dedicated `tests` directory if present.

## Commands
| Command        | Purpose                                         |
|----------------|-------------------------------------------------|
| /docs-update   | Document code changes and update documentation.  |
| /run-tests     | Run all tests before submitting code changes.    |
```