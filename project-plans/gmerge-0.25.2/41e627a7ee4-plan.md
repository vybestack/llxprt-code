# Playbook: Refine Gemini 3 System Instructions to Reduce Model Verbosity

**Upstream SHA:** `41e627a7ee4`
**Upstream Subject:** Refine Gemini 3 system instructions to reduce model verbosity (#16139)
**Upstream Stats:** ~2 files, small-moderate text changes

## What Upstream Does

Upstream adds verbosity-reduction guidance to the Gemini 3 model prompt files. The Gemini 3 models (both `gemini-3-pro-preview` and `gemini-3-flash-preview`) tend to produce overly verbose output compared to Gemini 2.x models. The upstream fix adds system prompt instructions telling the model to:
- Be concise and direct in CLI responses.
- Minimize unnecessary text output (aim for fewer than 3 lines excluding code/tool use).
- Prefer tools over text for actions.
- Avoid excessive explanations or justifications.
- Use GitHub-flavored Markdown formatted for monospace rendering.

## Why REIMPLEMENT in LLxprt

1. LLxprt's prompt system uses per-model Markdown files under `packages/core/src/prompt-config/defaults/providers/gemini/models/`. The verbosity guidance must be added to these `.md` files, not to upstream's raw prompt code.
2. `gemini-3-pro-preview/core.md` **exists** (13 lines, already has tone/style guidance) — the verbosity directives should be refined and extended in this file.
3. `gemini-3-flash-preview/core.md` **does NOT exist** — the directory `gemini-3-flash-preview/` is missing entirely. It must be created with the same verbosity guidance.
4. The existing `gemini-3-pro-preview/core.md` already says "Minimal Output: Aim for fewer than 3 lines" and "Concise & Direct" — but may need stronger language matching upstream's refined wording.
5. The `gemini-2.5-flash/` directory exists with its own `core.md`, providing a template for how model-specific files are structured.

## LLxprt File Existence Map

**Present (verified):**
- [OK] `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md` — 13 lines, has "Core Mandates" and "Tone and Style" sections
- [OK] `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-2.5-flash/` — Reference directory for model prompt structure
- [OK] `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-exp-1206/` — Another reference

**Missing (to be created):**
- `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-flash-preview/` — Directory
- `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-flash-preview/core.md` — Model-specific prompt file

## Files to Modify / Create

### 1. Modify: `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md`

The current content (13 lines) already covers conciseness. Refine and extend with upstream's stronger verbosity guidance. The file should read:

```markdown
# Core Mandates

- **Do not call tools in silence:** You must provide to the user a very short and concise natural explanation (one sentence) before calling tools.

## Tone and Style (CLI Interaction)

- **Concise & Direct:** Adopt a professional, direct, and concise tone suitable for a CLI environment. Avoid filler words, pleasantries, or unnecessary preamble.
- **Minimal Output:** Aim for fewer than 3 lines of text output (excluding tool use/code generation) per response whenever practical. Focus strictly on the user's query.
- **No Repetition:** Do not repeat back the user's question or restate what was just said. Jump directly to the answer or action.
- **Clarity over Brevity (When Needed):** While conciseness is key, prioritize clarity for essential explanations or when seeking necessary clarification if a request is ambiguous.
- **Formatting:** Use GitHub-flavored Markdown. Responses will be rendered in monospace.
- **Tools vs. Text:** Use tools for actions, text output _only_ for communication. Do not add explanatory comments within tool calls or code blocks unless specifically part of the required code/command itself.
- **Handling Inability:** If unable/unwilling to fulfill a request, state so briefly (1-2 sentences) without excessive justification. Offer alternatives if appropriate.
- **No Unsolicited Summaries:** After completing a task, do not provide a summary unless the user asks for one. A brief confirmation (e.g., "Done.") is sufficient.
```

Key additions from upstream:
- "Avoid filler words, pleasantries, or unnecessary preamble"
- "No Repetition" bullet
- "No Unsolicited Summaries" bullet

### 2. Create: `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-flash-preview/core.md`

Create the directory and file with the same content as the updated `gemini-3-pro-preview/core.md`. Flash models tend to be even more verbose than Pro, so the same guidance applies:

```markdown
# Core Mandates

- **Do not call tools in silence:** You must provide to the user a very short and concise natural explanation (one sentence) before calling tools.

## Tone and Style (CLI Interaction)

- **Concise & Direct:** Adopt a professional, direct, and concise tone suitable for a CLI environment. Avoid filler words, pleasantries, or unnecessary preamble.
- **Minimal Output:** Aim for fewer than 3 lines of text output (excluding tool use/code generation) per response whenever practical. Focus strictly on the user's query.
- **No Repetition:** Do not repeat back the user's question or restate what was just said. Jump directly to the answer or action.
- **Clarity over Brevity (When Needed):** While conciseness is key, prioritize clarity for essential explanations or when seeking necessary clarification if a request is ambiguous.
- **Formatting:** Use GitHub-flavored Markdown. Responses will be rendered in monospace.
- **Tools vs. Text:** Use tools for actions, text output _only_ for communication. Do not add explanatory comments within tool calls or code blocks unless specifically part of the required code/command itself.
- **Handling Inability:** If unable/unwilling to fulfill a request, state so briefly (1-2 sentences) without excessive justification. Offer alternatives if appropriate.
- **No Unsolicited Summaries:** After completing a task, do not provide a summary unless the user asks for one. A brief confirmation (e.g., "Done.") is sufficient.
```

### 3. Verify prompt loading picks up the new file

Check `packages/core/src/prompt-config/` for the loader that discovers model-specific `.md` files. The loader likely reads from the directory structure by model name. Verify that `gemini-3-flash-preview` as a model identifier will cause the loader to look in the corresponding directory.

If the prompt loader uses a static mapping or registry (rather than dynamic directory scanning), the new `gemini-3-flash-preview` directory may need to be registered.

## Preflight Checks

```bash
# Verify existing pro-preview core.md
cat packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md

# Verify flash-preview does NOT exist
test ! -d packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-flash-preview && echo "OK: not yet"

# List existing model directories for reference
ls packages/core/src/prompt-config/defaults/providers/gemini/models/

# Check how prompt loader discovers model-specific files
grep -rn "gemini-3\|models/" packages/core/src/prompt-config/ --include="*.ts" | head -10
```

## Implementation Steps

1. **Read** existing `gemini-3-pro-preview/core.md` (already read — 13 lines with tone/style guidance).
2. **Read** `gemini-2.5-flash/core.md` as a reference for structure and style.
3. **Read** the prompt config loader to understand how model-specific `.md` files are discovered and loaded.
4. **Update** `gemini-3-pro-preview/core.md` with refined verbosity guidance (add ~3 new bullets).
5. **Create** `gemini-3-flash-preview/` directory.
6. **Create** `gemini-3-flash-preview/core.md` with the same content.
7. **Verify** the prompt loader will pick up the new file (check for dynamic discovery vs. static registration).
8. **Run verification.**

## Verification

```bash
# Verify both files exist with expected content
test -f packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md && echo "OK"
test -f packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-flash-preview/core.md && echo "OK"

# Verify no Gemini CLI branding
grep -ri "gemini cli" packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-*/core.md || echo "OK: clean"

# Run build to ensure prompt files are bundled
npm run build

# Smoke test with synthetic profile
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Execution Notes / Risks

- **Risk: Low.** These are Markdown prompt files, not code. The main risk is the prompt loader not discovering the new `gemini-3-flash-preview` directory.
- **Risk: Prompt loader registration.** If the prompt config system requires explicit model registration (not just directory scanning), the new `gemini-3-flash-preview/core.md` won't be loaded automatically. Check `packages/core/src/prompt-config/` for a registry or model list. If registration is needed, add it.
- **Do NOT** modify `gemini-2.5-flash/core.md` or `gemini-exp-1206/` — these model prompts have different verbosity characteristics and should not receive the same guidance.
- **Do NOT** add Gemini-3-specific guidance to the shared/default prompt files — keep it in the model-specific directories.
- **Build bundling:** The `bundle/providers/gemini/models/gemini-3-pro-preview/core.md` file (found in the glob search) suggests the build process copies these files. Verify the build step includes the new `gemini-3-flash-preview/` directory.
- **Content parity:** Both `gemini-3-pro-preview` and `gemini-3-flash-preview` should have identical verbosity guidance. Flash models are often more verbose than Pro, so the guidance is equally applicable.
