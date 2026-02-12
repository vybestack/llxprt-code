# Plan: Issue #1036 — Sandbox Git Support and macOS SSH Agent Forwarding

Plan ID: PLAN-20260211-SANDBOX1036
Generated: 2026-02-11
Total Phases: P0.5 through P11 (11 phases)
Requirements: R1, R2, R3, R4, R5, R6, R7

## Summary

Fix sandbox Git support and macOS compatibility in
`packages/cli/src/utils/sandbox.ts`. Four fixes:

1. **Fix 1** (R1): Replace stale `gemini-cli-dev@google.com` reference
2. **Fix 2** (R2): Set `GIT_DISCOVERY_ACROSS_FILESYSTEM=1` in all containers
3. **Fix 3** (R3): Mount Git config files read-only with dual-HOME pattern
4. **Fix 4** (R4–R7): Platform-aware SSH agent forwarding for Linux, Docker
   on macOS, and Podman on macOS

## Critical Reminders

1. ALL production changes go into `packages/cli/src/utils/sandbox.ts`
2. Tests go into `packages/cli/src/utils/sandbox.test.ts`
3. No mock theater — tests must verify behavioral outcomes
4. New helper functions must be exported for testability
5. Follow existing patterns in the file (see technical-overview.md)
6. Verification cycle: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build`
7. Smoke test: `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

## Integration Points

### Existing Code That Uses This Feature
- `start_sandbox()` in `sandbox.ts` — the single entry point being modified
- Called from `packages/cli/src/gemini.ts` (main CLI entry)

### Existing Code Being Modified
- `sandbox.ts` line ~526: stale error message string
- `sandbox.ts` lines ~540–560: container arg construction (env vars)
- `sandbox.ts` lines ~595–615: volume mount section (git config)
- `sandbox.ts` lines ~670–710: SSH agent section (complete refactor)

### User Access Points
- Any user running `LLXPRT_SANDBOX=docker` or `LLXPRT_SANDBOX=podman`

## Phase Sequence

| Phase | Title | Subagent | Requirements |
|-------|-------|----------|-------------|
| P0.5 | Preflight Verification | typescriptexpert | — |
| P02 | Pseudocode | typescriptexpert | R1–R7 |
| P03 | Fix 1+2 TDD | typescriptexpert | R1, R2 |
| P04 | Fix 1+2 Implementation | typescriptexpert | R1, R2 |
| P05 | Fix 3 TDD | typescriptexpert | R3 |
| P06 | Fix 3 Implementation | typescriptexpert | R3 |
| P07 | Fix 4 SSH Helper Stubs | typescriptexpert | R4–R7 |
| P08 | Fix 4 SSH TDD | typescriptexpert | R4–R7 |
| P09 | Fix 4 SSH Implementation | typescriptexpert | R4–R7 |
| P10 | Fix 4 Integration into start_sandbox | typescriptexpert | R4–R7 |
| P11 | Full Verification + Smoke Test | typescriptexpert | R1–R7 |

## Execution Tracking

| Phase | Status | Started | Completed | Verified | Semantic? |
|-------|--------|---------|-----------|----------|-----------|
| P0.5 | pending | - | - | - | N/A |
| P02 | pending | - | - | - | N/A |
| P03 | pending | - | - | - | [ ] |
| P04 | pending | - | - | - | [ ] |
| P05 | pending | - | - | - | [ ] |
| P06 | pending | - | - | - | [ ] |
| P07 | pending | - | - | - | [ ] |
| P08 | pending | - | - | - | [ ] |
| P09 | pending | - | - | - | [ ] |
| P10 | pending | - | - | - | [ ] |
| P11 | pending | - | - | - | [ ] |
