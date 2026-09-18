# Runtime plugins

Optional LLxprt Code runtime plugin packages (issue #2759). Each directory in
this tree is a standalone package context that sits OUTSIDE the root
workspaces: a root `bun install` or `npm install` never installs anything from
here, and the root lockfiles never record plugin workspace membership.

## Why plugins live outside the workspaces

Runtime plugins are optional by design (issue #2758): installing a package is
what makes a provider available. Google-specific dependencies
(Gemini SDKs, Google auth libraries) must therefore never leak into base
installs. Reserving each plugin as its own install root with its own lockfile
is what makes that boundary verifiable instead of aspirational. The topology
guard in `scripts/tests/plugins-topology.test.ts` fails if a root workspaces
edit absorbs this tree or a root lockfile gains a plugin entry.

## Naming

Package names are `@vybestack/llxprt-plugin-*`:

- `@vybestack/` is the repo's first-party scope.
- The `llxprt-plugin-` prefix makes an installed package identifiable by name
  alone, while remaining compatible with the #2758 discovery rule. Discovery
  never scans by name: a package opts in by declaring
  `{ "llxprt": { "runtimePlugin": true } }` in its own manifest, and any name
  is accepted. The bare package name (no path) is what discovery hands to the
  loader.

## Host contract

Each plugin declares the host packages it compiles against as
`peerDependencies` (`@vybestack/llxprt-code-core`,
`@vybestack/llxprt-code-providers`) with caret ranges matching the workspace
version. Plugins never bundle host code: source imports from host packages are
type-only, and the published `files` allow-list is `dist` + `README.md`.

Typecheck and test resolve the host packages through tsconfig `paths` entries
pointing at the in-repo host sources, so no host package is ever installed.
The plugin lockfile records only toolchain dependencies (`@types/bun`,
`@types/node`, `typescript`), which keeps a plugin install small, fast, and
deterministic. This is deliberate: linking the host packages with `file:`
dependencies would make each plugin install re-resolve the entire monorepo
dependency graph (the host packages themselves interlink via relative `file:`
dependencies), and the resulting lockfile goes stale every time a host
package's dependencies change.

## Flows (run from inside a plugin directory)

Plugin-local installs use Bun >= 1.4.2 (enforced by `engines.bun`) and omit
peers, because the peers are provided by the host at runtime and no registry
publish of `@vybestack/llxprt-code-*@^0.12.0` exists to satisfy them:

```
bun install --omit=peer
bun run typecheck    # tsc --noEmit against real host source via tsconfig paths
bun test             # bun:test suite
bun run build        # tsc -> dist/ (host contract resolved via types/host-contract.d.ts)
bun run pack:smoke   # npm pack --dry-run
```

Each plugin has its own committed `bun.lock`; regenerate it only with
`bun install --omit=peer`. Re-running the same command reproduces the lock
byte-for-byte.

## Publication

Release automation (`.github/workflows/release.yml`) publishes plugins from
the explicit ordered list in `scripts/utils/release-packages.ts`
(`FIRST_PARTY_RUNTIME_PLUGIN_RELEASES`), after every base workspace package and
the CLI, because plugins peer-depend on host packages that must already exist
on the registry. The list is never derived by scanning this directory.
