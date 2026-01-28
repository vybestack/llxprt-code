# Phase 0.5: Preflight Verification

## Purpose
Verify ALL assumptions before writing any code.

## Dependency Verification
| Dependency | npm ls Output | Status |
|------------|---------------|--------|
| msw | (fill after running: npm ls msw) | ⬜ |
| vitest | (fill after running: npm ls vitest) | ⬜ |

## Type/Interface Verification
| Type Name | Expected Definition | Actual Definition | Match? |
|-----------|---------------------|-------------------|--------|
| RuntimeInvocationContext | Has cliSettings/modelBehavior/modelParams/customHeaders + ephemerals | (fill after grep) | ⬜ |
| EphemeralSettings | Registry-derived settings shape | (fill after grep) | ⬜ |

## Call Path Verification
| Function | Expected Caller | Actual Caller | Evidence |
|----------|-----------------|---------------|----------|
| buildEphemeralsSnapshot | ProviderManager | (fill after grep) | ⬜ |
| filterOpenAIRequestParams | OpenAI providers | (fill after grep) | ⬜ |
| getModelParams | Providers (anthropic/openai/etc) | (fill after grep) | ⬜ |
| getCustomHeaders | Providers/base provider | (fill after grep) | ⬜ |

## Test Infrastructure Verification
| Component | Test File Exists? | Test Patterns Work? |
|-----------|-------------------|---------------------|
| settings registry | (packages/core/src/**/__tests__/*) | ⬜ |
| RuntimeInvocationContext | (packages/core/src/**/__tests__/*) | ⬜ |
| providers integration | (packages/core/src/**/__tests__/*) | ⬜ |
| CLI settings | (packages/cli/src/**/__tests__/*) | ⬜ |

## Blocking Issues Found
- None yet (fill during preflight)

## Verification Gate
- [ ] All dependencies verified
- [ ] All types match expectations
- [ ] All call paths are possible
- [ ] Test infrastructure ready

IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.
