# Naming Standard

Status: enforced. Issue #2533 established this standard and removed the
historical alias matrix. The `custom/no-alias-probes` ESLint rule rejects new
alias probes in CI.

## Principle

Every LLxprt-owned name has exactly one canonical spelling per boundary. Code
must never probe for alternate spellings of the same field
(`value.oldName || value.newName`). External spellings are adapted once, at the
boundary that owns the external format, and mapped immediately to LLxprt types.

## Conventions by boundary

### TypeScript source

- Values, functions, properties, variables: `camelCase`.
- Types, classes, components, enums: `PascalCase`.
- Constants that are themselves names (tool names, schema keys): declare once
  next to the thing they name and import everywhere else
  (for example `TaskTool.Name`, `SCOPE_LOCAL_EMIT_TOOL_NAME`).

### Model-facing JSON and tool parameters

- Tool parameter schemas exposed to the LLM use `snake_case`
  (see `packages/agents/src/tools/taskSchema.ts`:
  `subagent_name`, `goal_prompt`, `expected_outputs`, `tool_whitelist`).
- Schemas set `additionalProperties: false` so alternate spellings are rejected
  by the schema itself, with a validation message naming the canonical field.
- TypeScript types describing the wire shape carry the same single spelling;
  internal code normalizes once into camelCase invocation types
  (`TaskToolInvocationParams`).

### Slash commands and subcommands

- One canonical lowercase literal per command and subcommand, declared once at
  registration and reused by completion, dispatch, usage text, and docs.
- Example: `/tools desc`. The `descriptions` spelling was removed.

### Persisted settings and profile keys

- The settings registry's primary key is the canonical spelling
  (`tools.disabled`, `max_tokens`, `base-url`, `auth-key`).
- Legacy spellings are migrated once, destructively, at load
  (`packages/settings/src/settings/legacyKeyMigration.ts`); they are never
  resolved at read time.
- `/set` rejects legacy spellings with a message naming the canonical key.
- Environment variables: `UPPER_SNAKE_CASE`.

### Tool names and namespaces

- One algorithm: `packages/tools/src/formatters/toolNameUtils.ts` and
  `toolGovernanceUtils.ts` (`canonicalizeToolName`,
  `canonicalizePolicyToolEntry`, `getToolNameCandidates`, `buildToolGovernance`,
  `isToolBlocked`). Registry, policy, subagent governance, commands, and UI
  import these; none re-implements normalization.
- User-authored policy entries (which may contain legacy spellings such as
  `ShellTool(npm test)` or wildcards) are decoded once at the policy boundary by
  `canonicalizePolicyToolEntry` into canonical registry names.
- The tool-name manifest is each tool's `static Name` declaration.
  `SUBAGENT_EXCLUDED_TOOL_NAMES` is pinned to `TaskTool.Name` and
  `ListSubagentsTool.Name` by a drift test.

### Provider and protocol fields

- Third-party wire spellings exist only inside the adapter that owns the
  protocol and are mapped immediately to LLxprt types
  (for example OpenAI `finish_reason` → internal `stopReason` in
  `packages/providers/src/openai/finishReasonMapping.ts`).
- LLxprt provider objects use `baseURL`; the settings key is `base-url`.
- Provider-specific malformed-name repair stays confined to
  `packages/providers/src/utils/toolNameNormalization.ts` and must emit the
  canonical form.

## Prohibited forms

```ts
// All of these are alias probes and fail lint (custom/no-alias-probes):
value.oldName || value.newName;
value.old_name ?? value.newName;
obj['old-name'] ?? obj.oldName;
params.foo_bar ?? params.fooBar;
```

Allowed, because they are not spelling probes:

```ts
x.flag || false; // boolean option fallback
x.name ?? 'default'; // literal default
a.b ?? c.d; // different objects
x.foo ?? x.bar; // genuinely different fields
```

Renaming an LLxprt-owned name: pick the canonical spelling, change every
declaration and use in one change, add the old spelling to
`LEGACY_SETTING_KEY_MIGRATIONS` (settings) or a one-time migration for its
format, update schemas/prompts/docs/tests, and never keep a read-side alias.

## Enforcement

- `eslint-rules/no-alias-probes.js`, wired as `custom/no-alias-probes` in
  `eslint.config.js`, flags `||`/`??` chains whose operands are spelling
  variants of the same property on the same object. Tests live in
  `eslint-rules/no-alias-probes.test.ts`.
- The table below is the full boundary-exception register: it records the
  owner, reason, and removal condition for every permitted non-canonical
  spelling.
- `BOUNDARY_EXCEPTIONS` in `eslint-rules/no-alias-probes.js` is the
  machine-enforced subset of that register: only the files whose exceptions
  contain lint-detectable probe forms need an entry there. Register rows
  without a lint entry are inert today (no flaggable chain exists); if such a
  row ever gains a probe form, it must gain a matching `BOUNDARY_EXCEPTIONS`
  entry, and inert rows must not be added to the allowlist preemptively.
  Generic inline `eslint-disable` comments remain disallowed repo-wide.

## Boundary-exception register

Each entry names the only place a non-canonical spelling may appear, why, and
the condition for removing it.

| Location                                                                                            | Owner                   | Reason                                                                                                                        | Removal condition                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/policy/src/config.ts` `normalizeToolName`                                                 | policy package          | Byte-equivalent twin of `canonicalizePolicyToolEntry`; policy has zero workspace dependencies                                 | Policy gains a tools dependency, or the decoder moves to a zero-dep shared module. Guarded by `packages/core/src/policy/toolEntryDecoderDrift.test.ts` |
| `SHELL_TOOL_NAMES` `ShellTool` member (`core`/`policy` shell-utils)                                 | policy/core maintainers | Policy engine and shell checks match raw user policy input before boundary decoding                                           | Decode `coreTools`/`excludeTools` at the CLI boundary before they reach these checks                                                                   |
| `packages/providers/src/openai/finishReasonMapping.ts`                                              | providers               | OpenAI wire field `finish_reason` decoding                                                                                    | Never (third-party wire format)                                                                                                                        |
| `packages/providers/src/auth/proxy/proxy-oauth-adapter.ts`                                          | providers               | Third-party OAuth proxy response: decode both wire spellings once at this boundary                                            | Never (third-party wire format)                                                                                                                        |
| `packages/providers/src/openai-vercel/errors.ts`                                                    | providers               | Third-party API error payload: decode both wire spellings once at this boundary                                               | Never (third-party wire format)                                                                                                                        |
| `packages/providers/src/utils/mediaDiagnostics.ts`                                                  | providers               | Gemini wire format: decode both spellings once at this boundary                                                               | Never (third-party wire format)                                                                                                                        |
| MCP transport `'streamable-http'` value alias                                                       | mcp                     | Ecosystem compatibility with existing MCP client configs                                                                      | Upstream MCP spec retires the value                                                                                                                    |
| `packages/cli/src/config/settingsLegacy.ts`, `packages/settings/src/settings/legacyKeyMigration.ts` | settings                | One-time destructive migrations of legacy spellings at load                                                                   | Remove entries after releases with no observed legacy keys in the wild                                                                                 |
| `packages/zed-acp/src/zed-tool-handler.ts` name mapping                                             | zed-acp                 | Zed ACP protocol names (`execute_command`, `exec`)                                                                            | Never (third-party protocol)                                                                                                                           |
| `packages/providers/src/utils/toolNameNormalization.ts`                                             | providers               | Provider-specific malformed-name repair, emits canonical form only                                                            | Provider retires non-canonical names                                                                                                                   |
| `packages/cli/src/utils/sandbox-containers.ts`, `packages/cli/src/utils/sandbox-seatbelt.ts`        | cli                     | `NO_PROXY`/`no_proxy`: both spellings are set and honored by the proxy ecosystem                                              | Never (third-party env convention)                                                                                                                     |
| `packages/tools/src/tools/apply-patch-analysis.ts`                                                  | tools                   | Rule false positive: oldFileName/newFileName are distinct semantic fields (source vs target hunk path), not spelling variants | Never (heuristic limit; revisit if the rule gains semantic awareness)                                                                                  |

`docs/token-usage-log.md` documents the token-usage wire log, whose
`subagent_name` field is snake_case by the model-facing rule above; it is
canonical, not an exception.
