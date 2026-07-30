# Issue #2692 — Remove dead remote telemetry scaffolding

The requested canonical file, `dev-docs/workflow/ISSUE-DELIVERY.md`, is not
present on current `origin/main`. This plan applies the bounded issue-delivery
requirements supplied with the issue together with `dev-docs/RULES.md`.

## Problem and decisions

The application telemetry SDK constructs only local file or console exporters,
but active configuration, CLI, UI, dependency, and helper-script surfaces still
imply that LLxprt can export telemetry remotely. The dependency criterion is
broader than the six direct declarations: `@opentelemetry/sdk-node` installs
OTLP grpc/http/proto exporters transitively and contains environment-driven
OTLP defaults. It must therefore be removed to satisfy “declared or installed.”

Decisions:

1. **Hard-remove the three inert application CLI flags.** Accepted-and-ignored
   deprecation would leave CLI flags and contradict both the acceptance criterion
   and the project's fail-fast preference.
2. **Remove destination enums rather than preserve one-value enums.** Remove the
   telemetry package enum/defaults and the distinct AgentRuntime enum/public
   export. Keep the otherwise unrelated runtime snapshot field temporarily as
   `'local' | null` so removing an unused field does not force mechanical edits
   across dozens of agent fixtures.
3. **Remove remote destination settings, not merely their getters.** Delete
   `target`, `otlpEndpoint`, `otlpProtocol`, `useCollector`, and remote-consent
   plumbing from active application, agent, and A2A configuration. Existing
   strict schemas will reject stale keys instead of silently ignoring them.
4. **Replace `NodeSDK` with direct local providers.** Compose the already-present
   `NodeTracerProvider`, `LoggerProvider`, and `MeterProvider`, retain one HTTP
   instrumentation instance, and implement flush/shutdown against those real
   providers. Do not add a public SDK abstraction or dependency.
5. **Preserve ungated in-memory aggregation.** `/stats` aggregation is local,
   ephemeral, and independent of OTEL export enablement. Pin that behavior with
   a test while leaving `loggers.ts` unchanged.
6. **Remove the About GCP row end to end.** Delete only the About data pipe; do
   not touch real provider GCP authentication or environment handling.
7. **Use a narrow existing test as a privacy invariant guard.** Extend the
   telemetry accuracy test to reject OTLP exporter/sdk-node declarations,
   lockfile entries, and source imports. Do not change workflows or quality-tool
   configuration.
8. **Remove the dedicated collector launcher/toolchain.** It is a runnable GCP
   destination surface omitted from the issue's original vestige list. Keeping
   it would leave active remote telemetry advertising after the application
   flags and settings are removed. This is an unplanned subsystem deletion and
   is separately called out in the scope approval gate below.

## Acceptance matrix

| ID  | Given                                                       | When                                                  | Then                                                                                                                             | Behavioral or invariant evidence                                                                   |
| --- | ----------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A1  | Active workspace manifests and installed dependencies       | Dependencies are installed from either lockfile       | No `@opentelemetry/exporter-*-otlp-*` or `@opentelemetry/sdk-node` package is declared, locked, or installed                     | Manifest/lock/source guard plus `npm ls` and installed-tree checks                                 |
| A2  | Local OTEL telemetry is enabled                             | Telemetry initializes, emits, flushes, and shuts down | File/console-only telemetry still works through direct tracer/logger/meter providers and one HTTP instrumentation                | Real temporary-outfile lifecycle test; no provider call-count assertions                           |
| A3  | A user supplies any removed telemetry destination flag      | CLI parsing runs                                      | Startup fails with an unknown-argument error; no accepted deprecation/no-op path exists                                          | Table-driven parser behavior for target, endpoint, and protocol                                    |
| A4  | A user requests CLI help                                    | Help renders                                          | None of the three inert flag names appears; supported local telemetry flags remain                                               | Real help-output test                                                                              |
| A5  | Active settings, agent config, or A2A config is inspected   | Configuration is parsed/built                         | No remote target, endpoint, protocol, collector, or remote-consent field is exposed or honored                                   | Strict settings and agent-schema rejection tests; A2A config behavior test; generated-schema check |
| A6  | Active telemetry source is inspected                        | Types and config contracts compile                    | No telemetry `GCP`/remote enum member, `TelemetryTarget` symbol, default target, default endpoint, or destination getter remains | Typecheck and active-source invariant search                                                       |
| A7  | Conversation logging is disabled or enabled                 | PrivacyManager evaluates logging/disclosure           | Explicit logging enablement alone controls permission and disclosure always identifies the configured local path                 | PrivacyManager input/output behavior tests                                                         |
| A8  | `GOOGLE_CLOUD_PROJECT` is set                               | `/about` is executed and rendered                     | No GCP project field or row appears                                                                                              | Existing About command/history/render tests with the environment variable set                      |
| A9  | OTEL telemetry is disabled and the SDK is uninitialized     | Tool/API events are logged                            | In-memory `/stats` aggregation still records the event and no exporter is required                                               | Real `uiTelemetryService` snapshot assertion with telemetry explicitly disabled                    |
| A10 | The dedicated telemetry helper command surface is inspected | Root scripts and helper entry points are enumerated   | No GCP collector target or helper remains                                                                                        | Script inventory/guard test and active-source search                                               |
| A11 | Users read telemetry/configuration documentation            | Resulting code is documented                          | Docs describe only local in-memory stats and local file/console OTEL output, with no inert-flag or collector caveat              | Existing documentation accuracy/link/placement tests                                               |
| A12 | Candidate head is verified                                  | Required gates run                                    | Test, lint, typecheck, format, build, and configured smoke tests pass                                                            | Exact command exit status on candidate head                                                        |

## Explicit non-goals

- Do not gate or persist the in-memory `/stats` aggregation layer.
- Do not add a remote exporter, collector integration, migration shim, warning-only
  compatibility path, or public telemetry abstraction.
- Do not reproduce undocumented `NodeSDK` resource/environment auto-detection.
- Do not change provider-specific GCP/Vertex/Code Assist authentication,
  `GOOGLE_CLOUD_PROJECT` handling outside the About data pipe, or A2A task
  environment restoration.
- Do not remove the unrelated AgentRuntime snapshot `telemetry.target` property;
  constrain it to `'local' | null` and defer the 37-file mechanical cleanup.
- Do not change OCR review-statistics telemetry scripts.
- Do not edit historical `project-plans/**`, move unrelated tests, or redesign
  conversation retention/redaction.
- Do not change workflows, agent memory, quality tools, lint rules, complexity or
  source-size thresholds, ignores, suppressions, or coverage requirements.

## Bounded vertical slices

1. **User-visible contracts (RED):** add failing unknown-flag/help, strict
   settings/agent, privacy, About, local aggregation, and dependency guard tests.
2. **Local SDK composition (GREEN):** remove exporter/sdk-node dependencies,
   replace NodeSDK with direct local providers, regenerate locks, and prove real
   local emission/flush/shutdown.
3. **Configuration removal (GREEN):** remove enums/defaults/getters, CLI mapping,
   persisted schema fields, agent/A2A fields, and typed fixture remnants; regenerate
   the settings schema.
4. **Privacy and About removal (GREEN):** remove unreachable remote-consent logic
   and the About GCP data pipe without touching provider auth.
5. **Collector and documentation removal (GREEN):** delete the dedicated helper
   command/toolchain and update all active truth-facing docs and release notes.
6. **Verification and review:** reconcile scope, run focused/full gates, tmux-test
   the About/help UI change, triage DeepThinker/OCR findings, and stop after all
   accepted behavior and required gates pass.

## Expected paths and scope ledger

### Dependencies, SDK, and invariant evidence

| Paths                                                                                      | Planned change                                                             | Acceptance       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ---------------- |
| `package.json`, `packages/telemetry/package.json`                                          | Remove six exporters, sdk-node, and root collector command                 | A1, A10          |
| `package-lock.json`, `bun.lock`                                                            | Regenerate without direct/transitive OTLP exporters or sdk-node            | A1               |
| `packages/telemetry/src/telemetry/sdk.ts`                                                  | Direct local provider lifecycle                                            | A2               |
| `packages/core/src/telemetry/sdk.test.ts`, `packages/core/src/telemetry/telemetry.test.ts` | Replace stale NodeSDK interaction tests with observable lifecycle evidence | A2               |
| `scripts/tests/telemetry-doc-accuracy.test.ts`                                             | Extend existing source/manifest/lock privacy guard                         | A1, A2, A10, A11 |

### Destination configuration and contracts

| Paths                                                                                                                                                                                   | Planned change                                                       | Acceptance |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------- |
| `packages/telemetry/src/telemetry/index.ts`, `packages/telemetry/src/internal/interfaces.ts`                                                                                            | Remove destination enum/defaults/getters                             | A5, A6     |
| `packages/core/src/telemetry/index.ts`                                                                                                                                                  | Remove compatibility re-exports                                      | A6         |
| `packages/core/src/config/configTypes.ts`, `configConstructor.ts`, `configBaseCore.ts`, `config.ts`                                                                                     | Remove destination/endpoint/remote-consent fields and defaults       | A5, A6, A7 |
| `packages/core/src/runtime/AgentRuntimeContext.ts`, `packages/core/src/index.ts`                                                                                                        | Remove distinct enum/public export; constrain snapshot to local/null | A6         |
| `packages/core/src/config/config.b2.test.ts`, `configTestHarness.ts`, `config-lsp-integration.test.ts`, `packages/core/src/lsp/__tests__/system-integration.test.ts`, `e2e-lsp.test.ts` | Remove stale tests/mocks while preserving supported telemetry tests  | A5, A6     |
| `test-scripts/privacy-validation.ts`                                                                                                                                                    | Verify local path without a target getter                            | A7         |

### CLI, schemas, agents, and A2A

| Paths                                                                                                                                                                                                                                          | Planned change                                                       | Acceptance |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------- |
| `packages/cli/src/config/yargsOptions.ts`, `cliArgParser.ts`, `configBuilder.ts`                                                                                                                                                               | Hard-remove flags, mappings, and endpoint environment plumbing       | A3-A6      |
| `packages/cli/src/config/config.test.ts`, `packages/cli/src/integration-tests/cli-args.integration.test.ts`                                                                                                                                    | Unknown-flag and help behavior                                       | A3, A4     |
| `packages/cli/src/config/settingsSchema.ts`, `schemas/settings.schema.json`, `packages/cli/src/config/settingsSchema.test.ts`, `settings-validation.test.ts`                                                                                   | Remove four persisted fields, regenerate, and prove strict rejection | A5         |
| `packages/agents/src/api/config-schema.ts`, `config-types.ts`, focused existing/new API behavior test                                                                                                                                          | Remove target/endpoint and prove strict rejection/local acceptance   | A5         |
| `packages/a2a-server/src/config/config.ts`, `config.factory-migration.test.ts`                                                                                                                                                                 | Remove target/endpoint/environment mapping                           | A5         |
| `packages/cli/src/cli.test.tsx`, `cli-sandbox.test.tsx`, `config/__tests__/outputFormat.test.ts`, `config/config.loadMemory.test.ts`, `ui/hooks/agentStream/__tests__/streamRuntimeTestHelper.ts`, `packages/test-utils/src/test-rig-setup.ts` | Mechanical typed-fixture cleanup                                     | A5, A6     |
| `packages/cli/src/providers/logging/git-stats.test.ts`                                                                                                                                                                                         | Remove obsolete GCP-target case while retaining real local behavior  | A6         |

### Privacy, About, and local aggregation

| Paths                                                                                                                                                                           | Planned change                                        | Acceptance |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------- |
| `packages/cli/src/utils/privacy/PrivacyManager.ts`, focused behavior test                                                                                                       | Remove remote branch/consent and prove local behavior | A7         |
| `packages/cli/src/ui/cliUiRuntime.ts`                                                                                                                                           | Remove target/endpoint/remote-consent runtime surface | A5-A7      |
| `packages/cli/src/ui/commands/aboutCommand.ts`, `ui/types.ts`, `ui/hooks/slashCommandProcessorSupport.ts`, `ui/components/HistoryItemDisplay.tsx`, `ui/components/AboutBox.tsx` | Remove About GCP field end to end                     | A8         |
| `packages/cli/src/ui/commands/aboutCommand.test.ts`, `ui/components/HistoryItemDisplay.test.tsx`, `ui/components/AboutBox.theme.test.tsx`                                       | About behavior evidence                               | A8         |
| `packages/telemetry/src/telemetry/loggers.localAggregation.test.ts`                                                                                                             | Explicitly pin ungated in-memory stats                | A9         |
| `packages/telemetry/src/telemetry/loggers.ts`                                                                                                                                   | No production change expected                         | A9         |

### Collector subsystem and documentation

| Paths                                                                                                                                                      | Planned change                                              | Acceptance  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------- |
| `scripts/telemetry.ts`, `telemetry_gcp.js`, `local_telemetry.js`, `telemetry_utils.js`                                                                     | Delete dedicated collector launcher/toolchain               | A10         |
| `scripts/tests/telemetry-user-settings-path.test.ts`, `telemetry-utils-path.test.ts`                                                                       | Delete tests for removed helper implementation              | A10         |
| `scripts/tests/bun-script-migration.test.ts`                                                                                                               | Update active script inventory                              | A10         |
| `docs/telemetry.md`, `docs/telemetry-privacy.md`, `docs/cli/configuration.md`, `docs/cli/enterprise.md`, `dev-docs/telemetry-internals.md`, `CHANGELOG.md` | Match resulting local-only behavior and record hard removal | A11         |
| `dev-docs/plans/2026-07-28-issue-2692-remove-remote-telemetry-scaffolding.md`                                                                              | Decision and scope record                                   | Policy gate |

Expected scope is approximately 60–70 changed/deleted files and net -1,100 to
-1,400 lines. The result is deletion-heavy, but it exceeds both the 25-file
mandatory-review threshold and the 40-file hard stop. A safe implementation
below 25 files cannot satisfy the issue's active dependency, typed config,
schema, UI, and evidence contracts. Deleting the collector subsystem was not in
the original numbered work list and is an unplanned subsystem change.

**Scope status: explicitly approved by the user on 2026-07-28.** The approval
covers the >40-file hard budget, removal of the dedicated collector subsystem,
and removal of `@opentelemetry/sdk-node` required to eliminate installed OTLP
exporters. The mandatory scope review remains required before delivery.

## Review finding classifications

Every review finding must be recorded as one of:

- **Blocker-Fix:** violates an accepted behavior or required gate.
- **In-scope-Fix:** improves correctness or maintainability within A1-A12 and the
  approved paths.
- **Reject:** factually incorrect or contradicts the accepted design.
- **Defer:** valid but outside A1-A12 or the scope ledger and requiring separate
  approval/issue.

Reviewer suggestions do not expand this ledger. Use at most two local OCR and
two PR OCR reviews. After the bounded review rounds, remediate accepted findings
without launching optional additional reviews.

## Verification and exact-head completion gate

Focused evidence includes CLI parser/help, strict settings and agent schema,
A2A config, PrivacyManager, About rendering, real local SDK lifecycle, ungated
local aggregation, generated schema, dependency/source/lock guards, and tmux
harness coverage for help/About UI behavior.

Full local gates are `npm run test`, `npm run lint`, `npm run typecheck`,
`npm run format`, `npm run build`, and the configured profile smoke tests.
Dependency evidence must also prove that neither lockfile nor installed tree
contains sdk-node or an OTLP exporter package.

Exact-head completion additionally requires completed and triaged reviews,
correct ancestry, a conflict-free PR, green CI on the candidate commit, all
Blocker-Fix and In-scope-Fix findings resolved, no `.llxprt/**` changes, and this
scope ledger reconciled to the final diff. Stop successfully at that point;
do not continue optional cleanup or hardening.
