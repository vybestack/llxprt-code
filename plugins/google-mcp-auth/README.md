# @vybestack/llxprt-plugin-google-mcp-auth

Reserved LLxprt Code runtime plugin context for Google MCP auth
contributions (issue #2759). It stays a minimal stub for the whole of that
issue: a valid manifest-v1 skeleton whose placeholder provider fails
actionably, with the same lockfile/build/test/pack flows as every other
plugin context.

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

The install omits peers (the host provides them at runtime) and records only
toolchain devDependencies; typecheck compiles against the real host source in
`packages/` via tsconfig paths.
