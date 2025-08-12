# Project Plan: GitHub Issue Integration

This plan outlines the autonomous implementation of the GitHub Issue Integration feature. It adheres strictly to the development principles defined in `@docs/RULES.md` and the planning structure from `@docs/PLAN.md`.

**Referenced Specifications:**
*   **Functional Requirements:** `project-plans/gitint/PRD.md`
*   **Technical Design:** `project-plans/gitint/technical-requirements.md`

---

## 🛑 Integration Mandate Check

This feature is designed to be deeply integrated into the CLI's input prompt. It cannot be built in isolation.
-   **Existing Code to Use Feature:** `packages/cli/src/ui/components/InputPrompt.tsx` will consume the new hook.
-   **Existing Code to Be Modified:** `packages/cli/src/ui/hooks/useSlashCompletion.ts` will be modified to orchestrate the new hook. `packages/core/src/config/config.ts` will be updated with new settings. The application startup sequence will be modified to trigger the cache update.
-   **User Access:** The user will access this feature directly in the main input prompt via the `#` character.

---

## Plan of Action

### Phase 1: Configuration

**Objective:** Add the necessary configuration settings to the core `Config` service.

*   **Phase 1a: TDD (Test-Driven Development)**
    1.  **Action:** Create a new test file for `Config` specific to this feature.
    2.  **Test:** Write a failing test that instantiates the `Config` service and asserts that `config.getGithubSettings().issueCacheTtlMinutes` is `5` and `config.getGithubSettings().issueFetchLimit` is `10000`. This test will fail because the methods and properties do not exist.

*   **Phase 1b: Implementation**
    1.  **Action:** Modify `packages/core/src/config/config.ts`.
    2.  **Changes:**
        *   Add a `GitHubSettings` interface.
        *   Add a `github` property to `ConfigParameters`.
        *   Initialize the new properties in the `Config` constructor, setting the specified defaults (5, 10000) and allowing overrides.
        *   Create the public `getGithubSettings()` method.
    3.  **Verification:** Run the test created in Phase 1a. It must now pass.

---

### Phase 2: Cache Update Script

**Objective:** Create the background script responsible for fetching issues from GitHub.

*   **Note on Testing:** This is a standalone utility script. Per pragmatic adaptation of the rules, it will not have a corresponding TDD phase in the traditional sense. Its correctness will be verified by the behavioral tests in Phase 3 that rely on the `issues.json` file it creates.

*   **Phase 2a: Implementation**
    1.  **Action:** Create a new executable script at `scripts/update-issue-cache.js`.
    2.  **Logic:**
        *   The script will use `child_process.execSync` to run `git config --get remote.origin.url` to find the repository slug. It will include error handling for non-GitHub remotes.
        *   It will construct the `gh issue list --state open --repo <slug> --limit <limit> --json ...` command.
        *   It will execute the `gh` command, catching all errors. Failures (e.g., `gh` not installed, not authenticated) will be logged to `console.log` and the script will exit.
        *   On success, it will create the `.llxprt/ghcache/` directory if it doesn't exist.
        *   It will write the JSON output to `.llxprt/ghcache/issues.json`.

---

### Phase 3: Autocomplete Hook

**Objective:** Implement the core UI logic for issue completion.

*   **Phase 3a: Stub**
    1.  **Action:** Create a new file `packages/cli/src/ui/hooks/useHashCompletion.ts`.
    2.  **Implementation:** The file will contain an empty hook that returns no suggestions.
    3.  **Action:** Modify `packages/cli/src/ui/hooks/useSlashCompletion.ts` to add the logic for detecting the `#` trigger and calling the new (currently empty) `useHashCompletion` hook.

*   **Phase 3b: TDD (Behavioral Tests)**
    1.  **Action:** Create a new test file `packages/cli/src/ui/hooks/useHashCompletion.test.ts`.
    2.  **Test Setup:** The `beforeEach` block will create a temporary `.llxprt/ghcache/` directory and an `issues.json` file with mock data.
    3.  **Tests:**
        *   **Test 1 (Numeric Search):** Given the mock cache, simulate a user typing `#1`. Assert that the hook's suggestions output contains only the issue with `number: 1`.
        *   **Test 2 (Text Search):** Given the mock cache, simulate a user typing `#fix`. Assert that the suggestions output contains all issues from the mock file with "fix" in the title.
        *   **Test 3 (No Cache File):** Delete the mock `issues.json` file. Assert that the hook provides an empty array of suggestions.
        *   **Test 4 (Empty Cache File):** Create an empty `issues.json` file. Assert that the hook provides an empty array of suggestions.

*   **Phase 3c: Implementation**
    1.  **Action:** Implement the logic inside `useHashCompletion.ts`.
    2.  **Logic:**
        *   The hook will read the `.llxprt/ghcache/issues.json` file.
        *   It will handle file-not-found and JSON parsing errors gracefully, returning `[]`.
        *   It will filter the parsed array of issues based on the user's input pattern (numeric or text).
        *   It will return the filtered list of suggestions.
    3.  **Verification:** Run the tests from Phase 3b. They must all pass.

---

### Phase 4: Application Startup Integration

**Objective:** Integrate the cache update logic into the application's startup lifecycle.

*   **Phase 4a: TDD**
    1.  **Action:** In a relevant test file for the application's startup service, write a behavioral test.
    2.  **Test:** This test will mock the `fs/promises` `stat` function and the `child_process` `spawn` function.
        *   **Scenario 1:** Configure the `stat` mock to return a recent modification time. Assert that `spawn` is **not** called.
        *   **Scenario 2:** Configure the `stat` mock to return an old modification time (older than the TTL). Assert that `spawn` **is** called with the correct script path and detached options.

*   **Phase 4b: Implementation**
    1.  **Action:** Modify the application's main entry point or startup service.
    2.  **Logic:**
        *   Add a function that checks the `fs.stat` of `.llxprt/ghcache/issues.json`.
        *   If the file exists, compare its `mtime` with the current time and the `issueCacheTtlMinutes` from the `Config` service.
        *   If the file does not exist or is stale, use `child_process.spawn` to execute the `scripts/update-issue-cache.js` script with `{ detached: true, stdio: 'ignore' }` to ensure it runs as a "fire-and-forget" background process.
    3.  **Verification:** Run the tests from Phase 4a. They must all pass.
