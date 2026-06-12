# Phase P10a-V: Consumer & Boundary Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P10a (test migration verified)

## Purpose

**Verification-only phase (no RED/GREEN cycle).** Verify that CLI consumers can import all policy types through core re-exports after P09/P10 are complete. This phase replaces the former P10b (RED) and P10c (GREEN) phases, which were eliminated because they produced a bogus RED state: core re-export shims are already in place after P09, so CLI imports via core already work before any consumer RED tests could be written.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (verifies consumer integration)
- **Verifier**: deepthinker (confirms completeness)

## Why No RED/GREEN for Consumer Migration

The review identified that P10b/P10c consumer RED tests after P09/P10 are bogus:
- P09 already creates core re-export shims that forward policy types
- P10 already migrates tests successfully using those re-exports
- By the time P10b would run, CLI imports via core re-exports already work
- A RED test asserting "CLI can import from core" would pass immediately (not RED)
- A RED test asserting "re-export shim not in place" would fail because P09 put it there

Therefore: consumer migration is a **verification-only** gate that confirms existing wiring works, rather than a RED→GREEN TDD cycle.

## Exact File Tasks

None (verification only).

## Verification Commands

```bash
# 1. CLI test suite passes (CLI imports via core re-exports)
npm run test --workspace @vybestack/llxprt-code-cli
# Expected: ALL pass

# 2. Verify CLI can access policy types via core re-exports
node -e "
  import('@vybestack/llxprt-code-core').then(m => {
    const required = ['PolicyEngine', 'PolicyDecision', 'MessageBus', 'ConfirmationOutcome', 'ToolConfirmationOutcome'];
    const missing = required.filter(k => !(k in m));
    if (missing.length > 0) { console.error('MISSING:', missing); process.exit(1); }
    console.log('PASS: all policy types available via core re-exports');
  });
"

# 3. Verify ToolConfirmationOutcome alias is runtime-identical to ConfirmationOutcome
node -e "
  import('@vybestack/llxprt-code-core').then(m => {
    if (m.ToolConfirmationOutcome !== m.ConfirmationOutcome) {
      console.error('ALIAS MISMATCH: ToolConfirmationOutcome !== ConfirmationOutcome');
      process.exit(1);
    }
    console.log('PASS: ToolConfirmationOutcome is identity-equal to ConfirmationOutcome');
  });
"

# 4. Verify CLI still imports createPolicyEngineConfig/createPolicyUpdater from core
rg "createPolicyEngineConfig|createPolicyUpdater" packages/cli/src --type ts
# Expected: present (imported from @vybestack/llxprt-code-core)

# 5. Verify CLI does NOT have direct @vybestack/llxprt-code-policy dependency (unless behavioral test proved need)
# Check if direct dep was added:
rg "@vybestack/llxprt-code-policy" packages/cli/package.json
# If present: must be justified by a documented behavioral need
# If absent: PASS (CLI relies on core re-exports — preferred)

# 6. Verify no CLI source files import directly from policy package (unless justified)
rg "from.*@vybestack/llxprt-code-policy" packages/cli/src --type ts
# Expected: zero matches (CLI uses core re-exports) OR documented justification if present

# 7. Full workspace build
npm run build
npm run typecheck
```

## Success Criteria

- [ ] CLI test suite passes
- [ ] CLI can import PolicyEngine, MessageBus, PolicyDecision, ConfirmationOutcome via core re-exports
- [ ] ToolConfirmationOutcome is runtime-identical to ConfirmationOutcome (alias identity)
- [ ] CLI still imports createPolicyEngineConfig/createPolicyUpdater from core
- [ ] No direct `@vybestack/llxprt-code-policy` CLI dependency unless justified by behavioral need
- [ ] Full workspace builds and typechecks

## Failure Recovery

1. If CLI tests fail — check that core re-export shims (P09) forward all required exports
2. If alias identity broken — verify tool-confirmation-types.ts re-export shim
3. If CLI missing a type — check core policy/index.ts barrel re-exports completeness
4. Targeted fix: update core re-export shims, do NOT add direct CLI policy dependency unless justified
