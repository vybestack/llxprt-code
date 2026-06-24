<!-- @plan:PLAN-20260622-COREAPIGAP.P02a @requirement:REQ-001..REQ-010,REQ-INT-001..005 -->
# Phase 02a: Pseudocode Verification

## Phase ID

`PLAN-20260622-COREAPIGAP.P02a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 02 completed
- Verification: `test -f project-plans/issue2143/.completed/P02.md`

## Verification Tasks

Read all nine pseudocode files IN FULL. Confirm contract-first structure and fidelity to the
ACTUAL source (cross-check the cited line numbers against the real files).

```bash
set -o pipefail
# Structural presence (same loop as P02)
cd project-plans/issue2143/analysis/pseudocode
for f in approval-mode policy-control tasks-control hooks-admin auth-detail mcp-oauth tool-keys barrel-exports command-map; do
  grep -q "Interface Contracts" "$f.md" && grep -q "Integration Points" "$f.md" && grep -q "Anti-Pattern Warnings" "$f.md" || echo "$f INCOMPLETE"
done
cd - >/dev/null
# Fidelity spot-checks against real source (cited anchors MUST resolve)
grep -n "getApprovalMode" packages/core/src/config/configBaseCore.ts
grep -n "setApprovalMode" packages/core/src/config/config.ts
grep -n "getPolicyEngine" packages/core/src/config/configBaseCore.ts
grep -nE "getRules|getDefaultDecision|isNonInteractive" packages/policy/src/policy-engine.ts
grep -n "getAsyncTaskManager" packages/core/src/config/config.ts
grep -n "abortController" packages/core/src/services/asyncTaskManager.ts
grep -nE "getHookSystem|getDisabledHooks" packages/core/src/config/config.ts
grep -n "setDisabledHooks" packages/core/src/config/configBase.ts
grep -nE "getAllHooks|setHookEnabled|getHookName" packages/core/src/hooks/hookRegistry.ts
grep -nE "peekStoredToken|getHigherPriorityAuth|getAuthStatusWithBuckets" packages/providers/src/auth/oauth-manager.ts
grep -n "authenticate(" packages/mcp/src/auth/oauth-provider.ts | head
grep -n "setTools(): Promise<void>" packages/core/src/core/clientContract.ts
grep -nE "getToolKeyStorage|class ToolKeyStorage" packages/core/src/tools/tool-key-storage.ts
```

### Semantic Verification Checklist

- [ ] Every pseudocode file has all three mandatory sections + numbered lines.
- [ ] Cited symbols/line numbers MATCH actual source for all nine components.
- [ ] `approval-mode` pseudocode delegates directly and does NOT wrap `setApprovalMode` in
      try/catch (throw propagates — R-APPROVAL-THROW).
- [ ] `policy-control` projects `argsPattern` → `.source` string and returns read-only snapshots
      (no live engine handle leaked).
- [ ] `tasks-control` is undefined-safe and the projected `AgentTaskInfo` omits `abortController`;
      `cancelAllRunning` returns a COUNT.
- [ ] `hooks-admin` is undefined-safe (no hook system / not initialized → `[]`/no-op) and EXTENDS
      (does not replace) the existing exec/lifecycle members.
- [ ] `auth-detail` reads expiry via `peekStoredToken` (no refresh side-effect), masks output, and
      threads `oauthManager` via a closure (no new ctor wiring).
- [ ] `mcp-oauth` `authenticate` runs the real flow (authenticate→restartServer→setTools) and
      `refresh()` gains setTools parity; both undefined-safe; `mcp.auth()` semantics unchanged.
- [ ] `tool-keys` is DISTINCT from `auth.keys`, masks `status`, and treats `setKeyFile(tool, null)`
      as clear.
- [ ] `barrel-exports` re-exports enums as VALUES and projected interfaces as `export type`
      (verbatimModuleSyntax); `command-map` adds six `kind:'runtime'` rows that preserve the
      no-orphan / unique-command / durable-subpath invariants.

## Holistic Assessment (MANDATORY — into completion marker)

Explain whether the pseudocode, if implemented faithfully, would produce a public surface adequate
for #1595 (every one of the seven CLI capabilities reachable through the public root with no
`getConfig()` escape hatch). Note any line-number drift found and corrected. Verdict PASS/FAIL.

## Success Criteria

- All checks pass; line numbers reconciled; holistic assessment written.

## Failure Recovery

- Return to Phase 02 with specific corrections; do NOT proceed to Phase 03 until PASS.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P02a.md`

```markdown
Phase: P02a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence that grounded it]
```
