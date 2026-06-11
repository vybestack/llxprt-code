# Plan Review Feedback 04

Required corrections:

- Add explicit package-boundary verification for `packages/tools` / any `@vybestack/llxprt-code-tools` package/deep dependency in every manifest and source scan. Current forbidden-dependency checks cover core/providers/cli/telemetry/genai but do not consistently verify the issue’s “no packages/tools” requirement.
- Fix inconsistent CLI paths in P10c: use concrete repository paths like `packages/cli/package.json`, `packages/cli/tsconfig.json`, and `packages/cli/vitest.config.ts`, not `cli/package.json`.
- Fix phase sequencing/tracking. `execution-tracker.md` omits P10b/P10b-V/P10c/P10c-V/P10d/P10d-V and P12 has no separate verification phase. The plan must list every worker and verification phase in execution order so they cannot be skipped.
- Correct RED-state assumptions for P08 and P10b. Because `packages/policy` is already a registered workspace package by then, direct imports from `@vybestack/llxprt-code-policy` may resolve even before core/CLI declare explicit dependencies. RED tests should fail on missing package manifest dependency, missing re-exports, or missing integration behavior—not rely on import-resolution failure.
- Add/verify robust dependency-boundary checks for package manifests against all forbidden workspaces: core, providers, tools, CLI, and any equivalent package names. Include both production and dev dependencies.
- Ensure source-deletion/import verification does not accidentally allow stale direct imports through overly narrow regexes. The cleanup phases should scan all old `packages/core/src/policy/*` and `packages/core/src/confirmation-bus/*` implementation imports, not just selected relative patterns.
- Make the acceptance criteria explicit in final review: relevant policy/confirmation code lives in `packages/policy`, core keeps only justified orchestration/re-export shims, `PolicyEngine` is public entry point, file-loaded TOML policies work from source and dist, and existing imports are either migrated or backward-compatible through core re-exports.
