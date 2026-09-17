# Issue #3492 — github-broker temp-file lifecycle tests race across concurrent processes

## Summary

`packages/providers/src/auth/proxy/__tests__/github-broker-write-ops.test.ts`
contains two tests in the `body temp-file lifecycle` describe block that count
`llxprt-gh-body-*` entries in the shared `os.tmpdir()` before and after a
`withBodyFiles` call and assert the counts are equal:

- `removes the temp directory even when the operation throws`
- `is a no-op when no body parameter is present`

`os.tmpdir()` is shared by every process of the current user, so another LLxprt
checkout running the same provider tests can create or remove a
`llxprt-gh-body-*` directory between the two snapshots, flipping the count and
failing the assertion even though the code under test behaved correctly
(observed as `Expected: 1, Received: 0` and the inverse at line 263).

## Root cause

The tests assert on a global, cross-process-visible namespace (shared tmpdir
entry counts) instead of on the artifacts created by the operation under test.
No synchronization can fix that; the assertions must stop reading the shared
namespace.

## Chosen design

Give `withBodyFiles` an optional trailing `tempRoot` parameter defaulting to
`tmpdir()` (runtime behavior unchanged for all existing call sites in
`github-broker.ts`, which pass no argument). The lifecycle tests then run each
scenario against a per-test private `mkdtemp` root, so every cleanup/no-op
assertion reads only directories this test's own operation can create.

Rejected alternatives:

- **Before/after count deltas on the shared tmpdir** — still attributes
  foreign churn to the test; a concurrent process creating a dir inside the
  snapshot window still flips the delta. Not deterministic.
- **`process.env.TMPDIR` redirection** — depends on per-platform `os.tmpdir()`
  env sensitivity (Windows uses `TEMP`/`TMP`), mutates process-global state
  for the whole test file's process, and fails silently if the runner caches.
- **`Object.defineProperty(os, 'tmpdir', …)` override** — live-binding hazard:
  `github-broker-body-file.ts` binds `tmpdir` via a named ESM import, which a
  namespace-property redefinition may not affect under Bun's transpilation.
- **Spying `mkdtemp` to assert it was not called** — mock verification of
  infrastructure; forbidden by the test rules (assert real filesystem effects
  instead).

The captured-path technique is used for the throw-cleanup test: the effective
`body` param inside the callback IS the temp file path, so the test records it,
lets the operation throw, then asserts that exact directory no longer exists.
This is strictly stronger evidence than a count and is immune to any
concurrent-process churn.

## Acceptance criteria

- **AC1 — explicit temp root honored.** When a caller passes `tempRoot`, the
  body temp directory is created inside it (effective body path starts with
  `tempRoot` and still contains the `llxprt-gh-body-` prefix) and is removed
  after the operation completes.
- **AC2 — default behavior unchanged.** With no `tempRoot` argument the body
  temp directory is created directly under `os.tmpdir()` exactly as today
  (prefix `llxprt-gh-body-`, mode 0600 file, best-effort recursive removal in
  `finally`). Existing call sites in `github-broker.ts` are not modified.
- **AC3 — throw-cleanup verification is operation-local.** The throw test
  records the temp dir created by its own operation (derived from the effective
  body path) and asserts that directory no longer exists after the rejection,
  plus that no `llxprt-gh-body-*` entry remains in the private root. It never
  reads the shared `os.tmpdir()`.
- **AC4 — no-op verification is operation-local.** The no-op test asserts the
  private root contains no `llxprt-gh-body-*` entry after the call and that
  params pass through unchanged (`{ number: 1 }`). It never reads the shared
  `os.tmpdir()`.
- **AC5 — regression guard for concurrent churn.** A test simulates the
  interfering process from the issue (a foreign `llxprt-gh-body-*` directory
  in the shared `os.tmpdir()` that vanishes mid-test) and verifies the AC3/AC4
  assertions still pass deterministically.

### Boundary cases

- `tempRoot` supplied but no body param present → pure no-op; nothing created
  under the root (AC4 path).
- `tempRoot` supplied and the operation throws → root emptied, error
  propagates unchanged (AC3 path).
- Nonexistent `tempRoot` → `mkdtemp` fails loudly (ENOENT); no defensive
  guard added per the fail-fast architecture preference.
- Multiple concurrent processes churning `llxprt-gh-body-*` dirs in the
  shared tmpdir during the suite → no assertion reads that namespace (AC5).

## Test plan

All in `github-broker-write-ops.test.ts`, `body temp-file lifecycle` describe:

1. Keep `writes body text to a file and exposes its path` on the default root
   and extend it to pin the default: `dirname(seenPath)` equals `tmpdir()`
   (AC2).
2. New: body dir lands inside a caller-supplied private root and is cleaned
   up (AC1).
3. Rework `removes the temp directory even when the operation throws` to the
   captured-path + private-root assertions (AC3).
4. Rework `is a no-op when no body parameter is present` to the private-root
   assertion (AC4).
5. New regression test with a foreign dir in the shared tmpdir appearing and
   vanishing around both scenarios (AC5).

TDD order: write test 2 first (RED — parameter does not exist), implement the
`tempRoot` parameter (GREEN), then rework 3–5 against the private root.

## Verification

- `cd packages/providers && bun test src/auth/proxy/__tests__/github-broker-write-ops.test.ts`
- `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
  `npm run build`
- Smoke: `bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"`
- Test-audit scanner diff vs main for the touched test file.

OCR is skipped per standing instruction (disabled until Andrew re-enables it);
deepthinker review covers the compliance pass.

## Files

- `packages/providers/src/auth/proxy/github-broker-body-file.ts` — optional
  `tempRoot` parameter (default `tmpdir()`), JSDoc.
- `packages/providers/src/auth/proxy/__tests__/github-broker-write-ops.test.ts`
  — lifecycle describe rework per the test plan.
