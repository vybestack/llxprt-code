# Feature Specification: Config God-Object Decomposition (Issue #2615)

Plan ID: PLAN-20260808-ISSUE2615

## Purpose

`packages/core/src/config/Config` is a 2,514-line class spanning three files with
~349 members. 120 production files outside core hold a reference to it and reach
124 distinct members through it. It is simultaneously a settings bag, a service
locator, a session identity, a workspace descriptor and a composition root.

This plan ends with `Config` decomposed: no production file outside core imports
the `Config` **type**, every cross-package consumer depends on a role interface
or an injected service, and the service-locator getters are gone. Issue #2615
closes when the acceptance criteria in this document are all met.

## The end state, stated concretely

1. **Zero production files outside `packages/core` import the `Config` type.**
   Enforced by a CI guard, not by inspection.
2. **`Config` no longer exposes service getters cross-package.** The ~40 members
   of the form `getXManager()` / `getXService()` / `getXRegistry()` are removed
   from the cross-package surface; those services are injected at composition
   roots instead.
3. **Composition roots receive their dependencies explicitly.** The five known
   roots (`client.ts`, `zedIntegration.ts`, `subagentOrchestrator.ts`,
   `createChatSessionSafe`, `cli.tsx`) take a declared dependency record, not a
   `Config`.
4. **Role interfaces are owned by core and published**, one per concern, each
   under 12 members.
5. **`Config` itself remains** as the concrete implementation that satisfies the
   role interfaces and is constructed at the application entry point. It is no
   longer a cross-package type.

Point 5 is deliberate. "Delete Config" is not achievable without rewriting
application bootstrap, and is not what decomposition means. What must end is
`Config`-as-shared-type.

## Architectural Decisions

- **Role interfaces live in core**, at `packages/core/src/config/roles/`, and are
  published through a single `./config/roles` export subpath. Consumers stop
  declaring their own duplicates; the eight consumer-owned capability modules
  added earlier on this branch are consolidated into the core roles and deleted.
- **Services are injected, not fetched.** Every `getXManager()` style accessor
  used cross-package becomes a constructor or factory parameter at the
  composition root.
- **`Config` implements the role interfaces structurally.** No adapter classes,
  no wrapper objects. This keeps the migration mechanical and reversible.
- **Composition roots take a `RuntimeDependencies` record**, an explicit
  interface listing what they need. This replaces both `Config` and the
  service-locator calls in one move.
- **No compatibility shims.** A file either uses a role interface or it does
  not. No `type Config = ...` aliases left behind.

## Project Structure

    packages/core/src/config/roles/
      index.ts                    barrel, the only public entry
      sessionIdentity.ts          session id, turns, interactivity
      modelSelection.ts           model, provider, content generator, tokenizer
      ephemeralSettings.ts        get/set ephemeral, settings service
      workspacePaths.ts           target dir, project root, working dir, temp
      memoryAccess.ts             user/core/global/jit memory
      toolAccess.ts               tool registry, allowed tools
      policyAccess.ts             policy engine, approval mode
      mcpAccess.ts                mcp servers, instructions, discovery
      telemetryAccess.ts          re-export of telemetry's TelemetryConfig
      diagnostics.ts              debug mode, conversation logging, redaction
    packages/core/src/config/runtimeDependencies.ts
                                  explicit record for composition roots

## Integration Points

### Existing code that will use this

All 120 production files outside core currently importing `Config`. Enumerated
in `analysis/config-holders.json`, produced by Phase 1.

### Existing code to be replaced

- `packages/agents/src/config/capabilities.ts`
- `packages/providers/src/config/capabilities.ts`
- `packages/cli/src/config/capabilities.ts`
- `packages/mcp/src/client/trustedFolderSource.ts`
- Inline `Pick<Config, ...>` narrowings (5 sites)
- Interfaces hand-declared by consumers because no contract existed: the six
  re-derivations of `setEphemeralSetting(key, value)` and the structural
  `getSettingsService()` shape in `turnCitations.ts`

All are superseded by `core/config/roles`. None survive the plan.

### User access points

None. This is a type-level refactor with no runtime behaviour change. The
`bun scripts/start.ts` smoke test and the full test suites are the behavioural
guard.

### Migration requirements

Per-package, per-PR-able commits. Every phase leaves the build green.

## Formal Requirements

- **REQ-001** No production file outside `packages/core` imports the `Config`
  type from any specifier.
- **REQ-001.1** Enforced by `scripts/check-config-boundary.ts`, wired into the
  `lint` npm script and CI.
- **REQ-002** `packages/core/src/config/roles/` exports at most 10 interfaces,
  each with at most 12 members.
- **REQ-002.1** Enforced by a test asserting member counts.
- **REQ-003** The five composition roots take `RuntimeDependencies`, not
  `Config`.
- **REQ-004** No service-locator accessor (`getXManager`, `getXService`,
  `getXRegistry`) appears on any role interface.
- **REQ-004.1** Enforced by the same boundary guard.
- **REQ-005** The four consumer-owned capability modules are deleted.
- **REQ-006** All existing tests pass unmodified, except where a test itself
  declared a `Config` type.
- **REQ-007** `npm run test`, `test:scripts`, `lint`, `lint:affected-shards`,
  `typecheck`, `format`, `build` and the stepfun smoke test all pass.

## Constraints

- No `eslint-disable`, `ts-ignore`, `ts-expect-error`, `ts-nocheck`.
- No loosening of any lint or complexity threshold.
- New and changed tests use Bun and `bun:test`.
- `Config` construction sites (factories, test harnesses) legitimately keep the
  concrete class and are exempt from REQ-001 by being inside core or by
  constructing it — the guard tests for construction, not for a name allowlist.
- Behaviour must not change. This is types and injection only.

## Performance Requirements

None. Type-level change.
