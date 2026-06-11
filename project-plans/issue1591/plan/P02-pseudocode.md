# Phase P02: Pseudocode Review

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Design
Prerequisites: P01 (domain analysis complete)

## Purpose

Review and finalize all pseudocode artifacts against the verified domain analysis. Ensure every pseudocode step is consistent with actual code paths and the overview's architectural decisions.

## Expanded Requirements

- Cross-reference each pseudocode component against verified import maps from P01
- Verify no pseudocode introduces forbidden dependencies (`@vybestack/llxprt-code-core`, `@google/genai`, `@vybestack/llxprt-code-telemetry` in policy)
- Verify config split is correct: `createPolicyEngineConfig` stays in core, pure utilities copy to policy
- Verify confirmation bus types use `PolicyFunctionCall`, `PolicyToolCallState`, generic `ToolCallsUpdateMessage<T>`
- Verify all plan IDs are `PLAN-20260609-ISSUE1591`
- Verify consumer migration correctly handles CLI (createPolicyEngineConfig stays in core)

## Exact File Tasks

| File | Action | Description |
|------|--------|-------------|
| `analysis/pseudocode/component-001-package-scaffold.md` | REVIEW | Verify scaffold matches package boundary rules |
| `analysis/pseudocode/component-002-policy-extraction.md` | REVIEW | Verify no forbidden imports in moved files |
| `analysis/pseudocode/component-003-confirmation-bus-extraction.md` | REVIEW | Verify PolicyFunctionCall, PolicyLogger, PolicyToolCallState |
| `analysis/pseudocode/component-004-core-integration.md` | REVIEW | Verify core re-export strategy, exact file paths |
| `analysis/pseudocode/component-005-test-migration.md` | REVIEW | Verify test split (what moves vs stays) |
| `analysis/pseudocode/consumer-migration.md` | REVIEW | Verify CLI migration keeps createPolicyEngineConfig in core |
| `analysis/pseudocode/package-boundary.md` | REVIEW | Verify zero core/telemetry/genai deps in policy |

## Verification Commands

```bash
# Verify no stale plan IDs
grep -rn "PLAN-20260608" project-plans/issue1591/analysis/pseudocode/ --include='*.md'

# Verify no references to @vybestack/llxprt-code-core as policy dependency
grep -rn "@vybestack/llxprt-code-core" project-plans/issue1591/analysis/pseudocode/package-boundary.md

# Verify no @google/genai in policy pseudocode (should only be in "REMOVE/FORBIDDEN" context)
grep -rn "@google/genai" project-plans/issue1591/analysis/pseudocode/ --include='*.md'
```

## Success Criteria

- [ ] All pseudocode files use plan ID `PLAN-20260609-ISSUE1591`
- [ ] No pseudocode file references `@vybestack/llxprt-code-core` as a policy package dependency
- [ ] No pseudocode file references `@google/genai` as a policy import (only in REMOVE/FORBIDDEN context)
- [ ] Config split verified: createPolicyEngineConfig/createPolicyUpdater stay in core
- [ ] Consumer migration verified: CLI imports createPolicyEngineConfig from core, types from policy
- [ ] All exact file paths verified against actual codebase from P01

## Failure Recovery

If pseudocode review reveals issues:
1. Fix the specific pseudocode artifact
2. Re-verify only the affected component
3. If the fix affects other components, update those too
4. Do NOT proceed to P03 until all pseudocode is consistent
