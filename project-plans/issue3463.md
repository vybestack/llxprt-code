# Issue #3463: container multi-root workspaces

## Goal

Docker and Podman must expose every accepted workspace root at the same path used on the host. Host validation must reject missing, non-directory, inaccessible, and overlapping roots before image lookup, orphan cleanup, volume creation, or container launch. Every accepted root, including each literal nested workspace declared in its root `package.json`, must receive the private dependency treatment introduced by #3450.

Seatbelt keeps its existing profile-based include-directory grants. Container mode differs only where containers need explicit bind mounts and private engine-owned dependency volumes.

## Design

1. Resolve a container workspace plan before any engine operation. Preserve the primary working-directory spelling for its existing bind, identify accepted roots by real path, omit the primary identity from additional binds, reject ancestor/descendant overlap, and verify each root is a readable, writable, and searchable directory.
2. Add each include root as a read-write bind from the real host path to `getContainerPath(root)`. Add all workspace binds before private dependency volumes so the nested engine-owned mounts win.
3. Generalize #3450 dependency planning from one root to all planned roots. For every root, protect its root `node_modules` plus each literal declared nested workspace's `node_modules`. Run contamination preflight across every destination before orphan reaping or other engine activity.
4. Keep one per-session dependency lifecycle across all roots so one release removes containers, volumes, and empty engine-created mountpoints for the complete plan.
5. Exercise mount access, realistic offline dependency installation, host-tree preservation, and cleanup against real Docker and rootless Podman.

## Test-first evidence

### RED

Command:

```bash
bun test packages/cli/src/utils/sandbox-workspaces.test.ts packages/cli/src/utils/sandbox-node-modules.test.ts
```

Result: failed as expected on 2026-09-01. The new workspace test could not import `sandbox-workspaces.js`; all three new multi-root dependency tests failed because the existing #3450 planner accepted only one string root. Existing #3450 tests remained green. Full output is in the gitignored `tmp/verify3463/red-focused.log`.

A second test added on 2026-09-02 required a workspace root to be searchable as well as readable and writable. It failed because the planner did not check `X_OK`; `tmp/verify3463/red-unmountable.log` preserves that failure.

### GREEN

The final focused run passed 39 tests across workspace validation, dependency planning, launch ordering, and cleanup. The real-engine run passed the Docker and rootless Podman scenarios with 18 assertions. Each scenario read and wrote both roots, installed local packages into private root and nested-workspace dependency volumes, preserved seeded host dependency trees, removed absent mountpoints, and left no labeled volume or container behind.

The test-audit branch scan reported the same 2,023 findings as the saved main baseline, with an empty findings diff. `npm audit` reported four pre-existing low-severity `@ai-sdk/provider-utils` advisories whose offered fix requires a breaking forced upgrade; this issue does not change dependencies.

The final full `npm run test` completed all workspaces. All 726 CLI test files passed, including the changed sandbox suites. The agents workspace had two unrelated failures: the provider-naming scanner excluded every source file because this required worktree path contains `/tmp/` ([#3502](https://github.com/vybestack/llxprt-code/issues/3502)), and concurrent subagent termination cases crossed async mock/timer state ([#3504](https://github.com/vybestack/llxprt-code/issues/3504)). The agents runner passed 383 of 385 files; no issue #3463 test failed.

## Verification checklist

- [x] Focused workspace and dependency tests
- [x] Deterministic launch-order tests proving invalid roots stop before engine activity
- [x] Real Docker multi-root workflow
- [x] Real rootless Podman multi-root workflow
- [x] Host dependency trees unchanged and absent mountpoints cleaned
- [x] Engine volumes and containers cleaned
- [ ] `npm run test`
- [x] `npm run lint`
- [x] `npm run typecheck`
- [x] `npm run format`
- [x] `npm run build`
- [x] `npm audit` completed and pre-existing advisories recorded
- [x] Test-audit diff for changed tests
- [x] Final `git diff --check`
