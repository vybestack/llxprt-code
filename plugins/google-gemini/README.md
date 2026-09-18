# @vybestack/llxprt-plugin-google-gemini

Optional LLxprt Code runtime plugin that will contribute the Google Gemini
provider. This package is scaffolding (issue #2759): it reserves the package
context, lockfile, build/test/pack flows, and manifest-v1 skeleton. The
Gemini production code and its behavioral suites move in via #2762/#2763.

## Status

The manifest contributes a placeholder `google-gemini` provider whose factory
fails with an actionable error. It does not contribute `gemini` yet because
the built-in `gemini` provider still exists in the base CLI; the extraction
issue (#2763) removes the built-in and retires this placeholder.

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
