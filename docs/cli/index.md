# LLxprt Code

LLxprt Code is an AI-powered coding assistant that works with any LLM provider. Within LLxprt Code, `packages/cli` is the frontend for users to send and receive prompts and interact with AI-powered tools. For a general overview of LLxprt Code, see the [main documentation page](../index.md).

## Navigating this section

- **[Authentication](./authentication.md):** A guide to setting up authentication with AI providers, including OAuth buckets.
- **[Commands](./commands.md):** A reference for LLxprt Code commands (e.g., `/help`, `/tools`, `/theme`).
- **[Profiles](./profiles.md):** Save and manage configuration profiles, load balancing, and OAuth bucket failover.
- **[Configuration](./configuration.md):** A guide to tailoring LLxprt Code behavior using configuration files.
- **[Runtime helper APIs](./runtime-helpers.md):** Reference for the CLI runtime helper surface that powers provider switching, profiles, and diagnostics.
- **[Enterprise](./enterprise.md):** A guide to enterprise configuration.
- **[Token Caching](./token-caching.md):** Optimize API costs through token caching.
- **[Themes](./themes.md)**: A guide to customizing the CLI's appearance with different themes.
- **[Tutorials](tutorials.md)**: A tutorial showing how to use LLxprt Code to automate a development task.

## Non-interactive mode

LLxprt Code can be run in a non-interactive mode, which is useful for scripting and automation.

### Basic non-interactive usage

Pass a prompt directly as an argument:

```bash
llxprt "What is fine tuning?"
```

Or pipe input:

```bash
echo "What is fine tuning?" | llxprt
```

### Using profiles in non-interactive mode

Load a saved profile for consistent configuration:

```bash
llxprt --profile-load my-claude-profile "Explain this code"
```

### Interactive mode with initial prompt (`-i`)

The `-i` flag starts an interactive session with an initial prompt. Unlike non-interactive mode, the session continues after the first response:

```bash
llxprt -i "Let's work on improving this codebase"
```

This is useful when you want to start a conversation with context but continue interacting afterward.

### Comparison of modes

| Flag/Usage                   | Mode            | Session continues? |
| ---------------------------- | --------------- | ------------------ |
| `llxprt "prompt"`            | Non-interactive | No                 |
| `llxprt -p "prompt"`         | Non-interactive | No                 |
| `llxprt -i "prompt"`         | Interactive     | Yes                |
| `llxprt --profile-load name` | Interactive     | Yes                |
| `echo "prompt" \| llxprt`    | Non-interactive | No                 |
