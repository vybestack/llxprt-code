# Cherry-Pick Decisions: v0.15.4 to v0.16.0

**Upstream range**: `v0.15.4..v0.16.0`
**Total commits**: 50
**Branch**: `20260129gmerge`

## Summary Counts

| Decision | Count |
|----------|-------|
| PICK | 14 |
| SKIP | 29 |
| REIMPLEMENT | 7 |

---

## Research Findings

### 7ec78452e - Enable write_todo tool (SKIP)
**Finding**: Upstream's todo tool is completely different from LLxprt's todo system (todo_write, todo_read, todo_pause). **Not applicable.**

### 4d85ce40b - console.clear() buffer fix (PICK)
**Finding**: Fix adds `if (!isAlternateBuffer) { console.clear(); }` guard. **LLxprt should apply this fix.**

### 0075b4f11 - Show tool internal name in /tools (PICK)
**Finding**: Simple change to always show `{tool.displayName} ({tool.name})`. **Can pick directly.**

### 43916b98a - Don't clear buffers on cleanup (PICK)
**Finding**: Removes problematic flush logic in KeypressContext cleanup. **Evaluate if same cleanup exists in LLxprt.**

### 48e3932f6 - Auth type in history checkpoint (SKIP)
**Finding**: Gemini-specific auth types (LOGIN_WITH_GOOGLE, USE_GEMINI). **Not useful for multi-provider.**

### 0f9ec2735 - useAlternateBuffer default (SKIP)
**Finding**: LLxprt already has `default: true`. **Already applied.**

### 1ed163a66 - Safety Checker Framework (SKIP)
**Finding**: After deep research:
- Only protects file tools, not shell commands
- Shell commands bypass it entirely (`run_shell_command` not parsed for paths)
- Later commits (post v0.16.0) add shell parsing, but it's still whack-a-mole
- Sandbox provides real isolation; this is security theater
- 2600+ lines of code for marginal protection
- Git commands not protected by default (user must configure)
- AI can be prompt-injected to bypass patterns

**Decision**: SKIP permanently. Focus on sandbox (#1036) for real security.

### 3cb670fe3 - Selection Warning (SKIP)
**Finding**: Shows "Press Ctrl-S to enter selection mode" when user tries to drag-select. LLxprt already has `/mouse off` command for this. Different UX approach, not needed.

### cc608b9a9 - flagId Experiment (SKIP)
**Finding**: Changes experiment flag keys from strings to numeric IDs. Google A/B testing infrastructure. **Not applicable.**

### Sticky Headers (ee7065f66, d30421630, fb99b9537) (REIMPLEMENT)
**Finding**: Creates sticky tool headers using Ink's `sticky` prop. User wants this feature.
- Creates `StickyHeader.tsx` component
- Modifies `ToolMessage.tsx`, `ToolGroupMessage.tsx`, `ToolConfirmationMessage.tsx`
- Three commits work together

### ASCII Art (fe1bfc64f, 102905bbc) (SKIP)
**Finding**: IDE-specific upside-down logos. LLxprt has its own branding.

### UI Animation/Scroll (6f34e2589, 3cbb170aa, 60fe5acd6)
- **6f34e2589** (mouse button): SKIP - tied to selection warning we're skipping
- **3cbb170aa** (ThemedGradient): Check if already covered from v0.15.4
- **60fe5acd6** (animated scroll): REIMPLEMENT - keyboard scroll commands

### 1c8fe92d0 - Hook Result Aggregation (PICK)
**Finding**: New `hookAggregator.ts` file. Complements existing `hookRunner.ts`.

---

## PICK Table (14 commits)

| # | Upstream SHA | Date | Areas | Subject |
|---|-------------|------|-------|---------|
| 1 | e8038c727 | 2025-11-11 | core | fix test to use faketimer (#12913) |
| 2 | d3cf28eb4 | 2025-11-11 | cli, core | Use PascalCase for all tool display names (#12918) |
| 3 | cab9b1f37 | 2025-11-11 | cli | Fix extensions disable/enable commands not awaiting handler (#12915) |
| 4 | 1c8fe92d0 | 2025-11-11 | core | feat(hooks): Hook Result Aggregation (#9095) |
| 5 | 1c87e7cd2 | 2025-11-12 | core | feat(core): enhance RipGrep tool with advanced search options (#12677) |
| 6 | 1ffb9c418 | 2025-11-12 | cli | fix(FileCommandLoader): Remove error logs if aborted (#12927) |
| 7 | 540f60696 | 2025-11-12 | docs | fix(docs): Release version for read many files removal (#12949) |
| 8 | 4d85ce40b | 2025-11-12 | cli | Turns out console.clear() clears the buffer. (#12959) |
| 9 | 0075b4f11 | 2025-11-12 | cli | Always show the tool internal name in /tools (#12964) |
| 10 | aa9922bc9 | 2025-11-12 | cli, docs, scripts | feat: autogenerate keyboard shortcut docs (#12944) |
| 11 | ad1f0d995 | 2025-11-12 | core | refactor: move toml-loader.test.ts to use real filesystem (#12969) |
| 12 | a810ca80b | 2025-11-12 | core | Allow users to reset to auto when in fallback mode (#12623) |
| 13 | 43916b98a | 2025-11-12 | cli | Don't clear buffers on cleanup. (#12979) |
| 14 | 13d8d9477 | 2025-11-12 | cli | fix(editor): ensure preferred editor setting updates immediately (#12981) |

---

## SKIP Table (29 commits)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | 11a0a9b91 | 2025-11-11 | core | clearcut-logger telemetry | Increase code coverage for core packages (#12872) |
| 2 | 408b88568 | 2025-11-11 | core, docs | clearcut telemetry | feat(core): enhance loop detection with 2-stage check (#12902) |
| 3 | c961f2740 | 2025-11-11 | all | Version bump | chore(release): bump version |
| 4 | 396b427cc | 2025-11-11 | all | Version bump | chore/release: bump version |
| 5 | 570ccc7da | 2025-11-12 | core | code_assist metadata | feat: Update client metadata |
| 6 | 7ec78452e | 2025-11-12 | cli, core, docs | Different todo system | Enable write_todo tool (#12905) |
| 7 | d26b828ab | 2025-11-12 | core | Gemini-specific | feat(core): update default model config |
| 8 | 2987b473d | 2025-11-12 | core, docs | Gemini-specific | feat(core): set default chat base model configs |
| 9 | a05e0ea3a | 2025-11-12 | all | Version bump | chore/release: bump version |
| 10 | 0f9ec2735 | 2025-11-12 | cli | Already applied | feat(ui) Make useAlternateBuffer default (#12976) |
| 11 | 1ed163a66 | 2025-11-12 | core, cli | Security theater, sandbox is real protection | feat(safety): Introduce safety checker framework (#12504) |
| 12 | fe1bfc64f | 2025-11-12 | cli | ASCII art branding | feat: disengage surface adhesion protocols (#12989) |
| 13 | 102905bbc | 2025-11-13 | cli | ASCII art normalization | feat: normalize verticality (#12991) |
| 14 | 54c1e1385 | 2025-11-13 | root | Package lock only | chore: update package lock |
| 15 | 5d27a62be | 2025-11-12 | cli, core, docs | LLxprt keeps read-many-files | refactor: remove read-many-files from agent |
| 16 | 48e3932f6 | 2025-11-13 | cli, core | Gemini auth types | feat(core, cli): Add auth type to history checkpoint |
| 17 | eb9ff72b5 | 2025-11-13 | cli, integration-tests | Incremental update experiment | Support incremental update experiment flag |
| 18 | 1c6568925 | 2025-11-13 | all | Preview release | chore(release): v0.16.0-preview.0 |
| 19 | 3cb670fe3 | 2025-11-14 | cli | Selection warning - LLxprt has /mouse off | fix(patch): cherry-pick ba15eeb |
| 20 | ea4cd98e2 | 2025-11-14 | all | Preview release | chore(release): v0.16.0-preview.1 |
| 21 | cc608b9a9 | 2025-11-14 | core | Google A/B testing infra | fix(patch): cherry-pick ce56b4e |
| 22 | 6f34e2589 | 2025-11-14 | cli | Tied to selection warning | fix(patch): mouse button field |
| 23 | dcc2a4993 | 2025-11-14 | all | Preview release | chore(release): v0.16.0-preview.2 |
| 24 | a2b66aead | 2025-11-15 | all | Preview release | chore(release): v0.16.0-preview.3 |
| 25 | 47642b2e3 | 2025-11-15 | cli | Preview patch | fix(patch): cherry-pick d03496b |
| 26 | c9e4e571d | 2025-11-15 | all | Preview release | chore(release): v0.16.0-preview.4 |
| 27 | 670f13cff | 2025-11-17 | all | Preview release | chore(release): v0.16.0-preview.5 |
| 28 | 56f9e597c | 2025-11-18 | cli, docs | Gemini 3 launch branding | feat: launch Gemini 3 in Gemini CLI |
| 29 | aefbe6279 | 2025-11-18 | all | Final release | chore(release): v0.16.0 |

---

## REIMPLEMENT Table (7 commits)

| # | Upstream SHA | Date | Areas | Rationale | Subject |
|---|-------------|------|-------|-----------|---------|
| 1 | ee7065f66 | 2025-11-12 | cli | Sticky headers - user wants | Sticky headers with rounded border (#12971) |
| 2 | fb99b9537 | 2025-11-13 | cli | Header truncation - pairs with sticky | Switch back to truncating headers (#13018) |
| 3 | d30421630 | 2025-11-13 | cli | Polish sticky headers | Polish sticky headers (#13024) |
| 4 | 3cbb170aa | 2025-11-17 | cli | ThemedGradient usage sites | fix(patch): gradient fixes for tmux |
| 5 | 60fe5acd6 | 2025-11-13 | cli, docs | Animated scroll keyboard | feat(ui) animated page up/down (#13012) |
| 6 | 2b8adf8cf | 2025-11-13 | cli | Drag scrollbar | jacob314/drag scrollbar (#12998) |
| 7 | fb0324295 | 2025-11-13 | core | Error handling improvement | Improve MALFORMED_FUNCTION_CALL handling (#12965) |

---

## Files That Need Creation

1. `packages/cli/src/ui/components/StickyHeader.tsx` (and test) - from ee7065f66

---

## High-Risk Items

1. **Sticky headers** (ee7065f66 + d30421630 + fb99b9537) - Three related commits that need to be applied together. Creates new StickyHeader component.

2. **Drag scrollbar** (2b8adf8cf) - LLxprt may already have partial implementation from v0.15.4. Needs careful merge.

---

## Decision Rationale: Safety Checker Framework

**Why we're skipping 1ed163a66 permanently:**

1. **Shell bypass**: The `AllowedPathChecker` only validates file tool paths. `run_shell_command` arguments are not parsed for paths, so `cat /etc/passwd` bypasses it entirely.

2. **Incomplete solution**: The shell command parsing (added post-v0.16.0) is still pattern-matching that an AI can creatively bypass.

3. **Sandbox is the answer**: Container isolation physically prevents access to files outside mounted volumes. No parsing, no bypasses.

4. **Git not protected**: No built-in rules for `git push --force`. Users must manually configure. Server-side branch protection is the real solution.

5. **Maintenance burden**: 2600+ lines of code that provides marginal security benefit.

6. **Security theater**: Creates false sense of security while not preventing determined attacks.

**Focus instead on**: Fixing sandbox (#1036) for real isolation.
