# LLxprt Code

LLxprt Code is an AI-powered coding assistant that works with any LLM provider.
For a general overview, see the [main documentation page](../index.md).

## Where to start

| If you want to…                           | Read this                                             |
| ----------------------------------------- | ----------------------------------------------------- |
| Get authenticated with a provider         | [Authentication](./authentication.md)                 |
| Save and switch between configurations    | [Profiles](./profiles.md)                             |
| Tailor how LLxprt Code behaves            | [Configuration](./configuration.md)                   |
| Run LLxprt Code in scripts and automation | [Non-interactive mode](#non-interactive-mode) (below) |
| Generate or edit an image                 | [Image Generation](../tools/image-generation.md)      |
| Customise the CLI's appearance            | [Themes](./themes.md)                                 |

## Get authenticated

- **[Authentication](./authentication.md)** — set up authentication with AI
  providers, including OAuth buckets.
- **[Google Cloud Auth](./google-cloud-auth.md)** — configure Google Cloud
  service-account or workload-identity authentication.

## Configure behaviour

- **[Configuration](./configuration.md)** — tailor LLxprt Code behaviour using
  configuration files.
- **[Profiles](./profiles.md)** — save and manage configuration profiles, load
  balancing, and OAuth bucket failover.
- **[Enterprise](./enterprise.md)** — enterprise configuration options.
- **[Sandbox Profiles](./sandbox-profiles.md)** — configure container-based
  sandboxing for secure code execution.
- **[Token Caching](./token-caching.md)** — optimize API costs through token
  caching.
- **[Retry Settings](./retry-settings.md)** — configure retry behaviour for API
  calls.
- **[Token Tracking](./token-tracking.md)** — track token usage and costs.

## Run non-interactively

- **[Commands](./commands.md)** — reference for LLxprt Code commands (e.g.,
  `/help`, `/tools`, `/theme`).
- See [Non-interactive mode](#non-interactive-mode) below for scripting and
  automation.

## Customise appearance

- **[Themes](./themes.md)** — customise the CLI's appearance with different
  themes.

## Learn more

- **[Skills](./skills.md)** — extend LLxprt Code with custom skills.
- **[Tutorials](./tutorials.md)** — tutorials for using LLxprt Code features.

## Non-interactive mode

LLxprt Code can be run in a non-interactive mode, which is useful for scripting
and automation.

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

The `-i` flag starts an interactive session with an initial prompt. Unlike
non-interactive mode, the session continues after the first response:

```bash
llxprt -i "Let's work on improving this codebase"
```

This is useful when you want to start a conversation with context but continue
interacting afterward.

### Comparison of modes

| Flag/Usage                   | Mode            | Session continues? |
| ---------------------------- | --------------- | ------------------ |
| `llxprt "prompt"`            | Non-interactive | No                 |
| `llxprt -p "prompt"`         | Non-interactive | No                 |
| `llxprt -i "prompt"`         | Interactive     | Yes                |
| `llxprt --profile-load name` | Interactive     | Yes                |
| `echo "prompt" \| llxprt`    | Non-interactive | No                 |

### Image generation (`-O` / `-P`)

Generate or edit an image without starting a conversation. `-O` sets the output
path and `-P` sets the prompt; both are required. Use `-I` to supply input
images for editing (repeatable up to five times):

```bash
llxprt -O out.png -P "a photorealistic cat"
```

Image generation runs on your Codex account and is independent of the provider
you would chat with. See [Image Generation](../tools/image-generation.md) for
prerequisites, the full flag reference, and path rules.
