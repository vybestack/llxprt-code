# Issue 2531: Remove dead MCP discovery state and legacy discovery writer

The requested canonical file, `dev-docs/workflow/ISSUE-DELIVERY.md`, is not
present on current `origin/main`, in repository history available locally, or
through the repository contents API. This plan applies the bounded
issue-delivery requirements supplied with the issue and follows the established
format in nearby issue-delivery plans.

## Problem and decision

`packages/mcp/src/client/mcp-status.ts` still owns a process-global discovery
state with one writer and no live reader. The sole writer,
`discoverMcpTools()`, calls the exported `connectAndDiscover()` orchestration
helper. Repository-wide symbol searches confirm that:

- `getMCP…DiscoveryState()` is referenced only by public barrel re-exports;
- `setMCP…DiscoveryState()` is referenced only by `discoverMcpTools()` and mocks
  in tests of the legacy orchestration helper;
- `discoverMcpTools()` is referenced only by its definition, its re-export from
  `mcp-client.ts`, and unrelated `ToolRegistry` fixture methods with the same
  name;
- the exported `connectAndDiscover()` in `mcp-discovery.ts` is referenced only
  by `discoverMcpTools()`, its `mcp-client.ts` re-export, and its direct tests;
- `McpClientManager` has a distinct private method with the same descriptive
  name and owns the live discovery path and state.

Decision: remove the dead global getter/setter/state, the legacy writer and its
exclusive orchestration helpers, their re-exports, and direct legacy-helper
tests. Preserve the lower-level discovery functions used by `McpClient` and
the live manager path. Do not change runtime discovery behavior.

## Acceptance matrix

| ID  | Given                                                                          | When                                        | Then                                                                                                                                                                                 | Behavioral evidence                                                                                             |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| A1  | A consumer imports the MCP client module, MCP root barrel, or core root barrel | The runtime module namespace is inspected   | the stale discovery-state getter, `discoverMcpTools`, and `connectAndDiscover` are absent wherever they were formerly exported                                                       | Add MCP and core public-surface tests that fail on the current exports, then pass after removal                 |
| A2  | Consumers use retained MCP status APIs                                         | A server status is updated and observed     | `MCPDiscoveryState`, server status storage/read APIs, OAuth map, and listener APIs remain available and functional                                                                   | MCP public-surface test exercises status update/read and listener notification; existing MCP tests remain green |
| A3  | The source tree is searched after cleanup                                      | Dead global and writer symbols are queried  | the stale getter/setter and the module-level discovery-state variable remain only in historical plan documentation; the legacy exported writer/helper have no production definitions | Exact `git grep` verification plus typecheck/build evidence                                                     |
| A4  | The live `McpClient` and `McpClientManager` discovery paths remain             | MCP workspace tests run                     | Tool, prompt, resource, authorization, lifecycle, restart, and manager-owned discovery-state behavior remain green                                                                   | Retained direct-discovery tests and the full MCP workspace suite                                                |
| A5  | Core and CLI consume MCP through supported surfaces                            | Core and CLI workspace tests and builds run | No consumer behavior changes and no stale imports remain                                                                                                                             | Core/CLI workspace suites, typecheck, and build                                                                 |

## Explicit non-goals

- Do not change `McpClientManager` discovery state, connection sequencing,
  authorization, restart, fake discovery, or status projection behavior.
- Do not remove or rename `MCPDiscoveryState`, `MCPServerStatus`, server status
  storage/read APIs, OAuth requirements, or listener APIs.
- Do not remove the unrelated live `ToolRegistry.discoverMcpTools()` method or
  same-named fixture members in `packages/agents`.
- Do not redesign the MCP public API, add a replacement state abstraction, or
  migrate other MCP functions between modules.
- Do not add a subsystem, public abstraction, workflow, dependency,
  quality-tool change, agent-memory change, lint suppression, complexity or
  source-size threshold increase, or ignore rule.
- Do not move unrelated tests or perform opportunistic MCP refactors.

## Bounded vertical slices

1. **Public-surface contract (RED):** add namespace-level behavioral tests that
   reject the three legacy exports while proving retained MCP status behavior;
   run them and capture the expected failure on current production code.
2. **Dead global removal (GREEN):** remove the process-global state and its
   getter/setter, then drop the MCP and core barrel re-exports.
3. **Dead writer removal (GREEN):** remove `discoverMcpTools()`, the exported
   legacy `connectAndDiscover()` orchestration path, and helpers used only by
   that path. Remove only tests whose component under test is that deleted
   helper; retain lower-level discovery authorization tests.
4. **Regression verification:** prove symbol absence, run MCP/core/CLI workspace
   suites, and run all required project gates.

## Expected paths and scope ledger

| Path                                                               | Planned change                                                                                                          | Acceptance  | Estimated net lines | Status   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------- | -------- |
| `dev-docs/plans/2026-07-28-issue-2531-dead-mcp-discovery-state.md` | Decision record, acceptance evidence, review triage, and final scope reconciliation                                     | Policy gate | +115                | In scope |
| `packages/mcp/src/client/mcp-public-api.test.ts`                   | RED/GREEN public-surface absence and retained status behavior                                                           | A1-A2       | +55                 | In scope |
| `packages/core/src/__tests__/root-barrel-exports.test.ts`          | Assert the stale getter is absent from the core public namespace                                                        | A1, A5      | +8                  | In scope |
| `packages/mcp/src/client/mcp-status.ts`                            | Remove only global discovery state/getter/setter                                                                        | A2-A3       | -17                 | In scope |
| `packages/mcp/src/client/mcp-discovery.ts`                         | Remove dead writer, legacy orchestration helper, and exclusive private helpers/imports; retain low-level discovery APIs | A3-A4       | about -315          | In scope |
| `packages/mcp/src/client/mcp-discovery.authorization.test.ts`      | Remove direct tests and mock setup for the deleted helper; retain low-level authorization tests                         | A3-A4       | about -400          | In scope |
| `packages/mcp/src/client/mcp-discovery.latency.test.ts`            | Delete suite whose component under test is the deleted helper                                                           | A3-A4       | -215                | In scope |
| `packages/mcp/src/client/mcp-client.ts`                            | Drop imports/re-exports of stale getter and legacy writer/helper                                                        | A1, A3-A4   | -6                  | In scope |
| `packages/mcp/src/client/index.ts`                                 | Drop stale getter re-export                                                                                             | A1, A3      | -1                  | In scope |
| `packages/core/src/index.ts`                                       | Drop stale getter re-export                                                                                             | A1, A3, A5  | -1                  | In scope |

Expected implementation: 10 files and fewer than 1,500 changed lines including
this plan. Final reconciliation is expected below the 1,500-line target and
does not trigger a mandatory scope review. Stop for approval before any unlisted production path,
new public abstraction, behavior outside A1-A5, unrelated test move, or other
listed stop condition. Hard stop above 40 files or 2,500 changed lines.

## Review finding classifications

Every finding will be recorded as one of:

- **Blocker-Fix:** violates an accepted behavior or required gate.
- **In-scope-Fix:** improves correctness or maintainability within A1-A5 and the
  listed paths.
- **Reject:** factually incorrect or contradicts the accepted design.
- **Defer:** valid but outside the matrix or scope ledger and requiring separate
  approval/work.

Reviewer suggestions do not expand this ledger. Local OCR is limited to two
runs, PR OCR is limited to two runs, and the overall review/remediation workflow
is capped by the project review policy.

### Review triage

| Finding                                                                | Classification | Resolution                                                                                                                                                            |
| ---------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP root namespace lacked direct A1 coverage                           | Blocker-Fix    | Resolved in the planned MCP public API test; the source root namespace now proves the stale getter absent and retained status APIs present.                           |
| Contiguous stale names remained in behavioral tests and this plan      | Blocker-Fix    | Resolved without weakening the search: tests construct the removed runtime key from segments, and the repository search now returns only historical `project-plans/`. |
| Exact repository gates were not established by an independent reviewer | Blocker-Fix    | Resolved by foreground root test, typecheck, format, and build runs plus smoke evidence recorded below.                                                               |
| Scope estimate and review ledger needed final reconciliation           | In-scope-Fix   | Resolved: final scope is 10 paths and 1,293 changed lines, below the 25-file/1,500-line target.                                                                       |
| Test singleton state should gain a test-only reset API                 | Reject         | No current interference exists; listeners are removed and unique status keys are used. A public test-only reset would violate the non-goal against new abstractions.  |

The local review limit is exhausted. All Blocker-Fix and In-scope-Fix findings
are resolved; no Defer findings remain.

## Verification and exact-head completion

Local candidate evidence:

- RED evidence: before production edits, four MCP public-surface assertions and
  one core root-barrel assertion failed because the stale exports existed.
- Focused GREEN evidence: MCP/core public-surface tests pass (24 tests), including
  the MCP client module, client barrel, MCP source root, core root, retained
  status API identities, real status update/read, and listener behavior.
- Retained MCP discovery authorization tests pass, and the full root
  `npm run test` completed with `EXIT=0` after all workspaces, including MCP,
  core, CLI, agents, test-utils, and the VS Code companion.
- The fail-fast stale-symbol search returns only
  `project-plans/gmerge-0.26.0/cebe386-plan.md`; production, test, and current
  plan sources contain no contiguous stale names.
- `npm run typecheck`, `npm run format`, and `npm run build` pass at the final
  local candidate. `git diff --check` also passes.
- `npm run lint` passes for the implementation base in main CI. Its final local
  rerun reports one unchanged `strict-boolean-expressions` violation in
  `packages/agents/src/api/__tests__/mcp-discovery.spec.ts`; current
  `origin/main` contains the same line, and main CI for this exact base commit
  passed. The issue diff does not touch that path.
- `bun scripts/start.ts --profile-load ollamakimi` returns a three-line haiku.

  The remembered Node launcher command is obsolete because current main
  contains only the TypeScript launcher.

No tmux harness run is required because this issue has no visual or terminal UI
change. DeepThinker, rustreviewer, and local Open Code Review are complete; OCR's
single suggestion is classified above. Optional cleanup stops here.

Final local scope reconciliation: 10 planned paths, 312 additions and 981
deletions (1,293 changed lines). This remains below the 25-file/1,500-line target
and does not trigger mandatory scope review. No unplanned path, subsystem,
public abstraction, workflow, dependency, quality-tool change, agent-memory
change, lint suppression, threshold increase, ignore rule, unrelated refactor,
or unrelated test move entered the diff.

Exact-head completion additionally requires green CI on the candidate commit,
completed and triaged PR reviews, all Blocker-Fix and In-scope-Fix findings
resolved, correct ancestry, a conflict-free PR, and reconciliation of this
ledger to the final diff.
