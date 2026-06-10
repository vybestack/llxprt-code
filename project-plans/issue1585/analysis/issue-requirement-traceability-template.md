# Issue Requirement Traceability Table

Plan ID: PLAN-20260608-ISSUE1585
Issue: #1585

This template maps each requirement from the issue body and comments to plan phases and artifacts. It MUST be populated during P00a by reviewing the actual issue content.

## Traceability: Issue Requirements → Plan Phases

| Issue Requirement | Plan Phase(s) | Artifact(s) | Status |
| --- | --- | --- | --- |
| Extract packages/tools from core | P03, P06-P16 | packages/tools/ | Planned |
| No tools→core dependency | P04, P07, P10, P11, P15 | forbidden-imports.test.ts, boundary-scan.test.ts | Planned |
| Tools-owned interfaces only | P03, P05 | packages/tools/src/interfaces/** | Planned |
| Core adapters for tools interfaces | P11 (per group), P12 | packages/core/src/tools-adapters/** | Planned |
| MCP client/manager stay in core | P09, P15 | move-map-final.md (STAY_CORE_INFRASTRUCTURE) | Planned |
| mcp-tool.ts conditional move | P09 (decision), P11 Group 8 | analysis/mcp-tool-decision.md | Planned |
| Tool key storage ownership split | P09, P11 Group 7 | packages/tools/src/utils/tool-key-utils.ts | Planned |
| No compatibility shims | P15 | no-shim scan (core/tools/ scope) | Planned |
| Provider import migration | P13 | consumer-rewrite-map-final.md | Planned |
| CLI uses core re-exports only | P13 | CLI decision in plan/13-consumer-migration.md | Planned |
| A2A server no direct tools dep | P13, P16 | A2A verification in plan/13a, plan/16 | Planned |
| Release workflow updates | P14 | .github/workflows/release.yml, release-process.test.js | Planned |
| Sandbox/Dockerfile updates | P14 | build_sandbox.js, Dockerfile | Planned |
| Manual trusted publishing | P14 | manual-trusted-publishing.md | Planned |
| Behavioral regression tests | P10 | packages/tools/src/__tests__/*.test.ts | Planned |
| Pre-extraction characterization fixtures | P10 | packages/tools/src/__tests__/fixtures/** | Planned |
| (Add rows from actual issue body/comments during P00a) | | | |

## Population Instructions

1. Run `gh issue view 1585 --comments` to capture the actual issue content
2. For each distinct requirement in the issue body and actionable comments, add a row
3. If a comment raises a concern not covered by the plan, flag as UNCOVERED
4. UNCOVERED items require a resolution plan before proceeding past P00a
5. The approved temporary interface-adapter path is NOT blocked by UNCOVERED items