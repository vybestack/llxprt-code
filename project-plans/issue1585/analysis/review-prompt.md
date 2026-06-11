# Stable Review Prompt For issue1585 Plan

Review the project plan for GitHub issue #1585 in `/Users/acoliver/projects/llxprt/branch-3/llxprt-code/project-plans/issue1585`.

Issue #1585 is "Extract packages/tools". The plan must satisfy the issue body and comments: extract tool definitions and implementations into a dedicated package, include all relevant tool implementation/registry/context/name/formatter/error/key-storage concerns, avoid depending on CLI or providers, account for desired settings/storage dependencies, consider MCP coupling, preserve existing behavior, and include release process updates plus manual trusted publishing setup.

Evaluate the plan against:

- `dev-docs/PLAN.md`
- `dev-docs/PLAN-TEMPLATE.md`
- `dev-docs/RULES.md`
- The existing provider package extraction pattern in `project-plans/issue1584/**` and `packages/providers/**`
- The actual current code under `packages/core/src/tools/**`, current consumers/imports, package metadata, release workflow/scripts/tests, sandbox build, and Dockerfile

Review requirements:

1. Check whether the plan is concrete enough for a future implementation agent to execute without inventing architecture.
2. Check whether the package dependency direction is cycle-free and accurately reflects current blockers.
3. Check whether the plan handles missing `packages/settings`, `packages/storage`, and `packages/mcp` honestly instead of smuggling in a tools-to-core dependency.
4. Check whether release, sandbox, Docker, package-lock, bind-release-deps, and manual npm trusted publisher requirements are fully covered.
5. Check whether phase structure follows the dev-docs planning rules while being adapted for a refactoring project rather than a new feature.
6. Check whether TDD and behavioral regression requirements avoid mock theater, reverse testing, and structure-only tests.
7. Check whether all important existing consumers are included: core registry/scheduler/config/agents/confirmation-bus/telemetry/prompts/storage/todo/providers and any CLI/direct consumers.
8. Check whether the plan avoids no-op compatibility shims, V2/New duplicate implementations, and isolated copied packages.
9. Identify any missing artifacts, ambiguous ownership decisions, invalid assumptions, insufficient verification commands, or places where the plan is too vague.

Do not modify files. Return a structured review with:

- Verdict: PASS if only pedantic/minor polish remains, otherwise FAIL.
- Must-fix issues: numbered list with file/path references and concrete remediation.
- Pedantic issues: numbered list.
- Missing evidence or commands.
- Suggested exact edits or additions.
