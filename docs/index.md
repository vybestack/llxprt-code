# Welcome to LLxprt Code documentation

This documentation provides a comprehensive guide to installing, using, and developing LLxprt Code. This tool lets you interact with Gemini models through a command-line interface.

## Overview

LLxprt Code brings the capabilities of large language models to your terminal in an interactive Read-Eval-Print Loop (REPL) environment. LLxprt Code consists of a client-side application (`packages/cli`) that communicates with a local server (`packages/core`), which in turn manages requests to the provider APIs and its AI models. LLxprt Code also contains a variety of tools for tasks such as performing file system operations, running shells, and web fetching, which are managed by `packages/core`.

## Navigating the documentation

This documentation is organized into the following sections:

- **[Execution and Deployment](./deployment.md):** Information for running LLxprt Code.
- **[Architecture Overview](./architecture.md):** Understand the high-level design of LLxprt Code, including its components and how they interact.
- **CLI Usage:** Documentation for `packages/cli`.
  - **[CLI Introduction](./cli/index.md):** Overview of the command-line interface.
  - **[Commands](./cli/commands.md):** Description of available CLI commands.
  - **[Configuration](./cli/configuration.md):** Information on configuring the CLI.
  - **[Runtime helper APIs](./cli/runtime-helpers.md):** Reference for runtime-scoped helper functions.
  - **[Authentication](./cli/authentication.md):** Set up authentication for various providers.
  - **[OAuth Setup](./oauth-setup.md):** Configure OAuth authentication for providers.
  - **[Provider Configuration](./cli/providers.md):** Configure and manage LLM providers.
  - **[OpenAI Responses API](./cli/providers-openai-responses.md):** Using OpenAI's enhanced Responses API.
  - **[Local Models](./local-models.md):** Complete guide to using local AI models with LM Studio, Ollama, llama.cpp, and more.
  - **[Subagents](./subagents.md):** Create and manage subagents tied to profiles.

  - **[Prompt Configuration](./prompt-configuration.md):** How to customize AI behavior with prompts.
  - **[Settings and Profiles](./settings-and-profiles.md):** How to manage settings and use profiles.
  - **[Emoji Filter](./EMOJI-FILTER.md):** Control emoji usage in LLM responses.
  - **[Themes](./cli/themes.md):** Customize the visual appearance.
  - **[Keyboard Shortcuts](./keyboard-shortcuts.md):** Quick reference for keyboard shortcuts.
  - **[Checkpointing](./checkpointing.md):** Documentation for the checkpointing feature.
  - **[Context Dumping](./cli/context-dumping.md):** Capture API requests/responses for debugging and curl replay.
  - **[Extensions](./extension.md):** How to extend the CLI with new functionality.
  - **[IDE Integration](./ide-integration.md):** Connect the CLI to your editor.
  - **[Telemetry](./telemetry.md):** Overview of telemetry in the CLI.
  - **[Telemetry Privacy](./telemetry-privacy.md):** Privacy information for telemetry.

- **Core Details:** Documentation for `packages/core`.
  - **[Core Introduction](./core/index.md):** Overview of the core component.
  - **[Provider runtime context](./core/provider-runtime-context.md):** Manage `ProviderRuntimeContext` lifecycles.
  - **[Provider interface](./core/provider-interface.md):** Implement providers against the stateless runtime.
  - **[Tools API](./core/tools-api.md):** Information on how the core manages and exposes tools.
  - **[Memory Import Processor](./core/memport.md):** Modular LLXPRT.md import feature.
- **Tools:**
  - **[Tools Overview](./tools/index.md):** Overview of the available tools.
  - **[File System Tools](./tools/file-system.md):** Documentation for the `read_file` and `write_file` tools.
  - **[Multi-File Read Tool](./tools/multi-file.md):** Documentation for the `read_many_files` tool.
  - **[Shell Tool](./tools/shell.md):** Documentation for the `run_shell_command` tool.
  - **[MCP Server](./tools/mcp-server.md):** Model Context Protocol server integration.
  - **[Web Fetch Tool](./tools/web-fetch.md):** Documentation for the `web_fetch` tool.
  - **[Web Search Tool](./tools/web-search.md):** Documentation for the `google_web_search` tool.
  - **[Memory Tool](./tools/memory.md):** Documentation for the `save_memory` tool.
- **Additional Resources:**
  - **[Sandbox Security](./sandbox.md):** Security and sandboxing mechanisms.
  - **[Shell Replacement](./shell-replacement.md):** Command substitution in shell commands.
  - **[Contributing & Development Guide](../CONTRIBUTING.md):** Information for contributors and developers.
  - **[NPM Workspaces and Publishing](./npm.md):** Details on how the project's packages are managed and published.
  - **[Release notes: Stateless Provider](./release-notes/stateless-provider.md):** Summary of new runtime features, breaking changes, and validation steps.
  - **[Troubleshooting Guide](./troubleshooting.md):** Find solutions to common problems and FAQs.
  - **[Migration from Gemini CLI](./gemini-cli-tips.md):** Guide for users migrating from Gemini CLI.
  - **[Stateless provider migration](./migration/stateless-provider.md):** Upgrade guide for the new provider runtime model.
  - **[Terms of Service and Privacy Notice](./tos-privacy.md):** Information on the terms of service and privacy notices.

We hope this documentation helps you make the most of the LLxprt Code!
