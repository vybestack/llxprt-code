# Subagents

Subagents are specialized assistants you configure to run with their own profile, prompt, and tool limits. They are ideal for repeatable workflows like code review, documentation updates, or analysis tasks without changing your main session settings.

## Why there are no default subagents

LLxprt Code ships with no default subagents because each subagent must bind to a **profile**. Profiles are tied to the provider and model you select, so preloading subagents would assume a specific provider choice. Create subagents that match the profiles you already use.

## Prerequisites

Before creating a subagent, you need at least one profile:

- Model profiles are saved with `/profile save model ...`.
- Load balancer profiles are saved with `/profile save loadbalancer ...`.

If you haven't created profiles yet, review `docs/cli/profiles.md` for setup guidance.

## Manage subagents with `/subagent`

### List subagents

```bash
/subagent list
```

Lists all configured subagents along with their bound profile and mode.

### Save (create) a subagent

```bash
/subagent save <name> <profile> auto|manual "<text>"
```

- `<name>` must be unique and use letters, numbers, or dashes.
- `<profile>` must match an existing profile.
- `auto` and `manual` control how the system prompt is created.

`/subagent create` is an alias for `/subagent save`.

### Show subagent details

```bash
/subagent show <name>
```

Displays the full configuration, including the system prompt and timestamps.

### Edit a subagent

```bash
/subagent edit <name>
```

Opens your editor to update the stored JSON configuration. Changes are validated before saving.

### Delete a subagent

```bash
/subagent delete <name>
```

Deletes the configuration after confirmation.

## Auto vs manual mode

### Manual mode

Manual mode stores the exact system prompt you provide.

```bash
/subagent save code-reviewer my-profile manual "You are a careful reviewer focused on security and readability."
```

Use manual mode when you already know the prompt you want.

### Auto mode

Auto mode uses your description to generate a system prompt automatically.

```bash
/subagent save docs-helper my-profile auto "Help write concise developer documentation."
```

Auto mode requires a provider that can generate the prompt; if it fails, fall back to manual mode.

## Profiles and subagents

Subagents bind to profiles, not directly to providers or models. This means:

- Update a profile to change the provider/model used by every subagent that references it.
- Subagents can point at model profiles or load balancer profiles.
- Multiple subagents can reuse the same profile.

## Storage and files

Subagents are stored under `~/.llxprt/subagents/` as JSON files. Each file includes the profile, mode, system prompt, and timestamps. You can back these up or version them as needed.

## Examples

### Code review helper (manual)

```bash
/subagent save code-reviewer work-claude manual "Review changes for correctness, performance, and security. Provide actionable feedback."
```

### Documentation helper (auto)

```bash
/subagent save docs-helper docs-profile auto "Summarize API changes and draft release notes."
```

### Mixed provider setup

```bash
/subagent save quick-analysis fast-gemini auto "Provide quick code summaries."
/subagent save deep-review claude-max manual "Perform deep architectural analysis and list risks."
```

## Related commands

- `/profile list` to see available profiles.
- `/profile save model ...` or `/profile save loadbalancer ...` to create profiles.
- `/task` to invoke subagents programmatically.
