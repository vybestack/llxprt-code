# P09 — Migrate cli

> **SUPERSEDED — DO NOT EXECUTE.** See `../STATUS.md`. This plan targeted type
> width; the real problem is that `Config` mixes configuration, construction,
> injection and service location. Kept for the reasoning and the recorded dead
> ends only.

Plan ID: PLAN-20260808-ISSUE2615.P09
Requirement: REQ-001

## Goal

Zero production files in `packages/cli` importing the `Config` type.
Approximately 14 files at plan time; use the P04 guard for the live list.

## Method

1. `bun scripts/check-config-boundary.ts` for the current file list
2. For each file, replace `Config` with the narrowest role interface from
   `@vybestack/llxprt-code-core/config/roles` that covers what it reads
3. Compose roles with `&` or `extends` where a file spans concerns
4. Typecheck; where a file forwards into a callee still requiring `Config`,
   narrow the callee first — bottom-up, never top-down
5. Delete any now-unused consumer capability interface as you go

## Rules

- Do not add members to a role to make a file compile. If a file needs something
  no role provides, that is a P01 gap: record it in
  `analysis/role-gaps.md` and stop.
- Do not reintroduce consumer-owned capability modules.
- Do not touch `fromConfig` or its identity test.
- `new Config(...)` sites keep the concrete class.

## Verification before commit

- `cd packages/cli && npm test` — zero non-timeout failures
- `npm run typecheck`, `npm run lint`
- If core changed: `npm run build --workspace @vybestack/llxprt-code-core`
  before typechecking cli, which resolves core through dist
- `bun scripts/check-cli-import-boundary.ts` if cli touched

## Acceptance

- Guard reports 0 production `Config` holders in `packages/cli`
- Suites green, commit self-contained
