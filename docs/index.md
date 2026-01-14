# Welcome to LLxprt Code documentation

This documentation provides a comprehensive guide to installing, using, and developing LLxprt Code. This tool lets you interact with AI models from multiple providers through a command-line interface.

## Overview

LLxprt Code brings the capabilities of large language models to your terminal in an interactive Read-Eval-Print Loop (REPL) environment. LLxprt Code consists of a client-side application (`packages/cli`) that communicates with a local server (`packages/core`), which in turn manages requests to the provider APIs and its AI models. LLxprt Code also contains a variety of tools for tasks such as performing file system operations, running shells, and web fetching, which are managed by `packages/core`.

## Navigating the documentation

### Getting Started

New to LLxprt Code? Start here:

- **[Getting Started Guide](./getting-started.md):** Your first session — installation, authentication, and your first AI-assisted coding task.

### Core Workflows

Essential guides for daily use:

- **[Provider Configuration](./cli/providers.md):** Configure and manage LLM providers (Anthropic, OpenAI, Gemini, and more).
- **[Authentication](./cli/authentication.md):** Set up authentication for various providers.
- **[Profiles](./cli/profiles.md):** Save and manage configurations for different contexts.
- **[Subagents](./subagents.md):** Create and manage specialized AI assistants tied to profiles.

### Advanced Topics

Power features for advanced users:

- **[OAuth Setup](./oauth-setup.md):** Configure OAuth authentication for subscription access.
- **[Local Models](./local-models.md):** Complete guide to using local AI models with LM Studio, Ollama, llama.cpp, and more.
- **[Zed Editor Integration](./zed-integration.md):** Connect LLxprt Code to the Zed editor as an AI assistant.
- **[OpenAI Responses API](./cli/providers-openai-responses.md):** Using OpenAI's enhanced Responses API.
- **[Prompt Configuration](./prompt-configuration.md):** How to customize AI behavior with prompts.
- **[Settings and Profiles](./settings-and-profiles.md):** How to manage settings and use profiles.
- **[Checkpointing](./checkpointing.md):** Save and restore session state.
- **[Extensions](./extension.md):** How to extend the CLI with new functionality.
- **[IDE Integration](./ide-integration.md):** Connect the CLI to your editor.

### Reference

Configuration, commands, and troubleshooting:

- **[Configuration](./cli/configuration.md):** Configure the CLI behavior.
- **[Commands Reference](./cli/commands.md):** Complete documentation of available CLI commands.
- **[Troubleshooting Guide](./troubleshooting.md):** Find solutions to common problems and FAQs.
- **[CLI Introduction](./cli/index.md):** Overview of the command-line interface.
- **[Execution and Deployment](./deployment.md):** Information for running LLxprt Code.
- **[Keyboard Shortcuts](./keyboard-shortcuts.md):** Quick reference for keyboard shortcuts.
- **[Themes](./cli/themes.md):** Customize the visual appearance.
- **[Emoji Filter](./EMOJI-FILTER.md):** Control emoji usage in LLM responses.
- **[Runtime helper APIs](./cli/runtime-helpers.md):** Reference for runtime-scoped helper functions.
- **[Context Dumping](./cli/context-dumping.md):** Capture API requests/responses for debugging and curl replay.
- **[Telemetry](./telemetry.md):** Overview of telemetry in the CLI.
- **[Telemetry Privacy](./telemetry-privacy.md):** Privacy information for telemetry.
- **[Migration from Gemini CLI](./gemini-cli-tips.md):** Guide for users migrating from Gemini CLI.

### Architecture & Development

For contributors and developers:

- **[Architecture Overview](./architecture.md):** Understand the high-level design of LLxprt Code.
- **[Core Introduction](./core/index.md):** Overview of the core component.
- **[Provider runtime context](./core/provider-runtime-context.md):** Manage `ProviderRuntimeContext` lifecycles.
- **[Provider interface](./core/provider-interface.md):** Implement providers against the stateless runtime.
- **[Tools API](./core/tools-api.md):** Information on how the core manages and exposes tools.
- **[Memory Import Processor](./core/memport.md):** Modular LLXPRT.md import feature.
- **[Sandbox Security](./sandbox.md):** Security and sandboxing mechanisms.
- **[Shell Replacement](./shell-replacement.md):** Command substitution in shell commands.
- **[Contributing & Development Guide](../CONTRIBUTING.md):** Information for contributors and developers.
- **[NPM Workspaces and Publishing](./npm.md):** Details on how the project's packages are managed and published.
- **[Stateless provider migration](./migration/stateless-provider.md):** Upgrade guide for the new provider runtime model.

### Tools Documentation

- **[Tools Overview](./tools/index.md):** Overview of the available tools.
- **[File System Tools](./tools/file-system.md):** Documentation for the `read_file` and `write_file` tools.
- **[Multi-File Read Tool](./tools/multi-file.md):** Documentation for the `read_many_files` tool.
- **[Shell Tool](./tools/shell.md):** Documentation for the `run_shell_command` tool.
- **[MCP Server](./tools/mcp-server.md):** Model Context Protocol server integration.
- **[Web Fetch Tool](./tools/web-fetch.md):** Documentation for the `web_fetch` tool.
- **[Web Search Tool](./tools/web-search.md):** Documentation for the `google_web_search` tool.
- **[Memory Tool](./tools/memory.md):** Documentation for the `save_memory` tool.

### Additional Resources

- **[Release notes: Stateless Provider](./release-notes/stateless-provider.md):** Summary of new runtime features, breaking changes, and validation steps.
- **[Terms of Service and Privacy Notice](./tos-privacy.md):** Information on the terms of service and privacy notices.

We hope this documentation helps you make the most of the LLxprt Code!
