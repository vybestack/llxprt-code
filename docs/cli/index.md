# LLxprt Code

Within LLxprt Code, `packages/cli` is the frontend for users to send and receive prompts with the Gemini AI model and its associated tools. For a general overview of LLxprt Code, see the [main documentation page](../index.md).

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

LLxprt Code can be run in a non-interactive mode, which is useful for scripting and automation. In this mode, you pipe input to the CLI, it executes the command, and then it exits.

The following example pipes a command to LLxprt Code from your terminal:

```bash
echo "What is fine tuning?" | gemini
```

LLxprt Code executes the command and prints the output to your terminal. Note that you can achieve the same behavior by using the `--prompt` or `-p` flag. For example:

```bash
gemini -p "What is fine tuning?"
```
