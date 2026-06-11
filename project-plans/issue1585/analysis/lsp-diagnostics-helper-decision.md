# LSP Diagnostics Helper Decision: lsp-diagnostics-helper.ts Classification

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585
Generated: 2026-06-08 (P09 regenerated)

This is the required decision artifact for `lsp-diagnostics-helper.ts` classification, as mandated by review-07 must-fix #1 and the P09 plan Step 9.

## Actual Import List of lsp-diagnostics-helper.ts

```typescript
import path from 'path';
import type { Config } from '../config/config.js';
```

Evidence: `rg -n "^import .* from" packages/core/src/tools/lsp-diagnostics-helper.ts`
- Line 8: `import type { Config } from '../config/config.js';`
- Line 1: `import path from 'path';` (Node.js built-in, no dependency concern)

## Per-Import Analysis: Can Each Be Satisfied by ILspService/IToolHost?

| Import | ILspService / IToolHost Can Satisfy? | Notes |
| --- | --- | --- |
| `path` (Node.js built-in) | **Yes** | Always available |
| `type { Config } from '../config/config.js'` | **Yes** | Config is used for three purposes: (1) `config.getLspServiceClient()` → replaced by `ILspService`, (2) `config.getLspConfig()` → replaced by `ILspService`, (3) `config.getTargetDir()` → replaced by `IToolHost.getTargetDir()`. The function signature changes from `(config: Config, absolutePath: string)` to `(lspService: ILspService, host: IToolHost, absolutePath: string)`. |

## Final Decision: MOVE_AFTER_INTERFACE

`lsp-diagnostics-helper.ts` moves to `packages/tools/src/utils/lsp-diagnostics-helper.ts` **if** its `collectLspDiagnosticsBlock()` function signature is changed from `(config: Config, absolutePath: string)` to `(lspService: ILspService, host: IToolHost, absolutePath: string)`. Both `ILspService` and `IToolHost` are already-defined tools-owned interfaces.

## Justification

1. The only non-trivial import is `Config` (type-only import).
2. All three Config method usages map directly to already-planned tools-owned interfaces:
   - `config.getLspServiceClient()` → `ILspService.getLspServiceClient()`
   - `config.getLspConfig()` → `ILspService.getLspConfig()`
   - `config.getTargetDir()` → `IToolHost.getTargetDir()`
3. There are no direct LSP client class imports, no OAuth/auth dependencies, and no SecureStore/core-service coupling.
4. The function body is 40 lines of pure orchestration logic (check LSP alive, call checkFile with timeout, filter diagnostics, format output).

## Consumer Impact

| Consumer File | Current Import | New Import | Change |
| --- | --- | --- | --- |
| `ast-edit/ast-edit-invocation.ts` | `from '../lsp-diagnostics-helper.js'` | Package-local import in tools | Pass `ILspService` + `IToolHost` instead of `Config` |
| `write-file.ts` (via similar pattern) | `from '../lsp-diagnostics-helper.js'` | Package-local import in tools | Pass `ILspService` + `IToolHost` instead of `Config` |
| `delete_line_range.ts` | `from '../lsp-diagnostics-helper.js'` | Package-local import in tools | Pass `ILspService` + `IToolHost` instead of `Config` |
| `insert_at_line.ts` | `from '../lsp-diagnostics-helper.js'` | Package-local import in tools | Pass `ILspService` + `IToolHost` instead of `Config` |
| `apply-patch.ts` | `from '../lsp-diagnostics-helper.js'` | Package-local import in tools | Pass `ILspService` + `IToolHost` instead of `Config` |

## P11 Migration Group Assignment

`lsp-diagnostics-helper.ts` moves in **P11 Group 3** (Low-Coupling Filesystem Tools) alongside the ast-edit subsystem, because:
1. Its primary consumer (`ast-edit-invocation.ts`) is already in Group 3
2. CoreLspServiceAdapter and CoreToolHostAdapter are created in Group 3
3. Moving it alongside its primary consumer avoids orphaned inter-package imports

## Retained-File Allowlist

If `lsp-diagnostics-helper.ts` moves (confirmed by this decision), it is NOT added to the retained-file allowlist and is removed from `packages/core/src/tools/` in P15.