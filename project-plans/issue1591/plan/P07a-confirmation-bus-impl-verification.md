# Phase P07a: Confirmation Bus Implementation Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P07 (confirmation bus GREEN)

## Purpose

Thoroughly verify the confirmation bus implementation. All tests pass, no forbidden dependencies, correct type design, PolicyLogger injection works.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (verifies implementation quality)
- **Verifier**: deepthinker (confirms semantic correctness)

## Exact File Tasks

None (verification only).

## @plan / @requirement Marker Verification

```bash
rg "@plan.*PLAN-20260609-ISSUE1591\.P07" packages/policy/src/confirmation-bus --type ts -g '!*.test.ts' --count
# Expected: 3+ files

rg "@requirement:REQ-003" packages/policy/src/confirmation-bus --type ts -g '!*.test.ts' --count
# Expected: 3+ files
```

## Verification Commands

```bash
# 1. Full test suite
npm run test --workspace @vybestack/llxprt-code-policy -- --reporter=verbose
# Expected: ALL tests pass

# 2. Type checking
npm run typecheck --workspace @vybestack/llxprt-code-policy
# Expected: no errors

# 3. Build
npm run build --workspace @vybestack/llxprt-code-policy
# Expected: success

# 4. Forbidden dependency scan — use rg --glob
rg "from.*@vybestack/llxprt-code-core|from.*@google/genai|from.*@vybestack/llxprt-code-telemetry|from.*@vybestack/llxprt-code-providers|from.*@vybestack/llxprt-code-cli|from.*@vybestack/llxprt-code-tools" packages/policy/src --type ts -g '!*.test.ts'
# Expected: zero matches

# 5. Verify PolicyFunctionCall has correct shape
rg -A5 "interface PolicyFunctionCall" packages/policy/src/confirmation-bus/types.ts
# Expected: name?: string; args?: Record<string, unknown>

# 6. Verify ToolCallsUpdateMessage is generic with default
rg "ToolCallsUpdateMessage" packages/policy/src/confirmation-bus/types.ts | head -3
# Expected: shows <T = unknown>

# 7. Verify PolicyLogger interface
rg -A3 "interface PolicyLogger" packages/policy/src/confirmation-bus/types.ts
# Expected: debug and error methods

# 8. Verify MessageBus constructor accepts PolicyLogger
rg -n "constructor" packages/policy/src/confirmation-bus/message-bus.ts
# Expected: constructor includes optional logger parameter

# 9. Verify backward-compat aliases in index.ts
rg "as ToolConfirmationOutcome|as ToolConfirmationPayload" packages/policy/src/confirmation-bus/index.ts
# Expected: both aliases present

# 10. Verify no TODO/FIXME/HACK/STUB — use rg --glob
rg "TODO|FIXME|HACK|STUB" packages/policy/src --type ts -g '!*.test.ts'
# Expected: zero matches
```

## Success Criteria

- [ ] All tests pass (verbose output reviewed)
- [ ] Type checking passes
- [ ] Build succeeds
- [ ] Zero forbidden imports
- [ ] PolicyFunctionCall shape correct (name?, args?)
- [ ] ToolCallsUpdateMessage<T = unknown> generic with default
- [ ] PolicyLogger interface defined with debug and error
- [ ] MessageBus constructor accepts optional PolicyLogger
- [ ] Backward-compat aliases present (ToolConfirmationOutcome, ToolConfirmationPayload)
- [ ] No TODO/FIXME/HACK/STUB in production code
- [ ] @plan markers present in all confirmation-bus production files
- [ ] @requirement markers map to REQ-003

## Failure Recovery

1. If PolicyFunctionCall shape wrong — fix to match specification exactly
2. If ToolCallsUpdateMessage not generic — add generic parameter
3. If PolicyLogger not injectable — update MessageBus constructor
4. If backward-compat aliases missing — add to confirmation-bus/index.ts
