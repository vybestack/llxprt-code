<!-- @plan:PLAN-20260622-COREAPIGAP.P02 @requirement:REQ-001..REQ-010,REQ-INT-001..005 -->
# Phase 02: Pseudocode

## Phase ID

`PLAN-20260622-COREAPIGAP.P02`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 01a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P01a.md`

## Purpose

Produce/confirm contract-first NUMBERED pseudocode for every new/changed component. NO TypeScript.

## Implementation Tasks

### Files to Create / Confirm (under `analysis/pseudocode/`)

- `approval-mode.md` — top-level `Agent.getApprovalMode`/`setApprovalMode` delegation; throw
  propagates (REQ-001).
- `policy-control.md` — NEW `AgentPolicyControl`: `getRules` (→ `PolicyRuleView`,
  `argsPattern`→`.source`), `getDefaultDecision`, `isNonInteractive` (REQ-002).
- `tasks-control.md` — NEW `AgentTasksControl`: `list`/`listRunning`/`get`/`cancel`/
  `cancelAllRunning`; undefined-safe; project out `abortController` (REQ-003).
- `hooks-admin.md` — EXTEND `AgentHookControl`: `listHooks`/`getDisabledHooks`/`setDisabledHooks`/
  `enable`/`disable`; undefined-safe (REQ-004).
- `auth-detail.md` — EXTEND `AgentAuthControl`: `detailedStatus`/`getHigherPriorityAuth`/
  `listBucketStatuses`; masked; thread `oauthManager` closure (REQ-005).
- `mcp-oauth.md` — EXTEND `AgentMcpControl`: `authenticate` (real flow)/`details`/`refresh()`
  setTools parity; undefined-safe (REQ-006).
- `tool-keys.md` — NEW `AgentToolKeyControl` (`tools.keys`): `supported`/`status`(masked)/`save`/
  `delete`/`setKeyFile`/`getKeyFile`; distinct from `auth.keys` (REQ-007).
- `barrel-exports.md` — `api/index.ts` value-vs-type re-exports of the new public surface
  (REQ-008).
- `command-map.md` — six new `COMMAND_API_MAP` rows (REQ-008).

Each file MUST contain the mandatory sections: **Interface Contracts**, **Integration Points
(line-by-line)**, **Anti-Pattern Warnings**, plus NUMBERED pseudocode lines (`^[0-9]+:`).

### Required Markers

Each pseudocode file's top comment MUST include `@plan:PLAN-20260622-COREAPIGAP.P02`.

## Verification Commands

```bash
set -o pipefail
cd project-plans/issue2143/analysis/pseudocode
for f in approval-mode policy-control tasks-control hooks-admin auth-detail mcp-oauth tool-keys barrel-exports command-map; do
  test -f "$f.md" || { echo "MISSING $f.md"; exit 1; }
  grep -q "Interface Contracts" "$f.md" || { echo "$f MISSING Interface Contracts"; exit 1; }
  grep -q "Integration Points" "$f.md" || { echo "$f MISSING Integration Points"; exit 1; }
  grep -q "Anti-Pattern Warnings" "$f.md" || { echo "$f MISSING Anti-Pattern Warnings"; exit 1; }
  grep -qE "^[0-9]+:" "$f.md" || { echo "$f MISSING numbered lines"; exit 1; }
  grep -q "@plan:PLAN-20260622-COREAPIGAP.P02" "$f.md" || { echo "$f MISSING plan marker"; exit 1; }
done
echo "OK"
```

### Anti-Pattern Self-Check

- [ ] No actual TypeScript (only numbered pseudocode + contract sections).
- [ ] Pseudocode references REAL symbols/lines: `config.getApprovalMode` (`configBaseCore.ts:463`),
      `config.setApprovalMode` (`config.ts:401`), `getPolicyEngine` (`configBaseCore.ts:475`),
      `getAsyncTaskManager` (`config.ts:601`), `getHookSystem`/`getDisabledHooks`/`setDisabledHooks`
      (`config.ts:755`/`:734`/`configBase.ts:132`), OAuthManager
      `peekStoredToken`/`getHigherPriorityAuth`/`getAuthStatusWithBuckets`
      (`oauth-manager.ts:243`/`:313`/`:395`), `MCPOAuthProvider.authenticate`
      (`oauth-provider.ts:874`), `resolveClient().setTools()` (`clientContract.ts:77`),
      `getToolKeyStorage` (`tool-key-storage.ts:81`).
- [ ] No hardcoded responses; dependencies are injected closures; errors propagate (esp.
      `setApprovalMode`).
- [ ] Projected types omit `abortController` / raw `RegExp` / raw secrets.

## Success Criteria

- All nine pseudocode files present, each with the mandatory sections + numbered lines + marker.

## Failure Recovery

- Revise the deficient pseudocode file(s); re-run verification.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P02.md`

```markdown
Phase: P02
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```
