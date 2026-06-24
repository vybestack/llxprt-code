# Independent Plan Review — Issue #1594 Core Public API

Verdict: FAIL

## BLOCKING issues

### B1 — Phase 01 can proceed without an executed P00a preflight completion marker

**Location:**
- `project-plans/issue1594/plan/01-analysis.md`, Prerequisites
- `project-plans/issue1594/plan/00a-preflight-verification.md`
- `project-plans/issue1594/execution-tracker.md`, P00a/P01 rows

**Problem:**
P01 verifies preflight with:

```bash
test -f project-plans/issue1594/plan/00a-preflight-verification.md
```

That only proves the preflight artifact exists in the plan directory. It does not prove the preflight phase was executed, passed, or recorded in `.completed/P00a.md`. This is inconsistent with the rest of the phase chain, which uses `.completed/Pxx.md` markers, and with `PLAN-TEMPLATE.md`/`COORDINATING.md` sequencing rules.

**Why it matters:**
P00a contains critical corrections that make the plan executable: file-based FakeProvider, legal stats import path, `createIsolatedRuntimeContext`, `runtimeId`, async `handle.activate()`, and the shared `MessageBus` seam. If the coordinator can start P01 just because the static preflight document exists, the plan can skip the actual assumption-verification gate while still appearing structurally valid.

**Concrete fix:**
- Add an explicit P00a success criterion and completion marker: `project-plans/issue1594/.completed/P00a.md`.
- Change P01 prerequisites to:

```bash
test -f project-plans/issue1594/.completed/P00a.md
```

- Update `execution-tracker.md` and any verifier language to treat P00a like a real executed phase, not a static document.

### B2 — Several generated phase files still violate PLAN-TEMPLATE requirement expansion format

**Location:**
- `project-plans/issue1594/plan/01-analysis.md`
- `project-plans/issue1594/plan/02-pseudocode.md`
- `project-plans/issue1594/plan/11-harness-core-behavior.md`
- `project-plans/issue1594/plan/12-harness-cli-parity.md`

**Problem:**
These files have a `Requirements Implemented (Expanded)` section but do not include the required per-requirement `Full Text`, `Behavior`, and `Why This Matters` sections. A direct scan found these four missing one or more required headings.

Examples:
- P01 has a prose “Coverage check” with GIVEN/WHEN/THEN and “Why This Matters”, but no requirement-level `Full Text` heading.
- P02 says “No production code” and lists pseudocode files, but does not expand the requirements it governs with `Full Text`.
- P11/P12 use T-row tables instead of expanded requirement text; they do not inline the full requirement text for the REQs they test.

**Why it matters:**
The user explicitly asked to verify that generated phase files with expanded requirements include `Full Text`, `Behavior`, and `Why This Matters` per `PLAN-TEMPLATE.md`. This is not cosmetic for this coordinator/subagent system: workers rely on phase-local requirement text because subagents are intentionally isolated and should not have to infer the controlling behavior from external artifacts or tables.

**Concrete fix:**
For P01/P02/P11/P12, either:
1. add proper per-REQ subsections with:
   - `### REQ-XXX: ...`
   - `Full Text: ...`
   - `Behavior: GIVEN/WHEN/THEN ...`
   - `Why This Matters: ...`,

or, for analysis/pseudocode phases that intentionally cover all requirements, add an explicit expanded umbrella requirement section that copies the controlling full text and behavior for the analysis/pseudocode deliverable. For P11/P12, keep the T-row tables, but precede or follow them with expanded REQ sections for every REQ those tests implement.

### B3 — P15 bootstrap verifier can false-fail a correct multiline `createAgentRuntimeState({ runtimeId, ... })` implementation

**Location:**
- `project-plans/issue1594/plan/15-impl-createagent-core.md`, Verification Commands

**Problem:**
P15 verifies the runtime-state call with:

```bash
grep -rn "createAgentRuntimeState" packages/agents/src/api/createAgent.ts | grep -q "runtimeId" || { echo "MISSING runtimeId"; missing=1; }
```

The plan’s own pseudocode uses the idiomatic multiline call:

```ts
createAgentRuntimeState({
  runtimeId,
  provider,
  model,
  ...
})
```

In that shape, the line containing `createAgentRuntimeState` will not contain `runtimeId`, so the verifier fails even when the implementation is correct.

**Why it matters:**
This is a hard coordination executability defect. A verifier that rejects the expected implementation shape blocks the phase and encourages workers either to write awkward one-line code to satisfy grep or to bypass the check. The runtimeId requirement is critical and should be verified robustly.

**Concrete fix:**
Replace the single-line grep with a block-aware check, for example:

```bash
grep -n "createAgentRuntimeState" packages/agents/src/api/createAgent.ts | cut -d: -f1 | while read -r line; do
  sed -n "${line},$((line+12))p" packages/agents/src/api/createAgent.ts | grep -q "runtimeId" || exit 1
done || { echo "MISSING runtimeId"; missing=1; }
```

Prefer an AST-based verifier if available. The same pass should ensure the value equals the shared runtime-context `runtimeId`, not merely any property named `runtimeId`.

## NON-BLOCKING issues / improvements

### N1 — P11/P12 defer property-ratio enforcement until P29
P08 creates a global property-ratio script and P29 enforces ≥30%, but P11/P12 only say “write enough property tests.” This can push a predictable failure to the final evaluation. Add a non-final check after P13a or in each harness verifier to run the property-ratio script in warning or hard-fail mode once the harness files exist.

### N2 — Some verification commands are brittle Vitest-output checks
A few phases pipe Vitest output through `tail` or grep for output words. Prefer relying on test exit codes plus specific marker greps. Example: tests should fail/pass based on the Vitest process exit code, not whether a word appears in the last 20 lines.

### N3 — P07 wording should keep “transitional” front-and-center in docs
P07 correctly became non-breaking: it adds `./internals.js` while keeping current top-level low-level exports until #1595. Ensure P28 docs explicitly call this transitional, so consumers do not mistake the temporary top-level low-level exports for the final curated public API.

## Coverage assessment summary

### REQ-001..REQ-021
All formal requirements are nominally mapped in `execution-tracker.md`, and the phase allocation is largely coherent:

- REQ-001: P05/P15/P26 — covered, with strong shared runtime context and bootstrap constraints.
- REQ-002: P03/P14/P23 — covered, including typed config and sandbox classification.
- REQ-003: P04/P10/P14/P15/P26 — covered, including 21 variants and exactly-one-done.
- REQ-004/005: P16 — covered, including context preservation, rebuildLoop, and stripThoughts.
- REQ-006/007: P03/P05/P13/P15/P17/P23/P24 — covered, including confirmation IDs, safe denial, scheduler factory, and AgenticLoop delegation.
- REQ-008/009: P18/P19 — covered.
- REQ-010/011: P20 — covered, including legal stats import path and compression split.
- REQ-012: P21 — covered.
- REQ-013/014: P22 — covered, including decided MCP discovery semantics.
- REQ-015: P23/P24 — covered.
- REQ-016: P13/P24 — covered.
- REQ-017: P03/P04/P05/P25 — covered.
- REQ-018: P07 — covered and now non-breaking for #1594.
- REQ-019: P08/P09/P13/P29 — covered, including viable Stryker setup and property tooling.
- REQ-020: P28 — covered.
- REQ-021: P09/P26/P27 — covered, with P27 requiring behavior-real app-service backing.

Coverage is complete at the mapping level, but P01/P02/P11/P12 must be reformatted to carry expanded requirement text locally.

### T1..T25 harness rows
All T-rows and named subrows are allocated to RED and GREEN phases in `execution-tracker.md`:

- T1: P11 → P15
- T2/T2b/T3/T3b/T3c/T11/T21: P10/P11 → P17
- T4/T4b/T4c/T4d/T4e/T4f/T5: P12 → P16/P19
- T6/T6b/T7/T8/T8b/T14b: P11 → P20
- T9: P11 → P15
- T10: P11 → P21
- T12/T12b/T20: P12 → P22/P25
- T13: P13 → P24, with initial cleanup in P15
- T14/T15c: P11/P12 → P17/P20/P23
- T15/T15b: P12 → P22/P23
- T16: P10 → P14/P15
- T17: P09 boundary guard
- T18/T18b/T18c/T18d/T18e: P12 → P18/P19/P23
- T19: P13 → P23/P24
- T22: P11/P12 → P26
- T23/T24: P09 → P27
- T25: P11 → P15/P25

The mapping is complete and internally much more consistent than earlier iterations. The remaining issue is phase-local requirement expansion, not missing T-row allocation.

## Explicit yes/no findings

- **Design fidelity:** YES, with blocking formatting/executability defects. The plan is faithful to `overview.md`: Agent API lives in `@vybestack/llxprt-code-agents`; P07 is non-breaking; createAgent uses shared runtime context/runtimeId/message bus/activate/runtime state/rebuildLoop; public no-handler confirmation safe-denies; MCP discovery semantics are decided; stats import path is legal; 21 variants are represented.
- **Full harness/REQ coverage:** YES at mapping level, NO at phase-local expanded-requirement format level because P01/P02/P11/P12 omit required Full Text/Behavior/Why structure.
- **TDD soundness:** YES overall. Stubs precede RED harness phases, which precede implementation phases; tests are framed as behavior tests using real Agent/FakeProvider/infrastructure fakes. Improve early property-ratio enforcement to avoid final surprise.
- **Pseudocode discipline:** YES. Pseudocode files are contract-first and implementation phases cite numbered step labels, not physical line ranges. No orphan pseudocode found.
- **Integration:** YES. The plan is not isolated: it covers public exports, CLI/a2a boundary, no-deep-import guards, app-service subpaths, and non-interactive parity.
- **Coordination executability:** NO until B1 and B3 are fixed. The preflight completion marker gap allows a skipped preflight, and the P15 runtimeId verifier can false-fail correct code.
- **Open-question decisions:** YES. Entry package, control-plane scope, public sub-surfaces, no-handler confirmation, idle-timeout, stats source, command boundary, sandbox, a2a future, and core trim sequencing are all decided.
- **Correctness-risk handling:** YES overall. The plan handles event mapping/done synthesis, AgentExecutionStopped vs Blocked, client rebinding/rebuildLoop, shared provider/config/OAuth/message bus context, confirmation correlationId vs toolCallId, dispose ownership, MCP discovery, scheduler factory ownership, and telemetry import legality. The B3 verifier must be fixed so these risks can be validated reliably.
