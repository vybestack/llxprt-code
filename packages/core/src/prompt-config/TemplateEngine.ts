import path from 'node:path';
import { CORE_DEFAULTS } from './defaults/core-defaults.js';
import {
  type TemplateVariables,
  type TemplateProcessingOptions,
  type PromptContext,
  type PromptEnvironment,
} from './types.js';
import { debugLogger } from '../utils/debugLogger.js';

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
    content: string,
    variables: TemplateVariables,
    options?: TemplateProcessingOptions,
  ): string {
    // Step 1: Validate inputs
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Prompt template user data.
    if (content === null || content === undefined) {
      return '';
    }

    if (typeof content !== 'string') {
      return content;
    }

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Prompt template user data.
    const vars = variables ?? {};

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
    vars: TemplateVariables,
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
    context: PromptContext,
    currentTool: string | null = null,
  ): TemplateVariables {
    // Validate context - return minimal valid object if no context
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Prompt template user data.
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

    // Add environment variables
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Prompt template user data.
    if (context.environment !== undefined && context.environment !== null) {
      this.addEnvironmentVariables(variables, context.environment);
    }

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
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: workspaceName is optional string, empty string should fall through to basename
      env.workspaceName ||
      (env.workingDirectory ? path.basename(env.workingDirectory) : '');
    if (workspaceName) {
      variables['WORKSPACE_NAME'] = workspaceName;
    } else {
      variables['WORKSPACE_NAME'] = 'unknown';
    }

    const workspaceRoot =
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: workspaceRoot is optional string, empty string should fall through */
      env.workspaceRoot || env.workingDirectory;
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    if (workspaceRoot) {
      variables['WORKSPACE_ROOT'] = workspaceRoot;
    } else {
      variables['WORKSPACE_ROOT'] = 'unknown';
    }

    const workspaceDirectories =
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: workspaceDirectories is optional string[], empty array should fall through */
      env.workspaceDirectories ||
      (env.workingDirectory ? [env.workingDirectory] : []);
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Prompt template user data.
      context.environment?.sessionStartedAt &&
      context.environment.sessionStartedAt.trim() !== ''
        ? context.environment.sessionStartedAt
        : undefined;
    variables['SESSION_STARTED_AT'] =
      sessionStartedAt ?? variables['CURRENT_DATETIME'];
    variables['PLATFORM'] = process.platform;
  }

  /** Add subagent delegation and async subagent guidance variables */
  private addSubagentVariables(
    variables: TemplateVariables,
    context: PromptContext,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Prompt template user data.
    const enabledTools = context.enabledTools ?? [];
    const hasTaskTool =
      enabledTools.includes('Task') || enabledTools.includes('task');
    const hasListSubagentsTool =
      enabledTools.includes('ListSubagents') ||
      enabledTools.includes('list_subagents');
    const includeSubagentDelegation =
      context.includeSubagentDelegation === true &&
      hasTaskTool &&
      hasListSubagentsTool;

    if (includeSubagentDelegation) {
      try {
        variables['SUBAGENT_DELEGATION'] = this.loadSubagentDelegationContent();
      } catch {
        variables['SUBAGENT_DELEGATION'] = '';
      }
    } else {
      variables['SUBAGENT_DELEGATION'] = '';
    }

    const globalAsyncEnabled = context.asyncSubagentsEnabled !== false;
    const profileAsyncEnabled = context.profileAsyncEnabled !== false;
    if (
      includeSubagentDelegation &&
      globalAsyncEnabled &&
      profileAsyncEnabled
    ) {
      try {
        variables['ASYNC_SUBAGENT_GUIDANCE'] =
          this.loadAsyncSubagentGuidanceContent();
      } catch {
        variables['ASYNC_SUBAGENT_GUIDANCE'] = '';
      }
    } else {
      variables['ASYNC_SUBAGENT_GUIDANCE'] = '';
    }
  }

  /** Add interaction mode, label, confirm, and continue variables */
  private addInteractionModeVariables(
    variables: TemplateVariables,
    context: PromptContext,
  ): void {
    const interactionMode =
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: interactionMode is optional string, empty string should fall through to default */
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Prompt template user data.
      context.environment?.interactionMode || 'interactive';
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Prompt template user data.
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
