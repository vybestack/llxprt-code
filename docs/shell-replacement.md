# Shell Command Substitution

LLxprt Code controls how command substitution patterns (`$()`, `` ` ` ``, `<()`, `>()`) are handled in shell commands. There are three modes:

| Mode        | Behavior                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `allowlist` | **Default.** Allows substitution but validates nested commands against the coreTools allowlist. Uses tree-sitter parsing when available. |
| `all`       | Allows all substitution unconditionally. Least restrictive.                                                                              |
| `none`      | Blocks all command substitution. Most restrictive.                                                                                       |

## Per-Shell Parsing

LLxprt Code selects a structural parser **matching the execution shell when
one is available** rather than applying one generic grammar to every command
(#3181):

- **Bash** execution → `tree-sitter-bash` grammar.
- **PowerShell** execution under Bun → `tree-sitter-pwsh` grammar.
- **cmd.exe** execution → falls back to the Bash grammar (no dedicated cmd grammar exists; this is the same as pre-#3181 behavior).

Parsing does **not** always match the execution shell: under Node, PowerShell
structural validation intentionally fails closed (the PowerShell WASM is unstable
under Node), and cmd.exe always uses the Bash legacy fallback. In these cases
validation preserves the documented fail-closed or legacy fallback behavior
instead of silently treating PowerShell as Bash.

### PowerShell Substitution Semantics

PowerShell substitution differs from Bash:

- PowerShell **backticks** (`` ` ``) are escape/line-continuation characters, **not** command substitution. They are not treated as substitution in any mode.
- PowerShell **`$()`** subexpressions are substitution and follow the configured mode.
- PowerShell **`.NET` invocations** (e.g., `[System.Diagnostics.Process]::Start(...)`) are detected as expression targets. In strict allowlist mode they fail closed because they cannot be compared honestly against a command allowlist.

## Configuring

### Session Setting

```
/set shell-replacement allowlist    # Default — validate nested commands
/set shell-replacement all          # Allow everything
/set shell-replacement none         # Block all substitution
```

### In settings.json

```json
{
  "shell-replacement": "allowlist"
}
```

### In a Profile

The setting persists to profiles, so you can save it:

```
/set shell-replacement none
/profile save restricted
```

## How Allowlist Mode Works

In `allowlist` mode (the default), LLxprt Code uses tree-sitter to parse the command and extract all nested commands, including those inside `$()` or backticks. Each nested command is validated against the coreTools configuration. If a nested command isn't on the allowlist, the entire command is blocked.

This gives you command substitution where it's safe while preventing unexpected commands from running inside substitutions.

## Runtime Compatibility

The PowerShell grammar (`tree-sitter-pwsh`) loads under the **Bun** runtime — the shipped CLI runtime — where it is stable. Under **Node** (used by core library consumers, A2A, and other server paths), the PowerShell WASM causes a V8 out-of-memory crash at process shutdown. To prevent this, the codebase uses an `isBunRuntime()` guard so that:

- **Bun**: Both Bash and PowerShell grammars load. PowerShell structural validation works.
- **Node**: Only the Bash grammar loads. PowerShell validation **fails closed** with a truthful diagnostic (`PowerShell command rejected because the structural parser is unavailable`). PowerShell commands are never silently accepted without validation.

cmd.exe execution maps to the Bash grammar because no dedicated cmd grammar exists and cmd syntax is not PowerShell. This is the same behavior as before #3181 and does not make a false claim about the language.

## Case-Insensitive Matching (PowerShell)

PowerShell command resolution is case-insensitive. Blocklist and allowlist matching for PowerShell commands is therefore case-insensitive: `ShellTool(Get-Process)` matches `GET-PROCESS`, `get-process`, and `Get-Process`. Bash matching remains strictly case-sensitive. The case-insensitivity is PowerShell-scoped and does not affect Bash behavior.

Literal call targets (`& "C:	ools	ool.exe"`) and dot-source paths (`. .\script.ps1`) normalize to the basename before matching, so policy patterns do not require broad wildcards like `ShellTool(&)`.

## Wrapper and Evaluator Bypass Prevention

PowerShell evaluators and shell wrappers are recursively validated to prevent statically resolvable payloads from bypassing an allowlist or blocklist:

| Construct                                      | Literal payload                                        | Dynamic payload                                      |
| ---------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| `Invoke-Expression` / `iex`                    | Recursively parsed with PowerShell grammar             | Fails closed under a strict allowlist                |
| `powershell -Command` / `pwsh -Command`        | Recursively parsed with PowerShell grammar             | Fails closed under a strict allowlist                |
| `bash -c` / `sh -c`                            | Recursively parsed with Bash grammar                   | Fails closed under a strict allowlist                |
| `cmd /c` / `cmd.exe /c`                        | No dedicated grammar; treated as unresolved expression | Fails closed under a strict allowlist                |
| `Start-Process` / `saps` / `start`             | Static target extracted as command name                | Dynamic target fails closed under a strict allowlist |
| Literal call-operator forms such as `& "pwsh"` | Handled like the corresponding direct wrapper          | Fails closed under a strict allowlist                |

Ordinary quoted strings and static here-strings are decoded before recursive parsing. Statically resolvable nested blocklisted commands are therefore still checked when wrapped in these constructs. Dynamic payloads cannot be compared honestly with a command allowlist and are hard-denied when a strict global or session allowlist applies; an `excludeTools` blocklist alone is not a complete sandbox for dynamically generated command text.

## Blocklist Recursion Across Modes

Blocklist (`excludeTools`) checks recurse into all nested commands — script blocks, subexpressions, pipelines, and wrapper payloads — in every mode (`none`, `allowlist`, `all`). A blocklisted command nested inside `ForEach-Object { ... }` or `$(...)` is caught even in `all` mode, which only relaxes substitution restrictions, not blocklist enforcement.

## Security Notes

- **`none` mode** is appropriate if you're running untrusted code or want maximum safety — it blocks all substitution patterns entirely.
- **`all` mode** allows any nested command execution. Only use this if you trust all commands the model might generate.
- **`allowlist` mode** (the default) is a middle ground — substitution works, but nested commands must pass the same validation as top-level commands.

## Related

- [Settings and Profiles](./settings-and-profiles.md)
- [Sandboxing](./sandbox.md) — for running in a container instead of restricting shell commands
