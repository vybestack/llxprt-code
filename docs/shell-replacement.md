# Shell Command Substitution

LLxprt Code controls how command substitution patterns (`$()`, `` ` ` ``, `<()`, `>()`) are handled in shell commands. There are three modes:

| Mode        | Behavior                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `allowlist` | **Default.** Allows substitution but validates nested commands against the coreTools allowlist. Uses tree-sitter parsing when available. |
| `all`       | Allows all substitution unconditionally. Least restrictive.                                                                              |
| `none`      | Blocks all command substitution. Most restrictive.                                                                                       |

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

## Security Notes

- **`none` mode** is appropriate if you're running untrusted code or want maximum safety — it blocks all substitution patterns entirely.
- **`all` mode** allows any nested command execution. Only use this if you trust all commands the model might generate.
- **`allowlist` mode** (the default) is a middle ground — substitution works, but nested commands must pass the same validation as top-level commands.

## Related

- [Settings and Profiles](./settings-and-profiles.md)
- [Sandboxing](./sandbox.md) — for running in a container instead of restricting shell commands
