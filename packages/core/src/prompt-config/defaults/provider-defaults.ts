/**
 * Provider and model-specific default prompts
 * These constants contain the default content for provider/model overrides
 */

export const PROVIDER_DEFAULTS: Record<string, string> = {
  'providers/gemini/models/gemini-1-5-flash/core.md': `IMPORTANT: You MUST use the provided tools when appropriate. For example:
- When asked to list files or directories, use the 'Ls' tool
- When asked to read file contents, use the 'ReadFile' tool
- When asked to search for patterns in files, use the 'Grep' tool
- When asked to find files by name, use the 'Glob' tool
- When asked to create files, use the 'WriteFile' tool
- When asked to modify files, use the 'Edit' tool
- When asked to run commands, use the 'Shell' tool
Do not describe what you would do - actually execute the tool calls.`,
  'providers/gemini/models/gemini-2-5-flash/core.md': `IMPORTANT: You MUST use the provided tools when appropriate. For example:
- When asked to list files or directories, use the 'Ls' tool
- When asked to read file contents, use the 'ReadFile' tool
- When asked to search for patterns in files, use the 'Grep' tool
- When asked to find files by name, use the 'Glob' tool
- When asked to create files, use the 'WriteFile' tool
- When asked to modify files, use the 'Edit' tool
- When asked to run commands, use the 'Shell' tool
Do not describe what you would do - actually execute the tool calls.`,
  // Future provider-specific defaults can be added here
};
