# Phase 3a: TDD for Autocomplete Hook

**Objective:** Write failing behavioral tests for the `useHashCompletion` hook.

## Action

1.  **Create Test File:** Create `packages/cli/src/ui/hooks/useHashCompletion.test.ts`.
2.  **Test Setup (`beforeEach`):**
    *   Create a temporary directory structure: `.llxprt/ghcache/`.
    *   Write a mock `issues.json` file inside this directory with known test data (e.g., 3-4 issues with distinct numbers and titles).
3.  **Write Behavioral Tests:**
    *   **Test 1 (Numeric Search):**
        *   **Scenario:** A user types a valid issue number.
        *   **Given:** A mock `issues.json` file.
        *   **When:** The `useHashCompletion` hook is rendered with an input of `#123` (matching a number in the mock file).
        *   **Then:** The hook's `suggestions` output should be an array containing exactly one issue, matching the details for issue #123 from the mock file.
    *   **Test 2 (Text Search):**
        *   **Scenario:** A user types a partial title.
        *   **Given:** A mock `issues.json` file.
        *   **When:** The hook is rendered with an input of `#bug`.
        *   **Then:** The hook's `suggestions` output should be an array containing all issues from the mock file that have "bug" in their title.
    *   **Test 3 (No Cache File):**
        *   **Scenario:** The cache has not been created yet.
        *   **Given:** The `.llxprt/ghcache/issues.json` file does not exist.
        *   **When:** The hook is rendered with any input (e.g., `#test`).
        *   **Then:** The hook's `suggestions` output should be an empty array `[]`.

## Expected Outcome

All tests will fail because `useHashCompletion.ts` does not exist or has no implementation.
