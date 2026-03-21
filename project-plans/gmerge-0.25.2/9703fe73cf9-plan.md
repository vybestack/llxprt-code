# Playbook: Hooks Enable-All/Disable-All Adapted to LLxprt

**Upstream SHA:** `9703fe73cf9`
**Upstream Subject:** feat(cli): Hooks enable-all/disable-all feature with dynamic status (#15552)
**Upstream Stats:** hooks command UX/CLI feature; moderate LLxprt adaptation

## What Upstream Does

Upstream adds bulk hook-management commands so users can enable or disable all hooks in one action and then see updated status immediately. The feature is mainly command/UI ergonomics:
- add hooks `enable-all` and `disable-all` actions;
- update hook status dynamically after the bulk action;
- preserve per-hook management alongside the new bulk operations.

## Why REIMPLEMENT in LLxprt

1. `CHERRIES.md` marks this as **REIMPLEMENT** because the UX is desirable but the command logic must be rebuilt on LLxprt's current hook architecture.
2. The request gives the key repo facts: both yargs and slash hooks surfaces exist, and slash `/hooks` currently supports only `list`, `enable`, and `disable`.
3. LLxprt's slash implementation is in `packages/cli/src/ui/commands/hooksCommand.ts` and already uses `config.getDisabledHooks()`, `config.setDisabledHooks()`, and registry APIs to enable/disable named hooks.
4. LLxprt also has a yargs hooks surface in `packages/cli/src/commands/hooks.ts`, but it currently only wires the `migrate` subcommand. Any new bulk behavior must respect that current split instead of assuming upstream parity.
5. The request specifically says to adapt the feature to LLxprt's HookSystem registry APIs, which already exist in core and are the correct substrate here.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/cli/src/ui/commands/hooksCommand.ts`
- [OK] `packages/cli/src/commands/hooks.ts`
- [OK] `packages/core/src/hooks/hookSystem.ts`
- [OK] `packages/core/src/hooks/hookRegistry.ts`
- [OK] `packages/core/src/config/config.ts` with `getDisabledHooks()` / `setDisabledHooks()`
- [OK] current slash `/hooks` supports `list`, `enable`, `disable`
- [OK] yargs `hooks` command currently exposes `migrate`

**No missing architecture files are required:**
- this should build on existing hook registry/config APIs

## Files to Modify/Create

### Modify: `packages/cli/src/ui/commands/hooksCommand.ts`
- Add slash subcommands for bulk operations, likely `enable-all` and `disable-all`.
- Implement them using the current HookSystem registry plus `config.getDisabledHooks()` / `config.setDisabledHooks()`.
- After bulk changes, keep the UI behavior coherent with existing LLxprt patterns: either emit a confirmation message, re-list hooks, or both, depending on existing command style.
- Update the top-level `/hooks` description and fallback parsing list so the new subcommands are recognized.

### Modify: `packages/cli/src/ui/commands/hooksCommand` tests if present, or add targeted tests in the existing test location for slash commands
- Cover enable-all and disable-all behavior, including no-config/no-hook-system cases.
- Verify disabled hook state persists through config updates and registry updates.

### Maybe modify: `packages/cli/src/commands/hooks.ts`
- Decide whether yargs should also gain analogous bulk subcommands now.
- Because this file currently only exposes `migrate`, do not force upstream parity blindly. If no current yargs hook-management subcommands exist, it may be acceptable for this batch to keep bulk management slash-only and document that choice in tests/notes.
- If a yargs implementation is added, it must fit existing LLxprt command conventions rather than mirror upstream command names mechanically.

### Inspect only if needed:
- `packages/cli/src/ui/components/views/HooksList.tsx` if the UI needs help reflecting new bulk state immediately
- `packages/core/src/hooks/hookRegistry.ts` / `hookSystem.ts` to confirm the safest bulk update sequence

## Preflight Checks

```bash
# Inspect current slash hooks implementation
sed -n '1,320p' packages/cli/src/ui/commands/hooksCommand.ts

# Inspect current yargs hooks surface
sed -n '1,120p' packages/cli/src/commands/hooks.ts

# Confirm registry/config APIs used for single-hook toggles
grep -R "getDisabledHooks\|setDisabledHooks\|setHookEnabled\|getAllHooks" \
  packages/cli/src/ui/commands/hooksCommand.ts \
  packages/core/src/hooks packages/core/src/config --include="*.ts"
```

## Implementation Steps

1. Read the current slash `/hooks` implementation completely, especially how it initializes the hook system and updates disabled-hook config for single-hook operations.
2. Read enough of `hookSystem.ts` and `hookRegistry.ts` to confirm whether bulk toggling should use registry IDs, hook names, or both.
3. Add `enable-all` and `disable-all` slash subcommands in `hooksCommand.ts`.
4. Implement `disable-all` by collecting all registered hook names, writing them to disabled-hook settings in a deterministic order, and marking each registry entry disabled.
5. Implement `enable-all` by clearing disabled-hook settings for the currently registered hooks and marking each registry entry enabled.
6. Update top-level command parsing/help text so `/hooks` recognizes the new subcommands.
7. Decide explicitly whether the command should also refresh/re-list hook status after the action. Prefer the established LLxprt command style rather than upstream dynamic-status wording if they differ.
8. Add or extend tests for successful bulk enable/disable and for graceful failure paths.
9. Only extend the yargs `hooks` surface if inspection shows there is already a user-facing hook-management pattern there that should stay consistent.
10. Run verification.

## Verification

```bash
npm run lint
npm run typecheck
npm run test -- --reporter=verbose packages/cli/src/ui/commands/hooksCommand
npm run test -- --reporter=verbose packages/core/src/hooks
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Execution Notes/Risks

- **Key repo fact:** both yargs and slash hooks surfaces exist.
- **Key repo fact:** slash `/hooks` currently supports only `list`, `enable`, and `disable`.
- **Key repo fact:** this should adapt to LLxprt's existing HookSystem registry APIs, not upstream command plumbing.
- **Risk:** hook names in settings must match whatever `hookRegistry.getHookName()` returns today; bulk operations should use the same naming convention as single-hook commands.
- **Risk:** blindly clearing all disabled hooks could remove entries for hooks not currently registered. Preserve or document intended behavior after inspecting current config semantics.
- **Risk:** yargs parity is ambiguous because current yargs `hooks` is migration-focused. Avoid inventing a broad new CLI surface unless clearly justified by existing patterns.
- **Do not** rewrite hook core architecture for this batch.
- **Do not** add upstream-only dynamic UI machinery if LLxprt's existing addItem/list-refresh patterns already solve the UX sufficiently.
