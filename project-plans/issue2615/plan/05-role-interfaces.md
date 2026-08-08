# P05 — Role Interfaces in Core

Plan ID: PLAN-20260808-ISSUE2615.P05
Requirement: REQ-002

## Goal

`packages/core/src/config/roles/` implementing the role assignment from P01,
published through one new export subpath `./config/roles` with `types`, `bun`
and `import` conditions.

## Requirements

- One file per role, plus `index.ts`
- At most 10 roles, at most 12 members each — asserted by a Bun test
- No service-locator members (guard from P04 enforces)
- `Config` must satisfy every role structurally. Add a compile-time assertion in
  core: `const _check: SessionIdentity = {} as Config;` style, one per role, so
  drift breaks the build in core rather than in a consumer.
- Every retained subpath keeps `types` / `bun` / `import` parity

## Acceptance

- Member-budget test passes
- Core typechecks; `npm run build --workspace @vybestack/llxprt-code-core` succeeds
- `bun scripts/check-config-boundary.ts` reports no role violations
