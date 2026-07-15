```markdown
# mermail-docs Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and workflows used in the `mermail-docs` repository. The codebase is written in TypeScript and focuses on clear, consistent coding conventions without reliance on a specific framework. You'll learn how to structure files, write imports/exports, and follow testing patterns, as well as recommended commands for common tasks.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `apiClient.ts`

### Import Style
- Use **relative imports** for modules within the project.
  - Example:
    ```typescript
    import { fetchData } from './dataFetcher';
    ```

### Export Style
- Use **named exports** instead of default exports.
  - Example:
    ```typescript
    // In dataFetcher.ts
    export function fetchData() { /* ... */ }
    ```

    ```typescript
    // In another file
    import { fetchData } from './dataFetcher';
    ```

### Commit Patterns
- Commit messages are **freeform** and typically short (average 20 characters).
- No strict prefix or type required.

## Workflows

### Adding a New Module
**Trigger:** When you need to add new functionality or a new feature.
**Command:** `/add-module`

1. Create a new TypeScript file using camelCase naming.
2. Write your code using named exports.
3. Import your module using a relative path where needed.
4. Write a corresponding test file named `yourModule.test.ts` if applicable.

### Updating Documentation
**Trigger:** When you update or add documentation.
**Command:** `/update-docs`

1. Edit or create markdown files as needed.
2. Follow existing documentation style for consistency.
3. Commit changes with a clear, concise message.

### Running Tests
**Trigger:** When you need to verify code correctness.
**Command:** `/run-tests`

1. Ensure all test files follow the `*.test.*` naming pattern.
2. Use the project's test runner (framework not specified; check project scripts).
3. Run the test command (e.g., `npm test` or similar).

## Testing Patterns

- Test files use the `*.test.*` naming convention (e.g., `apiClient.test.ts`).
- The specific testing framework is not detected; check project dependencies or scripts for details.
- Place test files alongside the modules they test or in a designated test directory.

**Example:**
```typescript
// apiClient.test.ts
import { fetchData } from './apiClient';

test('fetchData returns expected result', () => {
  // ...test implementation
});
```

## Commands

| Command        | Purpose                                  |
|----------------|------------------------------------------|
| /add-module    | Scaffold and add a new module            |
| /update-docs   | Update or add documentation              |
| /run-tests     | Run all tests in the codebase            |
```
