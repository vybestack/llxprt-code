# Phase P02a: Pseudocode Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P02 (pseudocode review complete)

## Purpose

Independently verify that all pseudocode artifacts are consistent with the verified domain analysis, contain no forbidden dependencies, and are complete enough to guide implementation.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (verifies pseudocode artifacts)
- **Verifier**: deepthinker (confirms compliance with requirements)

## Exact File Tasks

None (verification only).

## Verification Commands

```bash
# 1. All pseudocode files must use correct plan ID
rg "PLAN-20260608" project-plans/issue1591/analysis/pseudocode/ --type md
# Expected: zero matches (no stale plan IDs)

rg "PLAN-20260609-ISSUE1591" project-plans/issue1591/analysis/pseudocode/ --type md -c
# Expected: 1+ matches per file

# 2. No @vybestack/llxprt-code-core as policy dependency
rg "@vybestack/llxprt-code-core" project-plans/issue1591/analysis/pseudocode/package-boundary.md
# Expected: only in "FORBIDDEN" or "must not" context

# 3. No @google/genai as policy import
rg "@google/genai" project-plans/issue1591/analysis/pseudocode/ --type md
# Expected: only in "REMOVE/FORBIDDEN" context

# 4. Config split verified
rg "createPolicyEngineConfig" project-plans/issue1591/analysis/pseudocode/ --type md
# Expected: stays in core, not moved to policy

# 5. Consumer migration verified
rg "cli" project-plans/issue1591/analysis/pseudocode/consumer-migration.md
# Expected: CLI migration keeps createPolicyEngineConfig from core, types from policy

# 6. All pseudocode files exist
ls project-plans/issue1591/analysis/pseudocode/component-001-package-scaffold.md
ls project-plans/issue1591/analysis/pseudocode/component-002-policy-extraction.md
ls project-plans/issue1591/analysis/pseudocode/component-003-confirmation-bus-extraction.md
ls project-plans/issue1591/analysis/pseudocode/component-004-core-integration.md
ls project-plans/issue1591/analysis/pseudocode/component-005-test-migration.md
ls project-plans/issue1591/analysis/pseudocode/consumer-migration.md
ls project-plans/issue1591/analysis/pseudocode/package-boundary.md
```

## @plan / @requirement Marker Requirements

This phase verifies that pseudocode artifacts reference:
- Plan ID `PLAN-20260609-ISSUE1591`
- Requirement IDs (REQ-001 through REQ-008) where pseudocode maps to specific requirements
- Component-004 references REQ-006 (core integration)
- Component-005 references REQ-007 (test migration)
- Consumer migration references REQ-006, REQ-007

## Success Criteria

- [ ] All pseudocode files use plan ID `PLAN-20260609-ISSUE1591`
- [ ] No pseudocode references `@vybestack/llxprt-code-core` as a policy dependency
- [ ] No pseudocode references `@google/genai` as a policy import (only in REMOVE/FORBIDDEN context)
- [ ] Config split verified: createPolicyEngineConfig/createPolicyUpdater stay in core
- [ ] Consumer migration verified: CLI imports types from policy, orchestration from core
- [ ] All 7 pseudocode files present and reviewed
- [ ] All exact file paths verified against actual codebase from P01

## Failure Recovery

1. If stale plan IDs found — update to `PLAN-20260609-ISSUE1591`
2. If forbidden dependency referenced — fix pseudocode to use policy-owned types
3. If config split wrong — clarify what stays in core vs moves
4. Do NOT proceed to P03 until all pseudocode is verified consistent
