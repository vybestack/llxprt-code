# Reimplement Plan: Gemini 3.0 Prompt Overrides

**Upstream SHA:** `1187c7fdacee20b2f1f728eaf2093a1c44b5f6f1`
**Batch:** 4

## What upstream does

Adds two behavioral changes for Gemini 3.0 models:
1. New mandate: "Do not call tools in silence" — explain before calling tools
2. Remove "No Chitchat" to allow Gemini 3.0 to be more conversational

## LLxprt approach

Use the existing per-model prompt override system (markdown files in `defaults/providers/gemini/models/`).

## Files to modify

- `packages/core/src/prompt-config/defaults/providers/gemini/models/gemini-3-pro-preview/core.md` — update with new mandate
- Possibly create additional model directories (e.g., `gemini-3/core.md`) if other gemini-3 variants need the same

## Implementation steps

1. Read existing `gemini-3-pro-preview/core.md` (currently overrides Tone & Style section)
2. Read base `core.md` to find "No Chitchat" text
3. Add to gemini-3-pro-preview/core.md:
   - Under Core Mandates section: "Do not call tools in silence" bullet
   - Ensure "No Chitchat" is absent from the Tone & Style override
4. Add test verifying the override renders correctly for gemini-3-pro-preview model

## Verification

- `npm run test` — prompt rendering tests pass
- Manual: verify prompt output for gemini-3-pro-preview includes the new mandate
