# P01 — Analysis: Complete Config Member Census by Role

> **SUPERSEDED — DO NOT EXECUTE.** See `../STATUS.md`. This plan targeted type
> width; the real problem is that `Config` mixes configuration, construction,
> injection and service location. Kept for the reasoning and the recorded dead
> ends only.

Plan ID: PLAN-20260808-ISSUE2615.P01
Requirement: REQ-002

## Goal

Produce `project-plans/issue2615/analysis/role-assignment.json`: every member of
`Config` that is reached from outside `packages/core`, assigned to exactly one
role, with its declared signature and its call sites.

This is read-only analysis. No source file may be modified.

## Inputs

- `packages/core/src/config/config.ts`, `configBaseCore.ts`, `configConstructor.ts`
- `bun scripts/config-contract.ts` — existing syntactic contract analysis
- `bun scripts/api-census.ts` — existing AST import census

## Required output shape

```json
{
  "generatedAt": "<ISO>",
  "commit": "<sha>",
  "roles": {
    "SessionIdentity": {
      "members": [
        { "name": "getSessionId", "signature": "getSessionId(): string",
          "callSites": ["packages/agents/src/x.ts:42"], "prodCount": 25 }
      ]
    }
  },
  "serviceLocators": [
    { "name": "getToolRegistry", "returns": "ToolRegistry",
      "compositionRootsNeedingIt": ["packages/agents/src/core/client.ts"] }
  ],
  "compositionRoots": [
    { "file": "...", "membersRead": 12, "constructsConfig": false,
      "feedsFromConfig": true }
  ],
  "configConstructors": ["packages/agents/src/core/subagent-test-helpers.ts"]
}
```

## Method — MANDATORY

Use the **TypeScript compiler API with a type checker**, not regex and not
`ts.createSourceFile` alone. The existing `scripts/config-contract.ts` is
syntactic and is known to both over- and under-report. Build a `ts.Program` over
each consumer package and resolve receivers by type.

Record in the output where the checker result differs from the syntactic tool.

## Role assignment rules

Assign each member to exactly one of:

`SessionIdentity`, `ModelSelection`, `EphemeralSettings`, `WorkspacePaths`,
`MemoryAccess`, `ToolAccess`, `PolicyAccess`, `McpAccess`, `TelemetryAccess`,
`Diagnostics`.

A member that returns a service object (`getXManager`, `getXService`,
`getXRegistry`, `getXClient`, `getXFactory`, `getXEngine`) does **not** go in a
role. It goes in `serviceLocators` and will become an injected dependency in P06.

If a member fits no role and is not a service locator, list it under a
`"unassigned"` key with a one-line note. Do not invent an eleventh role. P02
decides what happens to unassigned members.

## Composition-root identification

A file is a composition root if any of:
- it calls `fromConfig(...)`
- it constructs a chat session, content generator, agent or subagent scope
- it reads more than 8 distinct Config members

Record all three signals per file so P02 can judge.

## Acceptance criteria

- `analysis/role-assignment.json` exists, valid JSON, matching the shape above
- Every member with a production call site appears exactly once across
  `roles` + `serviceLocators` + `unassigned`
- Each role has ≤ 12 members, or the file explains why not
- `analysis/01-analysis.md` summarises: member totals per role, service-locator
  count, composition-root list, and every place the checker disagreed with the
  syntactic tool
- No file under `packages/` modified — `git status --short packages/` is empty
