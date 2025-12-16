# Plan: Legacy Ink UI refactor to Gemini-style scrolling (fix #456)

Plan ID: `PLAN-20251215-OLDUI-SCROLL`
Generated: 2025-12-16
Total Phases: 6 (P03–P08) + Phase 0.5 preflight
Issue: `vybestack/llxprt-code#456`
Scope: **legacy Ink UI** under `packages/cli/src/ui` (not `packages/ui`)

## Critical reminders

- Follow `dev-docs/RULES.md`: tests first (RED) → minimal implementation (GREEN) → refactor.
- Don’t skip phases; execute P03→P08 in order and record completion under `project-plans/20251215oldui/.completed/`.
- Tag code changes with plan/requirement markers (see `dev-docs/PLAN-TEMPLATE.md`).
- Keep the “realistic” baseline scripts on `gemini-2.5-flash-lite` to avoid quota blowups.

## What you asked for (my understanding)

1. Use the research in `project-plans/20251215oldui/` plus the tmux harness to create a **TDD-first** implementation plan to refactor the **legacy Ink UI** toward the **Gemini CLI structure** that avoids scrollback redraw spam.
2. Make the plan specific enough to run autonomously with reliable verification, including:
   - switching to the **same Ink fork/version** as Gemini CLI (where needed),
   - adding/updating **Vitest** tests that “expect the new structure,”
   - using the **realistic** tmux+LLM scenario as the primary end-to-end regression gate,
   - keeping durable **record keeping** inside this plan directory so context survives compression.

## Current baselines (ground truth)

### Realistic apples-to-apples regression (model + tool + scrollback)

These are the canonical “as a user” scripts:

- LLXPRT (expected PASS on `fix-oldui`):
  - `node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.llm-tool-scrollback-realistic.llxprt.json`
  - Assertion: tmux history does not grow while scrolled up (`deltaDuringCopyMode == 0`) and output is visible during-run.
- Gemini CLI comparison/control (expected PASS):
  - `node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.llm-tool-scrollback-realistic.gemini.json`
  - Assertion: tmux history does not grow while scrolled up (`deltaDuringCopyMode == 0`) and output is visible during-run.

Historical note: pre-fix baselines used “duplicate sentinel line count” in captured scrollback (see `project-plans/20251215oldui/.completed/P00.5.md`). Once alternate-buffer rendering became the default, “after exit” scrollback became an unreliable place to assert on tool output, so the baseline moved to tmux history growth while in copy-mode.

### Secondary fast signal (no model, shell-mode)

- `node scripts/oldui-tmux-harness.js --scenario scrollback --rows 20 --cols 100 --assert`

This is useful for tight loops, but the “realistic” baseline above is the success gate.

## Key technical finding to drive the refactor

The current legacy layout uses Ink `<Static>` for history (`DefaultAppLayout.tsx`) plus live “pending” items below it. When the UI forces a Static refresh (via `refreshStatic()` → `ansiEscapes.clearTerminal` + `staticKey++`), Ink reprints the whole Static region, which shows up as repeated frames in terminal history while the user is scrolled up.

Gemini CLI avoids this by restructuring around a **single, scroll-managed main content region** (virtualized list) rather than depending on terminal scrollback for “history”.

Reference implementation lives in `tmp/gemini-cli/`:
- `tmp/gemini-cli/packages/cli/src/ui/components/shared/VirtualizedList.tsx`
- `tmp/gemini-cli/packages/cli/src/ui/components/shared/ScrollableList.tsx`
- `tmp/gemini-cli/packages/cli/src/ui/contexts/ScrollProvider.tsx`
- `tmp/gemini-cli/packages/cli/src/ui/components/MainContent.tsx`
- `tmp/gemini-cli/packages/cli/src/gemini.tsx` (Ink `render()` options: alternate buffer + incremental rendering)

## Requirements (explicit)

### REQ-456.1 — LLXPRT scrollback redraw spam eliminated (realistic scenario)

**Full Text**: When a model runs a long `run_shell_command` tool output and the user scrolls back while it runs, the legacy Ink UI must not continuously repaint into scrollback (no repeated frames/blocks).

**Behavior**:
- GIVEN: LLXPRT is running interactively (TTY) with legacy Ink UI
- WHEN: a long-ish `run_shell_command` runs, user scrolls up (tmux copy-mode in harness)
- THEN: tmux history does not grow while in copy-mode (`deltaDuringCopyMode == 0`) while output continues to update

**Verification**: `scripts/oldui-tmux-script.llm-tool-scrollback-realistic.llxprt.json` exits 0.

### REQ-456.2 — Gemini CLI comparison remains “clean”

**Full Text**: The same baseline scenario run under Gemini CLI should remain clean (used as a control).

**Verification**: `scripts/oldui-tmux-script.llm-tool-scrollback-realistic.gemini.json` exits 0.

### REQ-456.3 — Legacy UI remains functional

**Full Text**: The refactor must preserve core user flows: tool approvals, streaming output, dialogs, and input.

**Behavior**:
- GIVEN: common tool approval dialogs (shell/tool/edit)
- WHEN: user navigates approvals and continues using the app
- THEN: UI is usable (no stuck states introduced by the refactor)

**Verification**: existing Vitest UI tests pass; manual tmux smoke scripts still work.

### REQ-456.4 — Adopt Gemini’s “single scroll-managed main content” structure

**Full Text**: Replace the `<Static>`-based history+pending split with a Gemini-like scroll-managed main content component (virtualized list + scroll provider) in the legacy Ink UI.

**Verification**: unit/integration tests prove the new component is used and scroll state behaves as designed.

## Record keeping (so we don’t lose context)

All progress is recorded under `project-plans/20251215oldui/`:

- `PLAN.md` (this file): authoritative phase list.
- `uifindings.md`: append notable discoveries/why decisions were made.
- `testing-strategy.md`: append how-to-run + how-to-interpret improvements.
- Create `project-plans/20251215oldui/.completed/PXX.md` after each phase (format at bottom).

Each `.completed/PXX.md` must include:
- date/time
- git commit SHA
- what tests ran + outputs (copy/paste)
- baseline script results + artifact dirs

## Phase 0.5: Preflight verification (MANDATORY)

Run from repo root:

1. Verify local tools:
   - `command -v tmux && tmux -V`
   - `command -v gemini && gemini --version`
2. Verify baseline scripts still reproduce:
   - LLXPRT baseline: `node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.llm-tool-scrollback-realistic.llxprt.json`
   - Gemini control: `node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.llm-tool-scrollback-realistic.gemini.json`
3. Verify upstream reference code is present:
   - `test -d tmp/gemini-cli/packages/cli/src/ui/components/shared`
4. Verify Ink dependency state (before change):
   - `npm ls ink`
   - `cat packages/cli/package.json | rg '\"ink\"'`

If any of these fail, update this plan before implementing anything.

---

# Phase 03: Add an automated regression test wrapper for the tmux baseline

## Phase ID

`PLAN-20251215-OLDUI-SCROLL.P03`

## Requirements implemented

- REQ-456.1 (as an executable test gate, initially failing when enabled)
- REQ-456.2 (control gate, optional)

## TDD-first tasks

### 1) RED: Add a Vitest test that runs the LLXPRT baseline harness

Create: `scripts/tests/oldui-scrollback-regression.test.js`

Behavior:
- If `process.env.LLXPRT_E2E_OLDUI !== '1'`, the test must `it.skip(...)`.
- Otherwise it must spawn:
  - `node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.llm-tool-scrollback-realistic.llxprt.json`
  - assert exit code == 0
  - on failure, include the “artifacts:” path from stdout/stderr in the assertion message

This is the “integration-first” test we will use while refactoring.

### 2) RED: (Optional) Add the Gemini CLI control test

Same file, gated behind `process.env.LLXPRT_E2E_GEMINI === '1'`, spawn:
- `node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.llm-tool-scrollback-realistic.gemini.json`

### 3) GREEN: Minimal harness runner utility (if needed)

If the test becomes noisy, create a tiny helper under `scripts/tests/helpers/` that:
- spawns a command with timeout
- returns `{ exitCode, stdout, stderr }`

## Verification commands

- `npm run test:scripts` (with env vars off; should still pass)
- `LLXPRT_E2E_OLDUI=1 npm run test:scripts` (expected to fail until the UI fix lands)

## Record keeping

Create: `project-plans/20251215oldui/.completed/P03.md`

---

# Phase 04: Align Ink version/fork with Gemini CLI

## Phase ID

`PLAN-20251215-OLDUI-SCROLL.P04`

## Requirements implemented

- REQ-456.4 (prereq: reduce Ink divergence so we can port Gemini components with less churn)

## Preflight verification (within this phase)

- Confirm Gemini CLI uses Ink alias:
  - `cat tmp/gemini-cli/packages/cli/package.json | rg '\"ink\"'`

## TDD-first tasks

### 1) RED: Add a “render options” unit test contract

Create a pure function (new file):
- `packages/cli/src/ui/inkRenderOptions.ts`

It should compute the `render(...)` options we’ll use (alternate buffer, incremental rendering, etc.) from `(config, settings)`.

Write tests first:
- `packages/cli/src/ui/inkRenderOptions.test.ts`

Minimum behaviors to test:
- screen reader mode disables alternate buffer
- default interactive mode enables the “Gemini-like” options we choose

### 2) GREEN: Implement `inkRenderOptions.ts`

### 3) Switch Ink dependency to match Gemini

Update (at minimum):
- `packages/cli/package.json` dependency `"ink": "npm:@jrichman/ink@6.4.6"` (or exact version confirmed in preflight)
- root `package.json` devDependency similarly (to keep tooling consistent)

Then update `packages/cli/src/gemini.tsx` to use `inkRenderOptions(...)` when calling `render(...)`.

### 4) Update any broken UI tests/snapshots caused purely by Ink changes

Do not change production behavior beyond what’s required for compatibility in this phase.

## Verification commands

- `npm run test --workspaces --if-present`
- `npm run typecheck`
- `npm run lint`

## Record keeping

Create: `project-plans/20251215oldui/.completed/P04.md`

---

# Phase 05: Port ScrollProvider + VirtualizedList + ScrollableList (with tests)

## Phase ID

`PLAN-20251215-OLDUI-SCROLL.P05`

## Requirements implemented

- REQ-456.4 (core structure components)

## TDD-first tasks (port from `tmp/gemini-cli/`)

### 1) RED: Port upstream tests first

Copy/adapt tests (keep names/behavior, adjust imports):
- `packages/cli/src/ui/components/shared/VirtualizedList.test.tsx`
- `packages/cli/src/ui/components/shared/ScrollableList.test.tsx`
- `packages/cli/src/ui/contexts/ScrollProvider.test.tsx`
- `packages/cli/src/ui/contexts/ScrollProvider.drag.test.tsx` (optional if we add mouse)

Initially these should fail because the implementations don’t exist.

### 2) GREEN: Port implementations with minimal adaptation

Create/adapt:
- `packages/cli/src/ui/components/shared/VirtualizedList.tsx`
- `packages/cli/src/ui/components/shared/ScrollableList.tsx`
- `packages/cli/src/ui/contexts/ScrollProvider.tsx`

Integration constraints:
- Prefer using existing `KeypressContext` in llxprt (we already have it).
- If mouse support is required, implement the minimum MouseContext plumbing necessary; otherwise leave mouse features for a later phase but keep keyboard scrolling + autoscroll.

### 3) REFACTOR: isolate pure logic behind the components (only if tests force it)

If needed for testability, move calculations into pure functions and test them directly (no “implementation detail” tests).

## Verification commands

- `npm run test --workspace @vybestack/llxprt-code -t \"VirtualizedList|ScrollableList|ScrollProvider\"`
- `npm run test`

## Record keeping

Create: `project-plans/20251215oldui/.completed/P05.md`

---

# Phase 06: Refactor legacy layout to a single scroll-managed main content region

## Phase ID

`PLAN-20251215-OLDUI-SCROLL.P06`

## Requirements implemented

- REQ-456.4 (use the new structure)
- REQ-456.3 (keep core flows working)

## TDD-first tasks

### 1) RED: Add layout-level tests that assert the new structure is used

Target file (existing):
- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx`

Add tests (new or extend existing snapshot tests):
- When “Gemini-style scrolling mode” is enabled, `DefaultAppLayout` must render `ScrollableList` (and must not render `<Static>` for history).
- When disabled, existing `<Static>` path remains (so we preserve fallback behavior).

This will likely require introducing a state/config flag in UIState (or settings) that toggles the new mode.

### 2) GREEN: Introduce `MainContent` (Gemini-like) component and wire it

Create:
- `packages/cli/src/ui/components/MainContent.tsx` (or similar) that mirrors upstream responsibilities:
  - renders header + tips + history + pending as list items inside `ScrollableList`
  - maintains scroll/autoscroll behavior
  - keeps footer (composer/dialogs) fixed outside the scrolling region

Modify:
- `packages/cli/src/ui/layouts/DefaultAppLayout.tsx` to delegate to `MainContent` in the new mode.

### 3) Ensure “pending” tool output still renders correctly

Specifically: streaming tool output updates must update list items without triggering full-history reprints.

## Verification commands

- `npm run test --workspace @vybestack/llxprt-code -t \"DefaultAppLayout|MainContent\"`
- `npm run test`

## Record keeping

Create: `project-plans/20251215oldui/.completed/P06.md`

---

# Phase 07: Eliminate Static refresh behavior in the new mode (stop full-frame reprints)

## Phase ID

`PLAN-20251215-OLDUI-SCROLL.P07`

## Requirements implemented

- REQ-456.1 (stop redraw spam)

## TDD-first tasks

### 1) RED: Add a test that proves `refreshStatic()` is not used in the new mode

We can test behaviorally by:
- mocking `ansi-escapes` (or the stdout writes) and asserting clearTerminal is not emitted while running a streaming tool in the new mode.

Target:
- `packages/cli/src/ui/AppContainer.tsx`

### 2) GREEN: Make `refreshStatic()` / `staticKey` a non-factor in the new mode

Options:
- Don’t mount `<Static>` at all in the new mode (preferred).
- Ensure resize/history-trim refresh logic is either no-op or scoped to the old mode only.

## Verification commands

- `npm run test --workspace @vybestack/llxprt-code -t \"AppContainer.*Static\"`
- `npm run test`

## Record keeping

Create: `project-plans/20251215oldui/.completed/P07.md`

---

# Phase 08: Prove the realistic tmux baseline passes (LLXPRT matches Gemini)

## Phase ID

`PLAN-20251215-OLDUI-SCROLL.P08`

## Requirements implemented

- REQ-456.1
- REQ-456.2
- REQ-456.3

## TDD-first tasks

### 1) RED: Run the integration regression test with env enabled (expect failure pre-fix)

- `LLXPRT_E2E_OLDUI=1 npm run test:scripts`

### 2) GREEN: iterate until it passes

Primary gate:
- `node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.llm-tool-scrollback-realistic.llxprt.json`

Control:
- `node scripts/oldui-tmux-harness.js --script scripts/oldui-tmux-script.llm-tool-scrollback-realistic.gemini.json`

### 3) Update docs + findings

- append what changed + why into `project-plans/20251215oldui/uifindings.md`
- update `dev-docs/oldui-tmux-harness.md` if commands change

## Final verification (repo checklist)

Run the AGENTS checklist (repo root):

1. `npm run format`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test`
5. `npm run build`
6. `node scripts/start.js --profile-load synthetic --prompt "write me a haiku"`

## Record keeping

Create: `project-plans/20251215oldui/.completed/P08.md`

---

## Phase completion file template

Create `project-plans/20251215oldui/.completed/PXX.md`:

```md
Phase: PXX
Completed: YYYY-MM-DD HH:MM
Commit: <sha>

What changed:
- ...

Tests:
- <paste exact commands + outputs>

Baseline scripts:
- LLXPRT: <command> → PASS/FAIL (artifacts: <dir>)
- Gemini: <command> → PASS/FAIL (artifacts: <dir>)
```
