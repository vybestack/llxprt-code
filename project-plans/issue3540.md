# Issue 3540 Plan

## Accepted behavior

1. A non-interactive native `self_emitvalue` call whose `emit_variable_name` or `emit_variable_value` argument is missing, null, or otherwise not a string is rejected: no value is written to `emitted_vars`, and the call returns a failed tool response carrying a correction message.
2. A supported textual (Hermes) `self_emitvalue` call with the same malformed arguments is rejected identically, because textual calls resolve to the same scope-local handler.
3. Well-formed string arguments continue to emit successfully and terminate `GOAL` as before (regression coverage).
4. Execution does not report `GOAL` from a rejected emit; the failure reaches the model as a non-fatal tool error and the run continues or terminates through the existing paths only.

## Scope boundaries

- No change to the interactive emitter (`handleEmitValueCall`), which already rejects malformed arguments.
- No change to unknown-output or duplicate-output validation.
- No new public abstraction, subsystem, dependency, or workflow change.
- One pre-existing test-suite hermeticity defect was corrected because the acceptance gate requires zero failures: `skillReloadDeclaration.behavior.test.ts` read the home-anchored `~/.agents/skills` discovery root, which `isolateStorageRoots()` cannot redirect. The test now points that root at an empty directory for the duration of each case and restores it afterwards. Assertions are unchanged.

## Test-first sequence and behavioral mapping

| Evidence | Failing behavioral test | Implementation response |
| --- | --- | --- |
| A | `processFunctionCalls` passes a native emitter call with a null `emit_variable_value`; assert `emitted_vars` stays `{}` and the tool response names the required arguments. | Validate both arguments are strings before mutating `emitted_vars`; return `INVALID_TOOL_PARAMS` failure with `toolFailureMarker` (issue #3063 convention). |
| B | Same harness with a missing (`undefined`) `emit_variable_name`; assert no write and an error response. | Same guard covers missing and nullish arguments. |
| C | Same harness with a null `emit_variable_name`; assert no write and an error response. | Same guard. |
| D | Real non-interactive runtime receives a native emitter call with a null value; assert `emitted_vars` is empty and termination is not `GOAL`. | Boundary guard blocks emission; the loop never sees the declared output as emitted. |
| E | Regression: well-formed native call stores the value (existing tests continue to pass). | No change to the success path. |
| F | `skillReloadDeclaration.behavior.test.ts` passes on a machine with a populated `~/.agents/skills`. | Test-local `Storage.getUserAgentSkillsDir` spy installed before `buildAgent`, restored in `finally`. |

## Review-finding triage (local OCR round 1 — 9 findings)

| Review finding | Classification | Resolution |
| --- | --- | --- |
| 1. `Storage.getUserAgentSkillsDir` spy not restored when `buildAgent` rejects. | **In-scope-Fix** | Spy lifetime moved inside the outer `try`/`finally`; restoration also covers the harness failure path. |
| 2. Unguarded `requestInfo.args` access throws a raw TypeError for a call whose `parameters` is absent, bypassing the structured rejection. | **Blocker-Fix** | Args now read through the existing `asUnknownRecord` boundary helper; a missing arguments object produces the same `INVALID_TOOL_PARAMS` tool response. Behavioral test added. |
| 3. Hardcoded `'self_emitvalue'` in the new message instead of the governance constant. | **In-scope-Fix** | Message interpolates `SCOPE_LOCAL_EMIT_TOOL_NAME`. |
| 4. Unit tests asserted `JSON.stringify(...).toContain('requires')` instead of the structured failure contract. | **In-scope-Fix** | Tests now narrow the `tool_response` block and assert `result.error`, the top-level marker, and message content. |
| 5. Tautological `terminate_reason === ERROR` assertion on a fixture initialized to `ERROR`. | **In-scope-Fix** | Dropped; success case asserts the returned content length instead. |
| 6. `as never` casts erase type checking in the new test context. | **In-scope-Fix** | `config` stub cast to `as unknown as Config` with a comment. |
| 7a. Non-interactive path lacks the interactive camelCase fallback. | **Reject** | The declared `parametersJsonSchema` requires the snake_case keys; alias expansion is not in the issue and was explicitly rejected for pause detection in the #3526 triage. Divergence is intentional. |
| 7b. Empty-string arguments pass the `typeof` check, writing `''` junk into `emitted_vars` and possibly reporting false completion. | **Blocker-Fix** | Both arguments must be non-empty strings, matching the interactive handler's semantics. Behavioral test added. |
| 8. Hand-rolled failure response duplicates `createErrorResponse` field-by-field. | **In-scope-Fix** | Failure path now calls `createErrorResponse`, keeping the canonical #3063 shape in one place. |
| 9. Integration test named "textual" but exercised the native route; the issue's coverage list includes Hermes forms. | **In-scope-Fix** | Test renamed to drop "textual"; a new direct-runtime file (`subagentNonInteractive.issue3540.test.ts`) drives real malformed `<tool_call>` Hermes text through the parser with three behavioral cases. |

## Review-finding triage (local OCR round 2 — 2 findings, both low)

| Review finding | Classification | Resolution |
| --- | --- | --- |
| 1. Extract a shared `parseEmitArgs` helper (with camelCase fallback) plus message constant so both emitter paths share one contract. | **Reject (documented follow-up)** | The suggested helper's `resolveEmitArg` accepts camelCase fallback keys, which round-1 finding 7a deliberately rejected for the non-interactive path (declared schema is snake_case-only; alias expansion was refused in #3526). Extracting a helper around intentionally divergent acceptance rules would not prevent drift. A future issue may unify the message constant alone. |
| 2. The new describe block was nested inside `describe('finalizeOutput')` while exercising `processFunctionCalls`. | **In-scope-Fix** | Moved out one level as a sibling suite; prettier, ESLint, per-file tests, and the full 402/402 suite re-verified. |

Local OCR cap (2 reviews) is now exhausted. Remaining known follow-up: optional message-constant extraction (round-2 finding 1), tracked here rather than in a new issue at this stage.

## Follow-up hardening: platform-level agents-dir isolation

The initial hermeticity fix isolated only the one failing test via a
`Storage.getUserAgentSkillsDir` spy. Review raised the stricter bar: no test
may read real machine state, and the directory source must be controllable.
`Storage.getGlobalAgentsDir()` now honors an explicit, absolute
`LLXPRT_AGENTS_HOME` override (fail-closed on a relative value; the homedir
fallback and its fail-closed guarantees are unchanged when the variable is
unset), and `LLXPRT_AGENTS_HOME` joined `STORAGE_ENV_KEYS` in
`isolateStorageRoots()` so all 14 workspaces that preload test storage
isolation point the agents root at their temp dir automatically. The per-test
spy was removed; the strict skill-set assertions now hold by platform
guarantee. Storage suite 38/38 and agents suite 402/402 verified.

## Verification

- `packages/agents` per-file suite (`bun run-bun-tests.ts`): 401/401 test files pass with the complete changeset (`tmp/verify3540/full-agents-suite-final.log`).
- `npm run build`: exit 0 (`tmp/verify3540/build.log`).
- `npm run lint:agents-api-surface`: report regenerated, snapshot matches (`tmp/verify3540/apisurface2.log`).
- Lint, typecheck, format, smoke test: recorded under `tmp/verify3540/`.
