# Issue #2656 — Windows IDE connection cannot recover from stale terminal port metadata

## Scope Ledger

### In scope
- `packages/ide-integration/src/ide/process-utils.ts`: replace fixed-offset
  (`ancestors[ancestors.length - 3]`) Windows heuristic with executable/command
  matching that walks the ancestor chain and selects the real IDE ancestor.
- `packages/ide-integration/src/ide/process-utils.test.ts`: new Windows
  behavioral test mirroring the issue's process tree
  (CLI → wrapper → shell → Code utility → Code main), plus update of any
  existing Windows assertions that encode the buggy fixed-offset behavior.
- `packages/ide-integration/src/ide/constants.ts`: additive IDE executable-name
  match list (small additive constant, not a new subsystem/public abstraction).

### Explicit non-goals
- NOT modifying `getIdeProcessInfoForUnix()` (Unix strategy unchanged).
- NOT changing `connect()` fallback ordering, `establishConnection()`, the
  epoch/generation ownership machinery, or auth-token / workspace-path
  validation.
- NOT connecting to an arbitrary port file — discovery must stay scoped to the
  current IDE/workspace PID and preserve auth-token validation.
- NOT introducing a new public abstraction, subsystem, or dependency.
- NOT changing workflow / agent-memory / quality-tool / CI configuration.
- NOT moving unrelated refactors or tests into scope.
- NOT validating candidate PIDs against port files from inside process-utils
  (process-utils is a pure process-tree utility; PID→port-file resolution stays
  in `IdeClient.getConnectionConfigFromFile()`). Candidate PID validation is a
  signal *available to* the caller, not a coupling introduced here.

### Hard scope budget
- Target: ≤ 4 files, ≤ 400 net changed lines (well under 25-file / 1500-line
  soft cap and 40-file / 2500-line hard cap).
- Mandatory scope review if either soft threshold is crossed; STOP without
  approval above the hard caps.

## Root cause (confirmed)

`getIdeProcessInfoForWindows()` returns
`ancestors[ancestors.length - 3]` (great-grandchild of the root process). For
the real VS Code integrated-terminal tree:

```
bun CLI (15604) → bun scripts/start.ts (23676) → pwsh (29180)
  → Code utility / extension host (26336) → Code main (29396)
```

the fixed offset returns PID `29180` (`pwsh.exe`), not PID `29396`
(`Code.exe`). `IdeClient.getConnectionConfigFromFile()` then searches for
`llxprt-ide-server-29180-*.json`, finds nothing, and falls back to the stale
environment port `LLXPRT_CODE_IDE_SERVER_PORT=49975`, where no listener exists.

A direct `IdeClient` diagnostic connects successfully when given the live
port-file metadata, proving the companion server is healthy — the only
broken link is Windows IDE-process identification.

## Architectural decision

Replace the fixed-offset heuristic with an **executable/command match walk**:

1. Build the full ancestor chain (current behavior: walk until root/unknown).
2. Walk from the *nearest* ancestor toward the root, returning the first
   ancestor whose process name / command matches a supported IDE executable
   (e.g. `Code.exe`, `code`, `Cursor`, `VSCodium`, plus the existing Sublime /
   Antigravity class names as appropriate). Matching is case-insensitive and
   basename-based.
3. If no ancestor matches a known IDE, fall back to the existing top-level
   ancestor (preserves current best-effort behavior for unknown launchers).

This keeps `process-utils.ts` a pure process-tree utility — it does NOT read
port files or know about the companion. PID→port-file resolution stays in
`IdeClient.getConnectionConfigFromFile()`, which already keys on
`this.ideProcessInfo.pid`. Once the correct PID (`Code.exe` = 29396) is
identified, the existing port-file lookup finds the live
`llxprt-ide-server-29396-64365.json` and recovery works end-to-end without
touching the connection state machine.

## Acceptance Matrix

| AC | Behavior | Trigger / State | Expected outcome |
|----|----------|-----------------|------------------|
| 1 | Windows picks real IDE ancestor (deep tree) | Tree: CLI(1000)→wrapper(900)→pwsh(800)→Code util(700)→Code main(600)→wininit(500)→root(0); names match `Code.exe` at 600 | returns `{pid:600, command:<Code.exe cmd>}` |
| 2 | Recovery from stale env port | AC1 PID + live port file `llxprt-ide-server-600-*.json` present; env `LLXPRT_CODE_IDE_SERVER_PORT` points at a dead port | `getConnectionConfigFromFile()` finds the 600-keyed file (port + authToken + workspacePath) — env fallback not reached |
| 3 | Nearest IDE ancestor wins when multiple match | Two `Code.exe` ancestors (extension host + main) | returns the one closer to the CLI (first match walking up) — deterministic |
| 4 | Falls back to top-level ancestor when no IDE match | Tree with no `code`/`cursor`/etc. names | returns top-level ancestor (current best-effort behavior preserved) |
| 5 | Case-insensitive executable matching | `code.exe` lowercase vs `Code.exe` | matches |
| 6 | Unix path unchanged | linux/mac trees | existing Unix tests pass unmodified |
| 7 | Backward-compat single-process / short chains | Tree length 1-2 | returns self/top ancestor (no regression) |

## Bounded vertical slices (TDD)
1. **Slice 1 — RED**: Write the failing Windows behavioral test from the issue
   (AC1): deep VS Code tree with wrapper+shell between CLI and `Code.exe`,
   asserting the returned PID is the `Code.exe` PID, not the shell's. Also
   update the existing Windows "great-grandchild" assertion that currently
   encodes the bug (it asserts `pid:900` for `powershell.exe` — that is the
   bug enshrined as a test; per RULES.md it must be corrected to assert the
   IDE process).
2. **Slice 2 — GREEN**: Implement executable/command match walk in
   `process-utils.ts` + the IDE executable-name constant list in
   `constants.ts`. Minimal code to make AC1-AC7 pass.
3. **Slice 3 — REFACTOR** (only if valuable): dedupe match logic, ensure
   immutability, no public API surface added beyond the existing
   `getIdeProcessInfo()` signature.

## Expected paths (verification)
- `cd packages/ide-integration && bun run test`
- `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
  `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

## Review-finding classification policy
Every OCR / CodeRabbit / deepthinker finding is classified as:
**Blocker-Fix** | **In-scope-Fix** | **Reject** | **Defer**.
Reviewer suggestions do NOT authorize scope expansion. Any finding that would
require a new public abstraction, subsystem, workflow change, dependency
change, or unrelated refactor is **Reject** or **Defer** and requires user
approval before action.
