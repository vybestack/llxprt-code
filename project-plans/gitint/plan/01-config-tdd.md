# Phase 1a: TDD for Configuration

**Objective:** Write a failing test to verify the new GitHub issue integration settings in the `Config` service.

## Action

1.  **Create Test File:** If it doesn't exist, create a new test file dedicated to the `Config` service's new features to avoid cluttering existing tests.
2.  **Write Failing Test:** Add a test case that:
    *   Imports the `Config` class.
    *   Instantiates it with a minimal set of parameters.
    *   Asserts that `config.getGithubSettings().issueCacheTtlMinutes` is equal to `5`.
    *   Asserts that `config.getGithubSettings().issueFetchLimit` is equal to `10000`.

## Expected Outcome

The test will fail because the `getGithubSettings` method and the underlying properties do not yet exist on the `Config` class, resulting in a compilation error or a runtime "is not a function" error.
