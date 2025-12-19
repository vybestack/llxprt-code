# LLxprt Code Core

LLxprt Code's core package (`packages/core`) is the backend portion of LLxprt Code, handling communication with multiple AI providers (Google Gemini, OpenAI, Anthropic, and others), managing tools, and processing requests sent from `packages/cli`. For a general overview of LLxprt Code, see the [main documentation page](../index.md).

## Navigating this section

- **[Provider runtime context](./provider-runtime-context.md):** Details on `ProviderRuntimeContext` lifecycle helpers and runtime isolation semantics.
- **[Provider interface](./provider-interface.md):** API reference for implementing providers against the stateless runtime.
- **[Core tools API](./tools-api.md):** Information on how tools are defined, registered, and used by the core.
- **[Memory Import Processor](./memport.md):** Documentation for the modular LLXPRT.md import feature using @file.md syntax.

## Role of the core

While the `packages/cli` portion of LLxprt Code provides the user interface, `packages/core` is responsible for:

- **AI Provider interaction:** Securely communicating with various AI providers (Google Gemini, OpenAI, Anthropic, etc.), sending user prompts, and receiving model responses.
- **Prompt engineering:** Constructing effective prompts for different AI models, potentially incorporating conversation history, tool definitions, and instructional context from `LLXPRT.md` files.
- **Tool management & orchestration:**
  - Registering available tools (e.g., file system tools, shell command execution).
  - Interpreting tool use requests from the AI model.
  - Executing the requested tools with the provided arguments.
  - Returning tool execution results to the AI model for further processing.
- **Session and state management:** Keeping track of the conversation state, including history and any relevant context required for coherent interactions.
- **Configuration:** Managing core-specific configurations, such as API key access, model selection, provider settings, and tool settings.

## Security considerations

The core plays a vital role in security:

- **API key management:** It handles various API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) and ensures they're used securely when communicating with their respective providers.
- **Tool execution:** When tools interact with the local system (e.g., `run_shell_command`), the core (and its underlying tool implementations) must do so with appropriate caution, often involving sandboxing mechanisms to prevent unintended modifications.

## Chat history compression

To ensure that long conversations don't exceed the token limits of the AI model, the core includes a chat history compression feature.

When a conversation approaches the token limit for the configured model, the core automatically compresses the conversation history before sending it to the model. This compression is designed to be lossless in terms of the information conveyed, but it reduces the overall number of tokens used.

Token limits vary by provider and model:

- **Google Gemini:** See the [Google AI documentation](https://ai.google.dev/gemini-api/docs/models)
- **OpenAI:** Models like GPT-4.1 and o3 have different context windows
- **Anthropic:** Claude models offer various context window sizes

## Model fallback (Disabled in LLxprt)

**Note:** LLxprt Code has disabled automatic model fallback. When you select a model, it will stay on that model throughout your session. This prevents unexpected model changes mid-conversation (e.g., switching from a powerful model to a less capable one while coding).

The upstream Gemini CLI includes an automatic fallback mechanism that switches from "pro" to "flash" models when rate-limited. LLxprt intentionally disables this behavior to maintain consistency in your AI interactions.

If you encounter rate limits, you can manually switch models using the `/model` command or wait for the rate limit to reset. Other providers may have their own rate limiting behaviors - consult their documentation for details.

## File discovery service

The file discovery service is responsible for finding files in the project that are relevant to the current context. It is used by the `@` command and other tools that need to access files.

## Memory discovery service

The memory discovery service is responsible for finding and loading the `LLXPRT.md` files that provide context to the model. It searches for these files in a hierarchical manner, starting from the current working directory and moving up to the project root and the user's home directory. It also searches in subdirectories.

This allows you to have global, project-level, and component-level context files, which are all combined to provide the model with the most relevant information.

You can use the [`/memory` command](../cli/commands.md) to `show`, `add`, and `refresh` the content of loaded `LLXPRT.md` files.

## Citations

When the AI model finds it is reciting text from a source it appends the citation to the output. It is disabled by default but can be enabled with the ui.showCitations setting.

- When proposing an edit the citations display before giving the user the option to accept.
- Citations are always shown at the end of the model's turn.
- We deduplicate citations and display them in alphabetical order.
