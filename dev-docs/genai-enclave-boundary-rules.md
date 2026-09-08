# `@google/genai` Enclave Boundary Rules (#2352)

> **Authoritative boundary rules** for where `@google/genai` imports and
> Gemini-named exports are permitted in the llxprt-code monorepo. Enforced
> by `scripts/check-genai-enclave.ts` (AST-precise, TypeScript compiler API)
> and wired into CI alongside the lint guards.

## Enclaves (permanent `@google/genai` import zones)

Only this subtree may import `@google/genai`:

| Enclave         | Path                               | Rationale                                             |
| --------------- | ---------------------------------- | ----------------------------------------------------- |
| Gemini provider | `packages/providers/src/gemini/**` | Provider implementation; needs the SDK for API calls. |

The former Code Assist enclave was deleted in #2623. Everything else in
`packages/**`, including core, agents, cli, tools, mcp, telemetry, a2a-server,
and test-utils, is **forbidden** from importing
`@google/genai` in any form.

### Import forms covered

The guard uses the TypeScript compiler API (not regex) to detect every import
form:

- **Static imports** (`import { X } from '@google/genai'`)
- **Type-only imports** (`import type { Content } from '@google/genai'`)
- **Dynamic imports** (`await import('@google/genai')`)
- **Import-equals** (`import x = require('@google/genai')`)
- **Named re-exports** (`export { X } from '@google/genai'`)
- **Namespace re-exports** (`export * from '@google/genai'`)
- **Subpath imports** (`import { X } from '@google/genai/sub'`)

### Fixing a violation

If you are outside an enclave and need a type that currently lives in
`@google/genai`, use the **neutral structural types** in
`packages/core/src/llm-types/` instead:

- `Content`, `Part` → `IContent`, `ContentBlock` (from `services/history/IContent.ts`)
- `GeminiContent`, `GeminiContentPart` → `packages/core/src/llm-types/geminiContent.ts` (structurally compatible)
- `FinishReason` → `mapGeminiFinishReason` + neutral union
- `GenerateContentResponse` → `ModelOutput` / `ModelStreamChunk`

See `dev-docs/genai-migration.md` for the full symbol-by-symbol disposition.

## Gemini-named export guard

A new exported identifier containing "Gemini" (case-insensitive) outside the
enclaves is **forbidden** unless it is in the explicit allowlist in
`scripts/genai-enclave/config.ts` (`GEMINI_NAME_EXPLICIT_ALLOWLIST`).

This catches provider-agnostic hooks or components being named with a
provider-specific name (e.g. `useGeminiFoo` in the CLI).

### Existing allowlist entries

The allowlist contains pre-existing public API names that cannot be renamed in
a patch release. Categories:

1. **Provider classes:** `GeminiProvider` (providers package index).
2. **Provider factories:** `createGeminiAliasProvider` (providers composition).
3. **Model predicates:** `isGemini2Model` / `isGemini3Model`. The former
   `DEFAULT_GEMINI_*` model-ID constants were deleted (issue #2627); provider
   defaults now live in the provider implementations, so no model-ID constants
   remain allowlisted from core.
4. **Neutral structural types:** `GeminiContent`, `GeminiContentPart`, etc.
   in `packages/core/src/llm-types/geminiContent.ts`.
5. **Finish-reason mappers:** `GEMINI_FINISH_MAP`, `mapGeminiFinishReason`.
6. **UI components:** `GeminiPrivacyNotice`.
7. **Provider dump utility:** `buildGeminiDumpContents`.
8. **Test fixture data:** `geminiModel` in
   `packages/core/test/models/__fixtures__/mock-data.ts`.

## CI integration

The guard runs in the `lint_javascript` CI job, after `lint:cli-boundary`
and before `gate:agents-neutral`:

```yaml
- name: 'Run genai-enclave boundary guard'
  run: |-
    npm run lint:genai-enclave
```

A PR that introduces a new `@google/genai` import or Gemini-named export
outside the enclaves will **fail CI**.

## Running locally

```bash
npm run lint:genai-enclave
# or directly:
bun scripts/check-genai-enclave.ts
```

For test fixtures (synthetic trees), set `GENAI_ENCLAVE_ROOT=<dir>` to scan a
temp directory instead of the real repo.

## Inventory ratchet

`dev-docs/genai-import-baseline.md` is the generated inventory of every
tracked `@google/genai` importer. As of #2623, all importers are classified
as `enclave` (20 files). The count may only ever **decrease**, never
increase. Check with:

```bash
bun scripts/genai-import-inventory.ts --check
```
