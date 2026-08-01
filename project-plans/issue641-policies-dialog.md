# Issue #641 — Interactive /policies dialog for managing rules

## Acceptance Matrix (decision-complete)

| # | Behavior | Accepted | Verification |
|---|----------|----------|--------------|
| A1 | `/policies` opens an interactive dialog (when an agent is bound) instead of a read-only message | YES | policiesCommand test + dialog wiring |
| A2 | Dialog displays rules grouped by tier (System/Admin, User, Default) with priority, tool name, decision, args pattern, source | YES | PoliciesDialog test |
| A3 | Add-rule flow: prompts toolName (or wildcard), decision (allow/deny/ask_user), optional args regex, priority within user tier; writes to the managed user overrides file | YES | userPolicyStore test + dialog test |
| A4 | Edit: change decision or args pattern of an existing overrides-file rule in-line; rewrites file | YES | userPolicyStore test + dialog test |
| A5 | Delete: removes a rule from the overrides file; defaults/system remain read-only | YES | userPolicyStore test + dialog test |
| A6 | Duplicate: copies a rule (from any tier) into the overrides file for tweaking | YES | userPolicyStore test + dialog test |
| A7 | After every mutation the active in-memory stack is refreshed (no restart) and the dialog re-reads | YES | reloadPolicyRules test |
| A8 | System/Default tier rules are shown as read-only with a warning that they need higher-priority overrides | YES | PoliciesDialog test |
| A9 | Non-interactive fallback (no agent) still emits the read-only message table | YES | policiesCommand test (unchanged path) |

## Non-Goals

- Bulk import/export of rules
- Editing system (Tier 0) or admin (Tier 3) rules — read-only by design
- MCP server trust management (owned by `/permissions` dialog)
- Approval-mode switching from within the dialog
- Undo/redo history
- Editing rules that live in non-managed user TOML files (only the managed `auto-saved.toml` is editable; other files display read-only)

## Bounded Vertical Slices

### Slice 1 — Policy engine + persistence foundation
1. `PolicyEngine.replaceRules(rules)` — replaces the entire base rule list and re-sorts (policy package).
2. `UserPolicyStore` (core) — CRUD on the managed overrides file (`Storage.getUserPoliciesDir()/auto-saved.toml`): list, add, update, delete, duplicate. Each mutation rewrites the file atomically (tmp + rename, matching the existing persist pattern).
3. `reloadPolicyRules(engine, approvalMode)` — re-reads the user policies dir, preserves all non-user rules in the engine, and calls `replaceRules`.

### Slice 2 — Dialog component
4. `PoliciesDialog.tsx` — Ink component with two views:
   - **Overrides list**: editable rules from `auto-saved.toml` with add/edit/delete/duplicate actions.
   - **Full stack**: read-only tier-grouped view of all engine rules.
   - Add/Edit sub-forms using `TextInput` + `RadioButtonSelect`.

### Slice 3 — Wiring + command change
5. Add `policies` to `DialogType`, `useDialogOrchestration` state, UI contexts, builders, `AppContainerRuntime`, `DialogManager`, and `slashCommandHandlers`.
6. `/policies` returns `OpenDialogActionReturn` when an agent is bound; keeps message fallback when not.

## Scope Ledger

| File | Change type | Package |
|------|-------------|---------|
| packages/policy/src/policy-engine.ts | MODIFIED — add replaceRules | policy |
| packages/policy/src/policy-engine.test.ts | MODIFIED — add test | policy |
| packages/core/src/policy/userPolicyStore.ts | NEW | core |
| packages/core/src/policy/userPolicyStore.test.ts | NEW | core |
| packages/cli/src/ui/components/PoliciesDialog.tsx | NEW | cli |
| packages/cli/src/ui/components/PoliciesDialog.test.tsx | NEW | cli |
| packages/cli/src/ui/commands/types.ts | MODIFIED — DialogType | cli |
| packages/cli/src/ui/commands/policiesCommand.ts | MODIFIED | cli |
| packages/cli/src/ui/commands/policiesCommand.test.ts | MODIFIED | cli |
| packages/cli/src/ui/containers/AppContainer/hooks/useDialogOrchestration.ts | MODIFIED | cli |
| packages/cli/src/ui/contexts/UIStateContext.tsx | MODIFIED | cli |
| packages/cli/src/ui/contexts/UIActionsContext.tsx | MODIFIED | cli |
| packages/cli/src/ui/containers/AppContainer/builders/buildUIState.ts | MODIFIED | cli |
| packages/cli/src/ui/containers/AppContainer/builders/buildUIActions.ts | MODIFIED | cli |
| packages/cli/src/ui/AppContainerRuntime.tsx | MODIFIED | cli |
| packages/cli/src/ui/components/DialogManager.tsx | MODIFIED | cli |
| packages/cli/src/ui/hooks/slashCommandHandlers.ts | MODIFIED | cli |
| packages/cli/src/ui/containers/AppContainer/builders/buildUIState.test.ts | MODIFIED | cli |
| packages/cli/src/ui/containers/AppContainer/builders/buildUIActions.test.ts | MODIFIED | cli |
| packages/cli/src/ui/containers/AppContainer/hooks/useDialogOrchestration.test.ts | MODIFIED | cli |

Net changed files: ~20 (within 25-file budget). Estimated net LOC < 1500.

## Review finding triage policy
Blocker-Fix / In-scope-Fix → resolve before merge. Reject → out-of-scope, defer to user. Defer → noted, not in this PR.
