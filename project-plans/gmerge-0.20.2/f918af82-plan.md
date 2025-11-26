# Reimplement Plan: Auto-Execute Slash Commands

**Upstream SHA:** `f918af82fe13eae28b324843d03e00f02937b521`
**Batch:** 7

## What upstream does

Adds `autoExecute?: boolean` to SlashCommand interface. When true, pressing Enter on a suggestion executes immediately instead of just autocompleting. Tab always autocompletes.

## LLxprt approach

Same concept, adapted to LLxprt's useSlashCompletion and InputPrompt architecture.

## Files to modify

1. `packages/cli/src/ui/commands/types.ts` — add `autoExecute?: boolean` to SlashCommand
2. `packages/cli/src/ui/components/InputPrompt.tsx` — add auto-execute check on Enter
3. `packages/cli/src/ui/hooks/useSlashCompletion.tsx` — add `getCommandFromSuggestion()` helper
4. All command registration files — classify each command as autoExecute true/false
5. Tests for the new Enter behavior

## Command classification

**autoExecute: true** (no args needed): `/about`, `/auth`, `/clear`, `/compress`, `/copy`, `/docs`, `/editor`, `/help`, `/init`, `/model`, `/quit`, `/settings`, `/setup-github`, `/theme`, `/stats session`, `/stats model`, `/stats tools`, `/memory show`, `/memory list`, `/memory refresh`, `/mcp list`, `/mcp desc`, `/mcp schema`, `/mcp refresh`, `/extensions list`, `/extensions explore`, `/ide status`, `/ide install`, `/ide enable`, `/ide disable`, `/policies list`

**autoExecute: false** (needs args or complex): `/bug`, `/chat save`, `/directory add`, `/extensions update`, `/memory add`, `/mcp auth`, `/permissions trust`, `/tools`

## Verification

- Test: Enter on autoExecute command submits immediately
- Test: Enter on non-autoExecute command autocompletes only
- Test: Tab always autocompletes regardless of autoExecute
