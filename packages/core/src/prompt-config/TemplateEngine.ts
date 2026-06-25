import path from 'node:path';
import {
  ApplyPatchTool,
  EditTool,
  GlobTool,
  GrepTool,
  LSTool,
  ReadFileTool,
  ReadManyFilesTool,
  ShellTool,
  WriteFileTool,
} from '@vybestack/llxprt-code-tools';
import { CORE_DEFAULTS } from './defaults/core-defaults.js';
import {
  type TemplateVariables,
  type TemplateProcessingOptions,
  type PromptContext,
  type PromptEnvironment,
} from './types.js';
import { debugLogger } from '../utils/debugLogger.js';

/**
 * Canonical tool-name template variables (issue #2109).
 *
 * Prompt templates reference workflow tools by class name (for example
 * `{{GrepTool.Name}}`). These must resolve to the canonical tool names the
 * model can actually call. Sourcing the values directly from each tool class'
 * `Name` constant keeps the prompt in sync with the tool registry and prevents
 * the names from drifting if a tool is renamed.
 */
const TOOL_NAME_VARIABLES: Readonly<Record<string, string>> = {
  'GrepTool.Name': GrepTool.Name,
  'GlobTool.Name': GlobTool.Name,
  'LSTool.Name': LSTool.Name,
  'ReadFileTool.Name': ReadFileTool.Name,
  'ReadManyFilesTool.Name': ReadManyFilesTool.Name,
  'EditTool.Name': EditTool.Name,
  'WriteFileTool.Name': WriteFileTool.Name,
  'ShellTool.Name': ShellTool.Name,
  'ApplyPatchTool.Name': ApplyPatchTool.Name,
};

/**
 * TemplateEngine - Handles variable substitution in prompt templates
 *
 * Implements REQ-004: Template Processing requirements
 * - Supports {{VARIABLE_NAME}} syntax
 * - Substitutes TOOL_NAME, MODEL, and PROVIDER variables
 * - Handles malformed templates gracefully
 * - Logs substitutions when DEBUG=1 (REQ-010.4)
 */
export class TemplateEngine {
  /**
   * Process a template string with variable substitution
   * @param content Template content with {{variables}}
   * @param variables Map of variable names to values
   * @param options Optional processing configuration
   * @returns Processed content with variables substituted
   */
  processTemplate(
    content: string | null | undefined,
    variables: TemplateVariables | null | undefined,
    options?: TemplateProcessingOptions,
  ): string {
    // Step 1: Validate inputs - public API boundary may receive null/undefined
    if (content === null || content === undefined) {
      return '';
    }

    const vars: Record<string, unknown> = variables ?? {};

    // Step 2: Initialize processing state
    let result = '';
    let currentPosition = 0;
    const contentLength = content.length;

    // Step 3: Process template using a loop with single exit condition
    let processing = true;
    while (processing && currentPosition < contentLength) {
      // Find position of next "{{"
      const openBracketPos = content.indexOf('{{', currentPosition);

      if (openBracketPos === -1) {
        // No more variables, append rest and finish
        result += content.substring(currentPosition);
        processing = false;
      } else {
        // Append content before "{{"
        result += content.substring(currentPosition, openBracketPos);

        // Find position of next "}}"
        const closeBracketPos = content.indexOf('}}', openBracketPos + 2);

        if (closeBracketPos === -1) {
          // No closing brackets, append rest and finish
          result += content.substring(openBracketPos);
          processing = false;
        } else {
          // Extract variable name and trim whitespace
          const variableName = content
            .substring(openBracketPos + 2, closeBracketPos)
            .trim();

          // Process the variable substitution
          const processResult = this.processVariable(
            variableName,
            vars,
            content,
            openBracketPos,
            closeBracketPos,
            options,
          );
          result += processResult.text;
          currentPosition = processResult.nextPosition;
        }
      }
    }

    return result;
  }

  /**
   * Process a single variable in the template.
   * Handles empty names, nested brackets, and variable substitution.
   */
  private processVariable(
    variableName: string,
    vars: Record<string, unknown>,
    content: string,
    openBracketPos: number,
    closeBracketPos: number,
    options?: TemplateProcessingOptions,
  ): { text: string; nextPosition: number } {
    // Handle empty variable names - leave as-is
    if (variableName === '') {
      return {
        text: content.substring(openBracketPos, closeBracketPos + 2),
        nextPosition: closeBracketPos + 2,
      };
    }

    // Check if variable name contains brackets (nested variables not supported)
    if (variableName.includes('{{') || variableName.includes('}}')) {
      // Leave the whole pattern as-is and move to next character
      return {
        text: content.substring(openBracketPos, openBracketPos + 2),
        nextPosition: openBracketPos + 2,
      };
    }

    // Perform substitution
    if (variableName in vars) {
      const variableValue = vars[variableName];
      if (variableValue !== null && variableValue !== undefined) {
        const stringValue = String(variableValue);
        this.logSubstitution(variableName, stringValue, options);
        return { text: stringValue, nextPosition: closeBracketPos + 2 };
      }
      // null/undefined -> empty string
      return { text: '', nextPosition: closeBracketPos + 2 };
    }

    // Variable not found, substitute with empty string
    this.logSubstitution(variableName, '', options);
    return { text: '', nextPosition: closeBracketPos + 2 };
  }

  /**
   * Create template variables from runtime context
   * @param context Runtime context with provider, model, tools, and environment
   * @param currentTool Optional current tool being processed
   * @returns Map of variable names to values
   */
  createVariablesFromContext(
    context: PromptContext | null | undefined,
    currentTool: string | null = null,
  ): TemplateVariables {
    // Validate context - return minimal valid object if no context
    if (context === undefined || context === null) {
      return {
        MODEL: '',
        PROVIDER: '',
      };
    }

    // Initialize variables map with required fields
    const variables: TemplateVariables = {
      MODEL: context.model || '',
      PROVIDER: context.provider || '',
    };

    // Add tool-specific variable
    if (currentTool?.trim()) {
      variables['TOOL_NAME'] = currentTool;
    }

    // Add canonical tool-name variables (issue #2109)
    this.addToolNameVariables(variables);

    // Add environment variables
    this.addEnvironmentVariables(variables, context.environment);

    // Add derived variables
    this.addDerivedVariables(variables, context);

    // Add current date and time
    this.addDateTimeVariables(variables, context);

    // Add subagent delegation variables
    this.addSubagentVariables(variables, context);

    // Add interaction mode variables
    this.addInteractionModeVariables(variables, context);

    return variables;
  }

  /** Add boolean environment flags and sandbox type */
  private addEnvironmentVariables(
    variables: TemplateVariables,
    env: PromptEnvironment,
  ): void {
    variables['IS_GIT_REPO'] = env.isGitRepository ? 'true' : 'false';
    variables['IS_SANDBOXED'] = env.isSandboxed ? 'true' : 'false';
    variables['HAS_IDE'] = env.hasIdeCompanion ? 'true' : 'false';

    if (env.workingDirectory) {
      variables['WORKING_DIRECTORY'] = env.workingDirectory;
    }
    if (env.folderStructure) {
      variables['FOLDER_STRUCTURE'] = env.folderStructure;
    }

    if (env.sandboxType) {
      variables['SANDBOX_TYPE'] = env.sandboxType;
    } else {
      variables['SANDBOX_TYPE'] = env.isSandboxed ? 'unknown' : 'none';
    }

    this.addWorkspaceVariables(variables, env);
  }

  /** Add workspace name, root, and directories variables */
  private addWorkspaceVariables(
    variables: TemplateVariables,
    env: PromptEnvironment,
  ): void {
    const workspaceName =
      env.workspaceName ??
      (env.workingDirectory ? path.basename(env.workingDirectory) : '');
    if (workspaceName) {
      variables['WORKSPACE_NAME'] = workspaceName;
    } else {
      variables['WORKSPACE_NAME'] = 'unknown';
    }

    const workspaceRoot = env.workspaceRoot ?? env.workingDirectory;
    if (workspaceRoot) {
      variables['WORKSPACE_ROOT'] = workspaceRoot;
    } else {
      variables['WORKSPACE_ROOT'] = 'unknown';
    }

    const workspaceDirectories =
      env.workspaceDirectories ??
      (env.workingDirectory ? [env.workingDirectory] : []);
    if (workspaceDirectories.length > 0) {
      variables['WORKSPACE_DIRECTORIES'] = workspaceDirectories.join(', ');
    } else {
      variables['WORKSPACE_DIRECTORIES'] = 'unknown';
    }
  }

  /** Add provider/model derived variables */
  private addDerivedVariables(
    variables: TemplateVariables,
    context: PromptContext,
  ): void {
    if (context.provider) {
      variables['PROVIDER_UPPER'] = context.provider.toUpperCase();
    }
    if (context.model) {
      variables['MODEL_SAFE'] = context.model.replace(/[^a-zA-Z0-9]/g, '_');
    }
  }

  /** Add date, time, session, and platform variables */
  private addDateTimeVariables(
    variables: TemplateVariables,
    context: PromptContext,
  ): void {
    const now = new Date();
    variables['CURRENT_DATE'] = now.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    variables['CURRENT_TIME'] = now.toLocaleTimeString();
    variables['CURRENT_DATETIME'] = now.toLocaleString();
    const sessionStartedAt =
      context.environment.sessionStartedAt &&
      context.environment.sessionStartedAt.trim() !== ''
        ? context.environment.sessionStartedAt
        : undefined;
    variables['SESSION_STARTED_AT'] =
      sessionStartedAt ?? variables['CURRENT_DATETIME'];
    variables['PLATFORM'] = process.platform;
  }

  /** Add canonical tool-name variables (issue #2109) */
  private addToolNameVariables(variables: TemplateVariables): void {
    for (const [name, value] of Object.entries(TOOL_NAME_VARIABLES)) {
      variables[name] = value;
    }
  }

  /** Add subagent delegation and async subagent guidance variables */
  private addSubagentVariables(
    variables: TemplateVariables,
    context: PromptContext,
  ): void {
    const enabledTools = context.enabledTools;
    const hasTaskTool =
      enabledTools.includes('Task') || enabledTools.includes('task');
    const hasListSubagentsTool =
      enabledTools.includes('ListSubagents') ||
      enabledTools.includes('list_subagents');
    const includeSubagentDelegation =
      context.includeSubagentDelegation === true &&
      hasTaskTool &&
      hasListSubagentsTool;

    const globalAsyncEnabled = context.asyncSubagentsEnabled !== false;
    const profileAsyncEnabled = context.profileAsyncEnabled !== false;
    const includeAsyncGuidance =
      includeSubagentDelegation && globalAsyncEnabled && profileAsyncEnabled;

    let asyncGuidance = '';
    if (includeAsyncGuidance) {
      try {
        asyncGuidance = this.loadAsyncSubagentGuidanceContent();
      } catch {
        asyncGuidance = '';
      }
    }
    variables['ASYNC_SUBAGENT_GUIDANCE'] = asyncGuidance;

    if (includeSubagentDelegation) {
      try {
        // The subagent delegation partial embeds a nested
        // {{ASYNC_SUBAGENT_GUIDANCE}} token. processTemplate is single-pass and
        // does not re-resolve tokens introduced by a substitution, so the
        // partial is rendered here (with the variables resolved so far,
        // including ASYNC_SUBAGENT_GUIDANCE) before it is injected into the main
        // template (issue #2109).
        const delegation = this.loadSubagentDelegationContent();
        variables['SUBAGENT_DELEGATION'] = this.processTemplate(
          delegation,
          variables,
        );
      } catch {
        variables['SUBAGENT_DELEGATION'] = '';
      }
    } else {
      variables['SUBAGENT_DELEGATION'] = '';
    }
  }

  /** Add interaction mode, label, confirm, and continue variables */
  private addInteractionModeVariables(
    variables: TemplateVariables,
    context: PromptContext,
  ): void {
    const interactionMode =
      context.environment.interactionMode ?? 'interactive';
    variables['INTERACTION_MODE'] = interactionMode;

    this.addInteractionModeLabel(variables, interactionMode);
    this.addInteractiveConfirm(variables, interactionMode);
    this.addNonInteractiveContinue(variables, interactionMode);
  }

  private addInteractionModeLabel(
    variables: TemplateVariables,
    interactionMode: string,
  ): void {
    if (interactionMode === 'interactive') {
      variables['INTERACTION_MODE_LABEL'] = 'an interactive';
    } else if (interactionMode === 'non-interactive') {
      variables['INTERACTION_MODE_LABEL'] = 'a non-interactive';
    } else if (interactionMode === 'subagent') {
      variables['INTERACTION_MODE_LABEL'] = 'a subagent';
    }
  }

  private addInteractiveConfirm(
    variables: TemplateVariables,
    interactionMode: string,
  ): void {
    if (interactionMode === 'interactive') {
      variables['INTERACTIVE_CONFIRM'] =
        "- **Confirm Ambiguity/Expansion:** Do not take significant actions beyond the clear scope of the request without confirming with the user. If asked _how_ to do something, explain first, don't just do it.";
    } else {
      variables['INTERACTIVE_CONFIRM'] =
        '- **Handle Ambiguity:** Do not ask the user for clarification. Use your best judgment to interpret ambiguous requests and proceed with the most reasonable approach.';
    }
  }

  private addNonInteractiveContinue(
    variables: TemplateVariables,
    interactionMode: string,
  ): void {
    if (
      interactionMode === 'non-interactive' ||
      interactionMode === 'subagent'
    ) {
      variables['NON_INTERACTIVE_CONTINUE'] =
        '- **Continue the work:** Do your best to complete the task. Do not stop to ask the user for input or confirmation. If you encounter issues, work around them or document them and continue.';
    } else {
      variables['NON_INTERACTIVE_CONTINUE'] = '';
    }
  }

  /**
   * Load the subagent delegation content from the default file
   * @returns The content of subagent-delegation.md
   */
  private loadSubagentDelegationContent(): string {
    const content = CORE_DEFAULTS['subagent-delegation.md'];
    if (!content) {
      throw new Error(
        'Failed to load subagent-delegation.md from CORE_DEFAULTS',
      );
    }
    return content;
  }

  /**
   * Load the async subagent guidance content from the default file
   * @returns The content of async-subagent-guidance.md
   */
  private loadAsyncSubagentGuidanceContent(): string {
    const content = CORE_DEFAULTS['async-subagent-guidance.md'];
    if (!content) {
      throw new Error(
        'Failed to load async-subagent-guidance.md from CORE_DEFAULTS',
      );
    }
    return content;
  }

  /**
   * Log variable substitution for debugging (when DEBUG=1)
   * @param variable Variable name being substituted
   * @param value Value being substituted
   * @param options Processing options
   */
  private logSubstitution(
    variable: string,
    value: string,
    options?: TemplateProcessingOptions,
  ): void {
    // Check if debug is enabled via environment variable or options
    const debugEnabled = process.env.DEBUG === '1' || options?.debug === true;

    if (debugEnabled) {
      debugLogger.log(`Template substitution: ${variable} -> ${value}`);
    }
  }
}

// Export the class as default for convenience
export default TemplateEngine;
