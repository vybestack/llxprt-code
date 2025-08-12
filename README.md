# LLxprt Code

[![LLxprt Code CI](https://github.com/acoliver/llxprt-code/actions/workflows/ci.yml/badge.svg)](https://github.com/acoliver/llxprt-code/actions/workflows/ci.yml)
&nbsp;
[![Mentioned in Awesome Gemini CLI](https://awesome.re/mentioned-badge.svg)](https://github.com/Piebald-AI/awesome-gemini-cli)

![LLxprt Code Screenshot](./docs/assets/llxprt-screenshot.png)

LLxprt Code is a powerful fork of [Google's Gemini CLI](https://github.com/google-gemini/gemini-cli), enhanced with multi-provider support and improved theming. We thank Google for their excellent foundation and will continue to track and merge upstream changes as long as practical.

## Key Features

- **Multi-Provider Support**: Direct access to OpenAI (o3), Anthropic (Claude), Google Gemini, plus OpenRouter, Fireworks, and local models
- **Enhanced Theme Support**: Beautiful themes applied consistently across the entire tool
- **Full Gemini CLI Compatibility**: All original features work seamlessly, including Google authentication via `/auth`
- **Local Model Support**: Run models locally with LM Studio, llama.cpp, or any OpenAI-compatible server
- **Flexible Configuration**: Switch providers, models, and API keys on the fly
- **Advanced Settings & Profiles**: Fine-tune model parameters, manage ephemeral settings, and save configurations for reuse. [Learn more →](./docs/settings-and-profiles.md)

With LLxprt Code you can:

- Query and edit large codebases with any LLM provider
- Generate new apps from PDFs or sketches, using multimodal capabilities
- Use local models for privacy-sensitive work
- Switch between providers seamlessly within a session
- Leverage all the powerful tools and MCP servers from Gemini CLI
- Use tools and MCP servers to connect new capabilities, including [media generation with Imagen, Veo or Lyria](https://github.com/GoogleCloudPlatform/vertex-ai-creative-studio/tree/main/experiments/mcp-genmedia)
- Ground your queries with the [Google Search](https://ai.google.dev/gemini-api/docs/grounding) tool when using Gemini
- Enjoy a beautifully themed interface across all commands

## Quickstart

You have two options to install LLxprt Code.

### With Node

1. **Prerequisites:** Ensure you have [Node.js version 20](https://nodejs.org/en/download) or higher installed.
2. **Install LLxprt Code:**

   ```bash
   npm install -g @vybestack/llxprt-code
   ```

   Or run directly with npx:

   ```bash
   npx https://github.com/acoliver/llxprt-code
   ```

### With Homebrew

1. **Prerequisites:** Ensure you have [Homebrew](https://brew.sh/) installed.
2. **Install the CLI:** Execute the following command in your terminal:

   ```bash
   brew install llxprt-code
   ```

   Then, run the CLI from anywhere:

   ```bash
   llxprt
   ```

### Common Configuration Steps

3. **Run and configure:**

   ```bash
   llxprt
   ```
   - Pick a beautiful theme
   - Choose your provider with `/provider` (defaults to Gemini)
   - Set up authentication as needed

## Provider Configuration

### Using OpenAI

Direct access to o3, o1, GPT-4.1, and other OpenAI models:

1. Get your API key from [OpenAI](https://platform.openai.com/api-keys)
2. Configure LLxprt Code:
   ```
   /provider openai
   /key sk-your-openai-key-here
   /model o3-mini
   ```

### Using Anthropic

Access Claude Sonnet 4, Claude Opus 4.1, and other Anthropic models:

#### Option 1: Log in with Anthropic to use your Claude Pro or Max account

Use OAuth authentication to access Claude with your existing Claude Pro or Max subscription:

1. Select the Anthropic provider:
   ```
   /provider anthropic
   ```
2. Authenticate with your Claude account:
   ```
   /auth
   ```
3. Your browser will open to the Claude authentication page
4. Log in and authorize LLxprt Code
5. Copy the authorization code shown and paste it back in the terminal
6. You're now using your Claude Pro/Max account!

#### Option 2: Use an API Key

1. Get your API key from [Anthropic](https://console.anthropic.com/account/keys)
2. Configure:
   ```
   /provider anthropic
   /key sk-ant-your-key-here
   /model claude-sonnet-4-20250115
   ```

### Using Qwen

Access Qwen3-Coder-Pro and other Qwen models for free:

#### Option 1: Log in with Qwen (FREE)

Use OAuth authentication to access Qwen with your free account:

```
/auth qwen
```

Your browser will open to the Qwen authentication page. Log in and authorize LLxprt Code, then copy the authorization code shown and paste it back in the terminal. You're now using Qwen3-Coder-Pro for free!

#### Option 2: Use an API Key

For advanced users who need API access:

1. Get your API key from [Qwen](https://platform.qwen.ai/)
2. Configure:
   ```
   /provider qwen
   /key your-qwen-api-key
   /model qwen3-coder-pro
   ```

### Using Local Models

Run models locally for complete privacy and control. LLxprt Code works with any OpenAI-compatible server.

**Example with LM Studio:**

1. Start LM Studio and load a model (e.g., Gemma 3B)
2. In LLxprt Code:
   ```
   /provider openai
   /baseurl http://127.0.0.1:1234/v1/
   /model gemma-3b-it
   ```

**Example with llama.cpp:**

1. Start llama.cpp server: `./server -m model.gguf -c 2048`
2. In LLxprt Code:
   ```
   /provider openai
   /baseurl http://localhost:8080/v1/
   /model local-model
   ```

**List available models:**

```
/model
```

This shows all models available from your current provider.

### Using OpenRouter

Access 100+ models through OpenRouter:

1. Get your API key from [OpenRouter](https://openrouter.ai/keys)
2. Configure LLxprt Code:
   ```
   /provider openai
   /baseurl https://openrouter.ai/api/v1/
   /keyfile ~/.openrouter_key
   /model qwen/qwen3-coder
   /profile save qwen3-coder
   ```

### Using Fireworks

For fast inference with popular open models:

1. Get your API key from [Fireworks](https://app.fireworks.ai/api-keys)
2. Configure:
   ```
   /provider openai
   /baseurl https://api.fireworks.ai/inference/v1/
   /key fw_your-key-here
   /model accounts/fireworks/models/llama-v3p3-70b-instruct
   ```

### Using xAI (Grok)

Access Grok models through xAI's API:

1. Get your API key from [xAI](https://x.ai/)
2. Configure using command line:

   ```bash
   llxprt --provider openai --baseurl https://api.x.ai/v1/ --model grok-3 --keyfile ~/.mh_key
   ```

   Or configure interactively:

   ```
   /provider openai
   /baseurl https://api.x.ai/v1/
   /model grok-3
   /keyfile ~/.mh_key
   ```

3. List available Grok models:
   ```
   /model
   ```

### Using Google Gemini

You can still use Google's services:

1. **With Google Account:** Use `/auth` to sign in
2. **With API Key:**
   ```bash
   export GEMINI_API_KEY="YOUR_API_KEY"
   ```
   Or use `/key YOUR_API_KEY` after selecting the gemini provider

### Managing API Keys

- **Set key for current session:** `/key your-api-key`
- **Load key from file:** `/keyfile ~/.keys/openai.txt`
- **Environment variables:** Still supported for all providers

## Examples

Start a new project:

```sh
cd new-project/
llxprt
> Create a Discord bot that answers questions using a FAQ.md file I will provide
```

Work with existing code:

```sh
git clone https://github.com/acoliver/llxprt-code
cd llxprt-code
llxprt
> Give me a summary of all the changes that went in yesterday
```

Use a local model for sensitive code:

```sh
llxprt
/provider openai
/baseurl http://localhost:1234/v1/
/model codellama-7b
> Review this code for security vulnerabilities
```

## Control and Shortcuts: Settings and Profiles

LLxprt Code provides powerful configuration options through model parameters and profiles:

```bash
# Fine-tune model behavior
/set modelparam temperature 0.8
/set modelparam max_tokens 4096

# Configure context handling
/set context-limit 100000
/set compression-threshold 0.7

# Save your configuration
/profile save my-assistant

# Load it later
llxprt --profile-load my-assistant
```

See the [complete settings documentation](./docs/settings-and-profiles.md) for all configuration options.

## Customizing AI Behavior with Prompts

LLxprt Code features a sophisticated prompt configuration system that allows you to customize the AI's behavior for different providers, models, and use cases. You can:

- Create custom system prompts for specific tasks
- Override provider-specific behaviors
- Add environment-aware instructions
- Customize tool usage guidelines

Learn more in the [Prompt Configuration Guide](./docs/prompt-configuration.md).

### Next steps

- Learn how to [contribute to or build from the source](./CONTRIBUTING.md).
- Explore the available **[CLI Commands](./docs/cli/commands.md)**.
- If you encounter any issues, review the **[troubleshooting guide](./docs/troubleshooting.md)**.
- For more comprehensive documentation, see the [full documentation](./docs/index.md).
- **Migrating from Gemini CLI?** Check out our [tips for Gemini CLI users](./docs/gemini-cli-tips.md).
- Take a look at some [popular tasks](#popular-tasks) for more inspiration.
- Check out our **[Official Roadmap](./ROADMAP.md)**

### Provider Commands Reference

- `/provider` - List available providers or switch provider
- `/model` - List available models or switch model
- `/baseurl` - Set custom API endpoint
- `/key` - Set API key for current session
- `/keyfile` - Load API key from file
- `/auth` - Authenticate with Google (for Gemini), Anthropic (for Claude), or Qwen

### Troubleshooting

See the [troubleshooting guide](docs/troubleshooting.md) if you encounter issues.

## Popular tasks

### Explore a new codebase

Start by `cd`ing into an existing or newly-cloned repository and running `llxprt`.

```text
> Describe the main pieces of this system's architecture.
```

```text
> What security mechanisms are in place?
```

```text
> Provide a step-by-step dev onboarding doc for developers new to the codebase.
```

```text
> Summarize this codebase and highlight the most interesting patterns or techniques I could learn from.
```

```text
> Identify potential areas for improvement or refactoring in this codebase, highlighting parts that appear fragile, complex, or hard to maintain.
```

```text
> Which parts of this codebase might be challenging to scale or debug?
```

```text
> Generate a README section for the [module name] module explaining what it does and how to use it.
```

```text
> What kind of error handling and logging strategies does the project use?
```

```text
> Which tools, libraries, and dependencies are used in this project?
```

### Work with your existing code

```text
> Implement a first draft for GitHub issue #123.
```

```text
> Help me migrate this codebase to the latest version of Java. Start with a plan.
```

### Automate your workflows

Use MCP servers to integrate your local system tools with your enterprise collaboration suite.

```text
> Make me a slide deck showing the git history from the last 7 days, grouped by feature and team member.
```

```text
> Make a full-screen web app for a wall display to show our most interacted-with GitHub issues.
```

### Interact with your system

```text
> Convert all the images in this directory to png, and rename them to use dates from the exif data.
```

```text
> Organize my PDF invoices by month of expenditure.
```

### Uninstall

Head over to the [Uninstall](docs/Uninstall.md) guide for uninstallation instructions.

## Privacy and Terms

**LLxprt Code does not collect telemetry by default.** Your privacy is important to us.

When using Google's services through LLxprt Code, you are bound by [Google's Terms of Service and Privacy Notice](./docs/tos-privacy.md). Other providers have their own terms that apply when using their services.
