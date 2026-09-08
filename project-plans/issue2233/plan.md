# Issue #2233: Dead-code and dependency inventory plan

## Purpose

Produce an evidence-based inventory for follow-up cleanup work. This issue records candidates and the limits of static analysis. It does not remove production code, alter package manifests, add analysis dependencies, or introduce permanent quality tooling.

## Target

Analyze the candidate branch head derived from `main`. Record the exact commit in the inventory so later cleanup work can account for drift. The repository currently contains 16 direct workspaces under `packages/*`:

- `a2a-server`
- `agents`
- `auth`
- `cli`
- `core`
- `ide-integration`
- `lsp`
- `mcp`
- `policy`
- `providers`
- `settings`
- `storage`
- `telemetry`
- `test-utils`
- `tools`
- `vscode-ide-companion`

No package is intentionally deferred.

## Accepted behavior

### AC-1: Reproducible baseline

The inventory records the analyzed commit, tool versions, commands, and exit status for the repository typecheck and lint baselines. A failing baseline is reported rather than hidden or repaired outside this issue.

### AC-2: Complete workspace coverage

The inventory contains one coverage row for each direct `packages/*` workspace. Each row states whether files, exports/types/members, dependencies, and import reachability were analyzed and notes any tool limitation.

### AC-3: Comparative analysis

Use the repository-installed `ts-prune` and `depcheck`, plus Knip and an import-graph tool when they can run without changing manifests, lockfiles, workflow files, agent memory, or committed quality-tool configuration. Run tools at repository scope and package scope where supported. Record failed or unsupported runs as evidence instead of silently dropping them.

### AC-4: Evidence-based classification

Group findings by package or related package family under all of these buckets:

1. definitely dead and safe to remove
2. test-only usage
3. public API or exported surface requiring explicit decision
4. dynamic, registry, or config-driven usage requiring manual validation
5. dependency cleanup candidates
6. confirmed false positives

A candidate is “definitely dead” only when targeted reference checks find no production, test, package-export, script, configuration, registry, or dynamic-loading use. Tool output alone is not sufficient. Ambiguous candidates remain in a decision or validation bucket.

### AC-5: Production and test distinction

For symbol, file, and dependency candidates, distinguish references from production source, tests/test utilities/fixtures, build or maintenance scripts, package metadata, and generated output. Test-only does not mean safe to delete without deciding whether the supporting test behavior remains needed.

### AC-6: False-positive guidance

Document recurring false-positive patterns that follow-up work must not remove blindly, including package export maps, root/workspace dependency ownership, type-only imports, executables and extension entrypoints, build or test tooling, generated artifacts, optional/platform dependencies, and string-based registry or configuration lookup.

### AC-7: Follow-up slices

Group candidates into manageable cleanup slices by package family. Recommend an order that starts with narrow, corroborated removals and leaves public API and dynamic-use decisions until their owners validate compatibility.

### AC-8: Parent issue update

After the inventory is committed and linkable, update issue #2233 with a link to it, the analyzed commit, package coverage, and recommended cleanup order.

### AC-9: Scope preservation

Do not change production code, tests, package manifests, lockfiles, workflows, agent memory, dependency versions, or permanent analysis configuration. Raw command output belongs in the gitignored `tmp/issue2233/` directory and is summarized in the committed inventory.

## Inputs and boundary cases

- Package-local entrypoints: `index.ts`, `src/**`, `bin`, extension/server entrypoints, `main`, `types`, `bin`, `files`, and `exports` fields.
- Cross-workspace consumers and root scripts, integration tests, evals, docs examples, configuration, schemas, and bundle/build scripts.
- Test patterns: `*.test.*`, `*.spec.*`, `__tests__`, test utilities, fixtures, and package-specific test runners.
- Generated or vendored paths: `dist`, `bundle`, coverage, snapshots, generated manifests, lockfiles, and `node_modules` are not source-orphan proof.
- Dynamic use: import strings, registries, provider/tool discovery, command tables, extension activation, environment/profile configuration, and package metadata.
- Dependencies: runtime, development, optional, peer-like metadata, platform packages, type packages, workspace links, root-owned tooling, and packages invoked from scripts rather than imported.
- Public surface: root barrels, package export maps, declarations, published `files`, bins, and documented external imports. An unreferenced public export needs an explicit compatibility decision.
- Tool disagreement: preserve the outputs and resolve classifications through targeted TypeScript/text references and package metadata rather than choosing one tool as authoritative.

## Behavioral evidence

The deliverable is documentation, so evidence is analysis coverage rather than new automated product tests.

1. `npm run typecheck` and `npm run lint` baseline results are recorded.
2. Tool versions and repository/package commands are recorded, with raw logs under `tmp/issue2233/`.
3. A package coverage table accounts for all 16 package directories found by both the workspace list and `packages/*/package.json` discovery.
4. Every “definitely dead” row includes targeted no-reference and no-public/dynamic-use evidence.
5. Every dependency candidate includes manifest location, tool reports, targeted import/script evidence, and production/dev/optional classification.
6. The inventory contains all six required buckets, including empty-state wording if a bucket has no sufficiently supported candidate.
7. `npm run format`, repository link/placement checks through lint, and the required full verification cycle pass on the candidate head.
8. Review findings are classified as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or `Defer`; only the first two classes authorize changes in this effort.

## Review limits

Run at most two local Open Code Review rounds and at most two PR Open Code Review rounds. Do not add a new tool, dependency, workflow, agent-memory rule, public abstraction, unrelated refactor, or production behavior without user approval.
