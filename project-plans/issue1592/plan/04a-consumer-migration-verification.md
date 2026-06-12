# Phase 04a: Consumer Migration Verification

## Phase ID

`PLAN-20260610-ISSUE1592.P04A`

## Checks

1. Full battery + smoke test — paste outputs (haiku must actually appear).
2. Consumer audit table from P04 spot-checked against 10 actual files.
3. Dependency direction scans all pass — run the FULL authoritative workspace-leakage gate from P03a item 11b (multi-form import inventory + all package.json dependency sections + tsconfig path aliases + vitest/esbuild aliases), not just the quick greps. Paste the generated inventory.
4. Bundle: `npm run bundle` succeeds; `node bundle/llxprt.js --version` (or repo-standard bundle smoke) works.
5. No `eslint-disable` additions beyond what moves carried verbatim; no test weakening (`git diff main -- '**/*.test.ts' | grep -E "^-.*expect"` — review every removed assertion against its relocation).
6. Behavioral regression checklist (specification "Behavior Preservation Constraints"): for each invariant (#897 isolation, #898/#905 dedup, #1060 single scheduler, #1373 self-identification, compression, retry/failover), point at the passing test(s) that cover it in the new layout.
7. TaskTool wiring proof: paste grep evidence that BOTH composition roots pass `taskToolRegistration` in ConfigParameters (`grep -rn "taskToolRegistration" packages/cli/src packages/a2a-server/src --include="*.ts" | grep -v test`) — expect hits in CLI Config construction AND a2a `createConfigParameters`; plus point at the passing REQ-INV-003.3 matrix tests (rows a/b/c).

## Holistic Assessment + Verdict

PASS/FAIL in `.completed/P04A.md`.
