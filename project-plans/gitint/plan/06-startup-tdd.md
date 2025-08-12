# Phase 4a: TDD for Startup Integration

**Objective:** Write a failing test for the application's startup logic to ensure it triggers the cache update.

## Action

1.  **Identify Startup Service:** Locate the primary service or function responsible for application initialization.
2.  **Create Test:** In the corresponding test file, add a new test case for the "issue cache update trigger".
3.  **Mock Dependencies:**
    *   Mock the `fs/promises` module, specifically the `stat` function.
    *   Mock the `child_process` module, specifically the `spawn` function.
4.  **Write Test Scenarios:**
    *   **Test 1 (Cache is Fresh):**
        *   **Given:** The `stat` mock is configured to return a modification time that is *newer* than the configured TTL (e.g., 2 minutes ago).
        *   **When:** The application startup function is called.
        *   **Then:** Assert that `spawn` was **NOT** called.
    *   **Test 2 (Cache is Stale):**
        *   **Given:** The `stat` mock is configured to return a modification time that is *older* than the TTL (e.g., 10 minutes ago).
        *   **When:** The application startup function is called.
        *   **Then:** Assert that `spawn` **WAS** called with the correct path to `scripts/update-issue-cache.js` and the `{ detached: true, stdio: 'ignore' }` options.
    *   **Test 3 (Cache Not Found):**
        *   **Given:** The `stat` mock is configured to throw a "file not found" error.
        *   **When:** The application startup function is called.
        *   **Then:** Assert that `spawn` **WAS** called.

## Expected Outcome

The tests will fail because the startup service does not yet contain this logic.
