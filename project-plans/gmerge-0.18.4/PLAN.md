# PLAN.md — gmerge-0.18.4 Batch Execution Plan

## START HERE (If you were told to "DO this plan")

If you're reading this because someone said "DO @project-plans/gmerge-0.18.4/PLAN.md", follow these steps:

### Step 1: Check current state

```bash
git branch --show-current  # Should be gmerge/0.18.4
git status                 # Check for uncommitted changes
```

### Step 2: Check or create the todo list

Call `todo_read()` first. If empty or doesn't exist, call `todo_write()` with the EXACT todo list from the "Todo List Management" section below.

### Step 3: Find where to resume

- Look at the todo list for the first `pending` item
- If an item is `in_progress`, restart that item
- If all items are `completed`, you're done

### Step 4: Execute using subagents

For each batch, you MUST use the `task` tool to invoke subagents:

- **For execution tasks (BN-exec):** Call `task` with `subagent_name: "cherrypicker"`
- **For review tasks (BN-review):** Call `task` with `subagent_name: "reviewer"`
- **For remediation (if review fails):** Call `task` with `subagent_name: "cherrypicker"`

- **DO NOT** do the cherry-picks yourself — use the cherrypicker subagent
- **DO NOT** do the reviews yourself — use the reviewer subagent
- Continue until todo list is empty or you hit a blocker

### Step 5: If blocked

- Call `todo_pause()` with the specific reason
- Wait for human intervention

---

## Non-Negotiables

See `dev-docs/cherrypicking.md` for full details. Key points:

- **Privacy**: A2A server stays private. No ClearcutLogger. No Google telemetry.
- **Multi-provider**: Preserve `USE_PROVIDER` instead of Google-specific auth. Keep LLxprt's provider abstraction.
- **Tool batching**: LLxprt has superior parallel batching. Do not adopt upstream's serial queue.
- **Branding**: Use LLxprt branding (see substitutions below).
- **NextSpeakerChecker**: Permanently disabled. Do not re-enable.
- **FlashFallback**: Disabled and slated for removal. Do not add.
- **Emoji-free**: LLxprt is emoji-free by design.

---

## Branding Substitutions

| Upstream | LLxprt |
| -------- | ------ |
| `@google/gemini-cli-core` | `@vybestack/llxprt-code-core` |
| `@google/gemini-cli` | `@vybestack/llxprt-code` |
| `gemini-cli` | `llxprt-code` |
| `Gemini CLI` | `LLxprt Code` |
| `GEMINI.md` | `LLXPRT.md` |
| `gemini` (binary name) | `llxprt` |
| `USE_GEMINI` | `USE_PROVIDER` |
| `AuthType.LOGIN_WITH_GOOGLE` | Preserve multi-provider auth |
| `Google LLC` copyright | `Vybestack LLC` copyright |

---

## File Existence Pre-Check

Files referenced by REIMPLEMENT plans that might not exist in LLxprt:

| File | Status | Notes |
| ---- | ------ | ----- |
| `packages/cli/src/ui/hooks/useAlternateBuffer.ts` | [ERROR] Does not exist | LLxprt has alternate buffer inline in AppContainer.tsx + inkRenderOptions.ts |
| `packages/cli/src/ui/hooks/useBanner.ts` | [ERROR] Does not exist | Will be created in Batch 15 (ea3d022c) |
| `packages/cli/src/utils/persistentState.ts` | [ERROR] Does not exist | Will be created in Batch 15 (ea3d022c) |
| `packages/cli/src/ui/hooks/useMouseClick.ts` | [ERROR] Does not exist | Will be created in Batch 5 (2231497b) |
| `packages/cli/src/ui/components/messages/ToolResultDisplay.tsx` | [ERROR] Does not exist | Will be created in Batch 5 (2231497b) |
| `packages/cli/src/ui/components/messages/ToolShared.tsx` | [ERROR] Does not exist | Will be created in Batch 5 (2231497b) |
| `packages/cli/src/utils/stdio.ts` | [ERROR] Does not exist | Created by Batch 10 (d1e35f86) |
| `packages/core/src/utils/stdio.ts` | [ERROR] Does not exist | Created by Batch 17 (2e8d7831) |
| `packages/core/src/utils/terminal.ts` | [ERROR] Does not exist | Created by Batch 17 (2e8d7831) |
| `packages/cli/src/commands/utils.ts` | [ERROR] Does not exist | Created by Batch 16 (013f9848) |
| `packages/core/src/config/defaultModelConfigs.ts` | [ERROR] Does not exist | N/A — 257cd07a SKIPPED; LLxprt uses multi-provider routing |
| `packages/cli/src/ui/auth/AuthDialog.tsx` | [ERROR] Wrong path | LLxprt has `packages/cli/src/ui/components/AuthDialog.tsx` |
| `packages/cli/src/ui/hooks/useInactivityTimer.ts` | [ERROR] Does not exist | Created by cherry-pick (843b019c) |

---

## Subagent Orchestration

Pattern for each batch:

```
Execute (cherrypicker) → Review (reviewer) → PASS? continue : Remediate (cherrypicker) → Review again
Loop remediation up to 5 times, then escalate to human if still failing.
```

### Subagent roles

1. **cherrypicker** — executes cherry-picks, resolves conflicts, applies reimplementations
2. **reviewer** — MANDATORY verification after every batch (mechanical + qualitative)

### Review requirements

Every reviewer prompt MUST include BOTH:

**Mechanical verification:**
- lint, typecheck pass (every batch)
- tests pass (full verify batches)
- build passes (full verify batches)
- branding check (no `@google/gemini-cli`, no `USE_GEMINI`, etc.)

**Qualitative verification:**
For EACH commit in the batch:
- **Code actually landed** — not stubbed, not faked, not just imports
- **Behavioral equivalence** — will it do what upstream intended?
- **Integration correctness** — properly connected, would work at runtime

---

## Batch Schedule

### Batch sizing notes

The runbook default for PICK batches is 5 commits. Deviations in this plan:
- **Batch 1 (7)**: All low-risk, non-overlapping areas (docs, keyboard, zed, settings, UI). Grouping saves a verify cycle.
- **Batch 4 (6)**: Genai bump needs `npm install` afterward; grouping related editor/keyboard/thinking changes keeps the dep bump atomic with its consumers.
- **Batch 9 (2)**: Only 2 remaining PICK commits before the high-risk Batch 10 solo. Flushing them avoids carrying state across the big commit.
- **Batch 11 (4)**: Natural grouping — all touch settings/config/zed. No reason to pad to 5.
- **Batch 16 (1)**: Solo because it's a dep bump (package-lock.json regeneration) that should be isolated.

---

### Batch 1 — PICK × 7

**Commits (chronological):**
1. `fd9d3e19` — Remove obsolete reference to "help wanted" in CONTRIBUTING.md
2. `b916d79f` — Improve keyboard code parsing
3. `10003a64` — Ensure read_many_files tool is available to zed
4. `90c764ce` — Support 3-parameter modifyOtherKeys sequences
5. `c5498bbb` — Improve pty resize error handling for Windows
6. `e8d0e0d3` — showLineNumbers had the wrong default value
7. `1e8ae5b9` — fix crash on startup in NO_COLOR mode

**Command:**
~~~bash
git cherry-pick fd9d3e19 b916d79f 10003a64 90c764ce c5498bbb e8d0e0d3 1e8ae5b9
~~~

**Verify:** Quick (`npm run lint && npm run typecheck`)
**Commit message:** `cherry-pick: upstream v0.17.1..v0.18.4 batch 1`

**Cherrypicker Prompt:**
~~~
You are executing Batch 1 of the gmerge v0.17.1→v0.18.4 sync on branch gmerge/0.18.4.

TASK: Cherry-pick 7 commits in order:
  git cherry-pick fd9d3e19 b916d79f 10003a64 90c764ce c5498bbb e8d0e0d3 1e8ae5b9

COMMITS:
1. fd9d3e19 — Remove obsolete "help wanted" reference in CONTRIBUTING.md
2. b916d79f — Improve keyboard code parsing (KeypressContext.tsx + test)
3. 10003a64 — Ensure read_many_files available to zed (zedIntegration.ts)
4. 90c764ce — Support 3-parameter modifyOtherKeys sequences (KeypressContext.tsx + test)
5. c5498bbb — Improve pty resize error handling for Windows (shellExecutionService.ts)
6. e8d0e0d3 — showLineNumbers wrong default value (settingsSchema.ts, settings.schema.json, docs)
7. 1e8ae5b9 — Fix crash on startup in NO_COLOR mode (Banner.tsx, ModelDialog.tsx, GradientRegression.test.tsx)

CONFLICT RESOLUTION:
- Low conflict risk. Touches keyboard handling, zed, settings, and UI components.
- If Banner.tsx conflicts: LLxprt may have different banner structure. Keep LLxprt banner, take the NO_COLOR fix logic.
- If settingsSchema.ts conflicts: Keep LLxprt additions, take the default value fix.

BRANDING (apply to ALL files touched):
- @google/gemini-cli-core → @vybestack/llxprt-code-core
- @google/gemini-cli → @vybestack/llxprt-code
- gemini-cli → llxprt-code, Gemini CLI → LLxprt Code
- GEMINI.md → LLXPRT.md, USE_GEMINI → USE_PROVIDER
- Google LLC → Vybestack LLC copyright. No emoji.

AFTER: git add -A. Run: npm run lint && npm run typecheck. Fix failures before reporting.
~~~

**Reviewer Prompt:**
~~~
Review Batch 1 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4.

MECHANICAL (quick):
1. Run: npm run lint — must pass
2. Run: npm run typecheck — must pass
3. Branding check:
   grep -rn "@google/gemini-cli" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | head -20
   grep -rn "USE_GEMINI" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | head -10
   Both must return ZERO matches in changed files.

QUALITATIVE (per-commit, verify real code landed):
1. fd9d3e19: CONTRIBUTING.md no longer references "help wanted" label
2. b916d79f: KeypressContext.tsx has improved keyboard code parsing logic (real logic, not just imports)
3. 10003a64: zedIntegration.ts includes read_many_files in zed tool list
4. 90c764ce: KeypressContext.tsx handles 3-parameter modifyOtherKeys sequences
5. c5498bbb: shellExecutionService.ts has better pty resize error handling
6. e8d0e0d3: settingsSchema.ts has correct showLineNumbers default, settings.schema.json matches
7. 1e8ae5b9: Banner.tsx/ModelDialog.tsx handle NO_COLOR mode without crashing

Report PASS or FAIL per check with file:line evidence for qualitative checks.
~~~

---

### Batch 2 — REIMPLEMENT × 1: Escape clears input

**Upstream:** `b644f037` — fix(ui): Clear input prompt on Escape key press
**Playbook:** `project-plans/gmerge-0.18.4/b644f037-plan.md`

**Verify:** Full (`npm run lint && npm run typecheck && npm run test && npm run format && npm run build && node scripts/start.js --profile-load synthetic --prompt "write me a haiku"`)
**Commit message:** `reimplement: Escape clears input when idle (upstream b644f037)`

**Cherrypicker Prompt:**
~~~
Execute Batch 2 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. REIMPLEMENT upstream b644f037.

Read and execute playbook: project-plans/gmerge-0.18.4/b644f037-plan.md

KEY CONTEXT:
- LLxprt's cancel handler at AppContainer.tsx is () => void (no shouldRestorePrompt param)
- LLxprt uses inputHistoryStore.inputHistory (not upstream's userMessages)
- Follow TDD: write failing test FIRST, then implement

BRANDING: @vybestack/llxprt-code-core, Vybestack LLC copyright. No emoji.

AFTER: git add -A. FULL verify: npm run lint && npm run typecheck && npm run test && npm run format && npm run build && node scripts/start.js --profile-load synthetic --prompt "write me a haiku". Fix failures.
~~~

**Reviewer Prompt:**
~~~
Review Batch 2 of gmerge v0.17.1→v0.18.4. REIMPLEMENT of b644f037 (Escape clears input).

MECHANICAL (full):
1. npm run lint
2. npm run typecheck
3. npm run test
4. npm run format (files should already be formatted)
5. npm run build
6. node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
7. Branding: grep -rn "@google/gemini-cli" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | head -20

QUALITATIVE for b644f037:
1. CODE LANDED: Escape key handler exists in AppContainer.tsx or InputPrompt.tsx with real logic
2. BEHAVIORAL: When Escape pressed while idle (not streaming), input clears. Check streaming state guard.
3. INTEGRATION: Cancel handler signature is still () => void (NOT (shouldRestorePrompt: boolean)). Uses inputHistoryStore (not userMessages).
4. TEST EXISTS: Test verifies Escape clears input when idle.

Report PASS/FAIL per check.
~~~

---

### Batch 3 — PICK × 5

**Commits:**
1. `61f0f3c2` — allow MCP prompts with spaces in name
2. `5c475921` — Refactor createTransport to duplicate less code
3. `0d89ac74` — Followup from #10719 (config/session utils)
4. `e1c711f5` — record interactive-only errors and warnings to chat recording
5. `300205b0` — Correctly handle cancellation errors (zed)

**Command:**
~~~bash
git cherry-pick 61f0f3c2 5c475921 0d89ac74 e1c711f5 300205b0
~~~

**Verify:** Quick
**Commit message:** `cherry-pick: upstream v0.17.1..v0.18.4 batch 3`

**Cherrypicker Prompt:**
~~~
Execute Batch 3 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. Cherry-pick 5 commits:
  git cherry-pick 61f0f3c2 5c475921 0d89ac74 e1c711f5 300205b0

COMMITS:
1. 61f0f3c2 — Allow MCP prompts with spaces in name (McpPromptLoader.ts + test)
2. 5c475921 — Refactor createTransport to reduce duplication (mcp-client.ts + test)
3. 0d89ac74 — Session config/utils improvements (config.ts, sessionUtils.ts, sessions.test.ts — adds 692 lines of tests)
4. e1c711f5 — Record interactive-only errors/warnings to chat recording JSON (AppContainer, clearCommand, hooks, chatRecordingService — 14 files)
5. 300205b0 — Correctly handle cancellation errors in zed (zedIntegration.ts)

CONFLICT RESOLUTION:
- Medium risk. e1c711f5 touches many UI hooks — if AppContainer.tsx conflicts, keep LLxprt structure, integrate error/warning recording.
- 0d89ac74 adds extensive session tests — should apply cleanly.

BRANDING: @google/gemini-cli-core → @vybestack/llxprt-code-core, @google/gemini-cli → @vybestack/llxprt-code, GEMINI.md → LLXPRT.md, USE_GEMINI → USE_PROVIDER, Google LLC → Vybestack LLC. No emoji.

AFTER: git add -A. Quick verify: npm run lint && npm run typecheck. Fix failures.
~~~

**Reviewer Prompt:**
~~~
Review Batch 3 of gmerge v0.17.1→v0.18.4.

MECHANICAL (quick):
1. npm run lint
2. npm run typecheck
3. Branding grep (same as Batch 1)

QUALITATIVE:
1. 61f0f3c2: McpPromptLoader.ts handles prompts with spaces in their names
2. 5c475921: mcp-client.ts createTransport has less duplicated code
3. 0d89ac74: config.ts and sessionUtils.ts have improved session handling + sessions.test.ts has tests
4. e1c711f5: chatRecordingService — OUT OF BAND. Upstream's Gemini-specific ChatRecordingService is
   replaced by LLxprt's own provider-agnostic Session Recording Service (GitHub #1361).
   Cherry-pick landed the non-recording parts (session config/utils); recording-specific code was removed.
5. 300205b0: zedIntegration.ts properly handles cancellation errors

Report PASS/FAIL per check.
~~~

---

### Batch 4 — PICK × 6

**Commits:**
1. `84573992` — Restore keyboard mode when exiting the editor
2. `25f84521` — Bump genai version to 1.30.0 (WARNING: major dep version change 1.16→1.30)
3. `f8a86273` — Keep header ASCII art colored on non-gradient terminals
4. `0f845407` — Fix typo in write_todos methodology instructions
5. `e4c4bb26` — update thinking mode support to exclude gemini-2.0
6. `d0a845b6` — remove unneeded log

**Command:**
~~~bash
git cherry-pick 84573992 25f84521 f8a86273 0f845407 e4c4bb26 d0a845b6
~~~

**Post-pick:** Run `npm install` to regenerate package-lock.json after genai bump.
**Verify:** Full
**Commit message:** `cherry-pick: upstream v0.17.1..v0.18.4 batch 4`

**Cherrypicker Prompt:**
~~~
Execute Batch 4 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. Cherry-pick 6 commits:
  git cherry-pick 84573992 25f84521 f8a86273 0f845407 e4c4bb26 d0a845b6

COMMITS:
1. 84573992 — Restore keyboard mode when exiting editor (InputPrompt.tsx, text-buffer.ts, kittyProtocol hooks)
2. 25f84521 — Bump @google/genai 1.16→1.30 (package.json, McpPromptLoader, useGeminiStream, prompt tests)
3. f8a86273 — Keep header ASCII art colored on non-gradient terminals (Header.test.tsx, ThemedGradient.tsx)
4. 0f845407 — Fix typo in write_todos methodology (write-todos.ts, fileSearch.ts, test-utils/config.ts)
5. e4c4bb26 — Exclude gemini-2.0 models from thinking mode (client.ts + test)
6. d0a845b6 — Remove unneeded log (useIncludeDirsTrust.tsx)

IMPORTANT: After cherry-pick, run `npm install` to regenerate package-lock.json (genai version bump).

CONFLICT RESOLUTION:
- HIGH risk due to genai bump. package-lock.json WILL conflict — delete it and regenerate with `npm install`.
- If McpPromptLoader conflicts, take upstream's API changes for genai 1.30.
- write_todos.ts may be named differently in LLxprt — check packages/core/src/tools/ for the correct filename.

BRANDING: same substitutions as all batches (see PLAN.md "Branding Substitutions").

AFTER: git add -A. npm install. FULL verify: npm run lint && npm run typecheck && npm run test && npm run format && npm run build && node scripts/start.js --profile-load synthetic --prompt "write me a haiku".
~~~

**Reviewer Prompt:**
~~~
Review Batch 4 of gmerge v0.17.1→v0.18.4.

MECHANICAL (full):
1. npm run lint
2. npm run typecheck
3. npm run test
4. npm run format
5. npm run build
6. node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
7. Branding grep

QUALITATIVE:
1. 84573992: Keyboard mode restored when exiting editor (check kittyProtocol/InputPrompt changes)
2. 25f84521: @google/genai is 1.30.0 in both package.json files; McpPromptLoader uses new API; package-lock.json regenerated
3. f8a86273: ThemedGradient.tsx keeps ASCII art colored on non-gradient terminals
4. 0f845407: write_todos (or todo_write) tool has fixed methodology text; fileSearch has fix
5. e4c4bb26: client.ts excludes gemini-2.0 models from thinking mode
6. d0a845b6: Removed unneeded log from useIncludeDirsTrust.tsx

Report PASS/FAIL per check.
~~~

---

### Batch 5 — REIMPLEMENT × 1: Click-to-focus + ToolMessage refactor

**Upstream:** `2231497b` — feat: add click-to-focus support for interactive shell
**Playbook:** `project-plans/gmerge-0.18.4/2231497b-plan.md`

**Verify:** Quick
**Commit message:** `reimplement: click-to-focus + ToolMessage refactor (upstream 2231497b)`

**Cherrypicker Prompt:**
~~~
Execute Batch 5 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. REIMPLEMENT upstream 2231497b.

Read and execute playbook: project-plans/gmerge-0.18.4/2231497b-plan.md

KEY CONTEXT:
- Creates new files: useMouseClick.ts, ToolShared.tsx, ToolResultDisplay.tsx
- Refactors ToolMessage.tsx into smaller components
- Adds click-to-focus for shell command output and tool results
- LLxprt's ToolMessage.tsx has custom todo formatting, multi-provider imports, ANSI output path, stripShellMarkers
- PRESERVE ALL LLxprt-specific functionality when extracting components
- Follow TDD: write failing tests first

BRANDING: @vybestack/llxprt-code-core, Vybestack LLC copyright. No emoji.

AFTER: git add -A. Quick verify: npm run lint && npm run typecheck. Fix failures.
~~~

**Reviewer Prompt:**
~~~
Review Batch 5 of gmerge v0.17.1→v0.18.4. REIMPLEMENT of 2231497b (click-to-focus + ToolMessage refactor).

MECHANICAL (quick):
1. npm run lint
2. npm run typecheck
3. Branding grep

QUALITATIVE for 2231497b:
1. CODE LANDED: useMouseClick.ts hook exists with click handling logic
2. CODE LANDED: ToolShared.tsx exists with ToolStatusIndicator, ToolInfo, TrailingIndicator components
3. CODE LANDED: ToolResultDisplay.tsx exists with result rendering
4. BEHAVIORAL: Clicking on tool output focuses interactive shell (check useMouseClick integration)
5. INTEGRATION: ToolMessage.tsx imports from ToolShared.tsx and ToolResultDisplay.tsx
6. PRESERVATION: LLxprt-specific features preserved — stripShellMarkers, todo formatting, multi-provider imports, ANSI output
7. TESTS: Tests exist for new components

Report PASS/FAIL per check.
~~~

---

### Batch 6 — REIMPLEMENT × 1: Synchronous keyboard writes

**Upstream:** `9ebf3217` — Use synchronous writes when detecting keyboard modes
**Playbook:** `project-plans/gmerge-0.18.4/9ebf3217-plan.md`

**Verify:** Full
**Commit message:** `reimplement: synchronous keyboard writes in kittyProtocolDetector (upstream 9ebf3217)`

**Cherrypicker Prompt:**
~~~
Execute Batch 6 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. REIMPLEMENT upstream 9ebf3217.

Read and execute playbook: project-plans/gmerge-0.18.4/9ebf3217-plan.md

KEY CONTEXT:
- LLxprt's kittyProtocolDetector.ts is significantly restructured vs upstream (different function names, no SGR mouse handling)
- Replace process.stdout.write() with fs.writeSync(process.stdout.fd) for keyboard mode detection
- Add try/catch blocks around enable/disable functions
- Follow TDD

BRANDING: @vybestack/llxprt-code-core, Vybestack LLC copyright. No emoji.

AFTER: git add -A. FULL verify: npm run lint && npm run typecheck && npm run test && npm run format && npm run build && node scripts/start.js --profile-load synthetic --prompt "write me a haiku".
~~~

**Reviewer Prompt:**
~~~
Review Batch 6 of gmerge v0.17.1→v0.18.4. REIMPLEMENT of 9ebf3217 (synchronous keyboard writes).

MECHANICAL (full):
1. npm run lint
2. npm run typecheck
3. npm run test
4. npm run format
5. npm run build
6. node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
7. Branding grep

QUALITATIVE for 9ebf3217:
1. CODE LANDED: kittyProtocolDetector.ts uses fs.writeSync instead of process.stdout.write for keyboard mode detection
2. BEHAVIORAL: Keyboard mode queries use synchronous writes (prevents interleaving with async output)
3. INTEGRATION: try/catch blocks around enable/disable prevent crashes on unsupported terminals
4. TESTS: Tests cover the synchronous write behavior

Report PASS/FAIL per check.
~~~

---

### Batch 7 — REIMPLEMENT × 1: Context overflow race condition

**Upstream:** `b1258dd5` — prevent race condition when restoring prompt after context overflow
**Playbook:** `project-plans/gmerge-0.18.4/b1258dd5-plan.md`
**Depends on:** Batch 2 (b644f037 — Escape/cancel concepts must be in place first)

**Verify:** Quick
**Commit message:** `reimplement: context overflow prompt race condition fix (upstream b1258dd5)`

**Cherrypicker Prompt:**
~~~
Execute Batch 7 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. REIMPLEMENT upstream b1258dd5.

Read and execute playbook: project-plans/gmerge-0.18.4/b1258dd5-plan.md

KEY CONTEXT:
- Race condition: inputHistoryStore updates via React state (async), so last prompt may be stale at cancel time
- LLxprt approach: store lastSubmittedPromptRef at submit time (synchronous), use it for restore
- Cancel handler is () => void (no shouldRestorePrompt param)
- Depends on Batch 2 (b644f037 — Escape/cancel concepts)
- Follow TDD

BRANDING: @vybestack/llxprt-code-core, Vybestack LLC copyright. No emoji.

AFTER: git add -A. Quick verify: npm run lint && npm run typecheck. Fix failures.
~~~

**Reviewer Prompt:**
~~~
Review Batch 7 of gmerge v0.17.1→v0.18.4. REIMPLEMENT of b1258dd5 (context overflow race condition).

MECHANICAL (quick):
1. npm run lint
2. npm run typecheck
3. Branding grep

QUALITATIVE for b1258dd5:
1. CODE LANDED: A ref (lastSubmittedPromptRef or similar) stores the prompt at submit time
2. BEHAVIORAL: After context overflow, the prompt is restored from the ref (not from inputHistoryStore which may be stale)
3. INTEGRATION: The ref is set synchronously at the point of user submission, before any async state updates
4. TEST EXISTS: Test simulates context overflow and verifies correct prompt restoration

Report PASS/FAIL per check.
~~~

---

### Batch 8 — REIMPLEMENT × 1: Memory reload system instruction

**Upstream:** `1d2e27a6` — Update system instruction when GEMINI.md memory is loaded
**Playbook:** `project-plans/gmerge-0.18.4/1d2e27a6-plan.md`

**Verify:** Full
**Commit message:** `reimplement: update system instruction on LLXPRT.md reload (upstream 1d2e27a6)`

**Cherrypicker Prompt:**
~~~
Execute Batch 8 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. REIMPLEMENT upstream 1d2e27a6.

Read and execute playbook: project-plans/gmerge-0.18.4/1d2e27a6-plan.md

KEY CONTEXT:
- getCoreSystemPromptAsync() is ASYNC (not sync like upstream's getCoreSystemPrompt)
- GeminiChat.setSystemInstruction(sysInstr: string) exists at geminiChat.ts:609
- GeminiClient.isInitialized() checks chat + contentGenerator
- System instruction composition in startChat(): getEnvironmentContext → getCoreSystemPromptAsync → prepend env → estimate tokens → set base offset
- memoryCommand.ts refresh calls loadHierarchicalLlxprtMemory then config.setUserMemory()
- Multi-provider: GeminiProvider builds fresh system instruction per-call (auto-updates after config.setUserMemory), only GeminiChat path needs explicit updateSystemInstruction
- Follow TDD

BRANDING: @vybestack/llxprt-code-core, Vybestack LLC, LLXPRT.md (not GEMINI.md). No emoji.

AFTER: git add -A. FULL verify: all 6 steps.
~~~

**Reviewer Prompt:**
~~~
Review Batch 8 of gmerge v0.17.1→v0.18.4. REIMPLEMENT of 1d2e27a6 (memory reload system instruction).

MECHANICAL (full):
1. npm run lint
2. npm run typecheck
3. npm run test
4. npm run format
5. npm run build
6. node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
7. Branding grep

QUALITATIVE for 1d2e27a6:
1. CODE LANDED: GeminiClient has updateSystemInstruction() method (async) that recomposes system instruction
2. BEHAVIORAL: After /memory refresh, the system instruction includes updated LLXPRT.md content
3. INTEGRATION: memoryCommand.ts refresh action calls updateSystemInstruction after setUserMemory
4. COMPOSITION: updateSystemInstruction replicates startChat's composition — getEnvironmentContext + getCoreSystemPromptAsync + token estimation + setBaseTokenOffset
5. MULTI-PROVIDER: GeminiProvider path NOT modified (it already rebuilds per-call)
6. TESTS: Tests verify updateSystemInstruction updates GeminiChat's system instruction and token offset

Report PASS/FAIL per check.
~~~

---

### Batch 9 — PICK × 2

**Commits:**
1. `6c126b9e` — Ensure that the zed integration is classified as interactive
2. `4adfdad4` — Copy commands as part of setup-github

**Command:**
~~~bash
git cherry-pick 6c126b9e 4adfdad4
~~~

**Verify:** Quick
**Commit message:** `cherry-pick: upstream v0.17.1..v0.18.4 batch 9`

**Cherrypicker Prompt:**
~~~
Execute Batch 9 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. Cherry-pick 2 commits:
  git cherry-pick 6c126b9e 4adfdad4

COMMITS:
1. 6c126b9e — Ensure zed integration classified as interactive (config.ts — single line change)
2. 4adfdad4 — Copy commands as part of setup-github (setupGithubCommand.ts + test)

CONFLICT RESOLUTION: Low risk. config.ts change is small. setupGithubCommand is isolated.

BRANDING: same substitutions as all batches (see PLAN.md "Branding Substitutions").

AFTER: git add -A. Quick verify: npm run lint && npm run typecheck.
~~~

**Reviewer Prompt:**
~~~
Review Batch 9 of gmerge v0.17.1→v0.18.4.

MECHANICAL (quick):
1. npm run lint
2. npm run typecheck
3. Branding grep

QUALITATIVE (per-commit, verify code actually landed):
1. 6c126b9e:
   - CODE LANDED: config.ts has a change that marks zed integration as interactive (not just a comment)
   - BEHAVIORAL: When running via zed, the session is treated as interactive (affects tool availability, UI behavior)
   - INTEGRATION: The flag is read downstream where interactive vs non-interactive matters
2. 4adfdad4:
   - CODE LANDED: setupGithubCommand.ts copies commands as part of the setup flow (real logic, not a stub)
   - BEHAVIORAL: Running /setup-github now includes command copying step
   - INTEGRATION: The copied commands are functional (check test assertions)

Report PASS/FAIL per check with file:line evidence.
~~~

---

### Batch 10 — PICK × 1 SOLO: stdout/stderr protection — HIGH RISK

**Upstream:** `d1e35f86` — Protect stdout and stderr (82 files, 1487+/843-)
**This is the largest commit in the sync.** It monkey-patches process.stdout/stderr to prevent stray writes from corrupting Ink. Touches cli, core, a2a-server, many tests.

**Command:**
~~~bash
git cherry-pick d1e35f86
~~~

**Post-pick:** Run `npm install` to regenerate package-lock.json.
**Verify:** Full
**Commit message:** `cherry-pick: stdout/stderr protection (upstream d1e35f86)`

**Cherrypicker Prompt:**
~~~
Execute Batch 10 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. Cherry-pick SOLO HIGH RISK commit:
  git cherry-pick d1e35f86

This is the LARGEST commit: 82 files, 1487+/843-. Three-layer stdout/stderr protection:
1. patchStdio() — monkey-patches process.stdout.write/process.stderr.write to emit events
2. writeToStdout/writeToStderr — preserve original write methods for legitimate output (Ink)
3. initializeOutputListenersAndFlush — drains buffered events into console message system

CONFLICT NOTES (expect MANY conflicts):
- a2a-server/src/agent/task.ts: 1-line removal — resolve trivially
- package-lock.json: WILL conflict — delete it and regenerate with `npm install`
- packages/cli/src/gemini.tsx: CRITICAL — LLxprt's gemini.tsx is heavily modified. Take the patchStdio/writeToStdout/writeToStderr/initializeOutputListenersAndFlush additions. Keep LLxprt's existing structure, multi-provider setup, and startup flow.
- packages/cli/src/config/config.ts: Take changes, keep LLxprt's config structure
- packages/cli/src/ui/AppContainer.tsx: Take stdout protection changes, keep LLxprt's component structure
- packages/cli/src/ui/utils/ConsolePatcher.ts: Take coreEvents.emitConsoleLog integration
- Test files with @google/gemini-cli-core imports: fix ALL to @vybestack/llxprt-code-core

BRANDING: This commit touches 82 files. Apply ALL branding substitutions to EVERY file:
- @google/gemini-cli-core → @vybestack/llxprt-code-core
- @google/gemini-cli → @vybestack/llxprt-code
- gemini-cli → llxprt-code, Gemini CLI → LLxprt Code
- GEMINI.md → LLXPRT.md, USE_GEMINI → USE_PROVIDER
- Google LLC → Vybestack LLC. No emoji.

AFTER: git add -A. npm install. FULL verify: npm run lint && npm run typecheck && npm run test && npm run format && npm run build && node scripts/start.js --profile-load synthetic --prompt "write me a haiku". Fix all failures.
~~~

**Reviewer Prompt:**
~~~
Review Batch 10 of gmerge v0.17.1→v0.18.4. SOLO cherry-pick of d1e35f86 (stdout/stderr protection, 82 files).

MECHANICAL (full):
1. npm run lint
2. npm run typecheck
3. npm run test
4. npm run format
5. npm run build
6. node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
7. CRITICAL branding check (82 files touched — many may have Google imports):
   grep -rn "@google/gemini-cli" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | head -30
   grep -rn "USE_GEMINI" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | head -10
   Both MUST return ZERO matches.

QUALITATIVE for d1e35f86:
1. CODE LANDED: patchStdio() function exists and patches process.stdout.write/process.stderr.write
2. CODE LANDED: writeToStdout/writeToStderr preserve original write methods
3. CODE LANDED: initializeOutputListenersAndFlush drains buffered output
4. CODE LANDED: ConsolePatcher.ts routes through coreEvents.emitConsoleLog
5. BEHAVIORAL: Stray process.stdout.write calls get captured (not sent to terminal)
6. BEHAVIORAL: Ink rendering still works (uses real write methods via proxy)
7. INTEGRATION: gemini.tsx calls patchStdio early in startup, passes real write methods to Ink
8. COMPATIBILITY: LLxprt's DebugLogger chain (debug lib → console.log → ConsolePatcher) still works
9. TEST EXISTS: stdio.test.ts tests exist

Report PASS/FAIL per check with specific file:line evidence.
~~~

---

### Batch 11 — PICK × 4

**Commits:**
1. `ade9dfee` — Enable switching preview features on/off without restart
2. `c7b5dcd2` — Change default compress threshold to 0.5
3. `d15970e1` — remove duplicated mouse code
4. `83d0bdc3` — Use default model routing for Zed integration

**Command:**
~~~bash
git cherry-pick ade9dfee c7b5dcd2 d15970e1 83d0bdc3
~~~

**Verify:** Quick
**Commit message:** `cherry-pick: upstream v0.17.1..v0.18.4 batch 11`

**Cherrypicker Prompt:**
~~~
Execute Batch 11 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. Cherry-pick 4 commits:
  git cherry-pick ade9dfee c7b5dcd2 d15970e1 83d0bdc3

COMMITS:
1. ade9dfee — Enable switching preview features on/off without restart (settingsSchema, SettingsDialog, DialogManager)
2. c7b5dcd2 — Change default compress threshold to 0.5 for API key users (settingsSchema, chatCompressionService)
3. d15970e1 — Remove duplicated mouse code (kittyProtocolDetector.ts)
4. 83d0bdc3 — Use default model routing for Zed integration (zedIntegration.ts)

CONFLICT RESOLUTION:
- Medium risk. settingsSchema.ts touched by 2 commits (ade9dfee + c7b5dcd2) and by earlier batches.
- kittyProtocolDetector.ts was modified in Batch 6 (REIMPLEMENT 9ebf3217) — resolve carefully, KEEP Batch 6 changes (fs.writeSync, try/catch), take upstream's mouse code dedup.

BRANDING: same substitutions as all batches.

AFTER: git add -A. Quick verify: npm run lint && npm run typecheck.
~~~

**Reviewer Prompt:**
~~~
Review Batch 11 of gmerge v0.17.1→v0.18.4.

MECHANICAL (quick):
1. npm run lint
2. npm run typecheck
3. Branding grep

QUALITATIVE:
1. ade9dfee: Preview features can be toggled without restart (SettingsDialog has toggle, takes effect immediately)
2. c7b5dcd2: Default compress threshold is 0.5 for API key users (check settingsSchema + chatCompressionService)
3. d15970e1: Duplicated mouse code removed from kittyProtocolDetector.ts (no regression from Batch 6 fs.writeSync changes)
4. 83d0bdc3: Zed integration uses default model routing

Report PASS/FAIL per check.
~~~

---

### Batch 12 — REIMPLEMENT × 1: Alternate buffer default

**Upstream:** `316349ca` — fix(patch): useAlternateBuffer default change
**Playbook:** `project-plans/gmerge-0.18.4/316349ca-plan.md`

**Verify:** Full
**Commit message:** `reimplement: alternate buffer default to false (upstream 316349ca)`

**Cherrypicker Prompt:**
~~~
Execute Batch 12 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. REIMPLEMENT upstream 316349ca.

Read and execute playbook: project-plans/gmerge-0.18.4/316349ca-plan.md

KEY CONTEXT:
- LLxprt has NO useAlternateBuffer.ts hook — alternate buffer is inline in AppContainer.tsx (line 764+) and inkRenderOptions.ts
- Change the default from true to false (=== true check pattern)
- Update settingsSchema.ts and settings.schema.json to match
- Update test helpers
- Follow TDD

BRANDING: standard LLxprt branding. No emoji.

AFTER: git add -A. FULL verify: all 6 steps.
~~~

**Reviewer Prompt:**
~~~
Review Batch 12 of gmerge v0.17.1→v0.18.4. REIMPLEMENT of 316349ca (alternate buffer default).

MECHANICAL (full):
1. npm run lint
2. npm run typecheck
3. npm run test
4. npm run format
5. npm run build
6. node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
7. Branding grep

QUALITATIVE for 316349ca:
1. CODE LANDED: Alternate buffer setting defaults to false (check settingsSchema.ts, settings.schema.json)
2. BEHAVIORAL: When useAlternateScreen is unset/undefined, alternate buffer is NOT used (=== true check)
3. INTEGRATION: AppContainer.tsx or inkRenderOptions.ts has the === true guard
4. TEST: Test helper reflects new default

Report PASS/FAIL per check.
~~~

---

### Batch 13 — REIMPLEMENT × 1: Loading indicator + inactivity timer

**Upstream:** `843b019c` — fix(patch): loading indicator, phrase cycler, inactivity timer
**Playbook:** `project-plans/gmerge-0.18.4/843b019c-plan.md`

LLxprt's usePhraseCycler/useLoadingIndicator have diverged (WittyPhraseStyle, phrasesCollections). Upstream adds useInactivityTimer + shell focus hints. Take the new hooks, keep LLxprt's phrase style system.

**Verify:** Quick
**Commit message:** `reimplement: loading indicator + inactivity timer (upstream 843b019c)`

**Cherrypicker Prompt:**
~~~
Execute Batch 13 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. REIMPLEMENT upstream 843b019c.

Read and execute playbook: project-plans/gmerge-0.18.4/843b019c-plan.md

KEY CONTEXT:
- LLxprt has WittyPhraseStyle system + phrasesCollections.js (upstream does NOT have this)
- Upstream adds useInactivityTimer, isInteractiveShellWaiting, lastOutputTime concepts
- LLxprt already has useLoadingIndicator.ts and usePhraseCycler.ts with different structure
- Take the useInactivityTimer concept, integrate with LLxprt's WittyPhraseStyle system
- DO NOT replace LLxprt's phrase collections system
- Follow TDD

BRANDING: standard LLxprt branding. No emoji.

AFTER: git add -A. Quick verify: npm run lint && npm run typecheck.
~~~

**Reviewer Prompt:**
~~~
Review Batch 13 of gmerge v0.17.1→v0.18.4. REIMPLEMENT of 843b019c (loading indicator + inactivity timer).

MECHANICAL (quick):
1. npm run lint
2. npm run typecheck
3. Branding grep

QUALITATIVE for 843b019c:
1. CODE LANDED: useInactivityTimer hook exists or equivalent functionality in existing hooks
2. BEHAVIORAL: Loading indicator changes behavior based on inactivity (shows different phrases/indicators)
3. PRESERVATION: WittyPhraseStyle system and phrasesCollections.js are PRESERVED (not replaced)
4. PRESERVATION: usePhraseCycler and useLoadingIndicator still work with LLxprt's phrase system
5. INTEGRATION: Shell focus hints work (if applicable to LLxprt's shell integration)
6. TESTS: Tests cover inactivity timer behavior

Report PASS/FAIL per check.
~~~

---

### Batch 14 — REIMPLEMENT × 1: useBanner hook extraction

**Upstream:** `ea3d022c` — fix(patch): AppHeader, useBanner, persistentState
**Playbook:** `project-plans/gmerge-0.18.4/ea3d022c-plan.md`

**Verify:** Full
**Commit message:** `reimplement: extract useBanner hook + persistentState (upstream ea3d022c)`

**Cherrypicker Prompt:**
~~~
Execute Batch 14 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. REIMPLEMENT upstream ea3d022c.

Read and execute playbook: project-plans/gmerge-0.18.4/ea3d022c-plan.md

KEY CONTEXT:
- LLxprt has NO AppHeader.tsx — banner logic is inline in DefaultAppLayout.tsx
- persistentState.ts is self-contained and useful — create it as new file
- useBanner.ts hook extracts banner show/dismiss logic from inline code
- Config/settings are PROPS passed to DefaultAppLayout (no useConfig context)
- Use DebugLogger.getLogger() pattern for logging (not new DebugLogger())
- No getPreviewFeatures() function — use config.settings.previewFeatures directly
- Banner renders with basic Text component (no gradient)
- Follow TDD

BRANDING: @vybestack/llxprt-code-core, Vybestack LLC copyright. No emoji.

AFTER: git add -A. FULL verify: all 6 steps.
~~~

**Reviewer Prompt:**
~~~
Review Batch 14 of gmerge v0.17.1→v0.18.4. REIMPLEMENT of ea3d022c (useBanner + persistentState).

MECHANICAL (full):
1. npm run lint
2. npm run typecheck
3. npm run test
4. npm run format
5. npm run build
6. node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
7. Branding grep

QUALITATIVE for ea3d022c:
1. CODE LANDED: persistentState.ts created with state persistence utility
2. CODE LANDED: useBanner.ts hook exists with banner show/dismiss logic
3. BEHAVIORAL: Banner shows once, can be dismissed, stays dismissed across sessions (via persistentState)
4. INTEGRATION: DefaultAppLayout.tsx uses useBanner hook instead of inline logic
5. ARCHITECTURE: Config/settings passed as PROPS (not via useConfig context)
6. PATTERN: Uses DebugLogger.getLogger() (not new DebugLogger())
7. TESTS: Tests for persistentState and useBanner

Report PASS/FAIL per check.
~~~

---

### Batch 15 — REIMPLEMENT × 1: Extensions exitCli — HIGH PRIORITY

**Upstream:** `013f9848` — fix(patch): extensions commands refactor (30 files)
**Playbook:** `project-plans/gmerge-0.18.4/013f9848-plan.md`
**Depends on:** Batch 10 (d1e35f86 — stdout protection must be applied first for output middleware)

**Verify:** Quick
**Commit message:** `reimplement: extensions exitCli + output middleware (upstream 013f9848)`

**Cherrypicker Prompt:**
~~~
Execute Batch 15 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. REIMPLEMENT upstream 013f9848.

Read and execute playbook: project-plans/gmerge-0.18.4/013f9848-plan.md

KEY CONTEXT:
- HARD DEPENDENCY on Batch 10 (d1e35f86): initializeOutputListenersAndFlush must exist. If Batch 10 hasn't landed, skip Phase 2 (output middleware) and add TODO comment. Continue with other phases.
- Create exitCli() utility in packages/cli/src/commands/utils.ts with try/finally pattern:
  try { await runExitCleanup() } finally { process.exit(exitCode) }
- Replace 8 process.exit(1) calls in extension commands + 1 in mcp/add.ts
- MANDATORY: Remove config.ts early-exit block (lines 596-610) that force-exits for mcp/extensions subcommands
- SCOPE: Only extension and MCP command process.exit calls. DO NOT change process.exit in nonInteractiveCli.ts, validateNonInterActiveAuth.ts, errors.ts, useFolderTrust.ts, gemini.tsx.
- Follow TDD

BRANDING: standard LLxprt branding. No emoji.

AFTER: git add -A. Quick verify: npm run lint && npm run typecheck.
~~~

**Reviewer Prompt:**
~~~
Review Batch 15 of gmerge v0.17.1→v0.18.4. REIMPLEMENT of 013f9848 (extensions exitCli lifecycle).

MECHANICAL (quick):
1. npm run lint
2. npm run typecheck
3. Branding grep

QUALITATIVE for 013f9848:
1. CODE LANDED: exitCli() exists in packages/cli/src/commands/utils.ts with try/finally pattern
2. CODE LANDED: All 8 extension command process.exit(1) calls replaced with exitCli(1)
3. CODE LANDED: mcp/add.ts process.exit replaced with exitCli
4. CONFIG: Early-exit block REMOVED from config.ts (lines 596-610 no longer have process.exit for mcp/extensions)
5. SAFETY: exitCli uses try { await runExitCleanup() } finally { process.exit(exitCode) }
6. SCOPE: process.exit calls in nonInteractiveCli.ts, validateNonInterActiveAuth.ts, errors.ts, useFolderTrust.ts, gemini.tsx are UNCHANGED
7. DEPENDENCY: If Batch 10 landed, initializeOutputListenersAndFlush middleware added. If not, TODO comment exists.
8. TESTS: Tests verify exitCli calls runExitCleanup and process.exit

Report PASS/FAIL per check.
~~~

---

### Batch 16 — PICK × 1: MCP dependency bump

**Upstream:** `4b19a833` — fix(patch): dependency bump, mcp-client

**Command:**
~~~bash
git cherry-pick 4b19a833
~~~

**Post-pick:** Run `npm install` to regenerate package-lock.json.
**Verify:** Full
**Commit message:** `cherry-pick: MCP dependency bump (upstream 4b19a833)`

**Cherrypicker Prompt:**
~~~
Execute Batch 16 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. Cherry-pick 1 commit:
  git cherry-pick 4b19a833

COMMIT: 4b19a833 — MCP dependency bump (package.json versions, mcp-client.test.ts, vscode companion NOTICES.txt)

IMPORTANT: After cherry-pick, run `npm install` to regenerate package-lock.json.

CONFLICT RESOLUTION:
- Medium risk. package-lock.json WILL conflict — delete and regenerate with npm install.
- package.json version changes may conflict with earlier bumps (Batch 4 genai, Batch 10 stdio) — keep ALL previous bumps and add this one.

BRANDING: same substitutions as all batches.

AFTER: git add -A. npm install. FULL verify: all 6 steps.
~~~

**Reviewer Prompt:**
~~~
Review Batch 16 of gmerge v0.17.1→v0.18.4.

MECHANICAL (full):
1. npm run lint
2. npm run typecheck
3. npm run test
4. npm run format
5. npm run build
6. node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
7. Branding grep

QUALITATIVE:
1. 4b19a833: package.json files have updated MCP dependency versions
2. package-lock.json properly regenerated
3. mcp-client.test.ts reflects any API changes from the version bump

Report PASS/FAIL per check.
~~~

---

### Batch 17 — REIMPLEMENT × 1: stdio → core + terminal utils

**Upstream:** `2e8d7831` — fix(patch): cli/auth/stdio/terminal
**Playbook:** `project-plans/gmerge-0.18.4/2e8d7831-plan.md`
**Depends on:** Batch 10 (d1e35f86 — stdio.ts must exist in cli first)

**Verify:** Quick
**Commit message:** `reimplement: move stdio to core + terminal utils (upstream 2e8d7831)`

**Cherrypicker Prompt:**
~~~
Execute Batch 17 of gmerge v0.17.1→v0.18.4 on branch gmerge/0.18.4. REIMPLEMENT upstream 2e8d7831.

Read and execute playbook: project-plans/gmerge-0.18.4/2e8d7831-plan.md

KEY CONTEXT:
- DEPENDS ON Batch 10 (d1e35f86): stdio.ts must exist in packages/cli/src/utils/ first
- Move stdio.ts from packages/cli/ to packages/core/src/utils/ (update ALL imports across both packages)
- Create new packages/core/src/utils/terminal.ts utility
- Auth dialog changes: LLxprt's AuthDialog is at packages/cli/src/ui/components/AuthDialog.tsx (different path, completely different multi-provider architecture) — DO NOT apply upstream's auth changes
- Take: stdio→core move, terminal.ts, useBracketedPaste improvements, mouse utils improvements
- Skip: AuthDialog changes, oauth2 changes (Google-specific)
- Follow TDD

BRANDING: @vybestack/llxprt-code-core, Vybestack LLC copyright. No emoji.

AFTER: git add -A. Quick verify: npm run lint && npm run typecheck.
~~~

**Reviewer Prompt:**
~~~
Review Batch 17 of gmerge v0.17.1→v0.18.4. REIMPLEMENT of 2e8d7831 (stdio→core + terminal utils).

MECHANICAL (quick):
1. npm run lint
2. npm run typecheck
3. Branding grep

QUALITATIVE for 2e8d7831:
1. CODE LANDED: packages/core/src/utils/stdio.ts exists (moved from cli)
2. CODE LANDED: packages/core/src/utils/terminal.ts exists with terminal utility functions
3. CODE LANDED: All imports of stdio updated from cli path to core path
4. BEHAVIORAL: stdio functions work the same from core as they did from cli
5. INTEGRATION: packages/core/src/index.ts exports the new stdio/terminal utilities
6. SKIPPED: Auth dialog changes NOT applied (LLxprt's multi-provider AuthDialog unchanged)
7. SKIPPED: oauth2 changes NOT applied (Google-specific)
8. TESTS: Terminal utility tests exist

Report PASS/FAIL per check.
~~~

---

## Verification Cadence Summary

| Batch | Type | Quick | Full |
| ----: | ---- | :---: | :--: |
| 1 | PICK x7 | X | |
| 2 | REIMPLEMENT | | X |
| 3 | PICK x5 | X | |
| 4 | PICK x6 | | X |
| 5 | REIMPLEMENT | X | |
| 6 | REIMPLEMENT | | X |
| 7 | REIMPLEMENT | X | |
| 8 | REIMPLEMENT | | X |
| 9 | PICK x2 | X | |
| 10 | PICK SOLO | | X |
| 11 | PICK x4 | X | |
| 12 | REIMPLEMENT | | X |
| 13 | REIMPLEMENT | X | |
| 14 | REIMPLEMENT | | X |
| 15 | REIMPLEMENT | X | |
| 16 | PICK x1 | | X |
| 17 | REIMPLEMENT | X | |

---

## Failure Recovery

### Cherry-pick conflicts
```bash
# Abort and retry from scratch
git cherry-pick --abort

# Or resolve conflicts and continue
git add -A
git cherry-pick --continue
```

### When to create follow-up fix commits
- If lint/typecheck fails after a batch, fix and commit: `fix: post-batch NN verification`
- If tests fail, fix and commit before proceeding
- If `npm run format` changes files during full verify, commit: `style: format after batch NN`

### Review-remediate loop (max 5 iterations)
1. Review finds issues → remediate with cherrypicker
2. Re-review → still failing? → remediate again
3. After 5 failed iterations → `todo_pause("Batch NN failed review 5 times")`
4. Wait for human intervention

---

## Note-Taking Requirement

After each batch:
1. Update `PROGRESS.md` with status and LLxprt commit hash
2. Append to `NOTES.md` with conflicts, deviations, decisions
3. Update `AUDIT.md` with per-commit outcomes

---

## Todo List Management

Call `todo_write()` with this exact structure:

```json
{
  "todos": [
    { "id": "B1-exec", "content": "Batch 1 EXECUTE: cherry-pick fd9d3e19 b916d79f 10003a64 90c764ce c5498bbb e8d0e0d3 1e8ae5b9 (PICK×7: CONTRIBUTING, keyboard, zed, modifyOtherKeys, pty, showLineNumbers, NO_COLOR)", "status": "pending" },
    { "id": "B1-review", "content": "Batch 1 REVIEW: quick verify (lint+typecheck), branding check, qualitative check", "status": "pending" },
    { "id": "B1-commit", "content": "Batch 1 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B2-exec", "content": "Batch 2 EXECUTE: REIMPLEMENT b644f037 — Escape clears input when idle. See b644f037-plan.md", "status": "pending" },
    { "id": "B2-review", "content": "Batch 2 REVIEW: FULL verify (lint+typecheck+test+format+build+haiku)", "status": "pending" },
    { "id": "B2-commit", "content": "Batch 2 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B3-exec", "content": "Batch 3 EXECUTE: cherry-pick 61f0f3c2 5c475921 0d89ac74 e1c711f5 300205b0 (PICK×5: MCP spaces, transport, sessions, chat recording, zed cancel)", "status": "pending" },
    { "id": "B3-review", "content": "Batch 3 REVIEW: quick verify (lint+typecheck)", "status": "pending" },
    { "id": "B3-commit", "content": "Batch 3 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B4-exec", "content": "Batch 4 EXECUTE: cherry-pick 84573992 25f84521 f8a86273 0f845407 e4c4bb26 d0a845b6 (PICK×6: keyboard restore, genai 1.30, header color, todos typo, thinking mode, remove log). Run npm install after.", "status": "pending" },
    { "id": "B4-review", "content": "Batch 4 REVIEW: FULL verify", "status": "pending" },
    { "id": "B4-commit", "content": "Batch 4 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B5-exec", "content": "Batch 5 EXECUTE: REIMPLEMENT 2231497b — click-to-focus + ToolMessage refactor. See 2231497b-plan.md", "status": "pending" },
    { "id": "B5-review", "content": "Batch 5 REVIEW: quick verify", "status": "pending" },
    { "id": "B5-commit", "content": "Batch 5 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B6-exec", "content": "Batch 6 EXECUTE: REIMPLEMENT 9ebf3217 — synchronous keyboard writes. See 9ebf3217-plan.md", "status": "pending" },
    { "id": "B6-review", "content": "Batch 6 REVIEW: FULL verify", "status": "pending" },
    { "id": "B6-commit", "content": "Batch 6 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B7-exec", "content": "Batch 7 EXECUTE: REIMPLEMENT b1258dd5 — context overflow race condition fix. See b1258dd5-plan.md", "status": "pending" },
    { "id": "B7-review", "content": "Batch 7 REVIEW: quick verify", "status": "pending" },
    { "id": "B7-commit", "content": "Batch 7 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B8-exec", "content": "Batch 8 EXECUTE: REIMPLEMENT 1d2e27a6 — update system instruction on LLXPRT.md reload. See 1d2e27a6-plan.md", "status": "pending" },
    { "id": "B8-review", "content": "Batch 8 REVIEW: FULL verify", "status": "pending" },
    { "id": "B8-commit", "content": "Batch 8 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B9-exec", "content": "Batch 9 EXECUTE: cherry-pick 6c126b9e 4adfdad4 (PICK x2: zed interactive, setup-github)", "status": "pending" },
    { "id": "B9-review", "content": "Batch 9 REVIEW: quick verify", "status": "pending" },
    { "id": "B9-commit", "content": "Batch 9 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B10-exec", "content": "Batch 10 EXECUTE: cherry-pick d1e35f86 SOLO — stdout/stderr protection (82 files, HIGH RISK). Resolve conflicts carefully.", "status": "pending" },
    { "id": "B10-review", "content": "Batch 10 REVIEW: FULL verify", "status": "pending" },
    { "id": "B10-commit", "content": "Batch 10 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B11-exec", "content": "Batch 11 EXECUTE: cherry-pick ade9dfee c7b5dcd2 d15970e1 83d0bdc3 (PICK x4: preview features, compress threshold, mouse dedup, zed routing)", "status": "pending" },
    { "id": "B11-review", "content": "Batch 11 REVIEW: quick verify", "status": "pending" },
    { "id": "B11-commit", "content": "Batch 11 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B12-exec", "content": "Batch 12 EXECUTE: REIMPLEMENT 316349ca — alternate buffer default to false. See 316349ca-plan.md", "status": "pending" },
    { "id": "B12-review", "content": "Batch 12 REVIEW: FULL verify", "status": "pending" },
    { "id": "B12-commit", "content": "Batch 12 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B13-exec", "content": "Batch 13 EXECUTE: REIMPLEMENT 843b019c — loading indicator + inactivity timer. See 843b019c-plan.md", "status": "pending" },
    { "id": "B13-review", "content": "Batch 13 REVIEW: quick verify", "status": "pending" },
    { "id": "B13-commit", "content": "Batch 13 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B14-exec", "content": "Batch 14 EXECUTE: REIMPLEMENT ea3d022c — extract useBanner hook + persistentState. See ea3d022c-plan.md", "status": "pending" },
    { "id": "B14-review", "content": "Batch 14 REVIEW: FULL verify", "status": "pending" },
    { "id": "B14-commit", "content": "Batch 14 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B15-exec", "content": "Batch 15 EXECUTE: REIMPLEMENT 013f9848 — extensions exitCli + output middleware. See 013f9848-plan.md. HIGH PRIORITY.", "status": "pending" },
    { "id": "B15-review", "content": "Batch 15 REVIEW: quick verify", "status": "pending" },
    { "id": "B15-commit", "content": "Batch 15 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B16-exec", "content": "Batch 16 EXECUTE: cherry-pick 4b19a833 (PICK x1: MCP dependency bump). Run npm install after.", "status": "pending" },
    { "id": "B16-review", "content": "Batch 16 REVIEW: FULL verify", "status": "pending" },
    { "id": "B16-commit", "content": "Batch 16 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "B17-exec", "content": "Batch 17 EXECUTE: REIMPLEMENT 2e8d7831 — move stdio to core + terminal utils. See 2e8d7831-plan.md", "status": "pending" },
    { "id": "B17-review", "content": "Batch 17 REVIEW: quick verify", "status": "pending" },
    { "id": "B17-commit", "content": "Batch 17 COMMIT: git add -A && git commit", "status": "pending" },
    { "id": "FINAL-progress", "content": "UPDATE PROGRESS.md with all commit hashes", "status": "pending" },
    { "id": "FINAL-notes", "content": "UPDATE NOTES.md with all conflicts/deviations", "status": "pending" },
    { "id": "FINAL-audit", "content": "UPDATE AUDIT.md with all outcomes", "status": "pending" }
  ]
}
```

---

## Coordinator Execution Rules

1. **Create todo list FIRST** using the exact `todo_write` call from above
2. **Execute sequentially** — do not skip steps, do not reorder
3. **Mark status as you go** — `in_progress` when starting, `completed` when done
4. **Review is MANDATORY** — never skip the review step
5. **Commit after review passes** — tracked as separate todo item
6. **Remediate on failure** — loop up to 5 times, then escalate
7. **DO NOT pause for progress reports** — continue until todo list empty or blocked
8. **DO NOT ask what to do next** — the todo list tells you
9. **Context wipe recovery** — read PLAN.md and todo list to resume
10. **Use subagents via task() tool** — do not do cherry-picks or reviews yourself

---

## Context Recovery

If you've lost context and need to resume:

1. **Branch:** `gmerge/0.18.4`
2. **Range:** upstream gemini-cli v0.17.1 → v0.18.4 (64 commits)
3. **Decisions:** 26 PICK, 28 SKIP, 10 REIMPLEMENT (17 batches)
4. **Key files:**
   - `project-plans/gmerge-0.18.4/CHERRIES.md` — all decisions
   - `project-plans/gmerge-0.18.4/PLAN.md` — this file (batch schedule)
   - `project-plans/gmerge-0.18.4/PROGRESS.md` — batch completion status
   - `project-plans/gmerge-0.18.4/NOTES.md` — running notes
   - `project-plans/gmerge-0.18.4/AUDIT.md` — per-commit reconciliation
5. **Check state:** `git status`, `git log --oneline -10`, `todo_read()`
6. **Resume:** Find first pending todo item, execute it
