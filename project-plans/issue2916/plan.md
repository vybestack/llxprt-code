# Issue 2916 — Fail loudly for unresolved profile auth-key-name

## Purpose

A standard profile that explicitly names a credential must not silently continue when that name cannot be resolved. Profile application must fail before provider invocation, and non-interactive CLI callers must surface the failure with a non-zero exit status.

## Accepted behavior

### AC1 — Missing named key fails profile application

Given a standard profile with a non-empty `auth-key-name`, when provider key storage returns no secret for that name, profile application rejects. The error identifies the key name and tells the user how to save it.

### AC2 — Storage errors fail profile application

Given a standard profile with a non-empty `auth-key-name`, when provider key storage throws, profile application rejects with the key name and underlying cause. The error is not converted to a warning.

### AC3 — Explicit named-key precedence remains fail-fast

An unresolved `auth-key-name` does not fall through to `auth-keyfile`, inline `auth-key`, environment credentials, or previously active credentials.

### AC4 — Resolved named keys remain supported

When provider key storage returns a non-empty secret, profile application applies that secret and preserves the name reference without persisting the raw secret as the profile's named-key value.

### AC5 — Non-interactive CLI failure is observable

Running the CLI with `--profile-load` and a prompt against a profile whose `auth-key-name` is unresolved prints an actionable error, does not produce model output, and exits non-zero.

## Inputs and boundary cases

| Input | Expected behavior |
| --- | --- |
| Absent, non-string, blank, or whitespace-only `auth-key-name` | Existing behavior remains unchanged; it is not treated as an explicit named credential. |
| Non-empty name resolving to a non-empty secret | Existing successful named-key behavior remains unchanged. |
| Non-empty name resolving to `null`, `undefined`, empty, or whitespace-only secret | Fail as unresolved. |
| Provider key storage throws | Fail with named-key context and the underlying cause. |
| Missing named key alongside lower-precedence auth sources | Fail without fallback. |
| Load-balancer sub-profile named-key resolution | Existing load-balancer fallback behavior remains unchanged. |
| `auth-keyfile` loading | Existing behavior remains unchanged. |

## Behavioral evidence

All new or changed tests use Bun and `bun:test`.

1. Provider/profile behavioral test: missing key rejects with the actionable named-key error.
2. Provider/profile behavioral test: key-storage failure rejects with key-name and cause.
3. Provider/profile behavioral test: lower-precedence credential is not applied after named-key failure.
4. Provider/profile behavioral test: resolved named key still applies and preserves the name reference.
5. CLI subprocess/integration test: unresolved named key produces visible error output and a non-zero exit status before any provider response.

Tests must exercise real profile-application and CLI behavior. Filesystem/process isolation is permitted; tests must not verify mock call choreography as the acceptance proof.

## TDD sequence

1. Add the smallest Bun behavioral test for AC1 and run it to record RED.
2. Add AC2 and AC3 behavioral cases, keeping production unchanged, and record RED.
3. Make the minimal profile-application change that turns unresolved named-key results and key-storage errors into actionable failures.
4. Run the provider/profile Bun tests to GREEN.
5. Add the CLI subprocess behavioral test for AC5 and record whether existing top-level error handling already satisfies it.
6. Change CLI error handling only if the AC5 test proves it is necessary; otherwise make no CLI production change.
7. Add/retain positive evidence for AC4 and run all targeted tests.
8. Run full project verification and smoke testing.

## Scope boundaries

- Do not alter macOS profile discovery or `Profile 'name' not found` wording. That adjacent suggestion is deferred.
- Do not alter load-balancer sub-profile fallback semantics.
- Do not alter keyfile behavior.
- Do not add dependencies, public abstractions, workflows, quality-tool changes, lint exceptions, TypeScript suppressions, or unrelated refactors.
- Do not loosen lint, complexity, source-size, safety, coverage, cross-platform, or CI requirements.

## Review triage

Every review finding is classified as one of:

- **Blocker-Fix** — prevents an accepted behavior or required gate.
- **In-scope-Fix** — improves correctness, evidence, or maintainability within the accepted behavior.
- **Reject** — factually incorrect or conflicts with the accepted behavior.
- **Defer** — valid but outside the scope boundaries above.

## Final review triage (remediation)

1. **Blocker-Fix — Fixed.** `packages/cli/test-bun/profileAuthKeyNameIssue2916.bun.ts` now builds a deliberately allowlisted child environment (copies only `PATH/USER/SHELL/LANG/LC_ALL/TMPDIR/TERM` individually, never spreading `process.env`). It sets `LLXPRT_TEST_DISABLE_OS_KEYRING=1`, isolated `LLXPRT_CONFIG/DATA/CACHE/LOG_HOME`, a temp `HOME`, a temp workspace cwd, and points `LLXPRT_SYSTEM_SETTINGS_PATH`/`LLXPRT_SYSTEM_DEFAULTS_PATH` at controlled nonexistent temp paths. It does not pass `LLXPRT_CREDENTIAL_SOCKET`, `LLXPRT_CAPABILITY_FD`, provider credentials, proxy variables, dotenv/config paths, or unrelated `LLXPRT_*` vars.
2. **Blocker-Fix — Fixed.** The prompt-as-output sentinel is replaced by a unique local request-counting HTTP trap (`Bun.serve` on `127.0.0.1`, port 0) configured as the profile `base-url`. The trap returns a valid-enough completion whose content is distinct from the prompt; the test asserts the request count is exactly zero. A deterministic `OPENAI_API_KEY` lower-precedence credential is present in the isolated child env and proven unused through the zero request count. Nonzero exit, key-name, `/key save` remediation, and no-secret-leak assertions are retained.
3. **In-scope-Fix — Fixed.** The subprocess helper drains stdout/stderr immediately, races `proc.exited` against a resolve-only timeout, and in `finally` clears the timer and terminates only the tracked child PID (guarded), then awaits `proc.exited` and both stream drains before returning. No broad process-group kill; no orphan/race/unhandled-rejection path.
4. **In-scope-Fix — Fixed (RED → GREEN).** A behavioral test was written first that seeds prior auth and non-auth ephemerals plus a configured provider credential and proves a failed named-key apply preserves all prior application state while never installing the unresolved name. This initially failed (RED) because `clearProfileEphemerals` destroyed prior ephemerals before `resolveNamedAuthKey` could throw. GREEN: `resolveNamedAuthKey` is now a pure preflight (no mutation; returns the resolved name), called before `clearProfileEphemerals` in `applyProfileWithGuards`; the resolved result is reused by `wireAuthBeforeSwitch`, so there is no duplicate storage lookup and mutation only begins after successful resolution. The advisory value-warnings computation moved into `buildProfileApplicationContext` (where warnings are assembled) to keep `applyProfileWithGuards` within the function size limit without a new public abstraction.
5. **In-scope-Fix — Fixed.** Stored named-key results (null, undefined, empty, whitespace) and name inputs (absent, null, non-string, empty, whitespace) are now table-driven. The storage double's `getKey`/`resolvedValue` types were widened to `string | null | undefined` so all edge cases are expressed without assertions; each row directly proves expected behavior. Deterministic environment no-fallback is proven through the isolated CLI trap (zero requests).
6. **In-scope-Fix — Fixed.** The unrelated-secret map entry that could not influence the error path and its `.not.toContain` assertions were removed. Type/non-null assertions in the new provider test were replaced with an `instanceof`-based `asError` narrowing helper and safe `Map` access.
7. **Defer — Deferred.** No quality tooling was changed for legacy Vitest compatibility. The workflow test remains `bun:test` and passes through the authoritative Bun manifest via the shared vitest-compatible setup.
8. **Reject — Rejected.** No mock-call assertions were added; all evidence is observable state, output, and request count.
9. **Plan update — This section.**

## Verification evidence

All new/changed tests use `bun:test`. Commands run from repo root unless noted.

RED → GREEN for the production behavior change (finding 4):
- RED (before the preflight): the "preserves prior application state" test failed with `context-limit` observed `undefined` (expected `50000`) because `clearProfileEphemerals` ran before `resolveNamedAuthKey` could throw.
- GREEN (after preflight): same test passes; prior auth and non-auth ephemerals survive a failed apply.

Targeted test results:
- `cd packages/providers && bun test src/runtime/__tests__/profileApplication.issue2916.bun.test.ts` → 17 pass, 0 fail, 56 expect() calls.
- `cd packages/providers && bun test src/runtime/__tests__/profileApplication.workflow.test.ts` → 16 pass, 0 fail.
- `cd packages/providers && bun test src/runtime/__tests__/profileApplication` → 134 pass, 0 fail across 10 files (includes boundaries, load-balancer auth/detection, failover, unavailable-provider).
- `cd packages/cli && bun test ./test-bun/profileAuthKeyNameIssue2916.bun.ts` → 1 pass, 0 fail, 10 expect() calls (trap request count asserted zero).

Static checks (all exit 0):
- `cd packages/providers && bunx tsc --noEmit -p tsconfig.json`
- `cd packages/cli && bunx tsc --noEmit`
- `bunx tsc --project tsconfig.scripts.json`
- `bunx eslint` and `bunx prettier --check` on all changed files.
- `git diff --check` clean.
- Bun manifest discovery resolves all three issue-2916 test files (`packages/cli/test-bun/profileAuthKeyNameIssue2916.bun.ts`, `packages/providers/src/runtime/__tests__/profileApplication.issue2916.bun.test.ts`, `packages/providers/src/runtime/__tests__/profileApplication.workflow.test.ts`).
