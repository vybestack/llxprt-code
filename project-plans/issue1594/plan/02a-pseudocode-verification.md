# Phase 02a: Pseudocode Verification

## Phase ID

`PLAN-20260617-COREAPI.P02a`

## LLxprt Code Subagent: deepthinker

## Prerequisites

- Required: Phase 02 completed
- Verification: `test -f project-plans/issue1594/.completed/P02.md`

## Purpose

Deep review of the six pseudocode files for correctness, completeness, and
consistency with the domain model + P00a corrections. This is a `deepthinker` phase
because pseudocode quality determines whether impl phases stay faithful (PLAN.md:
pseudocode MUST be used and referenced by line).

## Verification Commands

```bash
for f in createAgent config-adapter event-adapter switch-rebind tool-confirmation-merge dispose; do
  echo "== $f =="; grep -cE "^[0-9]+:" project-plans/issue1594/analysis/pseudocode/$f.md;
done
```

## Semantic Verification Checklist (MANDATORY)

For EACH file, answer in the completion marker:

1. Are INPUTS/OUTPUTS/DEPENDENCIES explicit and real (injected, not stubbed)?
2. Does each numbered line describe ONE algorithmic step (no hidden complexity)?
3. event-adapter: does it map ALL 21 variants and synthesize exactly one `done` for
   max-turns/context-overflow/loop-detected/error/BeforeAgent-block? Is
   AgentExecutionBlocked NON-terminal and AgentExecutionStopped terminal?
4. switch-rebind: does it assert `existingHistoryService === newHistoryService` and
   apply stripThoughts normalization?
5. tool-confirmation-merge: does respond key on correlationId (not toolCallId)? Does
   the public Agent path use AgenticLoop safe-denial for no-handler ASK_USER, while
   raw coordinator internals may throw only on the documented power-user path?
6. dispose: is teardown idempotent, awaited, error-collecting, ownership-table-driven?
7. Are anti-pattern warnings concrete (no hardcoded returns, no test doubles in prod)?

### Holistic Functionality Assessment (write in completion marker)

- Summarize each algorithm in your own words.
- Confirm consistency across files (e.g. createAgent's resolveClient ↔ switch-rebind's
  reattach ↔ dispose's teardown of the same resources).
- Identify ANY ambiguity an impl worker could misinterpret.
- Verdict: PASS/FAIL.

## Success Criteria

- PASS only if all six algorithms are unambiguous, complete, mutually consistent.

## Failure Recovery

- Return to Phase 02 with specific line-level feedback; loop until PASS.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P02a.md` (include Holistic Assessment).
