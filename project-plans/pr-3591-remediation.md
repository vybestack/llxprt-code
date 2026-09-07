# PR #3591 CI remediation

## Scope

Remediate CI failures for the `main...dev/0.12.0` synchronization PR without changing production behavior or rewriting history.

Validated starting refs:

- `origin/main`: `70830ae925b5f1349d9014514b0e46d4043bed52`
- `origin/dev/0.12.0`: `6401ee671035536b0326c8cc50b911f5ed07d0df`
- local `HEAD`: `6401ee671035536b0326c8cc50b911f5ed07d0df`

The tracked tree was clean and PR #3591 was open with base `main` and head `dev/0.12.0`.

## Observed failures and root causes

### Copyright lint

The JavaScript lint job compared files added since the PR base with the current year, 2026. Seven added files retained 2025 headers. The same guard failed locally against the exact PR base and current head.

The file history confirms that every corrected header belongs to a file created in 2026:

| File | Introduction |
| --- | --- |
| `packages/auth/src/proxy/__tests__/proxy-socket-client.lifecycle.test.ts` | `11dddd87e8`, 2026-08-30 |
| `packages/cli/src/ui/components/InputPrompt.escapeClear.test.tsx` | `1ed4cb000d`, 2026-06-24 |
| `packages/cli/src/ui/hooks/useAtCompletion.errorRecovery.test.ts` | `11dddd87e8`, 2026-08-30 |
| `packages/cli/src/utils/sandbox-proxy-integration.test.ts` | `584f007f0b`, 2026-02-18 |
| `packages/core/src/recording/RecordingIntegration.lifecycle.test.ts` | merge `4c7c72a3a3`, 2026-08-30 |
| `packages/core/src/recording/SessionRecordingService.payloads.test.ts` | `bf52702e34`, 2026-02-13 |
| `packages/core/src/recording/replayCheckpointMetadata.ts` | merge `4c7c72a3a3`, 2026-08-30 |
| `packages/providers/src/anthropic/AnthropicProvider.chat.tools.test.ts` | merge `4c7c72a3a3`, 2026-08-30 |

The merge introduced the three listed files relative to both parents. The sandbox integration test was not one of the seven files reported against the PR base, but its header was corrected because the focused remediation changed that file and its own addition commit is from 2026.

Change: update only those eight verified headers to 2026.

### CLI sandbox proxy integration

`packages/cli/src/utils/sandbox-proxy-integration.test.ts` failed 12 of 26 tests. The suite parsed source text from four legacy sandbox modules and required exact imports, function placement, implementation spelling, and plan-marker locations. Credential proxy orchestration moved into `sandbox-credential-proxy.ts` during the modular sandbox refactor, so the source parser no longer inspected the implementation it asserted against.

The required runtime behavior already has focused coverage in `sandbox-entrypoint.test.ts`, `sandbox-containers-capability-envfile.bun.test.ts`, `sandbox-credential.test.ts`, `sandbox-launch-release.test.ts`, `sandbox-seatbelt.test.ts`, and `sandbox-containers.test.ts`. The one runtime test in the obsolete integration suite covers Darwin Podman credential runtime isolation and remains useful.

Change: remove the source-text assertions and retain the runtime integration case. No sandbox production code changed.

### Core session scanner bounds

The aggregate-byte-cap test used candidate session IDs with unequal serialized lengths (`first` and `second`) and set the cap to the smaller payload. Directory iteration order is unspecified. If the larger file appears first, no candidate fits and the observed result is zero candidates plus one skip. If the smaller file appears first, one candidate fits. Local isolated execution passed while Linux CI produced the other valid ordering.

Change: rename the second fixture ID to the equal-length `other`, so either directory order yields one candidate and one skip. Scanner production semantics are unchanged.

### OpenCodeReview scope

OCR 1.8.4 preview classified `packages/providers/src/utils/boundedJsonBody.test.ts` as binary and excluded it, while the workflow correctly recognized the `.test.ts` path as a changed test and rejected the missing review coverage. The artifact selected 2,071 other files and 1,472 tests, then stopped in the `changed-test-missing` phase before any LLM work. The preview listed this test as `[B] ... (binary)` and selected the adjacent `boundedJsonBody.ts` normally.

The base blob is valid UTF-8 but contains literal byte `0x00` at offset 1,047 and control byte `0x1f` at offset 1,049. Git's binary-content heuristic treats any blob containing NUL as binary. Replacing the controls in the working file does not by itself produce a text diff because the comparison still reads the NUL-bearing base blob. The repository's `* text=auto` attribute permits Git to apply that heuristic.

Change: represent both controls with the TypeScript escape sequences `\u0000` and `\u001f`, and declare `*.ts` and `*.tsx` as `text diff eol=lf` in the repository `.gitattributes`. The source now decodes under a fatal UTF-8 decoder and contains no NUL. TypeScript evaluates the escape sequences to the same runtime string values, so fixture semantics remain identical. The explicit text and diff attributes are the repository-level correction because TypeScript source must be reviewable even when an old side of a comparison contains a control byte. The resulting OCR 1.11.6 preview selects the test as a one-line text change without weakening the changed-test coverage guard.

### Other checks and review threads

The aggregate Test job failed downstream of the CLI and core shards. No actionable review threads were present at intake. Other failing checks listed at intake were the top-level lint aggregate and the four root failures above.

## Planned changed files

- `.gitattributes`: require text diffs for TypeScript source.
- Seven copyright-header files reported by CI.
- `packages/cli/src/utils/sandbox-proxy-integration.test.ts`: retain behavioral coverage and remove brittle source inspection.
- `packages/core/src/recording/janitor/sessionScanner.bounds.test.ts`: equal-size fixtures.
- `packages/providers/src/utils/boundedJsonBody.test.ts`: escaped NUL source representation.
- This remediation record.

No `.llxprt/` or global settings files will be changed.

## Verification record

Initial reproductions are stored under `tmp/pr3591-remediation/` with explicit exit markers:

- `repro-copyright.log`: failed with the seven expected stale headers.
- `repro-sandbox-proxy.log`: failed with 12 source-inspection assertions.
- `repro-session-scanner.log`: passed locally, supporting the order-sensitive fixture diagnosis.
- `ci/*.log`: exact failed GitHub Actions logs.
- `ocr-artifact/ocr-preview.txt`: exact OCR preview showing the bounded JSON test as binary.

The original combined focused sandbox command ran several files in one Bun process and failed 9 of 152 tests. `sandbox-containers.test.ts` and `sandbox-launch-release.test.ts` both install module-level factories for `node:child_process`; the second file inherited the first file's `proxy-argv-captured` implementation. This is test-runner cross-file mock state, not a sandbox behavior failure. `scripts/test.ts` specifies one isolated process per test file, and the CLI shard uses that model. Running the seven related sandbox files in separate processes passed all 153 tests. Evidence is in `focused-sandbox-behavior-isolated.log` with per-file and aggregate exit markers.

`verify-cli-shard-2.log` was complete: it recorded 248 of 248 files and 3,044 of 3,044 test cases passing with `EXIT=0`.

`verify-core-shard.log` recorded 431 of 431 test files passing. A later rerun recorded 430 of 431 after `local-media-store-locking.test.ts` exceeded its two-second live-lock contention deadline while another media test ran concurrently. No local-media store source or test changed in this remediation, and the same file passed in the earlier complete shard. This later result is local scheduling and lock contention rather than an edit-caused failure.

`SessionRecordingService.payloads.test.ts` changed only in its copyright header. All 15 tests passed in the original CI run and in the earlier complete local core shard. In the later changed-file batch and isolated retry, property-test runtimes increased from roughly 0.18 to 0.61 seconds each in the green shard to 5 to 8 seconds, crossing their unchanged five-second timeouts. The uniform slowdown, unchanged test bodies, and earlier passes on the same implementation establish a loaded-host timeout rather than a remediation regression.

The requested final checks passed after inspection:

- `git diff --check HEAD`: exit 0.
- Prettier check for all touched TypeScript and Markdown files: passed.
- Fatal UTF-8 decode plus NUL scan for `boundedJsonBody.test.ts`: valid UTF-8, no NUL bytes.
- Exact `sandbox-proxy-integration.test.ts`: 1 passed, 0 failed.
- Exact `sessionScanner.bounds.test.ts`: 3 passed, 0 failed.
- Exact `boundedJsonBody.test.ts`: 14 passed, 0 failed.
- JavaScript copyright-year lint against `70830ae925`: passed for all 389 added files, including 274 headers.

## Remaining risks

The PR contains a large synchronization diff, so OCR and CI reruns may expose failures not present in the initial run. Any such failures will be evaluated against the current source and addressed if valid and in scope.

## Commit

- `ccfb041bde` `test(ci): stabilize release synchronization checks`
- `a733e1b3b2` `chore(ci): restore review and copyright checks`

This verification record follows those code commits as a separate documentation commit.
