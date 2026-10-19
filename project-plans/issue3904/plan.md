# Issue #3904: script-disabled installation investigation and remediation plan

Documentation checks: `git diff --check`, explicit plan trailing-whitespace and
balanced-fence checks passed. `bun scripts/check-doc-placement.ts` initially
failed because this checkout lacks `marked`; rerunning with `NODE_PATH` pointing
to the isolated nightly consumer's dependencies passed (`doc-placement guard
PASSED`), without installing or linking checkout dependencies.

Date: 2026-10-19. Investigated checkout: `issue3904`, HEAD `45a5157c7`.

Status: final-cap remediation complete; verification remains blocked by the
agents watchdog test and missing Luna profile. The round-2 report below records
the current results; earlier reports are historical evidence.
The investigation sections preserve the original evidence and proposed scope;
the implementation report supersedes their historical statements about checks
not yet run. `.llxprt/` was not modified. No global system installation,
credential write, commit, push, issue assignment, or PR was performed. Global
consumer proofs use disposable explicit prefixes only. This implementation run
was explicitly instructed not to commit, push, or create a PR.

## Behavioral requirement

[Issue #3904](https://github.com/vybestack/llxprt-code/issues/3904) reports that
Linux global npm installs need `--dangerously-allow-all-scripts`, for both stable
and nightly. Its original npm/Node versions and exact error were not supplied.

Required outcome: a clean registry-consumer install succeeds and its public
`llxprt` command launches with all dependency lifecycle scripts disabled, without
an existing global Bun, consumer postinstall, compiler, or download-on-launch
repair. Keep execution under Bun and support macOS, Windows, and Linux. Preserve
optional native-feature degradation rather than making optional addons mandatory.
Avoid another launcher/package/shim layer.

Distinguish three contracts: installation exit status, public-command startup,
and runtime capabilities. A successful install is not evidence of successful
startup; `--version` alone does not exercise native feature behavior.

## Verified root cause

Both current registry tags reproduce **installation success followed by startup
failure**, not an npm install error:

| Artifact | Scripts-disabled global install | Installed `--version` / `--help` |
| --- | --- | --- |
| latest: `0.11.0` | exit 0; 73.3 s | both exit 1 |
| nightly: `0.12.0-nightly.261019.45a5157c7` | exit 0; 41.0 s | both exit 1 |

Failure text begins `Error: Bun's postinstall script was not run.` and recommends
running `node install.js`. This is Bun's placeholder speaking, not an LLxprt
native-grammar error.

Causal chain:

1. The published CLI's own `bin.llxprt` points to `bin/llxprt.mjs`, with a Node
   shebang. That supervisor locates Bun and then runs the prebuilt Bun bundle.
2. CLI declares `bun: 1.3.14` plus exact-pinned optional `@oven/bun-*` packages.
3. The `bun@1.3.14` tarball **already contains** `bin/bun.exe` and `bin/bunx.exe`:
   each is a 450-byte shell error placeholder, not a native runtime. The `.exe`
   name is used on POSIX too. npm makes the bin target executable during linking.
4. `packages/cli/bin/llxprt.mjs::resolveBun()` tries `bun/bin/bun.exe` before the
   script-free `@oven` packages. `isFile()` checks only that it is a regular file.
   Therefore the placeholder shadows the valid `@oven` binary.
5. Script-enabled Bun installation would replace the placeholder with the native
   binary. Enabling scripts masks this launcher-selection defect.
6. The earlier #2978 fixtures model **absence**, not the actual placeholder.
   `scripts/tests/issue-2978-oven-fallback.bun.test.ts::makeNpmV12Layout()` even
   documents `bun/bin/bun.exe` as absent. The production fallback is never reached
   in the real script-disabled shape.

Strong causal control: with PATH containing **only a Node symlink**, the public
command failed on both artifacts. Renaming only the placeholder inside each
throwaway installation made the unchanged public command pass both `--version`
and `--help`. Restoring the placeholder restored exit 1. Nothing in the checkout
was changed, and both temporary placeholders were restored. Direct execution of
both bundle and source with the installed `@oven` Bun also returned the correct
version. This is diagnostic evidence, not a proposed user workaround.

Additional reproductions:

- npm `12.2.0` **default** nightly install, without `--ignore-scripts`, exited 0,
  warned that scripts for 18 packages were blocked by `allowScripts`, and the
  installed command failed identically. No dangerous script permission was used.
- Bun `1.4.3` clean local-consumer `bun add --ignore-scripts` installed nightly
  successfully, reported 16 blocked postinstalls, and its installed `.bin/llxprt`
  failed identically. This is not exclusively an npm failure.

## Architecture and release path

### Actual publishable package versus private root

- `package.json` is private, owns workspace orchestration, and points its dev bin
  at the older POSIX `packages/cli/bin/llxprt`. Its pre/postinstall hooks perform
  repository setup/patching/link repair. They are not the public CLI tarball's
  lifecycle contract.
- `packages/cli/package.json` is the public package. It still declares consumer
  `postinstall: node scripts/install-native-launchers.cjs`. That script can
  replace npm-generated Windows wrappers, but the own Node-shebang bin already
  exists specifically to work when that hook is denied.
- `packages/cli/src/launcher/bun-path-resolver.ts` is the older Node-to-Bun
  relaunch path. Its default checker uses `X_OK`, so a linked executable
  placeholder can also pass there. Under Bun, bootstrap skips that relaunch;
  this was not the failure point in the public-command reproductions.
- The `.mjs` supervisor also owns argv forwarding, signal behavior, capability
  fd 3, and installed memory-profiler dispatch. Do not replace it with an
  unrelated launcher or lose those contracts.

### Build, binding, stable, and nightly

- `.github/workflows/release.yml` handles **both stable and scheduled nightly
  publication**. `.github/workflows/nightly.yml` is a verification workflow, not
  the nightly npm publisher.
- Release uses Node 24 and `.bun-version` (`1.3.14`), installs with `npm ci`, runs
  version preparation and `scripts/bind-release-deps.ts`, builds/prepares
  packages, and publishes internal workspaces before CLI. Published nightly
  manifests observed here contain exact sibling release versions, not source
  `file:../...` links.
- `scripts/bun-build.config.ts` builds `target: 'bun'` CLI/profiler artifacts.
  CLI `prepack` invokes it on the publisher. `scripts/copy_bundle_assets.ts`
  stages WASM and other runtime assets. Native modules and dirname-sensitive
  dependencies remain external; they must resolve in the consumer graph.
- Entry selection remains forced source (`LLXPRT_FORCE_SOURCE_ENTRY=1`), otherwise
  existing bundle, otherwise source. A broken existing bundle does not fall back
  after execution failure. Do not change that policy as a workaround.
- Existing native smoke, workspace CI, source/bundle execution, and script-enabled
  install smoke do not establish the denied-script registry-consumer contract.
- `scripts/tests/release-bound-artifact-helpers.ts` already provides the faithful
  official-binder/unchanged-manifest/loopback-cache proof needed for remediation.
  However its consumer install currently passes `--ignore-scripts=false` and
  `--foreground-scripts`; its full test is opt-in via
  `LLXPRT_RELEASE_BUILT_ROOT` and `LLXPRT_RELEASE_PROOF_DIR`.
- The older `issue-2603-release-pack.cjs` distinguishes a bound reference artifact
  from an offline replica rewritten to local tarballs. Testing that replica alone
  must not be presented as testing the release-bound graph.

### Lockfiles and resolver drift

Both `package-lock.json` and `bun.lock` are committed. Root/workspace declaration
parity is checked in `scripts/tests/bun-workspaces.test.ts`. npm consumers do not
use the repository's Bun lockfile or private-root trust allowlist, and published
caret ranges resolve afresh:

- committed ripgrep wrapper: `@lvce-editor/ripgrep@5.7.0`; fresh npm consumer:
  `5.8.0`; both route to `@vscode/ripgrep@1.18.0`;
- committed sharp `0.35.3`; fresh consumer `0.35.5`;
- Bun and `@oven` runtime packages remain exactly `1.3.14`.

`hasInstallScript` is a risk inventory, not proof that runtime artifacts require
that script. Likewise `trustedDependencies` describes contributor Bun installs,
not permission to demand arbitrary code execution on consumers. Do not regenerate
lockfiles or change trust speculatively. Bun frozen-lock behavior is documented
as unsuitable for this workspace; use the repository's plain-install/lockfile
checks during implementation, with bounded reviewed changes.

## Native dependencies: observed behavior and platform limits

All following feature probes used the **installed** `@oven` Bun `1.3.14`, without
running installation scripts. They are diagnostic probes, not committed tests.

| Capability | Actual result on Linux x64 glibc |
| --- | --- |
| `@ast-grep/napi` | Builtin TypeScript parsing works |
| Dynamic AST grammars | Published tools `parseSource` parses Python, Go, Rust, Java, C++, C, JSON, Ruby on both stable/nightly |
| Ripgrep | Installed `@vscode/ripgrep-linux-x64/bin/rg` performs a real matching search, exit 0; no system rg used |
| sharp | Encodes a real 1×1 PNG on both artifacts |
| Bash / PowerShell | `web-tree-sitter` loads shipped WASM and parses without syntax errors on both |
| POSIX PTY | Installed core `createBunPty` spawns `/bin/sh`, captures output and exit 0 on both, with global Bun absent from PATH |
| `@lydell/node-pty` | Module loads on both; Linux native PTY execution deliberately not exercised because Bun uses its own Terminal adapter |
| `@napi-rs/keyring` | Native module loads on both; constructor passed nightly but stable returned `KeyRevoked`; no password reads/writes attempted |

Dependency interpretation:

- `@ast-grep/lang-*` tarballs ship `prebuilds/.../parser.so`. Their installed
  `index.js` calls `@ast-grep/setup-lang::resolvePrebuild()` at runtime. Setup
  `0.0.6` postinstall first checks the same prebuild and only tries a source build
  if absent. On this supported host it is unnecessary. Do not assume these
  postinstalls download required artifacts based on old documentation.
- All thirteen observed grammar tarballs have Linux x64/arm64, macOS arm64, and
  Windows x64 prebuilds. They lack macOS x64 and Windows arm64 prebuilds. There is
  no libc distinction in that grammar layout. Availability on those missing
  tuples or musl is not established. Core N-API optional-package support is
  broader than these dynamic grammar prebuilds.
- The tools utility lazily registers eight dynamic grammars together and catches
  failure; builtin languages remain available. Missing dynamic grammars should
  produce its documented unavailable result, not force a consumer build or crash
  startup. Windows security policy can independently block unsigned grammars.
- `@vscode/ripgrep@1.18.0` and current lvce wrapper have no consumer lifecycle
  hooks; rg arrives via OS/CPU optional packages. Historical download-script
  descriptions do not describe the current locked or freshly resolved graph.
- sharp, ast-grep N-API, keyring, and `@lydell/node-pty` use optional platform
  payloads. Keep these; there is no evidence supporting wholesale replacement.
- Bash/PowerShell `node-gyp-build` hooks build Node bindings the runtime parser
  does not import. The shipped WASM works with scripts denied. In particular,
  trusting `tree-sitter-pwsh` was already investigated and rejected historically.
- Bun POSIX uses `Bun.Terminal`; Windows uses prebuilt `@lydell/node-pty` ConPTY
  with optional legacy `node-pty` fallback. Legacy `node-pty` install/build scripts
  are not required for the verified POSIX path. Windows fallback behavior still
  needs hosted validation; do not promote that dependency to mandatory.
- Four Linux x64 `@oven` payloads were installed (glibc/musl × AVX2/baseline),
  not exactly one. Launcher CPU/libc selection still matters. Current detection
  identifies musl using `/etc/alpine-release`, which is not a general musl proof;
  test non-Alpine musl separately. Do not assume all optional payloads are usable.

## Historical decisions to preserve

1. [PR #2305](https://github.com/vybestack/llxprt-code/pull/2305), fixing #2243:
   no consumer compilation; Bun executes shipped TypeScript. Its original launcher
   explicitly rejected text placeholders with executable-header validation.
   That historical protection is absent from the current regular-file/X_OK checks.
2. [PR #2610](https://github.com/vybestack/llxprt-code/pull/2610), fixing #2603:
   direct Bun launch and Windows wrapper generation for startup/argument fidelity.
   This explains today's legacy POSIX launcher and install-native script; it does
   not require retaining consumer postinstall forever.
3. [Issue #2978](https://github.com/vybestack/llxprt-code/issues/2978) and
   [PR #3086](https://github.com/vybestack/llxprt-code/pull/3086): direct pinned
   `@oven` payloads to survive npm script denial; workspace/link installs conceal
   registry-only failures. **The PR body is stale** about OS-gated child-bin
   packages and about bun.exe being absent. The final design was corrected by
   [commit dec99ec81412](https://github.com/vybestack/llxprt-code/commit/dec99ec81412f2fda9c5fa621379ce2bce045417):
   restore the public CLI's own Node-shebang bin, because npm global installs do
   not link dependency bins. Do not resurrect child launcher packages.
4. [PR #3013](https://github.com/vybestack/llxprt-code/pull/3013), fixing #2999:
   publisher-prebuilt bundle improves startup while preserving no consumer build.
   Measured speedup was approximately 2×, not the retracted 11.7×. It added nightly
   bundle-launch coverage but deliberately deferred a release-time gate.
5. [PR #2407](https://github.com/vybestack/llxprt-code/pull/2407): lazy,
   fault-tolerant dynamic grammar registration, especially for Windows native
   security-policy failures. Preserve builtin AST functionality when addons fail.
6. [Issue #3309](https://github.com/vybestack/llxprt-code/issues/3309),
   [PR #3317](https://github.com/vybestack/llxprt-code/pull/3317), and
   [commit e470ccefa](https://github.com/vybestack/llxprt-code/commit/e470ccefa4c57f123e5aafb4895be7d507bb8720):
   missing PowerShell installation was not a Bun trust-list omission; WASM ships
   without native build. Do not fix this issue by granting more trust.
7. [Issue #3771](https://github.com/vybestack/llxprt-code/issues/3771): earlier
   `file:`-dependency allegation was corrected because the proof skipped the
   official binder. Faithful release-bound coverage exists but remains opt-in;
   release CI delivery is pending. Reuse it, rather than altering source workspace
   dependencies or weakening guards.

GitHub research used GitHub tools and local git history, not webfetch.

## Minimal implementation plan: red → green → broaden verification

### Increment 1: prove and repair the actual launcher failure

**RED** in existing `scripts/tests/issue-2978-node-shim.bun.test.ts` (and shared
`launcher-test-helpers.ts` only if needed):

- Construct the real script-disabled shape: CLI own bin, executable Bun text
  placeholder, valid script-free host `@oven` payload, actual application entry.
  Run the real launcher and assert entry output/argv and successful exit. No
  resolver mocks. Reuse the downloaded pinned Bun fixture or a deterministic
  placeholder fixture grounded in the inspected tarball, not just a missing file.
- Cover local and hoisted layout; only Node on PATH, no global Bun/rg fallback.
- Preserve native `bun` success when postinstall previously moved the `@oven`
  executable out of its package. Preserve legitimate application nonzero exits;
  never retry the application merely because it returned nonzero.
- Placeholder without any usable runtime must give LLxprt's actionable exit 43,
  not Bun's instruction to run consumer postinstall. Keep missing entry behavior.

**GREEN** in `packages/cli/bin/llxprt.mjs`:

- Treat the candidate as a native runtime, not merely a file. Restore bounded
  executable-header validation for direct native Bun candidates (ELF, supported
  Mach-O/fat forms, PE on Windows), rejecting the text placeholder; require
  executable accessibility on POSIX. Apply checks to the selected payload too.
- Keep healthy native Bun precedence, existing `@oven` host selection, and
  ancestor/module-resolution behavior. Do not hardcode the 450-byte size, error
  text, builder path, or a global runtime. Do not execute an arbitrary candidate
  as a version probe on every startup or add download/build repair.
- Do not introduce another shim or platform launcher package. The existing
  `.mjs` is an established bootstrapping exception: edit it, do not create new JS.
- Keep bundle/source and profiling/fd/signal contracts unchanged.

If maintaining the supported Node-to-Bun relaunch path, first add a real public
`resolveBunPath` regression in
`packages/cli/src/launcher/bun-path-resolver.test.ts`, then give
`bun-path-resolver.ts` the same placeholder rejection for package-native
candidates, while preserving intentional Windows wrapper policy. Do not expand
into a new generic resolver framework. Root POSIX dev-launcher and legacy
`install-native-launchers.cjs` are separate entry paths: characterize them only
if their public behavior is retained/changed; do not confuse them with the public
npm bin.

### Increment 2: remove the consumer hook, not add one

First make an installed-command behavior check pass with the hook absent and
scripts disabled, including real Windows npm-generated CMD/PowerShell wrappers.
Then in `packages/cli/package.json` remove the consumer `postinstall` hook and
its explicit `files` inclusion of `scripts/install-native-launchers.cjs`.
Retain the own Node-shebang `bin.llxprt` and publisher `prepack`. Keep legacy
helper source for contributor/root compatibility initially; deleting it and its
unrelated tests is not necessary to fix consumer installs.

Adjust affected policy expectations in `scripts/tests/publish-integrity.test.ts`
and `scripts/tests/issue-2603-install.test.ts` to the new no-consumer-hook contract,
without substituting metadata-only assertions for installed execution. Update
`package-lock.json`'s CLI lifecycle metadata; change `bun.lock` only if generated
metadata requires it. Preserve both lockfiles' declaration parity and existing
version/peer guards. Leave private-root contributor setup hooks untouched.

### Dependency strategy and tradeoffs

Keep `bun@1.3.14` and exact-pinned direct optional `@oven/bun-*` dependencies for
this minimal compatibility repair: installs with scripts already enabled may
have moved the payload into `bun/bin`, whereas denied-script installs leave it
in `@oven`. Validate both locations. Keep the version authoritative in
`.bun-version`/existing pin policy. This retains a blocked upstream postinstall
warning, but **does not require it to execute**; warnings are not failures.

Removing the `bun` runtime dependency entirely and relying exclusively on
`@oven` would remove its placeholder and warning, but is a larger alternative:
root tooling, version guards, native-launcher fixtures, `.bin/bun` consumers,
Node relaunch, and `oven-bun-variants` upstream-table tests would need coordinated
changes. Do not choose it merely to hide this defect, and do not move to a new
native launcher distribution in this issue. Keep current script-free prebuilt
native families; no speculative grammar/ripgrep replacements or trust expansion.

If a supported macOS/Windows tuple actually requires a missing grammar artifact,
separately select publisher-built prebuilds or explicit optional degradation.
Do not enable compilation on the consumer or silently promise unsupported native
functionality. No evidence currently requires rebuilding these packages for the
Linux startup fix.

### Increment 3: faithful packaged regression and release gating

Extend these existing files rather than build another release simulator:

- `scripts/tests/release-bound-artifact-helpers.ts`: make denied lifecycle scripts
  an explicit consumer mode (`--ignore-scripts`, no positive override); isolate
  cache/home/config/PATH; keep official binder and exact bound manifests. Seed
  third-party artifacts before offline validation, without running their hooks.
  Keep version/resolution containment checks. Check local and global consumers.
- `scripts/tests/issue-2603-release-install.test.ts`: exercise script-disabled
  installed `--version` and `--help` using the built, bound release artifact,
  not npm links, the private root tarball, or rewritten offline replicas.
- `scripts/windows-installed-command-smoke.cjs` and its existing support modules:
  add a denied-script mode and run the installed npm-generated CMD/PS wrappers,
  including spaces/metacharacters, stdin, argv, exit status and process runtime.
  Modify existing CJS only if needed; any new test/helper must be TS/Bun.
- `.github/workflows/release.yml`: gate publication **before first npm publish**
  using the built/bound/packed CLI graph, for stable, nightly, and release dry-run.
  Build all required bundles/assets on publisher, then pack without rebuilding
  and install with scripts disabled. Prefer publishing the artifacts that passed
  validation; otherwise verify repacked payload equivalence to avoid TOCTOU.
- `.github/workflows/ci.yml`: run the focused launcher regression on packaging or
  launcher changes. `.github/workflows/nightly.yml` plus the existing Windows
  installed-command workflow should run the cross-platform consumer matrix.
  A nightly-only bundle smoke is insufficient as a pre-publication gate.

Add feature-level consumer probes where risk warrants, using the existing
`scripts/bun-native-modules-smoke.ts` behavior as a guide but resolving modules
from the installed package, not the checkout: dynamic grammar parse through the
public tools utility, packaged rg search, real sharp transform, shipped WASM
parsing, POSIX Bun PTY, Windows ConPTY. Test missing optional-grammar behavior
through the existing public unavailable-result contract. Credential persistence
must not touch the user's keychain; construct-only checks can still fail due to
host keyring state, so separate module availability from storage health.

Do not edit `scripts/bind-release-deps.ts` or source `file:` workspace contracts
unless faithful regression exposes a binding failure. Do not change
`scripts/bun-build.config.ts` or `copy_bundle_assets.ts` absent a demonstrated
artifact defect; keep their publisher-build boundary.

### Cross-platform acceptance matrix

- Linux x64 glibc: npm 12 default denial and explicit `--ignore-scripts`; no
  global Bun or rg; installed local/global bins, source/bundle, native probes.
- macOS arm64 and Intel x64: real install/launch, Mach-O/fat handling, Rosetta
  runtime selection where available; explicit grammar degradation on missing
  Intel prebuilds rather than host compilation. Current duplicate AVX2 detection
  differs between the shim and TS/generator paths; verify actual selected payload,
  but do not make optimization cleanup a prerequisite for the Linux repair.
- Windows x64, and arm64 if supported runner available: public own bin linked by
  npm, generated CMD/PS wrappers, PE rather than text placeholder, Bun execution,
  ConPTY path, no `/bin/sh` requirement, correct argv/streams/exits. Native-grammar
  security denial must remain nonfatal for startup/builtin AST.
- Linux arm64 and musl/baseline CPU variants: separate available-host/container
  validation; require payload libc/CPU compatibility. Do not infer these results
  from x64 glibc or from pure platform-table tests. Missing optional Bun payloads
  should fail clearly, without requesting scripts. `--omit=optional` is not a
  guaranteed working install because the bundled runtime itself is optional.
- npm is still a supported installer; Bun is the application runtime. Keep Node
  as the small npm-compatible launcher host, not as the application runtime.
  Also verify Bun consumer installs, since root contributor trust does not apply.

### Verification and delivery after implementation

Run new focused Bun behavioral tests in RED before production edits, then GREEN.
Run relevant existing #2978/#2603, bundle/profiler, fd/signal, and publish-integrity
suites; lockfile checks; test-audit scan of touched tests; scoped lint/format and
TypeScript checks. Then run repository-required test/lint/typecheck/format/build
and `bun scripts/start.ts --profile-load luna "write me a haiku and nothing else"`.
The checkout currently has no `node_modules`; provision contributor dependencies
only for implementation, not by pretending these probes ran the full suite.

Use the issue workflow's bounded implementation/review/OCR cycles, create a PR
with `Fixes #3904`, watch CI and review remediation, and do not merge without
explicit authorization. This investigation does not create or claim that PR.

## Reproduction commands, retained evidence, and limits

Host: Ubuntu Linux x86_64, glibc `2.43`; Node `v26.12.0`, npm `12.2.0`, installed
host Bun `1.4.3`. Runtime probes use packaged `@oven` Bun `1.3.14`. Registry tags
were queried with `npm view @vybestack/llxprt-code dist-tags --json` and then pinned
so concurrent registry changes cannot silently change what was tested.

Evidence base: `/tmp/llxprt-issue3904-7xMbdw` (temporary, not committed).
Each consumer has isolated `home/`, `work/`, installation prefix, and logs.

Representative exact stable installation command (nightly substitutes its pinned
version and `nightly/` prefix):

```sh
npm install --global \
  --prefix /tmp/llxprt-issue3904-7xMbdw/stable/prefix \
  --cache /tmp/llxprt-issue3904-7xMbdw/npm-cache \
  --ignore-scripts --no-audit --no-fund \
  @vybestack/llxprt-code@0.11.0
/tmp/llxprt-issue3904-7xMbdw/stable/prefix/bin/llxprt --version
/tmp/llxprt-issue3904-7xMbdw/stable/prefix/bin/llxprt --help
```

Other executed commands:

```sh
# Separate npm-default/ prefix, isolated HOME/config/cache; no script permission:
npm install --global \
  --prefix /tmp/llxprt-issue3904-7xMbdw/npm-default/prefix \
  --cache /tmp/llxprt-issue3904-7xMbdw/npm-cache \
  --no-audit --no-fund \
  @vybestack/llxprt-code@0.12.0-nightly.261019.45a5157c7

# Separate temporary private consumer, not the workspace:
bun add --ignore-scripts \
  @vybestack/llxprt-code@0.12.0-nightly.261019.45a5157c7

# Confirm the upstream placeholder is actual registry payload:
npm pack bun@1.3.14 --ignore-scripts \
  --pack-destination /tmp/llxprt-issue3904-7xMbdw --json
```

Bun tarball SHA-256:
`29977c2f7ce440a9b14c61872dca3a694561575d9c6ea262029b8e448aaa48d2`.
Both placeholder SHA-256 values:
`3877c58dda42c0c5ce4f33d21bfde4733c8e6906e8268e136cfdd6ea522df040`.
Archive mode was `0644`; installed executable mode was `0775` on this host.

Retained files:

- `stable/` and `nightly/`: `install.log`, `version.log`, `help.log`,
  `results.json`, `dependency-lifecycle-inventory.json`, `native-probes.log`,
  `bundle-direct-version.log`, `source-direct-version.log`;
- controlled proof: `controlled-probe-results.json`,
  `restricted-path-before.log`, `restricted-path-absent-placeholder-version.log`,
  `restricted-path-absent-placeholder-help.log`,
  `restricted-path-after-restoration.log`, `public-tools-and-pty.log`;
- `nightly/oven-runtime.log`, `oven-cli-version.log`, `oven-cli-help.log`;
- `npm-default/` and `bun-consumer/`: `install.log`, `version.log`, `results.json`;
- `bun-tarball-metadata.json`, `bun-1.3.14.tgz`; original temp installs retained.

Limits: no macOS/Windows/ARM/musl execution; no live provider prompt, full TUI,
sandbox, plugin, profiler, or credential-store end-to-end verification. Stable's
single keyring constructor failure is recorded, not attributed to lifecycle
scripts: the same `1.3.0` package loaded on both installs, and nightly construction
succeeded. No script-enabled A/B install was needed or attempted. No committed
regression tests, build, full suite, lint, or typecheck were run for this read-only
investigation. No subagent dispatch tool was available in this session; historical
and architectural review were performed directly. No production remediation is
claimed complete.

## Implementation report (2026-10-19)

### Delivered contracts and scope

- The existing public Node supervisor and TypeScript resolver reject executable
  text placeholders. Native candidates must be regular files, executable on
  POSIX, and have the host's ELF, Mach-O/fat, or Windows MZ header. Reads are
  bounded to four bytes and descriptors are closed. This validates candidates;
  it is not a security attestation or an execution/version probe.
- Healthy materialized `bun/bin` retains precedence; selected host `@oven`
  payloads remain the script-free fallback. Host selection, ancestor resolution,
  source/bundle selection, application exit propagation, fd 3, signals, argv,
  and installed profiler dispatch are unchanged. Windows resolver wrappers
  retain their existing fallback policy. There is no new launcher, repair,
  download, build, or retry-on-application-failure path.
- The public CLI no longer declares consumer `postinstall` or includes
  `scripts/install-native-launchers.cjs` in its payload. Its own Node-shebang
  `bin` and publisher `prepack` remain. Private root contributor hooks and the
  legacy helper source remain untouched. `package-lock.json` only loses the
  CLI workspace's `hasInstallScript` flag; `bun.lock` is unchanged. All Bun
  and `@oven` declarations remain pinned to `1.3.14`.
- Launcher regressions execute the real supervisor with executable text
  placeholders and real native Bun payloads: local/hoisted layouts, Node-only
  PATH, materialized precedence, application exit 17 without retry,
  non-executable native files, and placeholder-only exit 43. Public resolver
  tests use a real filesystem and its default checker.
- The existing release-bound helper packs the official binder's unchanged
  workspace manifests, never the private root or a rewritten offline replica.
  It checks exact sibling versions and installed resolution containment. A
  scripts-disabled seed populates an isolated cache; offline local and
  disposable global-prefix consumers run installed public `--version` and
  `--help` with only Node on PATH. No consumer hooks run.
- Stable, scheduled nightly, and standard release dry-run require that proof
  before publication. Publication uses already-proven workspace tarballs with
  scripts disabled, avoiding a prepack/repack TOCTOU window. Publisher builds
  happen before packing, never on consumer startup.
- Existing nightly infrastructure covers Linux, macOS arm64, and Intel macOS
  consumers. The existing Windows installed-command workflow runs the same
  faithful graph through npm-generated CMD and PowerShell wrappers; existing
  invocation/probe support checks metacharacter/Unicode argv, stdin/stderr, Bun
  execution, and application exit propagation. The temporary installed Windows
  bundle is instrumented only after genuine version/help checks, then restored;
  release tarballs/manifests are never modified. This replaces the legacy
  rewritten-replica smoke/benchmark in that workflow.

### Test-first evidence

Logs: `/tmp/issue3904-implementation/`. Original investigation evidence remains
at `/tmp/llxprt-issue3904-7xMbdw`.

- `launcher-baseline-red.log`: four regressions fail against original production
  code because the executable text placeholder wins.
- `launcher-green.log`: 94 pass. `resolver-green.log`: 46 pass, including default
  filesystem checks with materialized, payload, and missing-runtime cases.
- `release-gate-red.log` / `release-gate-green.log`: missing gate fails, then five
  selected publication checks pass. These are static automation policy checks,
  not substitutes for installed application execution.
- The helper's first RED (`consumer-mode-red.log`) proves the old helper lacked
  local/global version evidence, not that npm 12 executed the poisoned hook.
  Its GREEN proves both install modes/commands; actual bound-artifact execution
  is the decisive runtime proof.

### Verified consumer result

`LLXPRT_RELEASE_PROOF_DIR=/tmp/issue3904-implementation/consumer-proof-verified
 timeout 1200 bun scripts/tests/release-bound-artifact-helpers.ts` exited 0.
`consumer-proof-verified.log` reports success for local/global version/help.
Each consumer has `installed-version.log` (`0.12.0`), `installed-help.log`,
`install.log`, `installed-graph.json`, and per-workspace resolution logs. The
real Bun package placeholder is present alongside real pinned `@oven` payloads.
No manifest rewriting or raw-root pack was used. Earlier identical successful
proof is retained at `/var/tmp/issue3904-release-proof-final/`.

A later attempt to move the fresh 3.9 GB fixture from tmpfs to `/var/tmp` was
interrupted by the foreground tool timeout while copying. The original complete
fixture remains at its original path; the partial duplicate is not evidence.

### Platform and review limitations

This host is Linux x64 glibc only. macOS Mach-O/fat execution and Windows PE,
npm-generated wrapper behavior, and ConPTY require hosted workflows; wiring is
not a claim those platforms passed. No ARM/musl execution or Rosetta validation
was performed. Native feature probes from the original investigation remain
valid diagnostic evidence but were not generalized into new consumer feature
contracts. Optional grammar degradation and credential-store semantics were
not changed. No credentials were read/written by the implementation proofs.
No subagent/review dispatch tool is exposed in this session; review is direct.

## Independent review and verification (2026-10-19)

Review evidence: `/var/tmp/issue3904-independent-review/`. Retained
implementation evidence remains `/tmp/issue3904-implementation/`.

### Findings and bounded fixes

- Fixed a syntax error in the Windows workflow regression's line-splitting
  regex. After repairing the test, confirmed it failed on the workflow's
  `local/*` upload glob, then restricted uploads to local/global `.log` and
  `.json` files. This avoids recursively uploading consumer installation trees.
  The complete workflow policy file now has 18 passing tests.
- Fixed a stale install-layout policy test that still required the removed
  consumer postinstall. Its existing failure was reproduced before aligning
  the assertion with the required no-consumer-postinstall contract. All 16
  install-layout tests now pass; installed execution is separately covered by
  the release consumer proofs, not this metadata assertion.
- **Open, medium:** `bun-path-resolver.ts` applies its new native-header check
  to POSIX PATH fallbacks as well as package-native candidates. A real shell
  wrapper invoking pinned Bun returns version `1.3.14`, resolves on HEAD, but
  resolves to `null` with these changes. Evidence:
  `posix-wrapper-baseline-comparison.log`. Preserve intentional PATH wrappers
  while rejecting package placeholders, or explicitly document the compatibility
  change. No resolver remediation was attempted in this review.
- **Open, low:** the Windows-sensitive filter in `ci.yml` does not include
  `packages/cli/src/launcher/` or the CLI workspace manifest. Although this
  change triggers it through other changed files, a future resolver-only change
  can skip the newly added Windows resolver regression.

### Exact validation outcomes

- Retained full `npm run build`, `npm run format`, and final
  `npm run typecheck` each exited 0 (`build-verified`, `format-verified`, and
  `typecheck-final` logs and exit files).
- Full lint subsequently completed all 18 groups with exit 0:
  `/var/tmp/issue3904-review-1/lint.log` and `lint.exit`. Earlier implementation
  lint attempts timed out with exit 124; those are not passing results.
- Independent pinned-Bun focused launcher/resolver/variant/output-generator/
  release-policy/workspace checks: 169 pass, 1 skip, 0 fail across six files
  (`focused-current.log`, exit 0).
- Independent release-bound helper checks: 3 pass, 1 opt-in skip, 0 fail
  (`release-helper-current.log`, exit 0), including local/global lifecycle-denied
  fixture installs. Windows workflow policy: 18 pass, 0 fail. Install layouts:
  16 pass, 0 fail. These are separate suites, not a replacement for the full
  workspace test run.
- The previously timed-out scripts check completed after lint released memory:
  `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --project
  tsconfig.scripts.json`, exit 0 (`scripts-typecheck.log`).
- All three review-fixed files pass Prettier check; `git diff --check` passes.
  Test-audit scan exits 0. The repaired test cases have no new restricted
  findings; existing Windows policy WEAK_ONLY/STRUCTURE_ONLY findings remain.
- The retained actual release-bound Linux local/global consumer proof exited 0
  and produced installed version `0.12.0` and help output with scripts denied.
  The public launcher in its CLI tarball has exactly the current source SHA-256:
  `cb3a0ee8735f3c0b857e171e59d8de5e50707d38fa5b16e905ffa6dfa194fbc7`.
  Stable/nightly/dry-run workspace publication uses these proven tarballs after
  the mandatory gate, rather than repacking them during publication.
- Retained publisher integrity checks: 19 pass, 0 fail; retained installer fixture
  checks: 38 pass, 0 fail. Earlier affected-suite failures include four legacy
  cmd-shim discovery failures (`cmd-shim not found`), not established passes.
- Full `npm run test` was still active when this review checkpoint was written.
  Its providers stage reports 663/664 isolated files passing: the real failure
  is `manifest-finite-contract.test.ts`, missing the local installed `gemini`
  contribution. Later workspace results remain pending; no all-green full-suite
  claim is made.
- Required Luna smoke exited 1: `Profile 'luna' not found`
  (`luna-verified.log`). No replacement profile or credentials were created.

Only Linux x64 glibc execution is established. macOS/Windows hosted consumer
runs, Windows ConPTY, ARM/musl/Rosetta, and automated native-feature acceptance
remain unverified. The workflow wiring is not a claim that these platforms pass.
No `.llxprt/` files were modified; no commit, push, PR, or merge was performed.

## Final-cap remediation round 2 (2026-10-19)

Evidence: `/var/tmp/issue3904-remediation-2/`. Earlier logs and consumer proofs
were retained. No further review/OCR round was performed.

### Remediations

- **P2 closed:** POSIX PATH candidates use executable-regular-file validation,
  preserving executable shell/version-manager wrappers. Package `.bin`, direct
  `bun/bin`, and selected `@oven` candidates still require native headers;
  Windows native/wrapper validation and ordering are unchanged. The real
  filesystem regression resolves and executes a shell wrapper, skips missing,
  non-executable and directory PATH entries, and checks the running Bun version.
  Packaged-placeholder fixtures now include an executable `@oven` text stub.
- **P3 closed:** the Windows-sensitive CI filter includes
  `packages/cli/src/launcher/` and `packages/cli/package.json`. Its regression
  executes the actual workflow's grep expression against those changed paths.
  `red.log` records both intended failures; `green.log` records both repairs.
- Installed the missing local dependencies with host Bun 1.4.3 using
  `bun install --omit=peer` in `plugins/google-gemini` and
  `plugins/google-mcp-auth`. No plugin manifest or lockfile changed. The missing
  Gemini contribution and three CLI integration failures pass focused reruns.
- Reproduced four `cmd-shim not found` failures. npm 12 nests its real shim
  under `bin-links`; discovery now resolves from that dependency's location,
  also supporting hoisted layouts. The existing subprocess generator now waits
  for the shim's Promise rather than relying on an obsolete callback.
- Broader verification reproduced the legacy release fixture's obsolete
  requirement for the deliberately removed installer script. Deleted only that
  stale required-asset entry from the existing CJS helper; no new JS file or
  implementation was added. After that fix, the first tmpfs smoke attempt
  failed later with partial step output and no useful stderr. A bounded rerun
  using disk-backed temporary storage passed all eight non-opt-in cases.

### Current verification

- `npm run format`: exit 0, including the final test-only correction
  (`format-final.log`). Full `npm run lint`: all 18 groups, exit 0 (`lint.log`).
  Full `npm run build`: exit 0 (`build.log`). These checks were serialized.
- Full typecheck attempts exited 2: first for an unavailable global `Bun` name,
  then for the optional `process.versions.bun` type in the new test. The final
  assertion explicitly narrows that value before comparing. Final CLI workspace
  production and Bun-test typechecks pass, exit 0 (`cli-typecheck-final.log`),
  as does final targeted ESLint (`lint-final-test.log`). A complete post-correction
  root typecheck remains unestablished within this time-bounded run. No production
  typing diagnostic was reported by either full attempt.
- Pinned Bun 1.3.14 focused launcher/resolver/Windows workflow/install-layout/
  publication policy suites: 198 pass, 1 platform skip, 0 fail (`focused.log`).
  Final resolver/workflow rerun after all test edits: 66 pass, 0 fail
  (`resolver-final.log`). Installer suite: 38 pass (`cmd-shim-green.log`).
- Provider finite contract: 24 pass (`plugin-green.log`); CLI plugin activation:
  1 pass; profile-flag integration: 11 pass; CLI argument integration: 22 pass
  (the respective `cli-*.log` files). The original failure logs remain retained.
- Legacy release/helper suite on disk-backed temporary storage: 8 pass,
  1 opt-in skip, 0 fail (`release-install-disk-tmp.log`). This rewritten legacy
  fixture is not substituted for the earlier faithful release-bound consumer
  proof. The public supervisor SHA-256 still matches that retained proof:
  `cb3a0ee8735f3c0b857e171e59d8de5e50707d38fa5b16e905ffa6dfa194fbc7`.
- Test-audit scan and lockfile check exit 0. The touched tests have no new
  restricted audit findings; four existing workflow WEAK_ONLY/STRUCTURE_ONLY
  entries remain (`test-audit-touched.tsv`). `git diff --check` passes.
- The inherited full `npm run test` was monitored, never duplicated. Original
  PID 3576108 exited; job `shell_c4e0a58d43fe` completed at
  `2026-10-19T20:54:19.437Z` with exit 1. Log remains
  `/tmp/issue3904-implementation/full-test.log`; exact status is copied to
  `full-test-status.txt`. Results: providers 663/664, agents 552/553, CLI 819/822.
  All four provider/CLI failing files pass after the dependency repair, but this
  inherited run started before remediation and is not a fresh all-green pass.

### Remaining blockers and handoff

- Agents `src/core/turn.watchdog.test.ts:161` still fails its no-idle-timeout
  liveness assertion: 3 pass, 1 fail in each of two isolated reruns, including
  after full tests/lint released resources (`watchdog-rerun.log`,
  `watchdog-after-full.log`). No watchdog production/test logic was rewritten.
  A green full-suite run remains unestablished.
- Required Luna smoke was rerun after the build and exits 1 with
  `Profile 'luna' not found` (`luna-smoke.log`). No replacement profile,
  authentication material, or substitute smoke credentials were created.
- Windows/macOS hosted consumer execution remains unverified on this Linux host.
  Foreground owns any remaining review/OCR and PR work. No commit, push, PR,
  merge, global dependency installation, or `.llxprt/` modification was performed.

## Final delivery verification checkpoint

- Complete root `npm run typecheck` now passes after the final test typing
  correction: `/var/tmp/issue3904-final/typecheck.log`, exit 0.
- Fresh watchdog checks pass on pinned Bun 1.3.14 and host Bun 1.4.3, directly
  and through the package runner. The previously failing case also passes 60
  pinned-runtime repetitions. Clean main sources pass 30 repetitions, but
  recent GitHub main runs skipped agents tests; there is no evidence establishing
  the original full-suite failure as unrelated. Do not treat isolated passes
  as a replacement for a complete passing suite.
- The final rebuilt release-bound consumer proof passes, exit 0, for both
  local/global script-disabled installs and version/help commands. A fresh full
  workspace run is still running. Logs are under `/var/tmp/issue3904-final/`.
- `ocr` is unavailable (`command not found`). The two bounded subagent review
  rounds and their remediation are recorded above; OCR is not claimed.
- The authenticated Luna smoke remains blocked by the absent profile. Hosted
  macOS/Windows execution is pending; neither is claimed as locally verified.
