# Getting Started with LLxprt Code

Welcome to LLxprt Code! This guide walks you through your first session — from installation to your first AI-assisted coding task.

## Prerequisites

- **Node.js 20+** installed on your system
- A terminal/command line

## Install LLxprt Code

```bash
npm install -g @vybestack/llxprt-code
```

Or run without installing:

```bash
npx @vybestack/llxprt-code
```

## Choose Your Path

LLxprt Code works with multiple AI providers. Pick the option that works for you:

### Option A: Free Tier (No Credit Card Required)

**Gemini (Google)** — Free tier with generous limits:

```bash
llxprt
/auth gemini enable
/provider gemini
/model gemini-2.5-flash
```

**Qwen (Alibaba)** — Free tier for coding tasks:

```bash
llxprt
/auth qwen enable
/provider qwen
/model qwen-3-coder
```

### Option B: Claude Pro/Max Subscription

If you have a Claude Pro ($20/month) or Claude Max ($100-200/month) subscription, you can use it directly:

```bash
llxprt
/auth anthropic enable
/provider anthropic
/model claude-sonnet-4-5
```

This opens a browser for OAuth authentication with your existing Anthropic account.

### Option C: API Keys (Pay-per-token)

For direct API access with pay-as-you-go pricing:

**Anthropic:**

```bash
llxprt
/provider anthropic
/keyfile ~/.anthropic_key
/model claude-sonnet-4-5-20250929
```

**OpenAI:**

```bash
llxprt
/provider openai
/keyfile ~/.openai_key
/model gpt-5.2
```

**Gemini (API Key):**

```bash
llxprt
/provider gemini
/keyfile ~/.gemini_key
/model gemini-3-flash-preview
```

**Note:** Store your API key in a file (e.g., `~/.anthropic_key`) with `chmod 600` permissions. The `/keyfile` command loads the key securely without exposing it in shell history.

Get your API keys from:

- [Anthropic Console](https://console.anthropic.com/)
- [OpenAI Platform](https://platform.openai.com/api-keys)
- [Google AI Studio](https://aistudio.google.com/app/apikey)

## Your First Session

### 1. Navigate to Your Project

```bash
cd your-project-directory
llxprt
```

LLxprt Code automatically reads your project context.

### 2. Ask a Question

Type naturally at the prompt:

```
> Explain the structure of this codebase
```

The AI analyzes your project files and explains the architecture.

### 3. Try a File Operation

LLxprt Code can read and modify files with your permission:

```
> Read the README.md file and suggest improvements
```

Or create new files:

```
> Create a simple unit test for the main module
```

**Note:** LLxprt Code will ask for confirmation before writing files. Review changes before accepting.

### 4. Debug an Issue

Paste an error message directly:

```
> I'm getting this error: TypeError: Cannot read property 'map' of undefined
  at UserList.render (src/components/UserList.js:24)
  Help me fix it
```

### 5. Save Your Configuration

Once you have your provider and model configured how you like, save it as a profile:

```
/profile save model my-setup
```

Load it anytime:

```
/profile load my-setup
```

Or set it as your default:

```
/profile set-default my-setup
```

## Essential Commands

| Command                      | Description                     |
| ---------------------------- | ------------------------------- |
| `/help`                      | Show all available commands     |
| `/provider`                  | Switch AI provider              |
| `/model`                     | Change the AI model             |
| `/auth <provider> enable`    | Set up OAuth authentication     |
| `/profile save model <name>` | Save your current configuration |
| `/profile load <name>`       | Load a saved profile            |
| `/clear`                     | Clear conversation history      |
| `/quit` or `Ctrl+C`          | Exit LLxprt Code                |

## Tips for Better Results

1. **Be specific** — "Add error handling to the login function in src/auth.js" works better than "improve my code"
2. **Provide context** — Mention relevant files, error messages, or constraints
3. **Iterate** — Follow up with clarifications or ask for alternatives
4. **Use the right model** — Larger models (claude-opus-4-5, gpt-5.2) for complex tasks, faster models (gemini-flash, claude-haiku-4-5) for quick questions

## Next Steps

Now that you're up and running:

- **[Profiles](./cli/profiles.md)** — Save and manage multiple configurations
- **[Subagents](./subagents.md)** — Create specialized AI assistants for different tasks
- **[Local Models](./local-models.md)** — Run models locally for complete privacy
- **[Provider Guide](./cli/providers.md)** — Detailed provider configuration
- **[Commands Reference](./cli/commands.md)** — Complete command documentation

## Troubleshooting

### Authentication Issues

```bash
# Check auth status
/auth <provider> status

# Re-authenticate
/auth <provider> logout
/auth <provider> enable
```

### Model Not Available

```bash
# List available models for current provider
/model

# Check current provider
/provider
```

### Need More Help?

- **[Troubleshooting Guide](./troubleshooting.md)** — Common issues and solutions
- **[Discord Community](https://discord.gg/Wc6dZqWWYv)** — Get help from the community
