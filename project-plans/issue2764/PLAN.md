# Plan: MCP auth factory contributions and Google ADC extraction (#2764)

Plan ID: PLAN-20260918-ISSUE2764
Generated: 2026-09-18
Issue: #2764 (milestone 0.12.0)
Prerequisites: #2758 (runtime plugin manifest v1 + provider contributions) and
#2759 (plugin topology) are closed and landed on main.

## Problem

`packages/mcp` (a base artifact) hard-imports `GoogleCredentialProvider` and
`ServiceAccountImpersonationProvider`, which value-import `google-auth-library`.
The root and `packages/mcp` manifests therefore ship Google ADC and IAM
impersonation to every install even though only Google-auth users need it.
There is also no way for a runtime plugin to contribute an
`authProviderType`-keyed `McpAuthProvider` factory: the transport dispatches
only the two Google enum members directly.

## Accepted behavior (from the issue)

1. MCP-owned immutable factory contributions returning the existing
   `McpAuthProvider`; the CLI passes loaded factories into the transport.
   Standard OAuth and static headers stay built in (unchanged).
2. Runtime plugin manifest v1 grows an optional `mcpAuthFactories` section.
   A manifest with no `providers` but with `mcpAuthFactories` is valid.
3. Unknown selected custom auth and factory failures are terminal and
   actionable; there is no standard-OAuth fallback.
4. Google credential and impersonation implementations/tests move to
   `plugins/google-mcp-auth` using the maintained `google-auth-library`;
   no handwritten ADC/IAM code and no `gcloud`.
5. Google config vocabulary (`authProviderType`, `targetAudience`,
   `targetServiceAccount`, oauth scopes) is retained. A2A is excluded.
6. Google auth library/implementations are removed from MCP/core/root base
   artifacts. Base OAuth works without the plugin; Google modes require it.

## Non-goals

A2A changes, generic MCP config/cycle resolution, OAuth redesign, Gemini
generation, config-key relocation (#2618 owns that).

## Design decisions

- **Registration seam.** The `mcp` package cannot import the providers
  composition registry (it sits below it). Following the #3305 precedent
  (`registerMcpHostServices` in `packages/mcp/src/host/hostServices.ts`), a
  startup-only `registerMcpAuthFactories(contributions)` seam lives in the MCP
  auth module; the CLI composition root (session bootstrap and the
  `llxprt mcp list` command) calls it with the contributions extracted from the
  loaded `ProviderContributionRegistry`. This threads factories into the
  transport with zero core-package changes and no module scanning.
- **Types.** `McpAuthProviderFactory`, `McpAuthFactoryContribution`, and
  `buildMcpAuthFactoryRegistry` are owned by `packages/mcp` (exported from the
  auth barrel). `packages/providers` imports these types (type-only) for its
  manifest schema/registry, so the manifest vocabulary is single-sourced.
  `providers` already depends on `core`, which depends on `mcp`; adding the
  direct type dep introduces no new transitive package.
- **Duplicate handling.** Case-insensitive `authProviderType` keys, matching
  the provider registry's convention. Duplicates throw at registry build time
  naming the type and the contributing plugins (providers side) or just the
  type (MCP-owned builder).
- **Error vocabulary.** `createTransport` keeps the existing
  missing-URL messages for the two Google types and gains a generic
  missing-URL message for other custom types. Unknown custom type names the
  type, the server, and (for the two Google types) the plugin package that
  supplies it. Factory invocation failures propagate as terminal errors with
  the server name, the type, and the original error as `cause`.
- **Plugin manifest.** The google-mcp-auth plugin drops its #2759 reserved
  placeholder provider and contributes exactly two `mcpAuthFactories` entries
  keyed by the `AuthProviderType` enum values `google_credentials` and
  `service_account_impersonation`.

## Phases

### Phase 1: MCP-owned factory types, transport dispatch, base cleanup

RED tests first (`packages/mcp/src/auth/mcp-auth-factory.test.ts`,
extensions to `packages/mcp/src/client/mcp-client.transport.test.ts`):

- `buildMcpAuthFactoryRegistry` rejects duplicate `authProviderType`
  (case-insensitive) naming the type; lookups are case-insensitive;
  the built registry is immutable; unknown lookups return `undefined`.
- `registerMcpAuthFactories` is startup-only (second registration throws);
  the default state is an empty registry.
- `createTransport` with a registered custom factory uses that provider's
  headers and auth provider (reuse the moved Google providers via a local
  test factory for dispatch assertions).
- Unknown custom `authProviderType` throws a terminal error naming the server
  and type; with `oauth.enabled: true` also set, the SAME error is thrown
  (proves no standard-OAuth fallback).
- Google types with no registered factory throw a terminal error naming
  `@vybestack/llxprt-plugin-google-mcp-auth`.
- A factory that throws propagates a terminal error carrying the server name,
  the type, and the cause; no fallback.
- Missing URL + Google types keeps the current messages; missing URL + other
  custom type throws the new generic message.
- Standard OAuth (no `authProviderType`, or `dynamic_discovery`) and static
  headers behave exactly as before.

Implementation:

- `packages/mcp/src/auth/mcp-auth-factory.ts`: factory/contribution/registry
  types, `buildMcpAuthFactoryRegistry`, startup-only
  `registerMcpAuthFactories`/`getRegisteredMcpAuthFactoryRegistry`.
- `packages/mcp/src/client/mcp-transport.ts`: remove Google imports; dispatch
  custom types through the registered registry with the error contract above;
  keep built-in OAuth/header path untouched.
- `packages/mcp/src/auth/index.ts`: remove `GoogleCredentialProvider` /
  `ServiceAccountImpersonationProvider` exports; export the new types and
  `FIVE_MIN_BUFFER_MS` (the plugin needs it alongside `OAuthUtils`).
- Delete `packages/mcp/src/auth/google-auth-provider.ts`,
  `sa-impersonation-provider.ts`, and their tests (they move in Phase 3).
- `packages/mcp/package.json` and root `package.json`: remove
  `google-auth-library`. Re-run plain `bun install` so `bun.lock` drops it.

### Phase 2: providers manifest + registry extension

RED tests first (extend `manifest.test.ts`, `registry.test.ts`):

- Manifest with `mcpAuthFactories` only (empty `providers`) parses, is frozen.
- Manifest with neither `providers` nor `mcpAuthFactories` is malformed with an
  actionable message.
- `mcpAuthFactories` entries with missing/empty `authProviderType` or a
  non-function `createAuthProvider` are malformed with the Zod path.
- Registry: `getMcpAuthFactories()` reports plugin contributions with plugin
  origin; duplicate `authProviderType` across plugins throws naming both
  plugins; built-in-only registry reports an empty list.

Implementation:

- `runtimePlugins/types.ts`: `RuntimeMcpAuthFactoryContribution`,
  manifest field, `RegisteredMcpAuthFactory`, registry method.
- `runtimePlugins/manifest.ts`: schema section + at-least-one-contribution
  refinement + deep freeze.
- `runtimePlugins/registry.ts`: collection, duplicate rejection, frozen
  exposure.
- `runtimePlugins/index.ts`: export new types.
- `packages/providers/package.json`: add `@vybestack/llxprt-code-mcp`
  (type-only dependency).

### Phase 3: plugins/google-mcp-auth becomes the real Google auth home

- Move (not copy) `google-auth-provider.ts` and `sa-impersonation-provider.ts`
  and their tests from `packages/mcp/src/auth/` into
  `plugins/google-mcp-auth/src/`, adapting imports to host barrels
  (`@vybestack/llxprt-code-mcp` for `McpAuthProvider`, `MCPServerConfig`,
  `OAuthUtils`, `FIVE_MIN_BUFFER_MS`; telemetry debugLogger;
  `google-auth-library` as a real dependency).
- Rewrite `plugins/google-mcp-auth/src/index.ts`: manifest v1 with the two
  `mcpAuthFactories` (enum-sourced type strings) and no placeholder provider.
- Update `plugins/google-mcp-auth/src/index.test.ts`: marker, id, manifest
  validity, both contributions present with callable factories constructing
  the right provider classes (google-auth-library mocked at the module
  boundary, as the moved tests already do).
- Plugin contract tests (composition-level): loading the plugin manifest
  through `parseRuntimePluginManifest` + `buildProviderContributionRegistry`
  yields the two factories; `buildMcpAuthFactoryRegistry` +
  `createTransport` resolves Google modes end to end (mocked
  google-auth-library).
- `plugins/google-mcp-auth/package.json`: add `google-auth-library`
  dependency; peerDependencies for `@vybestack/llxprt-code-providers`,
  `@vybestack/llxprt-code-mcp`, `@vybestack/llxprt-code-auth`,
  `@vybestack/llxprt-code-telemetry` (host-provided). Regenerate the plugin
  `bun.lock` with `bun install --omit=peer` inside the plugin dir.
- Update the plugin README (no longer a reserved stub).

### Phase 4: CLI composition + artifacts/tests/docs

- `cliSessionBootstrap.ts`: after `loadInstalledRuntimePlugins()`, register
  MCP auth factories extracted from the registry (helper in
  `packages/cli/src/mcpHostWiring.ts` or a sibling).
- `packages/cli/src/commands/mcp/list.ts`: load installed runtime plugins and
  register factories before connection tests so `llxprt mcp list` resolves
  plugin-backed auth types too.
- `scripts/tests/plugins-topology.test.ts`: expected runtime deps for
  google-mcp-auth become `{ 'google-auth-library': '^9.11.0' }` (match the
  declared range exactly as the test compares) and peer expectations updated.
- `scripts/tests/issue-2603-plugin-install-layouts.test.ts`: google-mcp-auth
  install layout assertions move from provider factory to
  `getMcpAuthFactories()`.
- `schemas/settings.schema.json`: keep the enum; extend the
  `authProviderType`/target field descriptions to note the plugin
  requirement for Google modes.
- `docs/tools/mcp-server.md`: document that `google_credentials` and
  `service_account_impersonation` require installing
  `@vybestack/llxprt-plugin-google-mcp-auth`, with install command and error
  behavior (terminal, no OAuth fallback).
- Verify base cleanliness: `grep -rn "google-auth-library" package.json
  packages/` finds only the plugin; `grep -rn "GoogleCredentialProvider"
  packages/` finds nothing.

### Phase 5: verification cycle

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, plus plugin-local `bun install --omit=peer`, `bun run
typecheck`, `bun test`, `bun run build`, `bun run pack:smoke` inside
`plugins/google-mcp-auth`, and the smoke test
`bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"`.

## Review

deepthinker compliance review (max 2 rounds), then PR. OCR is currently
disabled by Andrew's standing instruction; do not run it unless he re-enables
it. CodeRabbit on the PR is addressed per workflow.

## Out of scope (explicit)

- agents/a2a-server plugin loading (Google modes there surface the terminal
  install-required error, which is the accepted behavior).
- Moving `authProviderType` config keys (#2618).
- Any new global plugin framework surface beyond the manifest section.
