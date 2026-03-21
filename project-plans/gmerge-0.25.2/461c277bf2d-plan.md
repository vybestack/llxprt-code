# Playbook: Support for Built-in Agent Skills

**Upstream SHA:** `461c277bf2d`
**Upstream Subject:** Support for Built-in Agent Skills (#16045)
**Upstream Stats:** skills/UI/CLI behavior change; moderate LLxprt adaptation

## What Upstream Does

Upstream teaches the skills system to understand built-in skills separately from user-installed skills and updates listing UX accordingly. The core behavior is:
- ship a built-in skills location with the CLI;
- include built-in skills in discovery/loading;
- make `/skills list` and CLI skills surfaces differentiate default shipped skills from user/project skills;
- add `--all` style behavior so listing can include otherwise filtered built-in entries.

The intent is that shipped/default skills are first-class but not confused with user-managed custom skills.

## Why REIMPLEMENT in LLxprt

1. `CHERRIES.md` marks this as **REIMPLEMENT** because the value is real but LLxprt's skill loading and command surfaces have diverged.
2. The request provides authoritative repo facts: `packages/core/src/skills/skillLoader.ts` exists, but `packages/core/src/skills/builtin/` is currently absent.
3. The request also states that `/skills` currently supports only `list`, `disable`, `enable`, and `reload`; any built-in-skill UX must fit that existing slash-command surface instead of assuming upstream commands.
4. LLxprt also has a yargs-based skills surface in `packages/cli/src/commands/skills.tsx`, so both slash-command and CLI flows need grounded treatment.
5. LLxprt architecture already separates skill loading in core from presentation/commands in CLI, so the reimplementation should preserve that split and LLxprt naming.
6. This batch should plan for built-in skills in a way that composes cleanly with the later built-in-skill shipping batch already listed in `PLAN.md` (`e9c9dd1d672`), rather than fighting it.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/core/src/skills/skillLoader.ts`
- [OK] `packages/core/src/skills/skillManager.ts`
- [OK] `packages/cli/src/ui/commands/skillsCommand.ts`
- [OK] `packages/cli/src/commands/skills.tsx`
- [OK] `packages/cli/src/commands/skills/list.ts`
- [OK] `packages/cli/src/commands/skills/enable.ts`
- [OK] `packages/cli/src/commands/skills/disable.ts`
- [OK] skills list/history UI currently renders from existing skill metadata

**Absent now:**
- `packages/core/src/skills/builtin/`

**Important current-surface facts:**
- `/skills` currently supports `list`, `disable`, `enable`, and `reload` only.
- yargs and slash-command surfaces both exist and must stay coherent.

## Files to Modify/Create

### Modify: `packages/core/src/skills/skillLoader.ts`
- Extend skill metadata or loading helpers so LLxprt can distinguish built-in skills from user/workspace skills.
- Preserve current frontmatter parsing and location/body behavior.
- Prefer a minimal additive field such as source/kind/isBuiltin rather than a sweeping schema redesign.
- Add loading support for a built-in skills directory once present, but keep behavior safe when `packages/core/src/skills/builtin/` is absent.

### Modify: `packages/core/src/skills/skillManager.ts`
- Ensure the manager can merge built-in and discovered skills predictably.
- Define precedence rules explicitly: custom/project/user skills should continue to shadow built-ins when names collide unless current LLxprt conventions say otherwise.
- Expose enough metadata for UI/CLI listing filters.

### Modify: `packages/cli/src/ui/commands/skillsCommand.ts`
- Keep the existing slash surface (`list`, `disable`, `enable`, `reload`) intact.
- Adapt `list` so it can distinguish built-in skills and support an LLxprt-appropriate all-inclusive mode.
- Because `/skills` does not currently support extra subcommands, prefer a list argument variant such as `/skills list all` or `/skills list --all` only if the parser already handles it naturally; otherwise keep to existing argument conventions and document the exact LLxprt behavior.

### Modify: yargs skills commands under `packages/cli/src/commands/skills/`
- Update `list` command argument parsing so CLI users can request all skills, including built-ins, using LLxprt-appropriate flags or arguments.
- Keep `enable`/`disable` semantics consistent with built-in skills: disabling a built-in skill should mean adding it to disabled settings, not trying to delete shipped files.

### Modify: relevant UI rendering for skills lists
- If the existing `SKILLS_LIST` history item already has enough fields, use them.
- Otherwise add a small metadata extension so built-in entries can be labeled clearly in the existing skills list presentation.

### Create later only if this batch truly needs a placeholder for tests:
- `packages/core/src/skills/builtin/` should remain optional in this batch unless a real fixture or bootstrap location is needed.
- Do not create fake production built-in skills just to satisfy the plan unless the implementation genuinely requires one.

## Preflight Checks

```bash
# Inspect current loader and manager behavior
sed -n '1,240p' packages/core/src/skills/skillLoader.ts
sed -n '1,260p' packages/core/src/skills/skillManager.ts

# Verify builtin skill directory is absent today
ls packages/core/src/skills/builtin

# Inspect slash command surface
sed -n '1,360p' packages/cli/src/ui/commands/skillsCommand.ts

# Inspect yargs surface
sed -n '1,200p' packages/cli/src/commands/skills.tsx
find packages/cli/src/commands/skills -maxdepth 1 -type f | sort
```

## Implementation Steps

1. Read `skillLoader.ts` and `skillManager.ts` to understand current discovery roots, merge behavior, and what metadata is available to UI/CLI layers.
2. Read both command surfaces: slash `/skills` and yargs `skills` commands. Preserve their current structure and naming.
3. Add minimal built-in skill metadata in core so callers can tell whether a skill comes from a shipped directory or a user/workspace directory.
4. Implement safe built-in discovery behavior that tolerates `packages/core/src/skills/builtin/` being absent.
5. Update manager merge/shadowing behavior if needed so built-ins do not override user/project skills unexpectedly.
6. Update `/skills list` behavior to show built-in origin and provide an LLxprt-appropriate way to include all skills when filtering would otherwise hide built-ins.
7. Update the yargs `skills list` command to mirror the same capability and wording.
8. Add or extend tests around loader metadata, merge precedence, and list output/filtering.
9. Run verification.

## Verification

```bash
npm run lint
npm run typecheck
npm run test -- --reporter=verbose packages/core/src/skills
npm run test -- --reporter=verbose packages/cli/src/ui/commands/skillsCommand.test.ts
npm run test -- --reporter=verbose packages/cli/src/commands/skills.test.tsx
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Execution Notes/Risks

- **Key repo fact:** `skillLoader.ts` exists, but `packages/core/src/skills/builtin/` is absent today.
- **Key repo fact:** `/skills` currently supports only `list`, `disable`, `enable`, and `reload`.
- **Key repo fact:** both yargs and slash-command skills surfaces exist; keep them aligned.
- **Risk:** this batch should not assume the later shipping/bundling commit has already landed. Discovery of built-ins must degrade cleanly when the directory is missing.
- **Risk:** do not couple built-in skill handling to install/uninstall flows from other batches unless those commands already exist in the current tree.
- **Risk:** custom skill shadowing is subtle; preserve LLxprt precedence expectations and test collisions explicitly.
- **Do not** introduce upstream `/agents` terminology. Keep LLxprt's existing “skills” naming.
- **Do not** create a new `builtin skills manager` abstraction unless inspection shows the current loader/manager cannot be extended surgically.
