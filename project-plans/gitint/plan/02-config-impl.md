# Phase 1b: Implementation for Configuration

**Objective:** Implement the new settings in the `Config` service to make the failing test from Phase 1a pass.

## Action

1.  **Modify File:** Open `packages/core/src/config/config.ts`.
2.  **Add `GitHubSettings` Interface:**
    ```typescript
    export interface GitHubSettings {
      issueCacheTtlMinutes: number;
      issueFetchLimit: number;
    }
    ```
3.  **Update `ConfigParameters` Interface:** Add the optional `github` property:
    ```typescript
    export interface ConfigParameters {
      // ... existing properties
      github?: GitHubSettings;
    }
    ```
4.  **Update `Config` Class:**
    *   Add a private `githubSettings` property: `private readonly githubSettings: GitHubSettings;`
    *   In the constructor, initialize this property, merging the user-provided settings with the defaults:
        ```typescript
        this.githubSettings = {
          issueCacheTtlMinutes: params.github?.issueCacheTtlMinutes ?? 5,
          issueFetchLimit: params.github?.issueFetchLimit ?? 10000,
        };
        ```
    *   Create the public `getGithubSettings` method:
        ```typescript
        getGithubSettings(): GitHubSettings {
          return this.githubSettings;
        }
        ```

## Verification

1.  Run the test file from Phase 1a.
2.  The test must now pass.
3.  Ensure no other tests have been broken by this change.
