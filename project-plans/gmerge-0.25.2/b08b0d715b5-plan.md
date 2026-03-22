# Playbook: Update System Prompt to Prefer Non-Interactive Commands

**Upstream SHA:** `b08b0d715b5`
**Upstream Subject:** Update system prompt to prefer non-interactive commands (#16117)
**Upstream Stats:** prompts-only steering change; small LLxprt adaptation

## What Upstream Does

Upstream tightens prompt steering so the model prefers non-interactive shell commands when it uses terminal tools. The intent is to reduce hangs and dead-ends caused by commands that open editors, pagers, prompts, or long-running interactive flows. In practice, the upstream prompt change teaches the agent to:
- prefer one-shot commands that print results and exit;
- avoid interactive utilities such as pagers, editors, watch modes, and prompt-driven installers unless explicitly requested;
- choose flags or alternative commands that disable prompts and colored/paged output when possible;
- keep terminal usage automation-friendly.

## Why REIMPLEMENT in LLxprt

1. `CHERRIES.md` marks this as **REIMPLEMENT** because the behavior is valuable but LLxprt must apply it in its own prompt markdown system rather than in upstream prompt source code.
2. LLxprt stores provider/model steering in prompt markdown files under `packages/core/src/prompt-config/defaults/providers/...`, so the change belongs there.
3. The key repo fact from the request is authoritative: prompt steering changes should target LLxprt prompt markdown/provider model files rather than upstream prompt code.
4. `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md` already exists and is the established place for Gemini-model-specific steering.
5. `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-flash-preview/core.md` may need creation if this repo wants the same steering for both Gemini 3 preview variants.
6. LLxprt already has adjacent Gemini 3 prompt work planned in `41e627a7ee4-plan.md`, so this batch should stay architecture-consistent and keep the guidance in model prompt markdown rather than scattering it through runtime code.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md`
- [OK] `packages/core/src/prompt-config/defaults/providers/gemini/models/`
- [OK] `packages/core/src/prompt-config/` loader/config code exists in the repo and should be checked only to confirm discovery behavior

**Missing / may need creation depending on current loader conventions:**
- `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-flash-preview/core.md`

**Do not target for this batch:**
- upstream raw prompt implementation files
- unrelated CLI/runtime code paths just to enforce prompt wording

## Files to Modify/Create

### Modify: `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md`
- Add concise steering that explicitly prefers non-interactive shell commands.
- Keep the tone aligned with existing LLxprt prompt wording.
- Phrase the guidance as CLI-operating behavior, e.g. prefer non-interactive commands, avoid pagers/editors/prompts unless requested, and choose flags that make commands finish cleanly.

### Maybe create or modify: `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-flash-preview/core.md`
- If the file already exists by execution time, mirror the same non-interactive guidance there.
- If it does not exist and the prompt loader supports model-directory discovery by path, create it with the same Gemini 3 guidance block so Flash and Pro behave consistently.
- If the loader requires explicit registration, stop and adapt only within the prompt-config system rather than inventing a runtime workaround.

### Inspect only if needed: prompt-config loader files under `packages/core/src/prompt-config/`
- Confirm whether model-specific prompt markdown is discovered dynamically from directory structure or via a registry.
- Only update loader/config code if the new `gemini-3-flash-preview` prompt file would otherwise be ignored.

## Preflight Checks

```bash
# Verify the existing Gemini 3 Pro prompt file
cat packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md

# Check whether Gemini 3 Flash prompt already exists
ls packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-flash-preview

# Inspect neighboring Gemini model prompt directories for conventions
find packages/core/src/prompt-config/defaults/providers/gemini/models -maxdepth 2 -name core.md | sort

# Confirm how prompt markdown is discovered/loaded
grep -R "prompt-config/defaults/providers\|models" packages/core/src/prompt-config --include="*.ts"
```

## Implementation Steps

1. Read the current `gemini-3-pro-preview/core.md` and at least one nearby model prompt file to match LLxprt wording and section structure.
2. Read enough of the prompt-config loader to confirm whether `gemini-3-flash-preview/core.md` can be discovered by directory name alone.
3. Add non-interactive command guidance to `gemini-3-pro-preview/core.md` in LLxprt style. Keep it short and operational, not verbose.
4. If appropriate for current model coverage, add the same guidance to `gemini-3-flash-preview/core.md` by creating or updating that file.
5. Do not edit shared upstream-style prompt source files outside LLxprt's prompt markdown system.
6. Re-read the changed prompt files to ensure the wording is specific to command behavior and does not conflict with LLxprt's existing tool-usage mandates.
7. Run verification.

## Verification

```bash
# Confirm expected prompt text landed in Gemini 3 prompt markdown
grep -R "non-interactive\|pager\|editor\|prompt" \
  packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-* --include="core.md"

npm run lint
npm run typecheck
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Execution Notes/Risks

- **Key repo fact:** implement this in LLxprt prompt markdown/provider model files, not upstream prompt code.
- **Key repo fact:** `gemini-3-pro-preview/core.md` exists; `gemini-3-flash-preview/core.md` may need creation.
- **Risk:** creating `gemini-3-flash-preview/core.md` is only useful if the prompt-config system actually resolves that model name. Verify discovery before assuming it is active.
- **Risk:** this should remain steering, not policy enforcement. Do not add code that forbids interactive commands globally.
- **Risk:** avoid wording that conflicts with explicit user requests to open editors, run watch commands, or enter interactive flows.
- **Do not** broaden scope into generic shell-policy changes; those belong to policy/security batches, not this prompt batch.
- **Do not** rename files or alter provider/model naming conventions.
