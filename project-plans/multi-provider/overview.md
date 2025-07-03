# Multi-Provider Support for Gemini CLI

## 1. Overall Objectives

The primary objective is to transform the `gemini-cli` into a versatile command-line interface capable of interacting with multiple Large Language Model (LLM) providers beyond Google, specifically including OpenAI and Anthropic, with extensibility for others like Deepseek and Qwen. This will provide users with flexibility in choosing their preferred LLM and leveraging provider-specific features, such as advanced tool calling mechanisms.

Key goals include:

- **Provider Agnostic Interaction:** Abstract away provider-specific API details, allowing a consistent user experience regardless of the backend LLM.
- **Flexible Configuration:** Enable users to easily configure API keys, base URLs, and default models for each provider.
- **Dynamic Model Discovery:** Allow the CLI to dynamically fetch and list available models from a selected provider.
- **Universal Streaming:** Ensure all LLM interactions, including initial responses and tool-augmented follow-ups, are streamed by default for a responsive user experience.
- **Advanced Tooling Support:** Accommodate different tool calling formats (e.g., OpenAI's JSON, Deepseek's XML, Qwen's Hermes) to maximize model capabilities.
- **Maintainability and Extensibility:** Design the architecture to be modular, making it easy to add new providers or tool formats in the future.

## 2. Key Requirements

### 2.1. Provider Management

- **`/provider <name>`:** A new command-line argument to specify the active LLM provider (e.g., `openai`, `anthropic`, `google`).
- **Dynamic Model Listing:** When a provider is selected, the CLI should be able to query that provider's API to dynamically retrieve a list of available models.
- **Default Provider:** A mechanism to set and persist a default provider.

### 2.2. Model Selection

- **`/model <model_name>`:** Command to select a specific model from the currently active provider. This model name should be validated against the dynamically fetched list.

### 2.3. API Key Handling

- **`/key <api_key>`:** Command-line argument to directly provide an API key. This should take precedence over other key sources.
- **`/keyfile <path>`:** Command-line argument to specify a file path from which to read the API key (e.g., `~/.openai_key`). This should support common path conventions like `~`.
- **Environment Variables:** Support reading API keys from standard environment variables (e.g., `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).
- **Secure Storage:** Implement secure handling of API keys, avoiding plain-text storage in general configuration files.

### 2.4. Base URL Configuration

- **`/baseurl <url>`:** Command-line argument to specify a custom base URL for the selected provider's API endpoint. This will override default URLs for providers like OpenAI or Anthropic.

### 2.5. Tooling and Function Calling

- **`/toolformat <format_name>`:** A new command-line argument to specify the tool calling format to be used with the selected model (e.g., `openai`, `hermes`, `xml`).
- **Tool Definition Transformation (Outgoing):** The CLI must be able to convert its internal, standardized tool definitions into the specific format required by the chosen provider/model (e.g., OpenAI's JSON schema, Hermes, XML).
- **Tool Call Parsing (Incoming):** The CLI must be able to parse tool calls received from the LLM's response (which will be in the provider-specific format) back into a common internal representation for execution.
- **Dynamic Tool Listing:** The CLI should be able to dynamically retrieve the list of supported tools from the selected provider.

### 2.6. Streaming

- **Default Streaming:** All interactions with LLMs, including initial responses and subsequent responses after tool execution, must be streamed by default. This requires adapting the existing streaming logic to the new multi-provider architecture.

### 2.7. Provider-Specific Implementations

- **OpenAI:**
  - Utilize the official OpenAI SDK.
  - Support both standard Chat Completions API and the "Responses API" (for models like `o3`, `o4-mini`, `gpt-4o`).
  - Handle OpenAI's JSON tool format.
- **Anthropic:**
  - Utilize the official Anthropic SDK.
  - Handle Anthropic's tool format (if different from OpenAI's).
- **Extensibility for Others:** The architecture should allow for easy integration of new providers (e.g., Deepseek, Qwen) by implementing the common provider interface and adding specific tool formatters/parsers.

## 3. Overall Plan to Modify `gemini-cli`

### Phase 1: Architectural Foundation & Configuration

1.  **Define Core Interfaces (TypeScript):**
    - `IProvider`: Interface for all LLM providers, defining methods like `getModels()`, `generateCompletion()`, `generateChatCompletion()`, `getToolDefinitions()`.
    - `IModel`: Interface for LLM models, including properties like `id`, `name`, `provider`, `supportedToolFormats`.
    - `ITool`: Standardized internal representation of a tool.
    - `IMessage`: Standardized message format for conversation history.

2.  **Centralized Configuration Management:**
    - Create a `config.ts` module (e.g., `packages/cli/src/config/providerConfig.ts`) to manage provider configurations.
    - This module will handle loading configurations from:
      - Command-line arguments (`/provider`, `/key`, `/keyfile`, `/baseurl`, `/toolformat`).
      - Environment variables.
      - A new persistent configuration file (e.g., `~/.gemini-cli-config.json`).
    - Implement logic for precedence (CLI > Env Var > File).

3.  **Implement `ProviderManager`:**
    - Create a `ProviderManager` class (e.g., `packages/cli/src/providers/providerManager.ts`).
    - This manager will be responsible for:
      - Initializing and holding instances of different `IProvider` implementations.
      - Selecting the active provider based on user input.
      - Providing a unified interface to interact with the currently selected LLM.

### Phase 2: Provider Implementations & Tooling

1.  **Develop `OpenAIProvider`:**
    - Create `packages/cli/src/providers/openai/OpenAIProvider.ts`.
    - Implement `IProvider` interface.
    - Integrate the `openai` npm package.
    - Handle both standard `chat.completions` and the "Responses API" (for `o3`, `o4-mini`, `gpt-4o`) based on the model selected. This will involve conditional logic within the `generateCompletion`/`generateChatCompletion` methods.
    - Implement `getToolDefinitions()` to return OpenAI's JSON tool format.
    - Implement `getModels()` to dynamically fetch models from OpenAI.

2.  **Develop `AnthropicProvider`:**
    - Create `packages/cli/src/providers/anthropic/AnthropicProvider.ts`.
    - Implement `IProvider` interface.
    - Integrate the `@anthropic-ai/sdk` npm package.
    - Implement `getToolDefinitions()` and `getModels()` for Anthropic.

3.  **Implement `ToolFormatter`:**
    - Create `packages/cli/src/tools/toolFormatter.ts`.
    - This module will contain functions to:
      - `toProviderFormat(tools: ITool[], format: ToolFormat): any`: Convert internal `ITool` definitions to provider-specific formats (OpenAI JSON, Hermes, XML).
      - `fromProviderFormat(rawToolCall: any, format: ToolFormat): IToolCall`: Parse raw tool calls from provider responses into a standardized `IToolCall` internal representation.
    - This will be a central point for managing different tool schema transformations.

### Phase 3: CLI Integration & Streaming

1.  **Update CLI Command Handlers:**
    - Modify `packages/cli/src/index.ts` (or relevant command parsing logic) to recognize and handle new commands: `/provider`, `/model`, `/key`, `/keyfile`, `/baseurl`, `/toolformat`.
    - These commands will update the `ProviderManager`'s active configuration.

2.  **Refactor Main Interaction Loop:**
    - The core logic that sends user input to the LLM and processes responses will be updated to use the `ProviderManager`.
    - Instead of direct `openai` calls, it will call `providerManager.getActiveProvider().generateChatCompletion(...)`.

3.  **Implement Default Streaming:**
    - Ensure that the `generateChatCompletion` method in each `IProvider` implementation always returns a stream.
    - The main interaction loop will then iterate over this stream, printing content and collecting tool calls as they arrive.
    - The logic for `processToolCalls` will be adapted to work with the new `IToolCall` format and will trigger subsequent streamed calls to the LLM.

### Phase 4: Testing & Refinement

1.  **Unit Tests:** Write comprehensive unit tests for:
    - `ProviderManager` logic.
    - Each `IProvider` implementation (mocking API calls).
    - `ToolFormatter` transformations.
    - New CLI command parsing.
2.  **Integration Tests:** Develop end-to-end integration tests to verify the full flow with different providers, models, and tool formats.
3.  **Error Handling:** Enhance error handling for API failures, invalid configurations, and unsupported features.
4.  **Documentation:** Update user-facing documentation (e.g., `README.md`, `docs/cli/commands.md`) to reflect new commands and capabilities.

This plan provides a structured approach to implementing multi-provider support, ensuring modularity, extensibility, and adherence to the specified requirements.
