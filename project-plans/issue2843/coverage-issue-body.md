Migrating the `cli` workspace to Bun-native test execution (#2843) revived a
large body of tests that had been excluded from the Vitest selection and had not
run in CI for a long time. Some could not be ported, and the migration also
uncovered product defects that those tests correctly catch.

This issue tracks the coverage deliberately given up, and the defects needing a
product decision, so none of it is silently lost.

## 1. Deleted — behaviour no longer exists

**`InputPrompt.vim.test.tsx` — "queued message editing" (8 cases)**

Every case drove `props.popAllMessages`. That prop appears exactly once in
non-test source, as an optional field in
`src/ui/components/inputPromptTypes.ts`, and nothing reads or calls it. The
tests also used a returns-a-string signature while the surviving type takes a
callback, so they never described current behaviour.

Behaviours lost:

- up arrow on an empty prompt loads all queued messages
- queued messages are not loaded when the prompt already has text
- an undefined return from `popAllMessages` is handled
- the NAVIGATION_UP binding behaves the same as the raw up arrow
- a single queued message is handled
- the check only fires when the buffer trims to empty
- absence of `popAllMessages` is tolerated
- input history is navigated when no queued messages exist (still covered by
  `useInputHistory.test.ts`)

**`test/integration/auth-e2e.integration.test.ts` (5 cases)**

Spawned `npm run cli`, a script that exists in neither `package.json` nor
reachable history. Every assertion ran against empty output, so the file could
only ever pass vacuously.

## 2. Deleted — placeholder / structure-only (RULES.md)

Eleven `expect(true).toBe(true)` assertions were found. Five files were deleted
because every case in them was vacuous:

| file | cases | its own comment |
| --- | --- | --- |
| `src/ui/App.e2e.test.tsx` | 3 | "placeholder test to verify file structure" |
| `test/baseProvider.stateless.stub.test.ts` | 1 | "TODO(Phase 05): Replace with..." |
| `test/openai.stateless.stub.test.ts` | 1 | same |
| `test/openaiResponses.stateless.stub.test.ts` | 1 | same |
| `src/ui/components/OAuthCodeDialog.test.tsx` | 5 | "This will be tested via integration tests" |

`OAuthCodeDialog.test.tsx` nominally had one non-vacuous case, but it asserted
only that the import resolves.

Named behaviours worth real coverage:

- OAuth code dialog: only pasted input is accepted for security-code entry
- OAuth code dialog: Escape closes the dialog
- OAuth code dialog: Return submits the verification code
- OAuth code dialog: invalid characters are filtered from a pasted code
- OAuth code dialog: provider-specific instructions are produced
- App e2e: clear user instructions for clipboard copy behaviour

## 3. Product defects the revived tests exposed

### 3a. Bun's `spawnSync` does not support extra file descriptors

`src/utils/sandbox-bashrc.ts` passes payloads back through fds 3 and 4 and reads
`result.output[3]` / `result.output[4]`. Measured directly with the same
command:

| runtime | `output.length` | fd3 | fd4 |
| --- | --- | --- | --- |
| Node | 5 | populated | populated |
| Bun | 3 | empty | empty |

All 16 cases in `src/utils/sandbox-bashrc.test.ts` fail and **cannot be fixed in
the test** — the mechanism the code depends on is absent.

This is not only a test problem. The repository is moving to Bun as the runtime
(`bun scripts/start.ts`), so the shipped CLI would silently capture nothing for
sandbox env and cwd. A different transport is needed — a temporary file, or
stdout with delimiters. Choosing one is a product decision.

### 3b. Inline load-balancer profiles are rejected

`parseInlineProfile` in `src/config/profileBootstrap.ts` requires `provider` and
`model` and has no `type: 'loadbalancer'` branch, so an inline load-balancer
profile is rejected while the equivalent file-based profile works. Blocks 3
cases in `src/integration-tests/loadbalancer.integration.test.ts`.

### 3c. `retries` / `retrywait` validators were lost — FIXED in #2843

Both settings lost their `validate` functions in a settings-registry migration,
so invalid values were accepted silently. Restored in
`packages/settings/src/settings/registry/registry-entries-2.ts`; the original
error wording was recovered from the test.

## 4. Still failing at the end of #2843

Left failing with the investigation recorded, rather than skipped or weakened:

| file | cases | note |
| --- | --- | --- |
| `sandbox-bashrc.test.ts` | 16 | blocked by 3a |
| `loadbalancer.integration.test.ts` | 3 | blocked by 3b |
| `InputPrompt.paste.test.tsx` | 10 | mouse / tab / ctrl-R content assertions |
| `InputPrompt.paste.spec.tsx` | 6 | `useKeypress` mock does not intercept; specifier corrected, cause unidentified |
| `InputPrompt.test.tsx` | 4 | Enter does not submit |
| `oauth-timing.integration.test.ts` | 4 | |
| `useAgentStream.finished.test.tsx` | 2 | `context-warning` event does not reach its handler despite matching shape and correct argument positions |
| `useKeypress.test.tsx` | 2 | kitty-protocol debounce coalescing |
| `InputPrompt.completion.test.tsx` | 1 | ESC state |
| `git-stats.integration.test.ts` | 1 | `expect.any(Number)` passes inside `toMatchObject`, then `toBeGreaterThan` reports "must be numbers or bigints" |

## 5. Vacuous assertions found while porting

`InputPrompt.completion.test.tsx` ESC tests wait on
`onEscapePromptChange(false)`, which fires on mount and is therefore satisfied
instantly. "should reset escape state on any non-ESC key" consists of nothing
but two such waits. These passed under Vitest for the same reason. Recorded
rather than silently tightened, since making them strict changes what is being
asserted.

## Context

Full per-file investigation notes are in
`project-plans/issue2843/coverage-gaps.md`.
