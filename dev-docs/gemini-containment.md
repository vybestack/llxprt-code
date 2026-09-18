# Gemini containment gate

The permanent rulebook for where Google Gemini code may live in this
repository, introduced by issue
[#2628](https://github.com/vybestack/llxprt-code/issues/2628) and enforced by
`scripts/check-gemini-containment.ts`.

## The invariant

The base repository ships zero Google-generation SDK surface: no
`@ai-sdk/google` dependency declaration outside the plugin, no import-shaped
reference to the SDK in any base source or test, and no Gemini-resident
provider file under `packages/providers/src/**`. The Gemini provider
implementation lives exclusively in the non-workspace runtime plugin
`plugins/google-gemini`, which alone declares `@ai-sdk/google` (in its own
`package.json` `dependencies`) and contributes the `gemini` provider id and its
built-in aliases. `plugins/google-mcp-auth` is the second scaffolded runtime
plugin; it contributes no Google generation capability.

The containment model is register-free and permanent: no provenance registers,
no allowlists, no baselines, no ratchets. The gate is a structural scan, and
any violation fails it.

## Gate layers

- **L1-manifest** — exactly one `@ai-sdk/google` dependency declaration exists
  repo-wide, in `plugins/google-gemini/package.json` `dependencies`; npm-alias
  disguises are rejected in every manifest, and the required manifests (root,
  plugin) must exist and parse — a missing manifest fails the gate rather than
  passing silently.
- **L1-lockfile** — the root `bun.lock` and `package-lock.json` carry no
  resolution or workspace entry for the SDK; the plugin-local `bun.lock` is a
  separate install context and is allowed to carry it.
- **L2-import** — no import-shaped SDK specifier appears anywhere outside
  `plugins/*/src/**` and `plugins/*/dist/**`: static, type-only,
  inline-braced type-only, dynamic `import()`, `require()`, re-export, and
  `mock.module` / `vi.mock` / `jest.mock` specifier arguments are all flagged,
  across the `packages/`, `scripts/`, `evals/`, `integration-tests/`, and
  `test-scripts/` lanes plus root loose files, production and test sources
  alike.
- **L3-residency** — no file under `packages/providers/src/**` has a basename
  starting with `gemini` (either case); the provider tree lives only under
  `plugins/google-gemini/src/**`.
- **envelope** — the provider ids and built-in aliases contributed by plugin
  manifests exactly equal the plugin-owned capability set the base hints at in
  `PLUGIN_PROVIDED_PROVIDER_HINTS`
  (`packages/providers/src/composition/runtimePlugins/pluginProvidedProviders.ts`,
  currently `gemini` → `@vybestack/llxprt-plugin-google-gemini`).

The matcher is structural, not a substring search: a non-import mention of the
SDK name (this page, or models.dev metadata recording which npm package
implements a provider) is not a violation.

## Sanctioned zones

- `plugins/*/src/**` — plugin source, including every `@ai-sdk/google` import.
- `plugins/*/dist/**` — built plugin artifacts.
- `plugins/*/bun.lock` — plugin-local lockfiles (separate install contexts).
- The owning plugin's `package.json` `dependencies` — the single sanctioned
  SDK declaration site.

Everything else in the repository, including all workspace packages, is outside
these zones.

## Envelope rule

Plugin-contributed providers and aliases must exactly match the base hint
table: every alias-carrying contribution must be the one the hint names, and
every hinted id must be contributed by the plugin the hint names. Alias-less
provider contributions (the reserved-stub shape the manifest v1 schema
requires, e.g. `google-mcp-auth`) are exempt from the exact-set comparison
because they construct no aliases, but a hint must never point at them.

A2A protocol shapes are exempt: agent-to-agent envelope identifiers carrying
the `kind` / `messageId` / `taskId` discriminators stay legitimate A2A
messages even when their metadata references the `gemini` provider id. The
gate flags only SDK imports, declarations, and residency — never
protocol-shape identifiers in host code.

## Running it

```sh
bun scripts/check-gemini-containment.ts           # fail mode: exit 1 on any violation
bun scripts/check-gemini-containment.ts --report  # print the findings table, always exit 0
npm run lint:gemini-containment                   # CI entry, lint_javascript job
```

For fixture trees, set `LLXPRT_GATE_ROOT=<dir>`; a nonexistent directory is an
error, never a silent pass. The gate never imports workspace or plugin code —
it reads manifests, lockfiles, and sources structurally — so the scripts lane
stays dependency-free.

## What was retired

The old guard family — `scripts/check-genai-enclave.ts`, the agents-neutral
gates, the `genai-import-inventory` baseline ratchet, and the agents package
Gemini naming scanner — was deleted after measured parity. Every injection
shape the old guards detected is detected by this gate, and every old
capability without a successor has a recorded justification. The differential
evidence lives in [gemini-containment-parity.md](./gemini-containment-parity.md);
the live parity suite is `scripts/tests/gemini-containment-parity.test.ts`,
which re-asserts the new gate's verdict for every matrix row on every run.

## Residual risks

From parity §8, stated plainly:

- The legacy `@google/genai` specifier is unguarded — the gate targets
  `@ai-sdk/google` only. Mitigating facts: the legacy SDK has zero current
  importers and zero declarations, and new Google-generation SDK usage is
  supposed to enter through the plugin.
- Computed-specifier imports remain invisible to static analysis (true of
  every static gate, during and after retirement). The L1
  exactly-one-declaration rule keeps the SDK unresolvable outside the plugin
  at runtime, but cannot detect the import shape itself.
- Gemini-named identifier and export hygiene outside
  `packages/providers/src/**` is now convention, not gate; L3 keeps only file
  residency.
