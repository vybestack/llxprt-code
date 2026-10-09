# @vybestack/llxprt-plugin-google-mcp-auth

LLxprt Code runtime plugin that provides the Google-specific MCP auth
providers:

- `google_credentials` — Application Default Credentials (ADC) access tokens
  with quota-project header handling.
- `service_account_impersonation` — ID tokens minted via the IAM Credentials
  `generateIdToken` API for a target service account and audience.

Base LLxprt Code installs no longer ship `google-auth-library`; an MCP server
configured with one of these `authProviderType` values requires this plugin.
Without it, connecting to that server fails with a terminal error naming the
plugin to install — there is no fallback to standard OAuth.

## Install

Install the plugin globally or into the project the same way other LLxprt
runtime plugins are installed (see the LLxprt docs on runtime plugins), e.g.:

```
npm i -g @vybestack/llxprt-plugin-google-mcp-auth
```

The host provides the peer packages (`@vybestack/llxprt-code-auth`,
`@vybestack/llxprt-code-mcp`, `@vybestack/llxprt-code-providers`,
`@vybestack/llxprt-code-telemetry`); this package brings only
`google-auth-library` as its runtime dependency.

See `plugins/README.md` for the topology, naming, and host-contract rules.

## Development

Run from inside this directory (requires Bun >= 1.4.2):

```
bun install --omit=peer
bun run typecheck
bun test
bun run build
bun run pack:smoke
```

The install omits peers (the host provides them at runtime) and records
toolchain devDependencies plus `google-auth-library`; typecheck compiles
against the real host source in `packages/` via tsconfig paths.
