# P06 Audit: Replay Engine Stub

## Plan Requirements
- Create `packages/core/src/recording/ReplayEngine.ts` as a **stub** for phase P06.
- Include plan/requirement markers in that file:
  - `@plan:PLAN-20260211-SESSIONRECORDING.P06`
  - `@requirement:REQ-RPL-001`
- Provide `replaySession(filePath, expectedProjectHash)` with stub behavior (throw NotYetImplemented).
- Provide `readSessionHeader(filePath)` with stub behavior (throw NotYetImplemented).
- Modify `packages/core/src/recording/index.ts` to export ReplayEngine functions.
- Semantic checklist expected in P06:
  - `replaySession(filePath: string, expectedProjectHash: string)`
  - Return type `ReplayResult | ReplayError` (per plan text)
  - `readSessionHeader` returns `SessionStartPayload | null`
- Success criteria in phase doc: compiles as stub, correct signatures, no TODO/V2 artifacts.

## What Was Actually Done
- `packages/core/src/recording/ReplayEngine.ts`
  - File exists and is fully implemented, not a stub.
  - Header markers are for **P08**, not P06:
    - `@plan PLAN-20260211-SESSIONRECORDING.P08` (line ~19)
    - Requirements listed: `REQ-RPL-002, REQ-RPL-003, REQ-RPL-005, REQ-RPL-006, REQ-RPL-007, REQ-RPL-008` (line ~20)
  - `replaySession` exists with signature:
    - `replaySession(filePath: string, expectedProjectHash: string): Promise<ReplayResult>` (lines ~57-61)
    - Implements full JSONL streaming parse, event dispatch, validation, warnings, corruption handling, metadata/history reconstruction (lines ~62-347).
    - Does **not** throw NotYetImplemented.
  - `readSessionHeader` exists with signature:
    - `readSessionHeader(filePath: string): Promise<SessionStartPayload | null>` (lines ~361-363)
    - Implements actual first-line read/parse logic and returns null on failure (lines ~364-399).
- `packages/core/src/recording/index.ts`
  - Replay exports are present:
    - `export { replaySession, readSessionHeader } from './ReplayEngine.js';` (line 25).

## Gaps / Divergences
1. **Phase marker mismatch**
   - Plan required P06 marker/requirement (`P06`, `REQ-RPL-001`) in ReplayEngine stub.
   - Actual file is marked P08 with later requirements, and function-level marker for `readSessionHeader` references `REQ-RPL-001` under P08 context.
2. **Stub vs implementation mismatch**
   - Plan required P06 to create stub methods that throw NotYetImplemented.
   - Actual file contains full replay engine implementation.
3. **Return-shape divergence from P06 wording**
   - P06 text describes a return of `ReplayResult | ReplayError` and stub throwing.
   - Actual function returns `Promise<ReplayResult>` discriminated union (`ok: true/false`) without separate thrown NotYetImplemented path.
4. **Temporal/phase sequencing divergence**
   - Work appears to have advanced directly to P08 scope (multiple requirements beyond P06) within the same file, exceeding the exact scoped deliverable for P06.

## Severity
- Gap 1 (Phase marker mismatch): **Medium** — traceability/auditability issue; implementation may be correct but phase attribution is inconsistent.
- Gap 2 (Stub vs implementation mismatch): **Low-Medium** — functionally ahead of plan, but does not match requested phase artifact for strict phase-by-phase auditing.
- Gap 3 (Return-shape wording divergence): **Low** — likely resolved by later architecture (discriminated union) and still type-safe; differs from P06 document wording.
- Gap 4 (Phase sequencing divergence): **Low** — over-delivery rather than missing behavior, but violates strict phased implementation boundaries.

## Summary Verdict
**PARTIAL**

Core files and exports exist, and functionality is implemented (in fact beyond stub scope), but the deliverable does not match P06’s explicit stub/marker requirements exactly.