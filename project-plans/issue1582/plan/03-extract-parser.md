# Phase 3: Extract CLI Argument Parser

**Subagent:** `typescriptexpert`
**Prerequisite:** Phase 2 non-parser pure utility extraction passes verification
**Verification:** `npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`

## Goal

Extract the CLI argument parser (`cliArgParser.ts` + `yargsOptions.ts`) from `config.ts`. This is separated from the other pure utility extractions (Phase 2) because it is **higher risk** due to:

- **Subcommand wiring** — `mcpCommand`, `skillsCommand`, `hooksCommand`, `extensionsCommand` each register their own commands with `process.exit` behavior
- **Duplicated root/command options** — some options are registered both at root scope and inside subcommands; normalization during extraction could introduce subtle regressions
- **`process.exit` in yargs handlers** — subcommands call `process.exit()` which makes testing tricky and errors in wiring could cause silent early exits

By isolating parser extraction into its own phase, any regressions are immediately attributable to this specific change rather than being mixed with the safer utility extractions.

**Critical rule:** No backward compatibility re-exports. Callers are updated to import from the new canonical location.

## What To Read First

- `project-plans/issue1582/plan/00-overview.md` — architecture overview, symbol mapping table, design principles
- `packages/cli/src/config/config.ts` — focus on `parseArguments()` (lines 188-718) and `CliArgs` interface (lines 138-186)
- `packages/cli/src/config/config.test.ts` — existing mock setup for config.ts (will need mock path migration)
- All caller files that import `parseArguments` or `CliArgs` from config.ts

## Task 3.1: Create `yargsOptions.ts`

**What moves:**
- Static yargs option definition objects as typed data (the `.option()` chain arguments)
- No command wiring, no runtime behavior

## Task 3.2: Create `cliArgParser.ts`

**What moves:**
- `CliArgs` interface (lines 138-186)
- `parseArguments()` function — a thin orchestrator calling mandatory subfunctions:
  ```typescript
  function buildRootYargs(settings: Settings): Argv     // creates yargs instance, sets locale/usage
  function registerCommands(yargs: Argv, settings: Settings): Argv  // wires mcpCommand, skillsCommand, hooksCommand, extensionsCommand
  function registerOptions(yargs: Argv, optionDefs: YargsOptionDefs): Argv  // applies options from yargsOptions.ts
  function validateAndCoerce(argv: Record<string, unknown>): void   // mutual exclusivity checks, deprecation warnings
  function mapParsedArgsToCliArgs(result: Record<string, unknown>): CliArgs  // maps yargs result to typed CliArgs
  ```
  Each subfunction <40 lines; `parseArguments` orchestrator <50 lines
- Target: `parseArguments` body <80 lines (achievable via delegation to subfunctions above)

## Task 3.3: Update callers

**Production caller updates:**
- `gemini.tsx`: `import { parseArguments } from './config/cliArgParser.js'`
- `commands/skills/list.ts`: `import { type CliArgs } from '../../config/cliArgParser.js'`

**Test caller updates:**
- `gemini.test.tsx`: `import { parseArguments } from './config/cliArgParser.js'`
- `config.test.ts`: `import { parseArguments } from './cliArgParser.js'`
- `config.kimiModelBootstrap.test.ts`: `import { parseArguments } from './cliArgParser.js'`
- `__tests__/continueFlagRemoval.spec.ts`: `import { parseArguments } from '../cliArgParser.js'`
- `commands/skills/list.test.ts`: update any mocks referencing `config.js` module path

## Task 3.4: Migrate mock paths (CRITICAL)

Any test that uses `vi.mock('./config.js')` or similar and targets `parseArguments` or `CliArgs` must have its mock path updated to the new module.

### Mandatory mock-migration checklist

Before considering this phase complete, run ALL of the following checks:

```bash
# 1. Find all vi.mock, vi.importActual, and vi.hoisted calls referencing config.js in test files
grep -rn "vi\.mock\|vi\.importActual\|vi\.hoisted" packages/cli/src/ --include="*.test.*" --include="*.spec.*" | grep -i "config"

# 2. Verify no stale vi.mock paths remain for parseArguments/CliArgs
grep -rn "vi\.mock.*config/config\|vi\.mock.*['\"]\.\/config['\"]" packages/cli/src/ --include="*.test.*" --include="*.spec.*"
# Review each hit: if the mock targets parseArguments or CliArgs, it MUST point to cliArgParser.js now

# 3. Verify no stale imports remain
grep -rn "from.*config/config" packages/cli/src/ --include="*.ts" --include="*.tsx" | grep -E "parseArguments|CliArgs"
# Expected: ZERO hits

# 4. Specific check on config.test.ts mock paths (highest risk file)
grep -n "vi\.mock\|vi\.importActual\|vi\.hoisted" packages/cli/src/config/config.test.ts | head -30
# Review: any mock that referenced symbols now in cliArgParser.ts must be updated
```

**Reminder:** Check `vi.mock`, `vi.importActual`, AND `vi.hoisted` calls — all three can hold stale paths after module extraction.

## Parser Testing Note: `process.exit` Interception

Parser tests MUST intercept `process.exit` for subcommand behavior. Subcommands (`mcp`, `hooks`, `extensions`, `skills`) call `process.exit()` in their yargs handlers, which will kill the test runner if not intercepted. Add explicit tests that verify these subcommands trigger clean exit without propagating — e.g., spy on `process.exit` or use `vi.spyOn(process, 'exit').mockImplementation(() => { throw new ExitInterception(); })` and assert the exit code. This is especially important after extraction since the command wiring moves to `cliArgParser.ts` and any miswiring could cause `process.exit` to fire unexpectedly or not at all.

## Constraints

- No file >800 lines, no function >80 lines
- Each new module gets its own DebugLogger instance (don't share the one from config.ts)
- Remove extracted code from config.ts — do NOT leave dead copies
- All parity tests from Phase 1 must still pass after this extraction
- All existing tests must pass — if a test fails due to mock path changes, fix the mock path (not the test logic)
