# typescriptreviewer Review 02

## Verdict

FAIL

## Must-fix issues

1. P11/P12 phase order is not executable for high-coupling tools. `project-plans/issue1585/plan/11-tool-move-impl.md` moves shell/task/memory/todo/MCP/base registry files before `plan/12-core-adapters-and-registry-integration.md` creates adapters and registry wiring. Remediate by making P11 grouped migrations where each group includes interface updates, core adapter, constructor changes, registry factory update, and core/tools verification.
2. Interface contracts are too vague. `plan/02b-integration-contract.md`, `plan/00-overview.md`, and `analysis/final-architecture.md` list names/method sketches but do not capture current `packages/core/src/tools/tools.ts` behavior around MessageBus publish/subscribe/unsubscribe, MessageBusType, confirmation response correlation/abort/timeout, DiffUpdateResult, SchemaValidator, AnsiOutput, storage/key semantics, todo types, or MCP semantics. Add `analysis/interface-contracts-detailed.md` with exact TypeScript signatures and adapter mappings before P03/P11.
3. Runtime dependency relocation is under-specified. `analysis/dependency-audit.md`, `analysis/tool-move-map.md`, `plan/03-contracts-stub.md`, and `plan/06-package-scaffold-stub.md` do not enumerate external dependencies that must move from core to tools package metadata. Add `analysis/dependency-relocation-final.md` and require P09/P11 to classify every non-relative import used by moved tools and update `packages/tools/package.json` with direct runtime dependencies.
4. Release/versioning coverage omits actual repository scripts. `analysis/release-process.md` and `plan/14-release-process.md` cover release.yml, release-process tests, build_sandbox, Dockerfile, package-lock, and bind-release-deps, but omit explicit updates/evidence for `scripts/version.js`, plus inspection of `scripts/prepare-package.js` and `scripts/build.js`. Add those exact steps and checks.
5. CLI/direct consumers are not sufficiently included. `plan/13-consumer-migration.md` details providers but only vaguely mentions CLI/direct consumers. Current CLI uses tool types/outcomes/registry in files such as `packages/cli/src/zed-integration/zedIntegration.ts`, `nonInteractiveCli.test-helpers.ts`, `ui/hooks/slashCommandHandlers.ts`, `ui/hooks/useToolScheduler.test.ts`, `ui/hooks/atCommandProcessor*.ts`, `ui/types.ts`, and `types/message-bus-augmentation.d.ts`. Add explicit CLI migration decision: direct tools imports vs core top-level re-export compatibility, and update package dependency rules accordingly.
6. Core consumer migration is too vague for current import surface. `analysis/dependency-audit.md`, `plan/12-core-adapters-and-registry-integration.md`, and `plan/13-consumer-migration.md` do not require a per-file rewrite map for many current core imports across policy, telemetry, confirmation-bus, hooks, scheduler, agents, runtime, config, core, utils, storage, LSP tests, and test-utils. Add `analysis/consumer-rewrite-map-final.md` generated from actual rg output, with every current import classified exactly once.
7. `tool-key-storage.ts` ownership is internally inconsistent. `analysis/tool-move-map.md` says ToolKeyStorage moves to tools and `CoreToolKeyStorageAdapter` delegates to core ToolKeyStorage/SecureStore, which is circular. Decide explicitly that tools owns interfaces/pure masking/supported-name behavior and core owns secure-store-backed implementation, or define a different non-circular split.
8. TDD requirements still include structure/mock-adjacent tests. `plan/10-tool-move-tdd.md` includes constructor/interface tests and adapter delegation tests that may become mock theater. Replace with observable behavior tests asserting ToolResult, filesystem state, provider formatted output, storage state, registry/scheduler execution, and denial/error behavior. Require pre-extraction characterization fixtures for provider formatting/tool outputs.
9. Provider extraction pattern is only partially applied. Unlike `project-plans/issue1584/analysis/package-metadata-constraints.md` and anti-shim checks, issue1585 lacks concrete package.json/tsconfig anti-cycle assertions. Add `analysis/package-metadata-constraints.md` with node checks proving tools has no core/providers/cli dependency, core/providers depend on tools as needed, CLI dependency is conditional, exports exist, and tsconfig references do not create cycles.
10. Sandbox/Docker instructions need exact tarball ordering. `plan/14-release-process.md` says add tools pack after existing commands, but tools should pack/copy/install before core/providers/cli because dependents will require it. Specify `toolsPackageDir`, pack destination `packages/tools/dist`, chmod tools tarball, Dockerfile COPY before core, and install transaction order tools -> core -> providers -> cli.
11. Phase count is inconsistent. `plan/00-overview.md` says 36 phases, but the table/manifest list 35 phases from P00a through P16a. Fix count or add missing phase.
12. MCP client/manager final location is ambiguous. `analysis/final-architecture.md`, `plan/00-overview.md`, and `plan/15-cleanup-no-shims.md` allow staying in `packages/core/src/tools/` or moving to `packages/core/src/mcp/`. Pick one for issue #1585; recommended: leave them in `packages/core/src/tools/` and retain only their exports.

## Pedantic issues

1. `plan/00-overview.md` generated/revised dates conflict: generated 2026-06-08 and revised 2026-06-05.
2. `plan/06-package-scaffold-stub.md` has typo “Bind-Release-DepS”.
3. `analysis/tool-move-map.md` lists `insert_at_line.ts` twice in Category B.
4. Package export paths are inconsistent: overview maps `./IToolFormatter.js` to `dist/src/interfaces/IToolFormatter.js`, while P11 moves `IToolFormatter.ts` to `src/formatters/`.
5. Add verification that `@vybestack/llxprt-code-test-utils` is only a devDependency of tools, not runtime dependency.
6. Manual trusted publishing rollback guidance is operationally fine but slightly beyond implementation-plan scope.
7. Because root `packageManager` says pnpm but repo uses package-lock/npm scripts, note explicitly that this plan follows existing npm/package-lock release process.

## Missing evidence/commands

Add these commands/artifacts to the plan:

```bash
# Full current consumer map, including CLI
rg -n "from ['\"][^'\"]*\.\./tools/|from ['\"][^'\"]*\.\./\.\./tools/|@vybestack/llxprt-code-core/tools/" packages -g "*.ts"

# Full tools import dependency inventory
rg -n "^import .* from ['\"][^./]" packages/core/src/tools -g "*.ts"

# Package metadata anti-cycle checks
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; if (d['@vybestack/llxprt-code-core'] || d['@vybestack/llxprt-code-providers'] || d['@vybestack/llxprt-code']) process.exit(1)"

# tsconfig anti-cycle check
node -e "const c=require('./packages/tools/tsconfig.json'); if ((c.references||[]).some(r => String(r.path).includes('../core') || String(r.path).includes('../providers') || String(r.path).includes('../cli'))) process.exit(1)"

# scripts/version.js coverage
grep -n "@vybestack/llxprt-code-tools" scripts/version.js

# prepare/build script inspection
grep -n "llxprt-code-core\|llxprt-code-providers\|workspaces" scripts/prepare-package.js scripts/build.js

# packages/tools direct dependency health
npx depcheck packages/tools

# Correct no-shim scan
rg -n "export \\* from ['\"]@vybestack/llxprt-code-tools|export \\{.*\\} from ['\"]@vybestack/llxprt-code-tools" packages/core/src/tools packages/core/src -g "*.ts"
```

Required missing artifacts:

- `analysis/interface-contracts-detailed.md`
- `analysis/consumer-rewrite-map-final.md`
- `analysis/package-metadata-constraints.md`
- `analysis/dependency-relocation-final.md`
- optionally `analysis/pre-extraction-characterization-fixtures.md`

## Suggested edits

1. Add additional required artifacts before production moves to `plan/00-overview.md`.
2. Replace P11/P12 sequencing text so P11 is a sequence of compile-safe migration groups that each include moved files, interface updates, core adapter implementation, registry factory updates, affected consumer import rewrites, and typecheck/behavioral tests.
3. Add release script coverage to `plan/14-release-process.md` for `scripts/version.js`, `scripts/prepare-package.js`, and `scripts/build.js`.
4. Add explicit CLI/direct consumer migration section to `plan/13-consumer-migration.md`.
5. Tighten P10 behavioral tests to assert observable behavior and avoid constructor/delegation-only checks.
6. Fix phase count to 35 phases or add the missing phase.
7. Add key-storage ownership decision: tools owns interface/pure masking/supported-name behavior; core owns secure-store-backed implementation until packages/storage exists.
8. Add sandbox/Docker exact ordering: pack/copy/install tools before dependents, using `toolsPackageDir`, pack to `packages/tools/dist`, chmod tools tarball, and install tools -> core -> providers -> cli.
