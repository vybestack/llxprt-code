# GitHub Issue Integration: Technical Requirements

This document outlines the technical implementation plan for the GitHub Issue Integration feature, based on an analysis of the existing autocompletion architecture.

## 1. Architectural Integration

The current completion system uses `useSlashCompletion.ts` as a central orchestrator or "router" for different completion types. Although named for slash commands, it also handles the `@` trigger for file paths by delegating to a specialized hook, `useAtCompletion.ts`.

To ensure architectural consistency, the new `#` feature will follow this exact pattern:
1.  A new, specialized hook, `useHashCompletion.ts`, will be created to manage the logic for GitHub issue searching.
2.  The `useSlashCompletion.ts` orchestrator will be modified to detect the `#` trigger.
3.  When `#` is detected, `useSlashCompletion.ts` will activate and delegate all subsequent logic to the new `useHashCompletion.ts` hook, which will provide the suggestions back to the main `InputPrompt` component.

This approach reuses the existing architecture, requires minimal changes to the orchestrator, and cleanly encapsulates the new functionality.

## 2. High-Level Design

The new `#` issue completion will be implemented by creating a new React hook, `useHashCompletion.ts`, that closely mirrors the design of the existing `useAtCompletion.ts`. This ensures architectural consistency and proper integration with the main `InputPrompt` component.

## 3. Component & Hook Implementation

**3.1. `useHashCompletion.ts` (New Hook)**
*   **Purpose:** This hook will manage the state and logic for searching locally cached GitHub issues.
*   **State Management:** The hook's state will be simplified. It will read the cache file on mount and whenever the trigger (`#`) is active. If the file doesn't exist or is empty, it provides no suggestions.
*   **Cache Update Trigger:** At startup, the application will check the modification time of `.llxprt/ghcache/issues.json`. If it is stale (older than the configured TTL), it will spawn a "fire-and-forget" background process to run the update script. The UI will not wait for or report on the result of this process.
*   **Search Logic:** The search will be a synchronous, case-insensitive filter over the issues array from the cache.

**3.2. `useSlashCompletion.tsx` (Modification)**
*   This hook will be modified to detect the `#` character as a trigger for completion.
*   When a `#` is detected, it will activate `useHashCompletion.ts` and pass the search pattern to it.

**3.3. `InputPrompt.tsx` (Modification)**
*   No changes are required.

## 4. Cache Update Script & `gh` Command

**4.1. Repository Scoping**
*   The update script MUST determine the correct `owner/repo` slug from `git config --get remote.origin.url` and use it with the `--repo` flag to ensure correctness.

**4.2. `gh` Command Execution**
*   The command will fetch only **open** issues.
*   The fetch limit will be configurable, defaulting to `10000`.
    ```bash
    gh issue list --repo acoliver/llxprt-code --state open --limit 10000 --json number,title,author,state
    ```

**4.3. Error Handling**
*   All potential errors within the update script (`gh` not found, auth failure, non-GitHub remote, etc.) MUST be caught.
*   Errors will be logged to the debug console (`console.log`) and the script will exit gracefully. The script MUST NOT surface errors to the user's main UI.

## 5. Testing

*   Per `@docs/RULES.md`, testing will be strictly behavioral.
*   Tests will be written for the `useHashCompletion` hook.
*   The test setup will involve creating a temporary `.llxprt/ghcache/issues.json` file with mock data.
*   Tests will verify that the hook correctly provides suggestions based on the contents of that mock file for both numeric (`#123`) and text (`#some-text`) searches.
*   No part of the `gh` command, the update script, or the file system interaction for the cache update will be mocked or tested directly in unit tests. We test the behavior of the hook, which depends on the `issues.json` file being present.
