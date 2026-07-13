# `@google/genai` Enclave Boundary Rules (#2352)

> **Authoritative boundary rules** for where `@google/genai` imports and
> Gemini-named exports are permitted in the llxprt-code monorepo. Enforced
> by `scripts/check-genai-enclave.ts` (AST-precise, TypeScript compiler API)
> and wired into CI alongside the lint guards.

## Enclaves (permanent `@google/genai` import zones)

Only these two subtrees may import `@google/genai`:

| Enclave         | Path                               | Rationale                                              |
| --------------- | ---------------------------------- | ------------------------------------------------------ |
| Gemini provider | `packages/providers/src/gemini/**` | Provider implementation; needs the SDK for API calls.  |
| Code Assist     | `packages/core/src/code_assist/**` | Code-Assist back-end; needs the SDK for OAuth + calls. |

Everything else in `packages/**` — core (non-code_assist), agents, cli, tools,
mcp, telemetry, a2a-server, test-utils — is **forbidden** from importing
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

1. **Model-ID constants** — `DEFAULT_GEMINI_MODEL`, `DEFAULT_GEMINI_FLASH_MODEL`,
   etc. (genuine env-var / default model IDs).
2. **Neutral structural types** — `GeminiContent`, `GeminiContentPart`, etc.
   in `packages/core/src/llm-types/geminiContent.ts`.
3. **Finish-reason mappers** — `GEMINI_FINISH_MAP`, `mapGeminiFinishReason`.
4. **Deprecated public legacy aliases** — `GeminiEventType`,
   `ServerGemini*Event` types, `GeminiCLIExtension`, etc. These are in
   `packages/core/src/core/geminiLegacyAliases.ts` and are deprecated.
5. **Provider classes/factories** — `GeminiProvider`, `GeminiMessageConverter`,
   `createGeminiAliasProvider`.
6. **UI components** — `GeminiPrivacyNotice`.
7. **Provider dump utility** — `buildGeminiDumpContents`.

### Follow-up: legacy alias rename (next major release)

The deprecated public legacy aliases (category4 above) should be renamed to
provider-neutral names in the next major release. They are allowlisted now to
avoid breaking consumers in a patch release. This is a **documented follow-up
need** — do NOT remove them without a major version bump.

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
tracked `@google/genai` importer. As of #2352, all importers are classified
as `enclave` (27 files). The count may only ever **decrease** — never
increase. Check with:

```bash
bun scripts/genai-import-inventory.ts --check
```
