# Issue 2003: Multiline shell and heredoc parsing audit

Plan ID: PLAN-20260801-ISSUE2003

## Accepted behavior

### AC-1: Exact multiline inputs reach the real APIs

Behavioral tests pass multiline strings directly to `detectCommandSubstitution()`, `parseCommandDetails()`, and `checkCommandPermissions()` without shell evaluation. The tests cover:

- an unquoted heredoc containing an opening backtick
- a quoted heredoc containing paired backticks
- a safe command followed by a malformed backtick substitution
- a safe command followed by a malformed standalone backtick substitution
- malformed substitution inside a subshell, conditional, process substitution, and nested `$()`

### AC-2: `none` mode denies executable substitution syntax

With tree-sitter available, `shell-replacement=none`:

- hard-denies the unquoted heredoc containing an opening backtick
- hard-denies every listed malformed multiline/nested substitution input
- permits a quoted heredoc body containing paired backticks when its executable command is otherwise allowed, because the body is literal

The direct detector returns the same substitution decision for these inputs. A parser error may trigger conservative lexical detection, but a syntactically valid quoted heredoc must retain literal-body semantics.

### AC-3: `allowlist` mode validates complete parse behavior

With tree-sitter available, `shell-replacement=allowlist`:

- hard-denies the unquoted heredoc containing an opening backtick because the executable substitution cannot be parsed safely
- permits a quoted heredoc containing paired backticks when `cat` is allowlisted
- hard-denies every listed malformed multiline/nested input as an unsafe parse
- continues extracting and validating nested commands from supported unquoted heredoc substitutions such as `$(date)`
- does not treat supported quoted heredoc substitutions such as `$(date)` as executable

### AC-4: Parser-unavailable behavior is fail-closed for this scope

When tree-sitter is unavailable, both `none` and `allowlist` modes hard-deny:

- commands containing line breaks
- commands containing heredoc redirection syntax outside shell quotes

This intentionally avoids asking the regex fallback to model heredoc delimiter quoting or multiline shell grammar. One-line commands without heredoc syntax retain their existing fallback behavior. `shell-replacement=all` is unchanged.

### AC-5: Limitations are explicit

Implementation documentation states:

- regex fallback does not model multiline/heredoc semantics and permission checks fail closed for those inputs in `none` and `allowlist` modes
- the bundled tree-sitter grammar does not expose backtick substitutions in heredoc bodies as command-substitution nodes; unquoted heredoc backtick syntax that cannot be fully extracted is therefore rejected in allowlist mode

## Boundary cases and evidence

| Input | Direct detection with parser | `none` | `allowlist` with relevant outer commands allowlisted |
| --- | --- | --- | --- |
| `cat <<EOF\nInside heredoc \`unterminated\nEOF` | substitution | hard denial: substitution | hard denial: unsafe parse |
| `cat <<'EOF'\n\`not_executed\`\nEOF` | literal | allowed | allowed (`cat` only) |
| `echo safe\necho \`date` | substitution | hard denial: substitution | hard denial: unsafe parse |
| `ls -la\n\`evil_cmd` | substitution | hard denial: substitution | hard denial: unsafe parse |
| `(echo \`subshell_cmd` | substitution | hard denial: substitution | hard denial: unsafe parse |
| `if true; then \`bad_cmd; fi` | substitution | hard denial: substitution | hard denial: unsafe parse |
| `echo \`; rm -rf /` | substitution | hard denial: substitution | hard denial: unsafe parse |
| `cat <(echo \`unterminated` | substitution | hard denial: substitution | hard denial: unsafe parse |
| `echo $(echo \`inner` | substitution | hard denial: substitution | hard denial: unsafe parse |
| `cat <<EOF\n$(date)\nEOF` | substitution | hard denial: substitution | `date` must be independently allowlisted |
| `cat <<'EOF'\n$(date)\nEOF` | literal | allowed | allowed (`cat` only) |

Parser-unavailable tests prove fail-closed behavior for LF, CRLF, and heredoc syntax, including a quoted heredoc. They also prove an ordinary one-line command retains its existing result.

## TDD sequence

1. Add tree-sitter behavioral tests for direct detection and permission outcomes using the exact strings above.
2. Run the focused test file and record failures before production changes.
3. Add parser-unavailable permission tests by mocking only parser infrastructure, while exercising the real `checkCommandPermissions()` implementation.
4. Run those tests and record failures before production changes.
5. Make the minimum parser/orchestration changes required by AC-2 through AC-5.
6. Run focused tests, then the full verification suite.

## Integration points

- `packages/core/src/utils/shell-parser.ts`: existing AST substitution detection and unsafe-parse classification.
- `packages/core/src/utils/shell-utils.ts`: existing direct detector and permission-mode orchestration.
- Existing shell utility test suites: behavioral evidence through public parser and permission functions.

No new dependency, public API, subsystem, workflow, setting, or parser implementation is accepted.

## Out of scope

- changing `shell-replacement=all`
- replacing tree-sitter or adding a shell parser
- teaching regex fallback complete shell or heredoc grammar
- changing unrelated one-line fallback semantics
- refactoring split-command architecture or unrelated shell utilities
- adjacent shell hardening not exercised by the accepted inputs

## Verification gates

- Focused shell parser/permission tests pass.
- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- configured LLxprt smoke test passes.
- DeepThinker and Open Code Review findings are classified as Blocker-Fix, In-scope-Fix, Reject, or Defer; all required fixes are complete.
- Candidate PR head has green CI, resolved required review threads, correct ancestry, and no merge conflict.
