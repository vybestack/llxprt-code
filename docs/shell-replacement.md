# Shell Command Substitution

By default, LLxprt Code blocks command substitution patterns (`$()`, `<()`, and backticks) in shell commands for security reasons. This prevents potentially dangerous command injections.

## Enabling Command Substitution

You can enable command substitution in two ways:

### 1. Ephemeral Setting (Session Only)

Enable command substitution for your current session:

```
/set shell-replacement true
```

To disable it again:

```
/set shell-replacement false
```

### 2. Persistent Setting

Add to your settings file (`~/.llxprt/settings.json`):

```json
{
  "shellReplacement": true
}
```

## Examples

When enabled, you can use:

- **Command substitution**: `echo $(date)`
- **Process substitution**: `diff <(ls dir1) <(ls dir2)`
- **Backticks**: `` echo `whoami` ``
- **Variable assignment**: `RESULT=$(curl -s api.example.com)`

## Security Considerations

⚠️ **Warning**: Enabling shell replacement allows execution of nested commands, which can be a security risk if you're running untrusted commands. Only enable this feature if you understand the implications.

## Default Behavior

By default, shell replacement is **disabled**. Attempting to use command substitution will result in an error:

```
Command substitution using $(), <(), or >() is not allowed for security reasons
```
