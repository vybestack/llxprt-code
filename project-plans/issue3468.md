# Issue 3468: Glob-declared workspace dependency isolation

Plan ID: `PLAN-20260901-ISSUE3468`

Issue: <https://github.com/vybestack/llxprt-code/issues/3468>

## Scope

Extend issue #3450's installed-mode dependency isolation so root `package.json`
workspace declarations may select nested package roots with a bounded glob
contract. Keep the shared source bind and fresh engine-owned writable volumes.
Do not change `NODE_ENV=development`, contamination preflight, lifecycle, or
literal declaration behavior.

## Discovery contract

The root manifest may declare workspaces as either:

- an array of entries; or
- an object whose `packages` member is an array, matching the object form
  already recognized by repository tooling.

Non-string and empty entries retain #3450 behavior and are ignored. Literal
positive paths retain #3450 behavior: they select their normalized destination
even when the package root or its `package.json` does not exist.

A supported glob uses slash-separated path segments with these operators:

- `*` as a complete segment, matching exactly one segment; and
- `**` as the final complete segment, matching recursively beneath a literal
  directory prefix.

A leading `!` excludes package roots selected by positive declarations. All
positive declarations are discovered first, then all exclusions are applied,
so declaration ordering does not change the result. Exclusions may use the same
literal or glob syntax. An exclusion that matches nothing is harmless and does
not stop the launch or remove another selected destination.

Glob discovery resolves `package.json` files and selects their parent package
roots. It ignores dependency and VCS metadata trees. Results are deterministic,
normalized, and deduplicated by real filesystem identity. A positive glob that
matches no package roots fails before any engine command. The diagnostic names
the declaration and tells the user to correct the pattern or use a literal path
for a package root that does not exist yet.

Embedded stars, non-terminal `**`, `?`, character classes, brace expansion,
extglobs, backslash escapes, absolute glob patterns, and recursive patterns
without a literal prefix are unsupported. They fail before engine side effects
with the supported syntax in the diagnostic.

Every selected or excluded existing route is resolved through the filesystem.
A package root or existing path component that resolves outside the real
workspace fails before launch. Lexical prefix checks are not accepted as proof
of containment. Exclusion does not hide a symlink escape found by a positive
pattern.

## Integration points

- `resolveProtectedNodeModulesDestinations()` reads and validates declarations,
  discovers package roots, enforces realpath containment, and returns the root
  destination followed by nested destinations.
- `planPrivateDependencyMounts()` remains the read-only boundary before engine
  work. Unsupported syntax, no-match globs, and symlink escapes fail here.
- `addPrivateDependencyMounts()` continues to allocate and initialize exactly
  one engine-owned volume per planned destination after the shared workspace
  bind.
- Existing cleanup removes engine-created empty mountpoints and all labeled
  containers and volumes. Host dependency trees are never used as volume
  sources.

The `glob` package is already a direct dependency of `packages/cli` at `^12.0.0`
and is already imported by CLI production code. Use its synchronous filesystem
walker behind the restricted declaration validator. Do not add a dependency.

## Test-first sequence

1. **RED: pure declaration planning.** Add table-driven tests for array and
   object forms, supported operators, exclusions, deterministic normalization,
   and each unsupported syntax family.
2. **GREEN: bounded parser.** Implement the pure declaration plan without
   filesystem or engine effects.
3. **RED: filesystem discovery.** Add temporary-tree tests for `packages/*`,
   `tools/**`, nested manifests, exclusions, positive no-match diagnostics,
   ignored `node_modules`, deduplication, and symlink escape rejection.
4. **GREEN: contained package discovery.** Integrate the repository's existing
   `glob` dependency, realpath each candidate, and preserve literal behavior.
5. **RED/GREEN: state boundary.** Drive `addPrivateDependencyMounts()` through
   the fake state engine. Assert matching roots receive volumes and invalid,
   no-match, and symlink-escape plans leave launch arguments, engine resources,
   and host trees unchanged.
6. **RED/GREEN: real engines.** Extend the existing real Docker/Podman fixture to
   use matching globs plus an exclusion. Run install, build, and test in one
   container, prove selected host dependency trees remain byte-identical,
   excluded source stays shared, and private volume lifecycle is complete. Add
   real-engine prelaunch cases for unsupported syntax, no-match, and symlink
   escape that preserve the labeled resource set and host trees.
7. **Document and verify.** Update `docs/sandbox.md`, run focused tests, both
   engines, targeted lint/typecheck/format/build, test audit, full required
   verification, and inspect the final diff.

## Acceptance matrix

| Case | Required result |
| --- | --- |
| Existing literal declaration | Same destination and containment behavior as #3450. |
| Missing literal declaration | Protect its future `node_modules`, as in #3450. |
| `packages/*` | Select direct child package roots containing `package.json`. |
| `tools/**` | Select package roots recursively below `tools`, excluding metadata trees. |
| Object `{ packages: [...] }` | Apply the same declaration contract as the array form. |
| `!packages/excluded` or supported negative glob | Remove matching contained roots from the protected nested set. |
| Exclusion matches nothing | Continue safely; no destination is removed. |
| Positive glob matches no package roots | Fail before engine commands with corrective guidance. |
| Unsupported glob operator | Fail before engine commands and name supported forms. |
| Match resolves through a symlink outside the workspace | Fail before engine commands, even if an exclusion also names it. |
| Duplicate lexical or symlink aliases inside the workspace | Protect one real destination. |
| Root and selected nested dependency trees | Receive separate fresh writable engine volumes. |
| Install, build, and test in one run | Use private dependencies while shared source output reaches the host. |
| Session exit or prelaunch failure | Remove engine resources and empty mountpoints; preserve host trees. |

## Verification commands

Focused and targeted checks:

```bash
bun test packages/cli/src/utils/sandbox-node-modules.test.ts
bun test packages/cli/src/utils/sandbox-dependency-volumes.test.ts
bun test packages/cli/src/utils/sandbox-node-modules-preflight.test.ts
LLXPRT_SANDBOX_TEST_RUNTIME=docker bun test integration-tests/sandboxNodeModulesIsolation.real.test.ts
LLXPRT_SANDBOX_TEST_RUNTIME=podman bun test integration-tests/sandboxNodeModulesIsolation.real.test.ts
npm run lint:changed
npm run typecheck --workspace @vybestack/llxprt-code
npm run build --workspace @vybestack/llxprt-code
bun scripts/test-audit/scan.ts tmp/issue3468/test-audit
npm run format:check
```

Required repository verification cycle:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

## Verification results

- The four focused discovery, preflight, volume, and lifecycle suites passed 78
  tests with 278 assertions.
- The Docker selection passed all 9 selected real-engine scenarios. The rootless
  Podman selection also passed all 9 selected scenarios after its engine reported
  rootless mode. Both post-run label queries found no dependency containers or
  volumes.
- Full repository lint, typecheck, formatting, format check, and build passed.
- The `stepfun-37` startup smoke test returned a three-line haiku and exited
  successfully.
- The test audit found no findings in either changed test file. Direct ESLint,
  prohibited-pattern scans, and `git diff --check` passed.
- `npm run test` completed every workspace and passed all 725 isolated CLI test
  files. One unchanged agents-package test failed because its absolute-path
  exclusion treats this required `tmp/worktrees/issue3468` checkout as excluded
  test data, leaving its scan empty. That path-sensitive test defect is tracked
  in [#3511](https://github.com/vybestack/llxprt-code/issues/3511); this branch
  does not modify the failing package.

The real-engine sessions covered matching, exclusions, actionable prelaunch
failures, escaped symlinks, install/build/test persistence, a fresh second run,
an arbitrary container UID, shared source edits, and image-global agent launches.
Snapshots proved that selected and excluded host dependency trees remained
unchanged.

All logs belong under `tmp/issue3468/`. No review, push, or PR is part of this
run.
