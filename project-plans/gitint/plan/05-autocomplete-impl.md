# Phase 3b: Implementation for Autocomplete Hook

**Objective:** Implement the `useHashCompletion` hook to make the tests from Phase 3a pass.

## Action

1.  **Create File:** Create `packages/cli/src/ui/hooks/useHashCompletion.ts`.
2.  **Implement Hook Logic:**
    *   The hook will accept the search pattern (e.g., "123" or "bug") as an argument.
    *   It will use the `useState` and `useEffect` hooks to manage its state.
    *   Inside a `useEffect` that runs when the pattern changes:
        *   Read the file at `.llxprt/ghcache/issues.json`. Use a `try...catch` block to handle cases where the file doesn't exist.
        *   If the file is read successfully, parse the JSON. Use another `try...catch` for parsing errors.
        *   If the pattern is numeric, filter the issues array by `issue.number`.
        *   If the pattern is text, filter the issues array by `issue.title.toLowerCase().includes(pattern.toLowerCase())`.
        *   Set the component's state with the resulting array of suggestions.
        *   In case of any error (file not found, parse error), set the suggestions to an empty array `[]`.
3.  **Integrate with Orchestrator:**
    *   Modify `packages/cli/src/ui/hooks/useSlashCompletion.ts`.
    *   Add logic to detect the `#` trigger.
    *   When triggered, call the `useHashCompletion` hook and pass the search pattern to it.
    *   Ensure the suggestions from `useHashCompletion` are returned as the main output.

## Verification

1.  Run the tests from `04-autocomplete-tdd.md`.
2.  All tests must now pass.
