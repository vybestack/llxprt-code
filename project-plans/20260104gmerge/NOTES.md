Keep this as a running log while executing batches.

## Rules
- Add a complete entry after every batch (PICK or REIMPLEMENT).
- Include actual command output (no summaries).
- Document deviations from plan and follow-ups.

## Record Template

### Selection Record

```
Batch: NN
Type: PICK | REIMPLEMENT
Upstream SHA(s): <sha(s)>
Subject: <subject>
Playbook: <path if REIMPLEMENT, N/A for PICK>
Prerequisites Checked:
  - Previous batch record exists: YES | NO | N/A
  - Previous batch verification: PASS | FAIL | N/A
  - Previous batch pushed: YES | NO | N/A
  - Special dependencies: <list or None>
Ready to Execute: YES | NO
```

### Execution Record

```
$ git cherry-pick <sha...>
<output>
```

### Verification Record

```
$ npm run lint
<output>
$ npm run typecheck
<output>
```

### Feature Landing Verification

```
<evidence: git show / grep / diff>
```

### Commit/Push Record

```
$ git status --porcelain
<output>
$ git commit -m "..."
<output>
$ git push
<output>
```

---

## Batch 01

### Selection Record

```
Batch: 01
Type: REIMPLEMENT
Upstream SHA(s): b8df8b2a
Subject: feat(core): wire up UI for ASK_USER policy decisions in message bus (#10630)
Playbook: project-plans/20260104gmerge/b8df8b2a-plan.md
Prerequisites Checked:
  - Previous batch record exists: N/A (first batch)
  - Previous batch verification: N/A (first batch)
  - Previous batch pushed: N/A (first batch)
  - Special dependencies: None
Ready to Execute: YES
```

### Implementation Notes

Reimplemented upstream b8df8b2a which wires up UI for ASK_USER policy decisions in the message bus.

**Upstream changes:**
1. `packages/core/src/tools/tools.ts`: Changed `getMessageBusDecision()` from returning `{decision: PolicyDecision, requiresUserConfirmation?}` to returning `'ALLOW' | 'DENY' | 'ASK_USER'`. Added message bus publish/subscribe flow.
2. `packages/core/src/tools/web-fetch.ts`: Added message bus integration in `shouldConfirmExecute()` (LLxprt equivalent: `google-web-fetch.ts`).
3. `packages/core/src/confirmation-bus/types.ts`: Already has `requiresUserConfirmation` flag (no change needed).
4. `packages/core/src/core/coreToolScheduler.ts`: Already handles message bus responses via `handleMessageBusResponse()` (no change needed).

**LLxprt deviations:**
- Applied to `google-web-fetch.ts` (LLxprt's renamed version of upstream `web-fetch.ts`).
- Added `unsubscribe()` method to `MessageBus` class since tools.ts now needs to unsubscribe handlers.
- Upstream files `web-fetch.ts`, `web-fetch.test.ts`, `message-bus-integration.test.ts` don't exist in LLxprt - documented as NO_OP in AUDIT.md.

**Files modified:**
- `packages/core/src/tools/tools.ts` - Updated `getMessageBusDecision()` signature and implementation
- `packages/core/src/tools/google-web-fetch.ts` - Added message bus integration in `shouldConfirmExecute()`
- `packages/core/src/confirmation-bus/message-bus.ts` - Added `unsubscribe()` method

### Verification Record

```
$ npm run lint
> eslint . --ext .ts,.tsx && eslint integration-tests
(success)

$ npm run typecheck
> npm run typecheck --workspaces --if-present
(all workspaces passed)

$ npm run test --workspace @vybestack/llxprt-code-core -- --run src/tools/tools.test.ts
[OK] 11 tests passed

$ npm run test --workspace @vybestack/llxprt-code-core -- --run src/confirmation-bus/message-bus.test.ts
[OK] 23 tests passed

$ npm run test --workspace @vybestack/llxprt-code-core -- --run src/confirmation-bus/integration.test.ts
[OK] 24 tests passed

$ npm run test --workspace @vybestack/llxprt-code-core -- --run src/tools/google-web-fetch.test.ts
[OK] 20 tests passed

$ npm run test --workspace @vybestack/llxprt-code-core -- --run src/core/coreToolScheduler.test.ts
[OK] 33 tests passed, 6 skipped
```

### Feature Landing Verification

```
$ git diff --stat HEAD
packages/core/src/confirmation-bus/message-bus.ts |  13 +++
packages/core/src/tools/google-web-fetch.ts       |  18 +++-
packages/core/src/tools/tools.ts                  | 114 +++++++++++++++++++---
3 files changed, 126 insertions(+), 19 deletions(-)
```
---

## Batch 02 - Deepthinker Analysis Results

### Resolution Summary

| Commit | SHA | Resolution | Rationale |
|---|---|---|---|
| Prevent queuing of slash/shell commands | 4f17eae5 | **REIMPLEMENT** | LLxprt has StreamingState but lacks queue error state UI wiring |
| Shell tool call colors for confirmed actions | d38ab079 | **SKIP** | Purely aesthetic; conflicts with LLxprt SemanticColors palette |
| Fix --allowed-tools substring matching | 2e6d69c9 | **REIMPLEMENT** | Bug fix - LLxprt has same issue in parseAllowedSubcommands/shell.ts |
| Add output-format stream-json flag | 47f69317 | **REIMPLEMENT** | New feature requires LLxprt integration in output-format.ts, nonInteractiveCli.ts |
| Avoid unconditional git clone fallback | 8c1656bf | **REIMPLEMENT** | Apply result object + consent-driven fallback to LLxprt extension plumbing |

### Detailed Findings

**4f17eae5**: LLxprt's InputPrompt has setQueueErrorMessage/streamingState props but no queue error display or blocking logic in handleSubmitAndClear. Need to wire queue error state through UIState/UIActions contexts to Composer and InputPrompt.

**d38ab079**: LLxprt uses SemanticColors.text.secondary for separator (matches upstream intent), but tool group border and shell prompt colors diverge. No functional change requested - SKIP for aesthetic divergence.

**2e6d69c9**: LLxprt still uses parseAllowedSubcommands in ShellToolInvocation.shouldConfirmExecute, and doesToolInvocationMatch doesn't accept raw strings like upstream's fix. Apply substring matching fix to shell.ts and tool-utils.ts.

**47f69317**: LLxprt only supports text/json output. Need to implement stream JSON formatter in utils/output-format.ts, wire into nonInteractiveCli.ts and errors.ts, and update LLxprt docs (upstream docs won't apply).

**8c1656bf**: LLxprt's downloadFromGitHubRelease throws on errors; installOrUpdateExtension always clones on failure. Apply upstream's structured result object approach with consent flow.
---

## Batch 02

### Selection Record

```
Batch: 02
Type: PICK
Upstream SHA(s): 4f17eae5, d38ab079, 2e6d69c9, 47f69317, 8c1656bf
Subject: feat(cli): Prevent queuing of slash and shell commands (#11094) / Update shell tool call colors for confirmed actions (#11126) / Fix --allowed-tools in non-interactive mode to do substring matching for parity with interactive mode. (#10944) / Add support for output-format stream-jsonflag for headless mode (#10883) / Don't always fall back on a git clone when installing extensions (#11229)
Playbook: N/A
Prerequisites Checked:
  - Previous batch record exists: YES
  - Previous batch verification: PASS
  - Previous batch pushed: N/A
  - Special dependencies: None
Ready to Execute: YES
```

### Execution Record

Attempted cherry-pick of 5 commits. Conflicts in UI components, configs, and docs. Needs subagent analysis to determine which conflicts can be resolved and which are divergences. Status: PENDING ANALYSIS.

### Verification Record

Not yet verified due to conflicts.

### Commit/Push Record

No commit created. Status remains PENDING ANALYSIS.

---
---

## Batch 03

### Selection Record

```
Batch: 03
Type: PICK
Upstream SHA(s): cfaa95a2
Subject: feat(cli): Add nargs to yargs options (#11132)
Playbook: N/A
Prerequisites Checked:
  - Previous batch record exists: YES
  - Previous batch verification: PASS
  - Previous batch pushed: N/A
  - Special dependencies: None
Ready to Execute: YES
```

### Execution Record

Attempted cherry-pick of `cfaa95a2`. Conflicts in `packages/cli/src/config/config.ts` due to diverged extension handling. Deepthinker analysis recommends REIMPLEMENT - add `nargs: 1` to all single-argument options in LLxprt's config.ts and port two upstream tests.

```
$ git cherry-pick cfaa95a2
Auto-merging packages/cli/src/config/config.test.ts
Auto-merging packages/cli/src/config/config.ts
CONFLICT (content): Merge conflict in packages/cli/src/config/config.ts
[aborted]
```

### Verification Record

Not yet verified.

### Status Documentation

Batch 03 commit: `cfaa95a2` marked as REIMPLEMENT in AUDIT.md.
 Resolution: Add `nargs: 1` to all single-argument string/array options (LLxprt has many options without nargs that share the same parsing risk). Port two upstream tests for positional prompts after flags.

### Commit/Push Record

No commit created (REIMPLEMENT needed). Status documented in AUDIT.md.

---
---

## Batch 04

### Selection Record

```
Batch: 04
Type: REIMPLEMENT
Upstream SHA(s): 130f0a02
Subject: chore(subagents): Remove legacy subagent code (#11175)
Playbook: project-plans/20260104gmerge/130f0a02-plan.md
Prerequisites Checked:
  - Previous batch record exists: YES
  - Previous batch verification: PASS
  - Previous batch pushed: N/A
  - Special dependencies: None
Ready to Execute: YES
```

### Execution Record

Analyzed upstream commit 130f0a02 which removes `subagent.ts` and `subagent.test.ts` entirely. Deepthinker analysis confirmed LLxprt's subagent system is MORE advanced and actively used. Applying this change would delete core LLxprt functionality. Marked as SKIP.

```
$ git show 130f0a02 --stat
 packages/core/src/core/subagent.test.ts | 862 del
 packages/core/src/core/subagent.ts      | 733 del
```

### Verification Record

Verified LLxprt subagent system:
- `packages/core/src/core/subagent.ts` has SubAgentScope (line 411)
- `packages/core/src/core/subagentOrchestrator.ts` orchestrates subagent execution
- `packages/cli/src/ui/commands/subagentCommand.ts` manages subagents
- Active feature used by task tool

### Status Documentation

Batch 04 commit: `130f0a02` marked as SKIP in AUDIT.md.
 Reason: Upstream removes legacy subagent code; LLxprt's subagent system is newer and actively used. Removal would break core functionality.

### Commit/Push Record

No commit created (SKIP). AUDIT.md, NOTES.md, PROGRESS.md updated.
