# Subagent Configuration System Evolution

## Current State & Findings

LLxprt is transitioning towards a multiagentic architecture to enable more specialized and powerful workflows. The foundational logic for subagents already exists within the codebase.

*   **Core Subagent Logic:** The file `packages/core/src/core/subagent.ts` contains the essential TypeScript interfaces and classes (`SubAgentScope`, `ContextState`, etc.) that define how a subagent operates. This includes its prompt, model, execution constraints, tools, and output.
*   **Precedent for Configuration:** The system already has a robust configuration management system for model settings via the `/profile` slash command. This command allows saving, loading, listing, and deleting named profiles. These profiles are stored as JSON files in `~/.llxprt/profiles`.
*   **Existing Subagent Configs:** There is a designated directory `~/.llxprt/subagents/` for storing subagent configuration files. Upon inspection, example files like `default.json` and `joethecoder.json` were found. These files demonstrate the intended structure, which includes a `name`, a `profile` (referencing a model configuration profile), and a `systemPrompt`.
*   **Slash Command Infrastructure:** Slash commands are handled by `useSlashCommandProcessor` and defined within `packages/cli/src/ui/commands/`. New commands can be added by extending the `BuiltinCommandLoader`.

## Intent / What is to be Done

The goal is to expose the subagent capabilities directly to the user via a new, dedicated `/subagent` slash command, making the multiagentic features easily accessible and configurable from the command line.

### Primary Objectives

1.  **User Control:** Allow users to define, list, delete, and manually edit subagent configurations without requiring direct file system manipulation.
2.  **Define Agent Types:** Support creation of subagents via two modes:
    *   `auto`: The system will request a description from the currently active model to define the subagent's purpose and generate its system prompt.
    *   `manual`: The user provides an explicit system prompt string for the subagent.
3.  **Integration with Profiles:** Subagent configurations will reference existing model configuration *profiles* (managed by `/profile save/load`) to define their execution environment (model, parameters, etc.). This promotes reusability and consistency.
4.  **Persistent Storage:** Subagent definitions will be saved as individual JSON files in the `~/.llxprt/subagents/` directory, with the filename derived from the agent's name (e.g., `~/.llxprt/subagents/myHelperAgent.json`).

### Rationale

*   **Accessibility:** Providing a slash command makes the powerful subagent feature more discoverable and user-friendly than a hidden file-based system.
*   **Bootstrapping:** The `auto` mode lowers the barrier to entry, allowing users to quickly create purpose-built agents based on a simple description.
*   **Flexibility:** The `manual` mode retains full control for advanced users who want to craft precise prompts.
*   **Consistency:** Leveraging the existing `/profile` system for model configurations avoids duplicating effort and provides a single source of truth for provider settings.