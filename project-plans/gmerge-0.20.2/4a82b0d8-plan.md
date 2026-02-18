# Reimplement Plan: Interactive/Non-Interactive/Subagent Prompt Mode

**Upstream SHA:** `4a82b0d891a8caed2fa3e6b5761fc785cd4dcc38`
**Batch:** 5

## What upstream does

Differentiates system prompt for interactive vs non-interactive mode: removes "ask the user" language, adds "Continue the work" directive, simplifies tool usage instructions.

## LLxprt approach

Add `interactionMode` to PromptEnvironment and use template variables (following `{{SUBAGENT_DELEGATION}}` precedent). Critical fix for subagent mode where contradictory instructions cause models to stop and ask for input.

## Files to modify

1. `packages/core/src/prompt-config/types.ts` — add `interactionMode` to `PromptEnvironment`
2. `packages/core/src/prompt-config/template-engine.ts` — add template variables
3. `packages/core/src/core/prompts.ts` — add to `CoreSystemPromptOptions` and `buildPromptContext()`
4. `packages/core/src/prompt-config/prompt-cache.ts` — include in cache key
5. `packages/core/src/prompt-config/defaults/core.md` — use template variables
6. `packages/core/src/prompt-config/defaults/providers/gemini/core.md` — same
7. `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-2.5-flash/core.md` — same
8. `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md` — same
9. Subagent callers: pass `interactionMode: 'subagent'`
10. Main CLI: pass based on `config.isInteractive()`
11. Tests for all three modes

## Template variables

- `{{INTERACTION_MODE}}` — 'interactive' | 'non-interactive' | 'subagent'
- `{{INTERACTION_MODE_LABEL}}` — 'an interactive' | 'a non-interactive' | 'a subagent'
- `{{INTERACTIVE_CONFIRM}}` — full bullet text
- `{{NON_INTERACTIVE_CONTINUE}}` — "Continue the work" directive or empty

## Key behavioral changes per mode

| Section | Interactive | Non-Interactive / Subagent |
|---------|------------|---------------------------|
| Preamble | "an interactive CLI agent" | "a non-interactive CLI agent" |
| Confirm Ambiguity | "confirm with user" | "handle autonomously" |
| Continue the work | omitted | "Do your best, avoid asking" |
| Tool usage | "ask the user if unsure" | omitted |
| Git workflow | "keep user informed" | omitted |

## Verification

- Unit tests for template rendering in all three modes
- Verify subagent prompts no longer contain contradictory "interactive" + "don't ask" instructions
