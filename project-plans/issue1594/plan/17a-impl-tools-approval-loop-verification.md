# Phase 17a: Tools / Approval / Loop Verification

## Phase ID

`PLAN-20260617-COREAPI.P17a`

## LLxprt Code Subagent: deepthinker

## Prerequisites

- Required: Phase 17 completed
- Verification: `test -f project-plans/issue1594/.completed/P17.md`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P17"
npm test -- --testNamePattern "T2\b\|T2b\|T3\b\|T3b\|T3c\|T11\b\|T21\b"
npm run typecheck
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/control/tools.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

## Pseudocode Compliance Review (MANDATORY — deepthinker)

- Compare tools.ts with `analysis/pseudocode/tool-confirmation-merge.md` numbered steps 10-31, 40-45, 60-71, and 80-89.
- Confirm correlationId keying, dedup, modify-rekey, and that no-handler/handler-rejection
  is delegated to AgenticLoop safe denial (B7) — the public path does NOT throw.

## Semantic Verification Checklist (MANDATORY)

1. Does respondToConfirmation key on correlationId (would multi-call turns break otherwise)?
2. Is one logical confirmation deduped to one response?
3. Does ModifyWithEditor correctly re-key (new correlationId)?
4. Does no-handler + non-permissive produce a SAFE TOOL DENIAL via AgenticLoop (B7),
   NOT a throw, on the public path? Is the coordinator throw exposed only on the raw
   `./internals.js` path (T3/T11/T21)?
5. Does the raw unmerged stream serve the a2a path (T2b)?
6. Is the tool loop delegated to AgenticLoop (not re-implemented)?

### Holistic Functionality Assessment (completion marker)

- Trace a tool call: request → confirmation projection → response → execution → result → continuation.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if correlation semantics correct, no-handler safe-denial via loop (B7),
  loop delegated, T-rows green.

## Failure Recovery

- Return to Phase 17.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P17a.md`
