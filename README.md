# LLxprt Code

[![LLxprt Code CI](https://github.com/acoliver/llxprt-code/actions/workflows/ci.yml/badge.svg)](https://github.com/acoliver/llxprt-code/actions/workflows/ci.yml)

![LLxprt Code Screenshot](./docs/assets/llxprt-screenshot.png)

LLxprt Code is a powerful fork of [Google's Gemini CLI](https://github.com/google-gemini/gemini-cli), enhanced with multi-provider support and improved theming. We thank Google for their excellent foundation and will continue to track and merge upstream changes as long as practical.

## Key Features

- **Multi-Provider Support**: Direct access to OpenAI (o3), Anthropic (Claude), Google Gemini, plus OpenRouter, Fireworks, and local models
- **Enhanced Theme Support**: Beautiful themes applied consistently across the entire tool
- **Full Gemini CLI Compatibility**: All original features work seamlessly, including Google authentication via `/auth`
- **Local Model Support**: Run models locally with LM Studio, llama.cpp, or any OpenAI-compatible server
- **Flexible Configuration**: Switch providers, models, and API keys on the fly

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

Access Claude Sonnet 4, Claude Opus 4, and other Anthropic models:

1. Get your API key from [Anthropic](https://console.anthropic.com/account/keys)
2. Configure:
   ```
   /provider anthropic
   /key sk-ant-your-key-here
   /model claude-sonnet-4-20250115
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
   /key sk-or-v1-your-key-here
   /model anthropic/claude-3.5-sonnet
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

### Next steps

- Learn how to [contribute to or build from the source](./CONTRIBUTING.md).
- Explore the available **[CLI Commands](./docs/cli/commands.md)**.
- If you encounter any issues, review the **[troubleshooting guide](./docs/troubleshooting.md)**.
- For more comprehensive documentation, see the [full documentation](./docs/index.md).
- Take a look at some [popular tasks](#popular-tasks) for more inspiration.
- Check out our **[Official Roadmap](./ROADMAP.md)**

### Provider Commands Reference

- `/provider` - List available providers or switch provider
- `/model` - List available models or switch model
- `/baseurl` - Set custom API endpoint
- `/key` - Set API key for current session
- `/keyfile` - Load API key from file
- `/auth` - Authenticate with Google (for Gemini provider)

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
