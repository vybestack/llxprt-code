# Preflight Verification — issue #3113

Plan ID: PLAN-20260807-ISSUE3113
Performed: 2026-08-07
Branch: `issue3113` (verified with `git branch --show-current`)
Base commit: `2ae245b8d`

Every assumption in `specification.md` and `pseudocode.md` is verified here
against the actual repository. No implementation was performed.

---

## 1. Defect reproduction (live)

```bash
T=$(node -p 'require("os").tmpdir()')
find "$T" -maxdepth 1 -name 'llxprt-client-error-*.json' -type f -exec stat -f '%z %m %N' {} + \
  | awk '{s+=$1; n++; if($1>m)m=$1} END {printf "count=%d total_bytes=%d largest=%d\n", n, s, m}'
```

Observed:

```
count=4380 total_bytes=57597083 largest=11421098      (54.9 MB; largest report 10.9 MB)
by type:  4076 Turn.run-sendMessageStream
           301 generateJson-api
             3 startChat
```

Matches and exceeds the issue's reported 3,565 files / 62 MB. Defect confirmed
present on the base commit. Status: **CONFIRMED**.

---

## 2. Production call sites

| Assumption | Evidence | Status |
|---|---|---|
| `reportError` is exported only from `packages/core/src/utils/errorReporting.ts` | `errorReporting.ts:83` `export async function reportError(` | OK |
| Signature is `(error, baseMessage, context?, type='general', reportingDir=os.tmpdir())` | `errorReporting.ts:83-89`; mirrored in `packages/core/dist/src/utils/errorReporting.d.ts:13` | OK |
| It is the only export of the module | `grep -n "^export" packages/core/src/utils/errorReporting.ts` -> one hit | OK |
| Subpath export exists for cross-package import | `packages/core/package.json:490-493` `"./utils/errorReporting.js"` with `bun` -> `./src/utils/errorReporting.ts` | OK |
| Pretty-printing at both sites | `errorReporting.ts:60` and `:100` both pass `null, 2` | OK |
| Filename construction | `errorReporting.ts:84-86` | OK |
| No rotation/cleanup anywhere | `grep -rn "llxprt-client-error" packages --include=*.ts` -> only the writer and its test | OK |

### Core-`reportError` callers (complete)

| Caller | Line | `type` | Context shape today |
|---|---|---|---|
| `packages/agents/src/core/turn.ts` | 589 | `Turn.run-sendMessageStream` | `[...getHistory(true), req]` — array, unbounded |
| `packages/agents/src/agents/executor.ts` | 753 | `startChat` | `startHistory` — array |
| `packages/agents/src/core/ChatSessionFactory.ts` | 428 | `startChat` | `deps.extraHistory ?? []` — array |
| `packages/agents/src/core/subagentRuntimeSetup.ts` | 865 | `startChat` | `startHistory` — array (fire-and-forget `void`) |
| `packages/agents/src/core/clientLlmUtilities.ts` | 119 | `generateJson-api` | `contents` — array |
| `packages/agents/src/core/clientLlmUtilities.ts` | 178 | `generateContent-api` | `{ requestContents, requestConfig }` — object |

Only `turn.ts` conflates request and history, so only `turn.ts` changes
(REQ-3113-1.1). Status: **OK**.

### Out-of-scope same-name helpers (confirmed unrelated)

| Location | Nature | Evidence |
|---|---|---|
| `packages/mcp/src/client/mcp-client-manager-helpers.ts:85,150,263` | Injected callback parameter `(error: unknown) => void` / `(message, error) => void` | Supplied at `mcp-client-manager.ts:339,782,944`; no import of the core module |
| `packages/cli/src/ui/hooks/usePermissionsTrustDialogFlow.ts:43` | Local `function reportError(addItem, message)` | Local declaration |
| `packages/cli/src/config/extensions/extensionLoader.ts:44` | `deps.reportError: (message: string) => void` | Interface member |
| `packages/cli/src/session/nonInteractiveSession.ts:32` | `catch (reportError)` — a catch binding | Not a function |

Status: **OK — out of scope, no shared code.**

---

## 3. Type verification

| Type | Expected | Actual | Match |
|---|---|---|---|
| `ErrorReportData` | `{ error, context?, additionalInfo? }` | `errorReporting.ts:34-38` — exactly that, module-private | YES |
| `normaliseError` return | `{ message: string; stack?: string }` | `errorReporting.ts:40-43` | YES |
| `TurnRequest` | `string \| object \| readonly unknown[]` | `turn.ts:72` | YES |
| `ChatSession.getHistory` | `(curated?: boolean) => IContent[]` | `chatSession.ts:565-567` | YES |
| `context` parameter accepts an object literal | `unknown[] \| Record<string, unknown>` — a fresh object literal `{ request, recentHistory, omittedHistoryCount }` is assignable to `Record<string, unknown>` | `errorReporting.ts:86` | YES |
| `Buffer.byteLength` available | `node:buffer` is a builtin in both Node and Bun; the file already imports `node:fs/promises`, `node:os`, `node:path` | — | YES |
| `createHash` available and already used in `packages/core` | `node:crypto` is a builtin in both Node and Bun; `packages/core/src/services/loopDetectionService.ts:7`, `utils/llm-edit-fixer.ts:7`, and `prompt-config/installer/manifest-operations.ts:11` already `import { createHash } from 'node:crypto'` | — | YES |

### Fingerprint digest probe (executed on Bun 1.3.14)

The framed, incremental SHA-256 fingerprint of `pseudocode.md` lines 070-079 was
executed directly, alongside the rejected 512-character truncated concatenation,
on a pair of messages sharing a 1,024-character prefix:

```json
{
  "runtime": "bun 1.3.14",
  "lenA": 64,
  "distinct": true,
  "stable": true,
  "truncatedWouldCollide": true,
  "framingInjective": true,
  "nulSafe": true
}
```

| Observation | Meaning | Status |
|---|---|---|
| `lenA = 64` | The key is fixed-size hex regardless of input length; the registry bound in `specification.md` section 8 is exact | OK |
| `distinct = true` | Messages differing only after character 512 produce different fingerprints, so the second failure is reported, not suppressed | OK |
| `truncatedWouldCollide = true` | The rejected 512-character slice **does** collide on the same pair, silently suppressing a distinct real failure. This is the measured justification for replacing it | OK — rejected design falsified |
| `stable = true` | Equal inputs produce an equal digest, so genuine duplicates still coalesce | OK |
| `framingInjective = true` | `('ab','c','x')` and `('a','bc','x')` differ: the length-prefixed framing is not re-splittable | OK |
| `nulSafe = true` | A component containing U+0000 does not alias a different component split | OK |

Status: **OK**.

---

## 4. Test infrastructure

| Assumption | Evidence | Status |
|---|---|---|
| `packages/core` runs its suite under Bun | `packages/core/package.json` `"test": "bun run-bun-tests.ts"` | OK |
| Core runs **one process per test file** | `packages/core/run-bun-tests.ts` header + `['test', '--preload', PRELOAD, file]` at line 99 | OK — module-level dedupe state cannot leak across files |
| Core discovers `*.bun.test.ts` | `run-bun-tests.ts:58-62` matches any `.test.ts` suffix; `packages/core/src/services/shellPtySignal.bun.test.ts` already exists and runs | OK |
| Core preloads the `vi` augmentation | `packages/core/bunfig.toml` -> `preload = ["../../test-setup/augment-bun-vi.ts", "./bun-preload.ts"]` | OK |
| 21 core test files already import `bun:test` directly | `grep -rln "from 'bun:test'" packages/core/src \| wc -l` -> 21 | OK — established convention |
| `packages/agents` runs under Bun, one process per file | `packages/agents/package.json` `"test": "bun run-bun-tests.ts && bun ../../scripts/run_bun_tests.ts --workspace agents"`; `packages/agents/run-bun-tests.ts:52` `TEST_ROOTS = ['src']` | OK |
| Agents already has a direct-`bun:test` file under `src/core` | `packages/agents/src/core/streamOutputAccumulator.bun.test.ts:25` `import { describe, it, expect } from 'bun:test';` | OK — precedent for the new file's name and imports |
| `setSystemTime` is importable from `bun:test` and moves `Date.now()` | Probe executed on Bun 1.3.14: set, re-set +61 s, and restore all observed; `1 pass 0 fail` | OK |
| **A frozen clock makes two identical writes collapse onto one path on the base commit** | Probe against the unmodified `reportError`: clock pinned at `2026-08-07T00:00:00.000Z`, two identical calls with one `type` into one `mkdtemp` dir -> `SAME_MS_FILE_COUNT=1`, single file `llxprt-client-error-probe-type-2026-08-07T00-00-00-000Z.json`, and stderr showed the **same** path twice | **OK — hazard confirmed.** A "exactly one report file exists" duplicate assertion would pass against unchanged code. Every dedupe test must advance the clock (`test-matrix.md`, "Clock discipline"). |
| `setSystemTime` also moves the report **filename**, not just `Date.now()` | Same probe, second case: advancing `+1_000` ms between the two identical calls produced `ADVANCED_FILE_COUNT=2` with `...T00-00-00-000Z.json` and `...T00-00-01-000Z.json` | OK — clock advancement yields genuinely distinct paths, so the duplicate rows are RED for the right reason |
| Rotation would pin a file count regardless of deduplication | `MAX_REPORT_FILES = 20`; once a directory is at the cap, "the matching file count is unchanged" holds whether or not a duplicate was suppressed | **OK — hazard confirmed.** The registry-bound row (D9) asserts observable suppression (stderr line with the original path, unchanged original bytes, unchanged listing **set**) rather than a count. |
| `os.tmpdir()` honors `TMPDIR` **at call time** under Bun on darwin | Probe: `before=/var/folders/.../T`, after setting `TMPDIR`, `after=/tmp/llxprt-probe-dir`, `honored=true` | OK — enables the end-to-end Turn->disk test with no mocking of `reportError` |
| `turn.test.ts` runs under Bun | `packages/agents/src/core/turn.test.ts:7` imports from `'../testApi.js'`, which re-exports `bun:test` (`packages/agents/src/testApi.ts:46-58`) | OK — it does **not** import Vitest |
| `turn.test.ts` has no `.rejects`/`.resolves` coupling | `grep -c "\.rejects\|\.resolves"` -> 0; `vi.mock` count -> 1 | OK |

Status: **OK**.

---

## 5. Quality-gate headroom

| Gate | Threshold | Current state | Status |
|---|---|---|---|
| ESLint on the two target files | — | `npx eslint packages/core/src/utils/errorReporting.ts packages/agents/src/core/turn.ts` -> exit 0, no output | OK (clean baseline) |
| `max-lines` | 800 (blank/comment-skipped) | `errorReporting.ts` 156 raw lines; `turn.ts` 912 raw lines and currently passing | OK — `turn.ts` gains only a few lines; `errorReporting.ts` has large headroom |
| `max-lines-per-function` | 80 (blank/comment-skipped) | New helpers are each far under 80; `reportError` is decomposed rather than grown | OK — enforced by design, verified at implementation |
| `complexity` | 25 | Each new helper is single-purpose | OK |
| `sonarjs/cognitive-complexity` | 30 | Same | OK |
| `sonarjs/no-ignored-exceptions` | error | Existing file already uses `} catch {` with no binding (`errorReporting.ts:16`); rotation reuses that exact form | OK |
| Doc placement | `project-plans/` only | `scripts/check-doc-placement.ts` bans `dev-docs/plans/`; all artifacts written to `project-plans/issue3113/` | OK |
| `no-restricted-imports` on `node:crypto` | — | The only Node-builtin import restriction in `eslint.config.js` targets `packages/cli/src/ui/components/shared/*` domain modules and bans `node:fs`/`node:child_process`/`node:os`. `packages/core/src/utils/errorReporting.ts` is outside that glob and already imports `node:fs/promises` and `node:os` with a clean ESLint baseline. | OK |

Status: **OK**.

---

## 6. Existing-test compatibility gate

`packages/core/src/utils/errorReporting.test.ts` imports Vitest and **must not
be modified**. All six of its cases were audited line by line against the new
design in `specification.md` section 10. Two facts make the audit hold:

1. Each case creates its own `fs.mkdtemp` directory, so rotation never sees more
   than one report and deletes nothing.
2. All six error messages are distinct (`Test error`, `Test plain object error`,
   `Just a string error`, `Main error` x2 with distinct `type`, `Error without
   context`), so the fingerprint registry never suppresses a case.

The one genuinely fragile case is the BigInt case, which mocks `JSON.stringify`
and throws on **call #1**. The design guarantees the first `JSON.stringify` call
inside `reportError` remains the main-payload serialization: fingerprinting is
string concatenation and rotation performs no serialization.

Status: **OK — no modification required, no case at risk.**

---

## 7. Blocking issues found

**None.** Every dependency is a Node builtin (`node:buffer` and `node:crypto`
are the two additions, both already used elsewhere in `packages/core`), every
type matches the plan, every call path exists, both test runners provide
per-file process isolation, and all required Bun capabilities (`setSystemTime`
over both `Date.now()` and the report filename, call-time `TMPDIR` resolution,
`createHash`) were executed and observed.

Two **false-pass hazards** were found and are recorded rather than deferred,
because each would have produced test evidence that proved nothing:

1. Same-millisecond writes collapse onto one report path, so a duplicate
   assertion could pass against unchanged code. Neutralized by the mandatory
   clock discipline in `test-matrix.md`.
2. Rotation holds the matching-file count at `MAX_REPORT_FILES`, so a
   count-based registry assertion could pass without any suppression.
   Neutralized by asserting observable suppression in D9.

Neither is a code defect in the plan's scope; the underlying millisecond
filename collision remains **Defer** (the filename format is frozen by
REQ-3113-5).

## 8. Verification gate

- [x] All dependencies verified (no new dependency required; `node:buffer` and
      `node:crypto` are Node builtins with existing `packages/core` precedent)
- [x] All types match plan assumptions
- [x] All call paths verified against actual source lines
- [x] Test infrastructure verified, including per-file process isolation
- [x] Defect reproduced on the base commit with measurements
- [x] Unmodifiable existing test audited case by case
- [x] Quality-gate headroom confirmed with a clean ESLint baseline
- [x] Fingerprint design measured: fixed-size digest distinguishes the pair that
      the rejected truncated key collides on
- [x] Both false-pass hazards measured against the base commit and neutralized
      in the test matrix
