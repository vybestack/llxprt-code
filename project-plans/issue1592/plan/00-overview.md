# Plan: Extract Agents Package (Issue #1592)

Plan ID: PLAN-20260610-ISSUE1592
Generated: 2026-06-10
Total Phases: P00a, P01, P01a, P02, P02a, P03, P03a, P04, P04a, P05, P05a
Requirements: REQ-PKG-001, REQ-DEP-001, REQ-API-001, REQ-INV-001, REQ-INV-002, REQ-INV-003, REQ-TEST-001, REQ-CLEAN-001

## Plan-Template Deviation Note

This plan deliberately deviates from the canonical PLAN.md feature sequence (stub → TDD → impl → integration → migration → deprecation): this is a behavior-preserving package extraction of ~61k lines of EXISTING, already-tested code, not a new feature. The existing test suite IS the behavioral safety net; TDD applies to the only new code (the P01 inversion seams, which are TDD-first). Phases are structured as preflight → inversion (TDD) → scaffold → atomic move+migration → audit/hardening → cleanup, with verification gates after each. Integration-first intent is preserved: the atomic P03 forces the move and all consumers to land together (no isolated package possible).

## Smoke-Test Note

The smoke test uses `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"` following project-local guidance in `.llxprt/LLXPRT.md` (the most specific instruction for this repo).

## Critical Reminders

1. This is a behavior-preserving refactor. NO logic changes during moves — only import paths and construction wiring change.
2. Read these artifacts before any implementation phase:
   - `project-plans/issue1592/specification.md`
   - `project-plans/issue1592/analysis/reverse-dependency-map.md`
   - `project-plans/issue1592/analysis/integration-contract.md`
   - `project-plans/issue1592/analysis/move-map.md`
3. Workspace must be green (typecheck + build at minimum) at the end of EVERY phase; full test suite green at P01a, P03a, P04a, P05a gates.
4. Use `git mv` for file moves to preserve history.
5. No compatibility shims: core must never re-export agents APIs; no forwarding wrapper files.
6. Anti-shim scan and core→agents import scan run from P03 onward.

## Execution Model

Sequential phases. Worker phases run with typescriptexpert; verification phases with typescriptreviewer (or deepthinker for semantic review). Do not skip phases. Each phase's completion marker goes in `project-plans/issue1592/.completed/P##.md`.

## Phase Summary

| Phase | Content |
|---|---|
| P00a | Preflight verification — verify every assumption in analysis docs against the working tree; produce preflight-results.md |
| P01 | Core contracts + construction inversion (in-place, before any move): `AgentClientContract`/`AgentClientFactory`, `ToolSchedulerContract`/`ToolSchedulerFactory`, `TaskToolRegistration` descriptor; Config/schedulerSingleton/toolRegistryFactory inverted (factories as ConfigParameters constructor params). AgentClient/scheduler factories: CLI/a2a/test wiring registers concrete classes (importable from core's public barrel today). TaskTool: STAGE 1 — core-local default registration module (`config/defaultTaskToolRegistration.ts`) since TaskTool has no public import path until P03; external roots wire it in P03 (REQ-INV-003.1). TDD: behavioral tests for the new seams written FIRST. |
| P01a | Verification of P01: tests pass, inversion complete (no `new AgentClient`/`new CoreToolScheduler` class construction/dynamic import in core config except via factories), behavior unchanged, full suite green |
| P02 | Package scaffold: `packages/agents` package.json/tsconfig/vitest, workspaces entry, CI/release/prepare-package/sandbox wiring, core exports map additions; package builds with placeholder index |
| P02a | Verification of P02: `npm run build` green including agents; release/CI files reference agents consistently with providers pattern |
| P03 | ATOMIC code move + consumer migration: `git mv` per move-map; turn.ts split; SubagentSchedulerFactory type relocation; import rewrites inside moved files (core deep modules) and inside core stayers; agents index.ts public API; core index.ts cleanup; AND all CLI/a2a-server import flips to `@vybestack/llxprt-code-agents` in the same change set. Because no shims are allowed, the workspace is only green when moves and consumer updates land together — P03 is one atomic phase ending green. |
| P03a | Verification of P03: no moved-file leftovers in core, no core→agents imports, anti-shim scan, full workspace test/typecheck/build green |
| P04 | Consumer audit + integration hardening: systematic audit of every CLI/a2a consumer file against the reverse-dep map, factory wiring finalization, esbuild bundle verification, integration test sweep, smoke test |
| P04a | Verification of P04: full suite + lint + format + build + smoke test, dependency direction scans, behavioral regression checklist |
| P05 | Cleanup & final hardening: remove dead exports, verify export maps minimal, documentation touch-ups (package READMEs if siblings have them), final full verification battery |
| P05a | Final semantic review: behavioral regression checklist, holistic assessment, PR readiness |

## Forbidden Implementations (reject on sight)

- `packages/core` importing `@vybestack/llxprt-code-agents` anywhere (src or tests).
- Wrapper/forwarding files in `packages/core/src/core/` re-exporting agents modules.
- `packages/agents` importing `@vybestack/llxprt-code-providers` or CLI.
- Renamed/duplicated classes (`AgentClientV2`, `NewScheduler`, etc.).
- Test deletions without relocation; weakened assertions.
- Logic edits inside moved files beyond import paths and explicitly specified seam changes.

## Verification Battery (used at gates)

**AUTHORITATIVE DEFINITION — wherever any phase doc says "full battery" it means EXACTLY this entire block, no subsets.** Every code-changing phase (P01, P02, P03, P04, P05) ends with the full battery; verification phases (P01a–P05a) re-run it. Phase docs may ADD scans but never remove battery items.

**EXECUTION PROTOCOL (makes the diff gate passable)**: each code-changing phase COMMITS its work (including any formatting the phase ran) BEFORE running the battery. The battery's `git diff --exit-code` then proves `npm run format` produced no NEW changes on top of the committed phase work — i.e. the committed code is format-clean. If format does change files at this point, amend/commit the format diff and re-run the battery from the top.

```bash
# Order matters: format FIRST so all semantic checks run against the final (formatted) code.
# PRECONDITION: phase work is already committed (see execution protocol above).
npm run format
git diff --exit-code   # proves the committed phase work was format-clean
npm run typecheck
npm run build
npm run test
npm run lint
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"

# Dependency direction scans (include tests — boundary rules cover test code)
# AUTHORITATIVE SCAN: from P03a onward, every gate (P03a, P04, P04a, P05, P05a) runs the FULL
# workspace-leakage gate defined in plan/03a-code-move-verification.md item 11b — the generated
# multi-form import inventory (static single/double quotes, export-from, dynamic import(),
# require(), vi.mock() literals) PLUS all package.json dependency sections (dependencies,
# devDependencies, peerDependencies, optionalDependencies) PLUS tsconfig path aliases PLUS
# vitest/esbuild alias configs. The quick greps below are a convenience subset, NOT a substitute.
grep -rn "llxprt-code-agents" packages/core --include="*.ts" && echo FAIL || echo OK
grep -n "llxprt-code-agents" packages/core/package.json && echo "FAIL: core must not declare agents in ANY dependency section" || echo OK
grep -rn "llxprt-code-providers" packages/agents --include="*.ts" && echo FAIL || echo OK
grep -n "llxprt-code-providers\|llxprt-code-cli" packages/agents/package.json && echo FAIL || echo OK
grep -rn "packages/cli" packages/agents/src && echo FAIL || echo OK
grep -rn "from '@vybestack/llxprt-code-core'" packages/agents/src --include="*.ts" && echo "AUDIT root-barrel imports" || echo OK

# Anti-shim scan (after P03)
ls packages/core/src/core/client.ts 2>/dev/null && echo "FAIL: client.ts must be absent (moved); contract lives in clientContract.ts" || echo OK
ls packages/core/src/core/clientContract.ts # must exist (staying contract module)
grep -rn "export \* from '@vybestack/llxprt-code-agents'" packages/core && echo FAIL || echo OK
```
