# Getting Started with LLxprt Code

This guide walks you through your first session — from installation to your first AI-assisted coding task.

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

```
llxprt
/auth gemini enable
/provider gemini
/model gemini-2.5-flash
```

**Qwen (Alibaba)** — Free tier for coding tasks:

```
llxprt
/auth qwen enable
/provider qwen
/model qwen-3-coder
```

### Option B: Use Your Existing Subscription (OAuth)

If you already pay for Claude, OpenAI, or Qwen, use your subscription directly — no separate API billing:

**Claude Pro/Max** ($20–200/month):

```
llxprt
/auth anthropic enable
/provider anthropic
/model claude-opus-4-6
```

**OpenAI ChatGPT Plus/Pro:**

```
llxprt
/auth codex enable
/provider codex
/model gpt-5.3-codex
```

**Qwen:**

```
llxprt
/auth qwen enable
/provider qwen
/model qwen-3-coder
```

Each `/auth` command opens a browser for OAuth with your existing account.

### Option C: API Keys

For direct API access, use `/key save` to store your key in your system keyring. You only need to do this once — afterwards, `/key load` retrieves it without exposing the key in your shell history or to the LLM. Keys are automatically masked when you paste them into the REPL.

**Anthropic:**

```
llxprt
/key save anthropic sk-ant-***your-key***
/provider anthropic
/key load anthropic
/model claude-opus-4-6
```

**OpenAI:**

```
llxprt
/key save openai sk-***your-key***
/provider openai
/key load openai
/model gpt-5.2
```

**Open-weight models** — providers like Synthetic, Z.ai, Chutes, Kimi.com, and Deepseek.ai give you access to models like DeepSeek, Kimi, Minimax, GLM, and Qwen:

**Synthetic:**

```
llxprt
/key save synthetic syn-***your-key***
/provider Synthetic
/key load synthetic
/model hf:Qwen/Qwen3-Coder
```

**Z.ai:**

```
llxprt
/key save zai zai-***your-key***
/provider zai
/key load zai
/model hf:zai-org/GLM-4.7
```

After saving a key once, you only need `/key load <name>` in future sessions.

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

LLxprt Code can read and modify files with your approval:

```
> Read the README.md file and suggest improvements
```

Or create new files:

```
> Create a simple unit test for the main module
```

LLxprt Code asks for confirmation before writing files. Review changes before accepting.

### 4. Debug an Issue

Paste an error message directly:

```
> I'm getting this error: TypeError: Cannot read property 'map' of undefined
  at UserList.render (src/components/UserList.js:24)
  Help me fix it
```

### 5. Save Your Configuration

Once you have your provider and model configured, save it as a profile so you don't have to set it up again:

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
| `/key save <name> <key>`     | Save an API key to your keyring |
| `/key load <name>`           | Load a saved API key            |
| `/profile save model <name>` | Save your current configuration |
| `/profile load <name>`       | Load a saved profile            |
| `/stats quota`               | Check your current quota usage  |
| `/clear`                     | Clear conversation history      |
| `/quit` or `Ctrl+C`          | Exit LLxprt Code                |

## Tips for Better Results

1. **Be specific** — "Add error handling to the login function in src/auth.js" works better than "improve my code"
2. **Provide context** — Mention relevant files, error messages, or constraints
3. **Iterate** — Follow up with clarifications or ask for alternatives
4. **Use the right model** — Larger models (claude-opus-4-6, gpt-5.3-codex) for complex tasks, faster models (gemini-flash, claude-haiku-4-5) for quick questions
5. **Think bigger for bigger projects** — This guide gets you started with quick tasks, but for larger projects you should have distinct requirements, planning, and execution phases. Check out the [Beyond Vibe Coding](https://www.youtube.com/@AndrewOliver/podcasts) YouTube series for how to approach real-world autonomous development workflows

## Security Tip: Sandboxing

When working with code from external sources, enable sandboxing to protect your system:

```bash
llxprt --sandbox-profile-load safe "review this pull request"
```

Sandboxing isolates tool execution from your host using Docker or Podman containers. Credentials stay on the host through the credential proxy, and host access is limited to explicit mounts used by the sandbox runtime.

For a full walkthrough, see the [Sandbox Tutorial](./tutorials/sandbox-setup.md).

## Next Steps

Now that you're up and running:

- **[Profiles](./cli/profiles.md)** — Save and manage multiple configurations
- **[Subagents](./subagents.md)** — Create specialized AI assistants for different tasks
- **[Local Models](./local-models.md)** — Run models locally for complete privacy
- **[Sandboxing](./sandbox.md)** — Protect your system with container isolation

## Troubleshooting

### Authentication Issues

```
/auth <provider> status
/auth <provider> logout
/auth <provider> enable
```

### Model Not Available

```
/model
/provider
```

### Quota Issues

Check your current usage and limits:

```
/stats quota
```

### Need More Help?

- **[Troubleshooting Guide](./troubleshooting.md)** — Common issues and solutions
- **[Discord Community](https://discord.gg/Wc6dZqWWYv)** — Get help from the community
