# Phase Verification Matrix

Plan ID: PLAN-20260603-ISSUE1584

Use this matrix in addition to each phase's local checks. Code-marker scans must search `packages/` only; plan text cannot satisfy code-marker gates.

| Phase Range | Required Commands |
|-------------|-------------------|
| P01-P02c analysis | `rg -n "provider" project-plans/issue1584/analysis`; no production code tests required unless analysis scripts are added. |
| P03-P05 contracts | `npm run typecheck --workspace @vybestack/llxprt-code-core`; targeted core tests for HistoryService, ToolIdStrategy, runtime context, content generator contracts; forbidden core->providers import scan. |
| P06-P08 scaffold | `npm install` if package metadata changes; `npm run typecheck --workspace @vybestack/llxprt-code-providers`; `npm run build --workspace @vybestack/llxprt-code-providers`; package metadata test. |
| P09-P11 provider move | `npm run test --workspace @vybestack/llxprt-code-providers`; `npm run typecheck --workspace @vybestack/llxprt-code-providers`; `npm run build --workspace @vybestack/llxprt-code-providers`; provider move map coverage scan. |
| P12-P14 consumer migration | `npm run test --workspace @vybestack/llxprt-code`; `npm run typecheck --workspace @vybestack/llxprt-code`; `npm run build --workspace @vybestack/llxprt-code`; CLI provider integration tests; forbidden core->providers import scan. |
| P15 final cleanup | Provider export scan, anti-shim scans, core/providers/cli build and typecheck. |
| P16 full verification | `npm run test`; `npm run lint`; `npm run typecheck`; `npm run format`; `npm run build`; `node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"`. |

## Marker Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584\.P[0-9A-Za-z]+" packages
rg -n "@requirement:REQ-" packages
```

Analysis-only phases do not require production code markers unless they modify code.


## Analysis-Only Phase Rule

Analysis-only phases must not fail solely because package code markers are absent. For P01-P02c, marker commands are N/A unless production files under `packages/**` are modified. Verification for those phases is artifact-based: required analysis documents must exist, include the required tables/commands, and be cross-checked against the actual repository before P03 begins.


## Expanded Package-Level Checks

During P06-P08, run providers package lint/typecheck/build and any scaffold tests:

```bash
npm run lint --workspace @vybestack/llxprt-code-providers
npm run typecheck --workspace @vybestack/llxprt-code-providers
npm run build --workspace @vybestack/llxprt-code-providers
```

During P09-P11, run providers package lint/test/typecheck/build after each implementation step that changes moved source:

```bash
npm run lint --workspace @vybestack/llxprt-code-providers
npm run test --workspace @vybestack/llxprt-code-providers
npm run typecheck --workspace @vybestack/llxprt-code-providers
npm run build --workspace @vybestack/llxprt-code-providers
```

During P12-P14, run CLI package lint/test/typecheck/build after consumer migration steps:

```bash
npm run lint --workspace @vybestack/llxprt-code
npm run test --workspace @vybestack/llxprt-code
npm run typecheck --workspace @vybestack/llxprt-code
npm run build --workspace @vybestack/llxprt-code
```
