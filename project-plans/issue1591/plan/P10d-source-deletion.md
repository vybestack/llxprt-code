# Phase P10d: Source Deletion & Cleanup

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Implementation
Prerequisites: P10b-V (boundary scan verified)

## Purpose

Replace old core source files with thin re-export shims that forward to `@vybestack/llxprt-code-policy`. Only files whose content now lives in `packages/policy/src/` and have remaining callers are replaced with shims. Files with no remaining callers are deleted outright. Re-export shims and kept files remain.

**Critical**: Files are not simply deleted — they are replaced with thin re-export shims to maintain backward compatibility for deep imports (e.g., `import { PolicyDecision } from '../policy/types.js'` within core).

## Worker / Verifier Assignment

- **Worker**: typescriptexpert (replaces core source with re-export shims)
- **Verifier**: typescriptreviewer (verifies in P10d-V)

## @plan / @requirement Marker Requirements

This phase tracks file deletions. Document each deletion with a comment in the re-export shim or barrel:

```typescript
// @plan PLAN-20260609-ISSUE1591.P10d — original types.ts deleted (moved to packages/policy/src/types.ts)
```

## Exact File Tasks

### Old Files to REPLACE with Thin Re-Export Shims (deep imports still active)

Each shim is a minimal file that re-exports everything from `@vybestack/llxprt-code-policy`, preserving deep import paths like `../policy/types.js`.

| File | Re-Export Shim Content |
|------|----------------------|
| `core/src/policy/types.ts` | `export * from '@vybestack/llxprt-code-policy';` + deletion comment |
| `core/src/policy/policy-engine.ts` | `export * from '@vybestack/llxprt-code-policy';` + deletion comment |
| `core/src/policy/stable-stringify.ts` | `export * from '@vybestack/llxprt-code-policy';` + deletion comment |
| `core/src/policy/utils.ts` | `export * from '@vybestack/llxprt-code-policy';` + deletion comment |
| `core/src/policy/toml-loader.ts` | `export * from '@vybestack/llxprt-code-policy';` + deletion comment |
| `core/src/confirmation-bus/types.ts` | `export * from '@vybestack/llxprt-code-policy';` + deletion comment |
| `core/src/confirmation-bus/message-bus.ts` | `export { MessageBus } from '@vybestack/llxprt-code-policy';` + deletion comment |

**Before replacing**, grep for direct relative imports to each file across core source. If no callers remain (all updated to import from `@vybestack/llxprt-code-policy` directly), delete the file outright instead of creating a shim.

### Files that STAY in Core (re-export shims or kept)

| File | Strategy |
|------|----------|
| `core/src/policy/index.ts` | RE-EXPORT shim (already updated in P09) |
| `core/src/policy/config.ts` | KEEP orchestration functions |
| `core/src/policy/policy-helpers.ts` | KEEP (hard tool/scheduler deps) |
| `core/src/confirmation-bus/index.ts` | RE-EXPORT shim (already updated in P09) |
| `core/src/tools/tool-confirmation-types.ts` | RE-EXPORT shim (already updated in P09) |

### TOML Cleanup (optional)

| File | Strategy |
|------|----------|
| `core/src/policy/policies/*.toml` | KEEP in core for now (may be used by core config.ts); can be removed in future cleanup if verified unused |

## Verification Commands

```bash
# 1. All tests pass after deletion
npm run test --workspace @vybestack/llxprt-code-policy
npm run test --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-cli
# Expected: ALL pass

# 2. Full workspace build
npm run build
npm run typecheck

# 3. Verify deleted/replaced files are either shims or gone
for f in types.ts policy-engine.ts stable-stringify.ts utils.ts toml-loader.ts; do
  if [ -f "packages/core/src/policy/$f" ]; then
    # File exists — must be a shim (re-exports from policy package)
    if grep -q "@vybestack/llxprt-code-policy" "packages/core/src/policy/$f"; then
      echo "PASS: packages/core/src/policy/$f is a re-export shim"
    else
      echo "FAIL: packages/core/src/policy/$f still contains original code (should be shim or deleted)"
    fi
  else
    echo "PASS: packages/core/src/policy/$f deleted (no remaining callers)"
  fi
done
for f in types.ts message-bus.ts; do
  if [ -f "packages/core/src/confirmation-bus/$f" ]; then
    if grep -q "@vybestack/llxprt-code-policy" "packages/core/src/confirmation-bus/$f"; then
      echo "PASS: packages/core/src/confirmation-bus/$f is a re-export shim"
    else
      echo "FAIL: packages/core/src/confirmation-bus/$f still contains original code"
    fi
  else
    echo "PASS: packages/core/src/confirmation-bus/$f deleted (no remaining callers)"
  fi
done

# 4. Verify re-export shims still exist
ls packages/core/src/policy/index.ts
ls packages/core/src/confirmation-bus/index.ts
ls packages/core/src/tools/tool-confirmation-types.ts
ls packages/core/src/policy/config.ts
ls packages/core/src/policy/policy-helpers.ts
```

## Success Criteria

- [ ] All moved source files replaced with thin re-export shims (or deleted if no callers remain)
- [ ] Re-export shims forward all exports from `@vybestack/llxprt-code-policy`
- [ ] Deep imports (e.g., `../policy/types.js`) still resolve via shims
- [ ] All tests pass (policy, core, CLI)
- [ ] Full workspace builds and typechecks
- [ ] No broken imports after deletion
- [ ] Deletion comments present in re-export shims

## Failure Recovery

1. If build fails after deletion — a file may still be imported directly (not via shim). Check error output, either update the import or keep the file.
2. If tests fail — check for direct relative imports to deleted files
3. Targeted restore: `git checkout -- packages/core/src/<specific-file>` to restore only the needed file
4. Do NOT use `rm -rf` or broad `git checkout`
