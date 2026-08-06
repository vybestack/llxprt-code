# Plan: Suppress Automatic Welcome Setup for Explicit CLI Provider Selection

Plan ID: PLAN-20260806-ISSUE3105
Generated: 2026-08-06
Requirements: REQ-SUPPRESS-001, REQ-DEFAULT-001, REQ-MANUAL-001

## Scope and acceptance boundary

This issue changes only automatic welcome-onboarding behavior at interactive startup. It does not alter provider/profile resolution, validation, precedence, authentication, persisted welcome completion, non-interactive behavior, or the manual `/setup` flow. It adds no dependency, workflow, subsystem, public API, or adjacent cleanup.

### REQ-SUPPRESS-001: Explicit CLI selectors suppress automatic welcome setup

**Requirement text:** An interactive launch with a valid, non-empty `--profile-load`, `--profile`, or `--provider` command-line value must not automatically display the welcome setup dialog, even when persisted welcome setup is incomplete.

- GIVEN persisted welcome setup is incomplete and folder trust permits normal UI startup
- WHEN the parsed command line contains a valid non-empty `--profile-load`, `--profile`, or `--provider` value
- THEN the automatic welcome-completion check is bypassed for that startup
- AND the welcome setup dialog is not displayed
- AND suppression is session-local and does not persist welcome completion

Each of the three flags is independently sufficient. Existing parser/profile/provider validation remains authoritative; this issue does not define new behavior for missing, empty, malformed, conflicting, or otherwise invalid selector values because those launches already fail or are handled before a usable interactive session.

### REQ-DEFAULT-001: Existing welcome behavior remains the default

**Requirement text:** Interactive launches without an explicit provider/profile selector must retain the existing welcome behavior.

- GIVEN persisted welcome setup is incomplete
- WHEN none of `--profile-load`, `--profile`, or `--provider` is supplied with a valid non-empty value
- THEN the welcome setup dialog is displayed after folder trust completes

A model-only argument, environment-selected provider/profile, settings default profile, or provider resolved from another non-command-line source does not suppress the welcome dialog. Existing completed-welcome behavior remains unchanged.

### REQ-MANUAL-001: Manual setup remains available

**Requirement text:** Startup suppression must not disable the existing `/setup` command.

- GIVEN automatic welcome setup was suppressed for the current startup
- WHEN the existing `/setup` action resets and reopens onboarding
- THEN the welcome setup dialog is displayed

## Preflight evidence

- `packages/cli/src/config/cliArgParser.ts` parses `provider` and `profileLoad`, but currently omits the already-defined yargs `profile` value from `CliArgs` mapping.
- `packages/cli/src/cli.tsx` retains parsed command-line arguments through foreground-agent construction and is the composition root for session dispatch.
- `packages/cli/src/session/nonInteractiveSession.ts` is the existing interactive/non-interactive dispatch boundary and calls `startInteractiveUI` only for interactive sessions.
- `packages/cli/src/session/interactiveUI.tsx`, `packages/cli/src/ui/App.tsx`, `packages/cli/src/ui/AppContainerRuntime.tsx`, and `useAppDialogs.ts` are the direct internal prop path to `useWelcomeOnboarding`.
- `useWelcomeOnboarding` currently initializes its state by calling `isWelcomeCompleted()` and derives dialog visibility from that state plus folder trust. Its existing `resetAndReopen` action can preserve manual `/setup` behavior if suppression affects only initial state.
- Bun-native React hook infrastructure already exists through `packages/cli/src/test-utils/render.tsx`; no dependency or test-framework change is needed.

## Test-first implementation sequence

1. Add Bun/bun:test behavioral coverage for the real welcome hook:
   - incomplete welcome plus startup suppression yields no dialog;
   - incomplete welcome without suppression still yields the dialog after trust;
   - startup suppression does not prevent `resetAndReopen` from showing the dialog;
   - completed welcome remains hidden.
2. Add Bun/bun:test coverage proving parsed `--profile`, `--profile-load`, and `--provider` values reach the startup-suppression decision, while no selector and `--model` alone do not suppress.
3. Run the focused tests and record RED evidence before production edits.
4. Implement the minimum internal data threading from parsed CLI arguments to the welcome hook. Suppression must initialize the hook as completed for that mount without writing welcome configuration; `resetAndReopen` must continue to clear the in-memory state.
5. Run focused tests, relevant CLI package tests, formatting, lint, and type checking.
6. Validate the visible terminal behavior in the tmux harness for a selector launch and a no-selector launch with an incomplete isolated welcome config.

Tests must assert rendered/hook-visible behavior rather than mock-call interactions. Infrastructure unrelated to the welcome decision may be replaced with minimal test fixtures, but the parser, suppression decision, and welcome hook behavior remain real.

## Behavioral evidence

Focused evidence must include Bun tests covering every accepted behavior and tmux-harness captures showing:

- an incomplete isolated welcome configuration does not show `Welcome to llxprt!` when launched with each supported selector form that can be exercised safely;
- the same incomplete configuration does show the welcome dialog with no selector;
- `/setup` can open onboarding after a suppressed startup.

## Full verification

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Before push, run DeepThinker review and detached Open Code Review with `--timeout 20`, ensuring test files are included. Classify every finding as Blocker-Fix, In-scope-Fix, Reject, or Defer; resolve all Blocker-Fix and In-scope-Fix findings. Do not exceed two local OCR or two PR OCR reviews.

## Completion conditions

- Every accepted behavior has direct behavioral evidence.
- No provider/profile resolution or persistence semantics are changed.
- No dependency, workflow, agent memory, quality-tool, public abstraction, unrelated refactor, suppression directive, or lint/complexity weakening is introduced.
- Focused and full local verification pass on the candidate head.
- Reviews are complete and triaged, candidate-head CI is green, all required threads are resolved, ancestry is current, and the PR is conflict-free.

## Implementation evidence

RED observations recorded before production edits (focused Bun suites):

- Repeated `--profile` parsing: before `pickLastRepeatedStringOption` mapping was added, yargs returned an array for `--profile a --profile b`, so `CliArgs.profile` was not a single string and the repeated-`--profile` parser expectation failed.
- Welcome suppression / manual reopen: before `suppressStartup` support was added, the welcome-onboarding hook expectations failed — a suppressed startup still reported `showWelcome === true`, and no path distinguished a suppressed startup from an incomplete one; `resetAndReopen` behavior was not exercised against a suppressed startup.

Connected TUI evidence (parser → interactive render with a real isolated incomplete welcome config) was captured with the tmux harness:

- `--profile-load stepfun-37` suppressed automatic welcome, and entering `/setup` opened `Welcome to llxprt!`: `/var/folders/qd/962lhrjj0232rjykgg3lgmrw0000gn/T/llxprt-tmux-harness-1786035305090`
- `--provider openai --model gpt-4o` suppressed automatic welcome: `/var/folders/qd/962lhrjj0232rjykgg3lgmrw0000gn/T/llxprt-tmux-harness-1786035360409`
- inline `--profile` with OpenAI provider/model suppressed automatic welcome: `/var/folders/qd/962lhrjj0232rjykgg3lgmrw0000gn/T/llxprt-tmux-harness-1786035369433`
- no selector displayed `Welcome to llxprt!`: `/var/folders/qd/962lhrjj0232rjykgg3lgmrw0000gn/T/llxprt-tmux-harness-1786035378455`
- `--model gpt-4o` alone displayed `Welcome to llxprt!`: `/var/folders/qd/962lhrjj0232rjykgg3lgmrw0000gn/T/llxprt-tmux-harness-1786035386997`
