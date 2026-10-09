# @vybestack/llxprt-plugin-google-gemini

Optional LLxprt Code runtime plugin supplying the Google Gemini provider.
The provider implementation and its behavioral suites live in this package
following the extraction in #2763.

## Status

The manifest contributes the `gemini` provider and its default alias. The base
CLI does not include Gemini. In a source checkout, install this package's
dependencies before selecting `gemini` or running CLI integration tests that
use it. Root installs and builds do not install optional plugin dependencies.
Checkout discovery loads this package from `src/index.ts` when its own
`node_modules` exists; a plugin build is not required for source execution.

## Install

```
npm i -g @vybestack/llxprt-plugin-google-gemini   # or: bun add -g
```

Installing the package next to the CLI is what makes discovery pick it up
(marker `{ "llxprt": { "runtimePlugin": true } }`). See `plugins/README.md`
for the topology, naming, and host-contract rules.

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
