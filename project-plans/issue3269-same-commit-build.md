# Issue #3269 Plan: Same-Checkout Workspace Builds

Plan ID: PLAN-20260821-ISSUE3269
Generated: 2026-08-21
Issue: https://github.com/vybestack/llxprt-code/issues/3269

## Investigation Result

The cited CI job installed a clean workspace and completed a full build before the agents shard failed. The immediate failure was a test-fixture race: `createMockConfig()` initialized a real `Config`, whose MCP startup continues in the background, and then replaced its `ToolRegistry` with a partial object that does not implement `listDeferredMcpServers()`. The background MCP refresh could observe that partial registry.

The repository already records all internal dependencies as local `file:` dependencies, both lockfiles map workspace package names to local workspaces, and the installed-tree verifier rejects a same-named registry copy. The relevant package namespace is `@vybestack`, not `@vyestack` as written in the issue.

A separate stale-output boundary remains. Workspace builds clean each package only when that package's build begins. A package built earlier in the sequence can therefore resolve an ignored `dist` directory belonging to a package whose build has not begun. The full-build coordinator does not remove all workspace output before compilation starts.

## Accepted Behavior

### AC-1: Declared internal dependencies identify exact sibling workspaces

**Given** the root workspace list and any `dependencies`, `devDependencies`, `optionalDependencies`, or `peerDependencies` entry in a workspace manifest,
**when** the dependency name belongs to a declared workspace,
**then** its local protocol target must resolve from the consumer to that exact workspace, and the target manifest must declare the expected package name.

This includes `@vybestack/llxprt-code`, which must resolve to `packages/cli`. Registry ranges, npm aliases, missing targets, and local paths to the wrong package fail before build or test consumers run.

### AC-2: Installed package aliases identify repository workspaces

**Given** a supported repository install,
**when** the workspace-link gate inspects root `node_modules`,
**then** every declared workspace alias, including `@vybestack/llxprt-code`, must resolve to its declared repository directory.

A missing entry, broken link, wrong workspace link, or same-named registry directory produces a nonzero result with the affected workspace and expected target. Existing postinstall behavior remains responsible for replacing nested first-party package copies; this issue will not add a second nested-package subsystem.

### AC-3: Full builds start without pre-existing workspace output

**Given** stale or API-incompatible files under any declared workspace's `dist` directory,
**when** `npm run build` or `npm run build:packages` starts a full JavaScript build,
**then** all declared workspace `dist` directories are removed before the first workspace compilation begins.

The cleanup must derive its targets from the declared workspace list rather than a hard-coded package list or shell glob. A missing, empty, malformed, or non-literal workspace declaration fails instead of allowing a partial cleanup. Declaration-only builds retain their existing behavior unless a failing behavioral test proves they can consume stale JavaScript output.

### AC-4: Build consumers fail before runtime on workspace inconsistency

**Given** an installed alias that does not identify its declared workspace,
**when** a full coordinated build starts,
**then** the existing workspace-link verifier runs before generation or workspace compilation and terminates the build on mismatch.

No runtime fallback, `typeof` guard, or MCP compatibility wrapper will be added.

### AC-5: Agents test configuration remains valid during MCP startup

**Given** an agents test that initializes a real `Config`,
**when** background MCP discovery refreshes the tool registry,
**then** it must observe a real, complete `ToolRegistry`, not a partial structural replacement, and test-owned configuration work must be disposed or settled through the existing lifecycle.

The reported `subagent.create.test.ts` behavior must pass without an unhandled `listDeferredMcpServers is not a function` exception in isolated execution and in the agents shard.

### AC-6: Source and compiled paths agree after a full build

**Given** a successful full build,
**when** the relevant real tools/core/MCP APIs are loaded through the Bun source path and Node compiled path,
**then** lazy MCP registry synchronization completes through the real `ToolRegistry` API without a missing-method exception.

Behavioral evidence must exercise real modules. A test that only checks a mocked method or asserts `typeof` is insufficient.

## Inputs and Boundary Cases

The accepted inputs are the root workspace declaration, every declared workspace manifest, root installed aliases, ignored workspace `dist` directories, and the agents test helper's `Config` lifecycle.

Required failure boundaries are:

- missing, empty, malformed, or glob-based workspace declarations;
- an internal dependency using a registry range, npm alias, missing local target, wrong sibling target, or target with a mismatched package name;
- a missing, broken, copied, or wrongly targeted root workspace alias;
- stale output in a workspace unrelated to the MCP stack as well as in tools/MCP/core;
- a build command that fails after cleanup, which must remain nonzero and must not restore pre-build stale output;
- MCP startup completing before or after agents test setup, with neither schedule exposing a partial registry.

## Behavioral Evidence

| Criterion | Evidence |
| --- | --- |
| AC-1 | Bun tests traverse all manifests and dependency sections using the real local-protocol resolver; fixture cases reject registry and wrong-target specifications. |
| AC-2 | Existing workspace-link tests plus explicit CLI-name coverage reject a same-named directory and wrong link; `bun scripts/verify-bun-workspace-links.ts` passes against the installed repository. |
| AC-3 | A temporary-repository test seeds stale markers in multiple declared workspace `dist` directories and proves all are absent before the first build callback or command runs. It also proves malformed workspace declarations fail. |
| AC-4 | A build-coordinator test supplies a failing link gate and proves no generation or workspace build starts. |
| AC-5 | A deterministic agents regression controls MCP refresh ordering around `createMockConfig()`, exercises the real registry boundary, and proves cleanup settles the configuration. The agents shard passes. |
| AC-6 | A real-module integration check after `npm run build` exercises lazy-MCP registry synchronization through source and compiled entry points. |

All new tests use TypeScript and `bun:test`. They must fail for the intended behavioral reason before production changes are made.

## Scope Exclusions

- Renaming the private root package. Current lockfiles and installed aliases already select `packages/cli`; changing root package identity would alter packaging workflows without evidence that it caused this failure.
- Replacing all `dist` exports or TypeScript path mappings with source imports.
- Adding artifact Git-SHA stamping, content hashing, a new cache service, or a new public build abstraction.
- Adding runtime compatibility handling around `ToolRegistry` or changing MCP feature behavior.
- Replacing npm or Bun, changing dependencies, or restructuring CI workflows. A workflow edit requires approval unless implementation proves the checked-in build entry point cannot enforce the accepted behavior.
- Guaranteeing arbitrary direct Node imports from an unbuilt developer worktree. The guarantee applies to supported install, full-build, test, CI, and release entry points.

## Implementation Phases

### Phase 0: Preflight

- Confirm every manifest and lockfile currently maps internal names to declared local workspaces.
- Confirm `@vybestack/llxprt-code` resolves to `packages/cli` in the installed tree.
- Run the existing workspace, link, postinstall, publish-integrity, and reported agents tests.
- Trace the full-build and Config/MCP lifecycle call paths.

### Phase 1: RED tests for manifest and installed identity

- Extend the existing manifest/protocol tests rather than introduce another resolver.
- Add only missing boundary coverage to the existing link-verifier suite.
- Record the expected failures before implementation.

### Phase 2: RED tests for build preparation

- Introduce a fixture test around the smallest internal build-preparation seam.
- Seed multiple stale workspace outputs and observe filesystem state before any build action.
- Test link-gate ordering and malformed workspace input.

### Phase 3: GREEN build preparation

- Reuse the existing workspace declaration and link verifier.
- Remove every declared workspace `dist` before coordinated full compilation.
- Route both supported full-build entry points through the same internal behavior without adding a public API.

### Phase 4: RED/GREEN agents lifecycle regression

- Add deterministic scheduling coverage around MCP refresh and test configuration setup.
- Keep the real `ToolRegistry` attached to the initialized `Config`; customize only methods needed by individual tests through the existing test seams.
- Dispose or settle each test-owned configuration through the existing lifecycle.

### Phase 5: Integration and verification

Run focused tests, the agents and scripts shards, the changed-test audit, and the full verification cycle:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Then complete technical review and Open Code Review. Every finding will be classified as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or `Defer`. Only accepted in-scope findings will change this plan's behavior.

## Execution and Review Record

Implementation followed the accepted split between the reported agents fixture race and the separate coordinated-build stale-output boundary. The build preparation gate now validates installed aliases and declared workspace identities before removing any output. It rejects workspace declarations that can escape the checkout, including lexical traversal and symlink or junction escapes. Both full-build entry points run preparation before generation and compilation, then run a source and compiled lazy-MCP coherence check. Declaration-only builds retain their prior behavior.

The agents helper keeps the initialized `Config`'s real `ToolRegistry`, limits test overrides to the two required query methods, and disposes test-owned configurations. Its regression test uses real deferred MCP tools and observes activation-tool synchronization after MCP refresh completes.

### RED and GREEN evidence

The behavioral tests exposed these failures before the corresponding fixes:

- stale markers remained outside the package that had begun building because the coordinator did not preclean every declared workspace;
- traversal and realpath-escape workspace entries allowed cleanup targets outside the checkout;
- a path-shaped package name could bypass alias lookup by resolving as a filesystem path;
- the agents helper exposed a partial registry while initialized MCP work was still active;
- neither full-build entry point enforced source and freshly compiled lazy-MCP API coherence.

The focused GREEN run after formatting covered all affected agents, build-preparation, workspace-link, dependency-protocol, publish-integrity, declaration-build, build-configuration, and coherence tests: 105 tests passed across 9 files with 243 assertions. The complete scripts shard also passed 266 of 266 files after the declaration-only isolation fix.

### Independent technical review

The first independent technical review requested changes. Every finding was classified and handled:

1. `Blocker-Fix`: the controlled `refreshMemory()` result had the wrong shape. The fixture now returns the real method's result shape.
2. `Blocker-Fix`: workspace declarations could escape the checkout and direct cleanup outside the repository. Lexical and realpath containment checks plus marker-survival tests now reject those inputs before deletion.
3. `In-scope-Fix`: the build lacked durable source and compiled lazy-MCP coherence evidence. A real-module gate now runs after both full-build entry points.
4. `In-scope-Fix`: source-string ordering checks did not prove behavior. They were replaced with coordinator effect-order, short-circuit, and error-propagation tests.
5. `In-scope-Fix`: the agents lifecycle regression could deadlock and relied on class identity. It now releases its gate in `finally`, awaits refresh completion, exercises a real deferred tool, and observes the activation tool through the registry.
6. `Defer`: rewriting the existing missing-workspaces fixture was redundant and did not change accepted behavior.

The second independent technical review found one issue. It was classified `Blocker-Fix`: an unvalidated package name such as `../packages/core` could resolve directly to a workspace without an installed alias. Package names now pass the established scoped or unscoped package-name grammar before alias resolution, with verifier and cleanup marker-survival regressions.

### Open Code Review

Two local OCR rounds were used, which is the configured limit.

Round 1 reviewed 14 selected files, completed 13, and reported six findings:

1. `In-scope-Fix`: malformed package metadata used a misleading summary. The summary now says `Declared workspace(s) have invalid or unreadable package metadata:` and both invalid-name and malformed-JSON tests assert it.
2. `Reject`: removing the preparation boundary's root-manifest validation would make a destructive consumer rely on untyped data from a verifier that does not return workspace directories.
3. `Defer`: richer compiled-subprocess signal diagnostics would improve error text but do not affect failure behavior.
4. `Reject`: sharing source and compiled coherence fixture code would weaken the independent Bun-source and Node-compiled boundary.
5. `Reject`: a timer around the deterministic agents gate would replace Bun's test timeout with another race without proving product behavior.
6. `Reject`: the claimed cleanup ordering problem was incorrect because `finally` releases the gate before disposal.

Round 2 completed all 14 selected files and reported six findings. All were rejected after checking the affected behavior:

1. `Reject`: explicit declaration and full-build command branches are clearer than the proposed command-list abstraction and preserve behavior.
2. `Reject`: the preparation manifest re-read is required for type-safe cleanup targets.
3. `Reject`: the publish-integrity diagnostic wording is accurate enough and has no behavioral defect.
4. `Reject`: independent source and compiled coherence programs are intentional boundary coverage.
5. `Reject`: the claimed missing glob rejection was factually incorrect; production rejects glob entries and the behavioral test passes.
6. `Reject`: the agents test uses deterministic initialization plus Bun's test timeout, so an additional timer race is not warranted.

### Verification evidence

The candidate was checked sequentially to avoid concurrent commands cleaning or consuming shared `dist` output:

- `bun scripts/test-audit/scan.ts tmp/issue3269-final-scan` scanned 2,699 files, 36,165 tests, and 77,908 assertions with zero scanner errors. None of the changed or new issue tests appears in the findings.
- `npm run lint` passed.
- `npm run typecheck` passed.
- `npm run format` passed without rewriting files.
- The post-format focused run passed 105 tests across 9 files with 243 assertions.
- `bun scripts/verify-bun-workspace-links.ts` verified all 16 declared workspaces against their in-repository targets.
- The final `npm run build` passed and printed `Verified source and compiled lazy-MCP registry coherence.`
- The required `stepfun-37` startup smoke passed after that rebuild and returned only a haiku.
- `git diff --exit-code HEAD -- package-lock.json bun.lock` passed. No dependency or lockfile change was introduced.

A complete local `npm run test` finished nonzero for three files outside this change. `packages/core/test/utils/ripgrepPathResolver.test.ts` had four Darwin failures because the implementation found `/opt/homebrew/bin/rg` despite the test's filesystem reassignment. The same file reproduced those four failures in isolation, with 10 tests passing and 4 failing. `packages/agents/src/api/__tests__/core-conversation.spec.ts` and `packages/agents/src/api/__tests__/displayCallbacks.behavior.test.ts` reached their 180-second suite timeout in the complete run; those two files passed together in isolation, with 13 tests passing in 1.96 seconds. A later full-suite rerun reproduced the core ripgrep failure and was stopped once the overall command was guaranteed to remain nonzero. This record does not classify those failures as pre-existing without comparison evidence from `main`. No issue-owned focused test failed. CI on the candidate head remains the completion check for the repository-wide suite.

### Pull request CI and review remediation

The first CI run passed every Linux test shard and failed only JavaScript lint plus its aggregate. The affected-test graph drift guard found the new agents test-only MCP import. Adding `mcp` to `testOnlyEdges.agents` made the exact guard and its 37-test behavioral suite pass.

The pull request OCR posted one actionable finding. It is classified `In-scope-Fix`: the compiled coherence subprocess could block a build indefinitely. A real subprocess regression first failed because no bounded compiled-check API existed. The compiled check now has a 120-second deadline and reports timeout, spawn, signal, and missing-status failures explicitly. The regression confirms that a child exceeding a short test deadline is terminated and diagnosed. The post-format focused run, including CI remediation coverage, passed 143 tests across 10 files with 294 assertions.

CodeRabbit passed without an actionable inline thread. Its remaining observations are classified as follows:

1. `Reject`: adding docstrings to reach an automated 80% threshold conflicts with the repository rule to add comments sparingly. The touched internal helpers and tests have descriptive names and behavioral coverage.
2. `Reject`: the Windows symlink concern does not match the fixtures, which explicitly request junctions on Windows rather than privileged directory symlinks.
3. `Defer`: aggregating multiple disposal failures could improve test-cleanup diagnostics, but it is separate from preserving a complete initialized registry and disposing every test-owned configuration.

Remediation verification was run sequentially. The changed-test audit scanned 2,699 files, 36,166 tests, and 77,909 assertions without an error or finding on the changed coherence test. Lint, typecheck, format, the coordinated build, and the required `stepfun-37` startup smoke passed. The build ended with source and compiled lazy-MCP coherence success. A fresh complete-suite attempt reproduced the same four Darwin ripgrep resolver failures, so the run was stopped once its result was guaranteed nonzero. No issue-owned test failed before the stop.

## Completion Gate

The issue is complete only when every acceptance criterion has behavioral evidence, focused and full local verification pass on the candidate head, allowed reviews are complete and triaged, all `Blocker-Fix` and `In-scope-Fix` findings are resolved, CI passes on that same head, CodeRabbit threads are resolved, and the pull request is conflict-free with correct ancestry.
