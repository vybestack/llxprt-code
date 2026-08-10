# Issue #3181 — Shell-aware command validation on Windows

Plan ID: `PLAN-20260808-SHELL-PARSER-WINDOWS`

## Status

Implementation and issue-focused verification are complete. The focused issue
#3181 suite passes 447 tests with 2 pre-existing fallback-path skips and no
failures. Multiple RED/GREEN security-remediation loops, the initial
OpenCodeReview pass, and a final independent security review are complete; the
final independent review returned `READY` with no findings. The required final
OpenCodeReview rerun also completed. Its two valid behavioral findings were
remediated with tests: malformed PowerShell parse trees now fail closed during
substitution detection, and successful empty parse results no longer produce a
false parser-unavailable diagnostic. Remaining findings were test-maintenance
suggestions, intentional compatibility differences, or false positives and did
not justify weakening the security model.

The PowerShell (`tree-sitter-pwsh`) grammar is integrated for the Bun CLI and
validation now selects behavior from the execution shell. Bash behavior is
unchanged.

### Verified guarantees

- **Bun CLI**: PowerShell grammar loads and structural validation works.
- **Node** (core/A2A/library): PowerShell grammar is NOT loaded (`isBunRuntime`
  guard). PowerShell validation fails closed truthfully. Bash grammar still
  loads under Node.
- **cmd.exe**: maps to Bash grammar (no dedicated cmd grammar exists).
- **Case-insensitive**: PowerShell blocklist/allowlist matching is
  case-insensitive; Bash remains case-sensitive.
- **Wrapper/evaluator bypass prevention**: `Invoke-Expression`/`iex`,
  `powershell`/`pwsh -Command`, `bash`/`sh -c`, `cmd /c`, and
  `Start-Process`/`saps`/`start` are recursively validated. Statically
  resolvable payloads are parsed; dynamic payloads fail closed under strict
  allowlists.
- **Blocklist recursion**: `excludeTools` recurses into script blocks,
  subexpressions, pipelines, and wrapper payloads in all modes (`none`,
  `allowlist`, `all`). `all` relaxes only substitution restrictions.
- **Canonical matching**: literal call targets and dot-source paths normalize
  to basename. Expandable string targets are dynamic.
- **27-command construct corpus**: all documented construct families pass.
- **Parser.ParseInput conformance**: Windows-only bounded test compares a
  subset against the semantic ground truth via stdin (data, never executed).

## Problem statement

LLxprt executes `run_shell_command` through PowerShell on Windows, but validates
the command as Bash. Valid PowerShell syntax therefore becomes a Bash parse
error and is hard-denied before execution with:

```text
Command rejected because it could not be parsed safely
```

This is a platform-specific parser-selection defect, not an expected rejection
and not the parser-initialization defect fixed by issue #2950 / PR #2961.

## Reproduction

The defect reproduced immediately on Windows with a command shaped like:

```powershell
git status --short --branch; git checkout main; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

The command is valid PowerShell. The tool rejected it before spawning
PowerShell. Splitting the same operation into commands that are also valid Bash
allowed execution.

A saved LLxprt recording from the stranded repository contains repeated
rejections of valid commands using these PowerShell constructs:

- variable assignment and .NET member invocation;
- `ForEach-Object { ... }` and `Where-Object { ... }`;
- `foreach` and `if` statements;
- the `&` invocation operator;
- `@(...)` array expressions;
- `*>&1` and PowerShell redirection;
- `Start-Process` with PowerShell expressions;
- property and method access such as `$value.Name` and `$value.Trim()`.

The recording contained 27 actual `run_shell_command` tool responses with this
parse rejection. These are direct behavioral examples, not synthetic guesses.

## Root cause

### Execution is shell-aware

`packages/core/src/utils/shell-utils.ts:80-107` selects PowerShell on Windows:

```typescript
{
  executable: 'powershell.exe',
  argsPrefix: ['-NoProfile', '-Command'],
  shell: 'powershell',
}
```

`ShellExecutionService` and the managed shell-job path consume that
configuration when they spawn the command.

### Validation is Bash-only

The permission path is:

1. `packages/tools/src/tools/shell.ts:794-813` validates the tool parameters.
2. `CoreShellToolHostAdapter.isCommandAllowed()` delegates to
   `shell-utils.isCommandAllowed()`.
3. `checkCommandPermissions()` resolves the default `shell-replacement` mode to
   `allowlist`.
4. `extractCommandsToValidate()` calls `parseCommandDetails(command)`.
5. `packages/core/src/utils/shell-parser.ts` parses through one singleton
   `web-tree-sitter` parser loaded only with `tree-sitter-bash`.
6. `parseCommandDetails()` marks any Bash `ERROR`/`MISSING` node as an error.
7. `shell-utils.ts:698-704` converts that result into a hard denial.

No shell type reaches `parseCommandDetails`, `getCommandRoots`,
`splitCommands`, or `detectCommandSubstitution`. The validator therefore asks
whether PowerShell source is valid Bash instead of whether it is valid in the
shell that will execute it.

### Misleading current tests

The Windows block in `packages/core/src/utils/shell-utils.test.ts:563-593` does
not exercise a PowerShell parser:

- “PowerShell AST output” is output from the Bash grammar. The test input happens
  to be valid in both languages.
- “PowerShell parser reports errors” is also the Bash grammar rejecting an
  incomplete pipeline that is invalid in both languages.

Those tests should be replaced, not merely supplemented, because their names
currently claim behavior that does not exist.

## Related issue distinction

Issue #2950 covered an uninitialized/unavailable Bash WASM parser. PR #2961
correctly initialized that parser before tool registration. Issue #3181 occurs
when initialization succeeds: the available parser is the wrong language for
the Windows execution shell.

## Parser-option investigation

### Real PowerShell `Parser.ParseInput`

`[System.Management.Automation.Language.Parser]::ParseInput` is the semantic
ground truth for Windows PowerShell. It parsed every command in the saved
rejection corpus without an error, and `CommandAst.GetCommandName()` produced
the expected nested command names.

It is safe only if untrusted command text is passed as data (for example over
stdin), never interpolated into the helper script. `ParseInput` itself parses and
does not execute the supplied command.

It is not a good per-call implementation behind the current synchronous tool
validation API. Local no-profile PowerShell startup measurements ranged from
roughly 430 ms to 750 ms. Starting one process and parsing the full corpus took
about 1.1 seconds. Spawning a new process for every shell tool validation would
be a visible regression. A persistent helper would require asynchronous
lifecycle/IPC changes while the current parameter validation contract is
synchronous.

Use `Parser.ParseInput` as a Windows conformance oracle in integration tests,
not as the default hot-path parser.

### `tree-sitter-powershell@0.26.4`

This in-process grammar parsed 22 of the 27 valid saved commands. It still
reported false syntax errors for valid argument lists, comma-separated paths,
string concatenation, and compound expressions. It is not sufficient for this
fix.

### `tree-sitter-pwsh@0.38.1`

The maintained `wharflab/tree-sitter-powershell` fork is published as
`tree-sitter-pwsh` and includes a WASM grammar. In the local Bun 1.3.14 spike it:

- parsed every command in the saved rejection corpus without an error;
- rejected malformed inputs such as `Get-ChildItem |` and `if (`;
- exposed nested `command` nodes under script blocks, subexpressions,
  pipelines, `foreach`, and `if` conditions;
- exposed static and dynamic invocation expressions distinctly;
- extracted the same command-name sequence as PowerShell `CommandAst` for the
  corpus;
- parsed the corpus in-process in approximately 53 ms total.

The same ad hoc WASM spike under Node 24 on Windows printed the correct result
but crashed during process shutdown with a V8 “Zone” out-of-memory failure.
The shipped CLI now uses Bun, and the Bun spike exited cleanly, but this remains
a preflight compatibility gate: implementation must prove the selected grammar
and runtime combination is stable in every supported invocation/test path.

## Recommended design

Use a shell-aware parser facade and an in-process PowerShell grammar, subject to
the runtime-stability preflight. Keep the existing Bash parser behavior intact.

### Shared contract

Define a shell-neutral parse result consumed by permission checking:

```typescript
interface ParsedShellCommand {
  text: string;
  name: string | null;
  nameKind: 'static' | 'dynamic' | 'expression';
}

interface ShellCommandParseResult {
  commands: ParsedShellCommand[];
  hasError: boolean;
  error?: {
    parser: 'bash-tree-sitter' | 'powershell-tree-sitter';
    message: string;
    row?: number;
    column?: number;
  };
}
```

The exact type names may follow neighboring conventions, but the behavior must
preserve the distinction between a statically resolvable command name and an
expression that cannot be safely allowlisted.

### Parser selection

- Bash execution → existing `tree-sitter-bash` implementation.
- PowerShell execution → maintained PowerShell tree-sitter implementation.
- Selection must use the same `ShellConfiguration` that execution uses; do not
  independently infer the platform in the permission layer.
- Parser availability must be tracked per shell/language, not through the
  current global Bash-only `isParserAvailable()` boolean.

Avoid a circular dependency between `shell-utils.ts` and `shell-parser.ts` by
moving shell configuration/types to a lower-level module or by injecting the
resolved shell into the parser facade from the existing host adapter.

### PowerShell extraction rules

In `allowlist` mode:

1. Reject trees with syntax errors.
2. Traverse all PowerShell `command` nodes recursively, including commands in
   script blocks and `$()` subexpressions.
3. Treat a literal call-operator target such as `& 'tool.exe'` as a static
   command and normalize its root like other paths.
4. Fail closed for dynamic call targets such as `& $command` or `. $script`;
   they cannot be compared honestly with an allowlist.
5. Do not silently discard executable invocation expressions. Static .NET
   method invocations and other effectful expressions must either become
   explicit permission details or receive a documented fail-closed policy in
   restricted allowlist mode. A command such as
   `[System.Diagnostics.Process]::Start(...)` must not piggyback unnoticed on an
   unrelated allowed command.
6. Preserve command text/extents for blocklist and confirmation messages.

`Invoke-Expression`, nested shell wrappers (`powershell -Command`, `cmd /c`,
`bash -c`), and dynamically created script blocks deserve explicit security
cases. A shell-aware parser must not accidentally make those less restrictive
than the current fail-closed behavior.

### Substitution modes

PowerShell semantics must replace Bash semantics on the PowerShell path:

- PowerShell backticks are escapes/line continuations, not Bash-style command
  substitution.
- `$()` is a PowerShell subexpression and its nested commands must be found.
- Script-block command nodes must be validated recursively in `allowlist` mode.
- `none` mode must block the PowerShell execution/substitution forms that the
  setting promises to block without rejecting ordinary PowerShell escapes.

Do not route PowerShell through the current Bash regex fallback. If the
PowerShell grammar is unavailable in a mode that requires structural parsing,
fail closed with an accurate PowerShell-parser diagnostic.

### Diagnostics

Replace the ambiguous error with a shell-aware reason while keeping command
text out of telemetry:

```text
PowerShell command rejected because powershell-tree-sitter reported a syntax error at 1:42
```

Debug logging may include parser captures under the existing debug-logging
privacy rules. User-facing output should identify the selected shell/parser and
the first useful error location.

## Acceptance criteria

### REQ-3181-001 — Validation matches execution shell

**GIVEN** the execution configuration selects PowerShell
**WHEN** a command is permission-checked
**THEN** it is parsed with the PowerShell parser, not the Bash parser.

Bash execution continues to use the existing Bash grammar unchanged.

### REQ-3181-002 — Valid PowerShell is accepted

Representative valid PowerShell constructs from the saved failures do not
produce a parse hard-denial: assignments, methods, script blocks, control flow,
call operators, arrays, redirects, and multiline source.

This means “not rejected as malformed”; ordinary allowlist, blocklist,
confirmation, and workspace policies still apply.

### REQ-3181-003 — Invalid PowerShell fails closed

Malformed PowerShell and parser failures remain hard denials. The message names
the PowerShell parser and reports a useful location/reason when available.

### REQ-3181-004 — Nested commands remain enforceable

Every statically resolvable command under PowerShell script blocks,
subexpressions, pipelines, and control flow is checked. A blocked command hidden
inside `ForEach-Object { ... }`, `$()`, or `& { ... }` is still blocked.

Dynamic command targets do not pass an allowlist as if they were known static
commands.

### REQ-3181-005 — Command roots are shell-correct

PowerShell pipelines and literal invocation targets yield normalized roots for
permission prompts. Pure expressions do not acquire fabricated Bash roots.

### REQ-3181-006 — Substitution policy is shell-correct

PowerShell backticks are not treated as Bash command substitution. PowerShell
subexpressions and nested executable forms follow the configured
`allowlist`/`all`/`none` behavior.

### REQ-3181-007 — Runtime compatibility is proven

The PowerShell grammar initializes and shuts down cleanly under the supported
Bun CLI runtime on Windows and in the repository's cross-platform Bun tests.
Any supported Node path that loads the grammar must also exit cleanly; otherwise
that path must be shown not to load core parsing code.

## Test-first implementation sequence

### P01 — Preflight and dependency gate

Before production edits:

1. Add a temporary or test-owned corpus covering the real rejected construct
   families.
2. Verify the selected package's license, WASM artifact resolution, Bun
   compatibility, package publishing integrity, and installed-package layout.
3. Reproduce and resolve or bound the observed Node shutdown crash.
4. Verify that both Bash and PowerShell WASM assets load from source,
   development, built, and npm-installed layouts.
5. Record the accepted dependency/version decision in this plan.

Do not proceed with a grammar that cannot parse the real corpus or that makes a
supported runtime crash.

### P02 — RED: shell-selection integration tests

Write failing behavioral tests through the public permission path showing that:

- a valid PowerShell `if ($LASTEXITCODE ...)` command is not a parse denial;
- the same PowerShell-only syntax is not sent to the Bash parser;
- Bash behavior remains unchanged when Bash is selected;
- a PowerShell parser initialization failure is a hard denial with an accurate
  reason.

Use the real grammar. Do not mock `parseCommandDetails` to return the desired
answer.

### P03 — RED: PowerShell grammar behavior

Write failing Bun tests for:

- each real rejected construct family;
- malformed PowerShell;
- recursive command extraction from pipelines, `if`, `foreach`, script blocks,
  `$()`, and `& { ... }`;
- literal call targets versus dynamic targets;
- static invocation expressions and the restricted-mode policy;
- PowerShell backticks and multiline source;
- syntax-error diagnostics.

On Windows, add a bounded conformance test that compares the checked-in corpus
against `Parser.ParseInput` without executing any corpus command.

### P04 — GREEN: parser facade and initialization

Implement the minimum shell-aware parser contract and initialize both grammar
assets. Keep Bash behavior and its current security checks unchanged. Wire
parser selection to the execution shell configuration.

### P05 — GREEN: permission and root extraction integration

Route `checkCommandPermissions`, command-root extraction, and substitution
checks through shell-aware results. Preserve blocklist/allowlist behavior and
fail closed for unresolved dynamic execution.

Update the misleading Windows tests so they exercise the actual PowerShell
parser.

### P06 — RED/GREEN: end-to-end shell tool behavior

Add an integration test through `ShellTool.validateToolParamValues` and the real
core host adapter. Prove a valid PowerShell-only command reaches the normal
permission/confirmation path, malformed input does not, and a blocked nested
command remains blocked.

Where Windows CI is available, add a non-destructive execution test using a
PowerShell-only construct. Cross-platform tests must still exercise the WASM
parser directly rather than skipping all useful coverage off Windows.

### P07 — Documentation and verification

Update shell-replacement documentation to describe per-shell parsing and
PowerShell semantics. Run focused tests after each RED/GREEN step, then the full
required verification cycle:

```text
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Finally, exercise a representative subset of the formerly rejected PowerShell
commands through the built CLI on Windows.

### Verification results

- Issue-focused behavioral suites: 447 passed, 2 pre-existing fallback-path
  tests skipped, 0 failed.
- Dependency trust and strict-layout resolution suites: 21 passed, 0 failed.
- `npm run format`, repository-wide `npm run typecheck`, repository-wide
  `npm run build`, explicit changed-file ESLint, integration-test ESLint, and
  `bun scripts/bun-native-modules-smoke.ts` completed successfully.
- Final OpenCodeReview completed successfully. The malformed-tree substitution
  and empty-success findings were remediated and the focused suite was rerun;
  incompatible and false-positive suggestions were rejected to preserve
  truthful parser-unavailable diagnostics and intentional Bash compatibility.
- A complete `npm run test` run progressed without a failure until it stalled in
  the unchanged Windows-only
  `shellJobManagerCancelRace.test.ts` cancellation-ownership suite and was
  terminated after exceeding that test's own timeout by several minutes. The
  issue-focused suites, including real Windows shell-adapter behavior, remain
  green.
- Root `npm run lint` and `npm run lint:changed` exit 1 without diagnostics on
  this Windows machine; direct ESLint over every changed or new TypeScript file
  passes. A default-heap root ESLint attempt separately exhausted V8 memory.
- The prescribed StepFun smoke could not start because the local `stepfun-37`
  profile is not installed. No credentials or user configuration were changed.
- The standalone unchanged bundle-runtime-assets suite is limited on this
  Windows environment: required-asset staging passes, while three spawned-bundle
  launch assertions produce no child output and one directory-shaped-asset case
  fails during Windows symlink cleanup with `EFAULT`.
- Generated lockfile churn was removed; final lock changes contain only direct
  dependency entries and the `tree-sitter-pwsh` package records.

## Out of scope

- Replacing the configured Windows execution shell.
- Weakening validation by accepting Bash parse errors on Windows.
- A regex-only PowerShell parser.
- Executing untrusted command text inside a parser helper.
- Broad redesign of shell approval policy unrelated to the parser mismatch.

Known wrapper/evaluator risks discovered while implementing shell-aware nested
extraction should be fixed if necessary to avoid a security regression; larger
policy redesigns should receive separate issues.
