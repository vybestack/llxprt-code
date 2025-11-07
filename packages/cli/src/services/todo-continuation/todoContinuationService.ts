/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@vybestack/llxprt-code-core';
import type { Todo } from '@vybestack/llxprt-code-core';

/**
 * Test mock config interface for unit tests
 */
interface MockConfig {
  continuationEnabled?: boolean;
}

/**
 * Type guard to check if config has continuation enabled property (test mock)
 */
function isMockConfig(config: unknown): config is MockConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'continuationEnabled' in config
  );
}

/**
 * Configuration for generating continuation prompts
 */
export interface ContinuationPromptConfig {
  readonly taskDescription: string;
  readonly isYoloMode: boolean;
  readonly attemptCount?: number;
  readonly previousFailure?: string;
}

/**
 * Context information for evaluating continuation conditions
 */
export interface ContinuationContext {
  readonly todos: readonly Todo[];
  readonly hadToolCalls: boolean;
  readonly isResponding: boolean;
  readonly config: Config;
  readonly currentState: ContinuationState;
  readonly todoPaused?: boolean;
}

/**
 * Result of evaluating continuation conditions
 */
export interface ContinuationEvaluation {
  readonly shouldContinue: boolean;
  readonly reason: string;
  readonly activeTodo?: Todo;
  readonly conditions: ConditionSet;
}

/**
 * State tracking for continuation attempts
 */
export interface ContinuationState {
  isActive: boolean;
  attemptCount: number;
  taskDescription?: string;
  lastPromptTime?: Date;
}

/**
 * Set of conditions evaluated for continuation
 */
export interface ConditionSet {
  readonly hasActiveTodos: boolean;
  readonly noToolCallsMade: boolean;
  readonly continuationEnabled: boolean;
  readonly notCurrentlyContinuing: boolean;
  readonly withinAttemptLimits: boolean;
  readonly withinTimeConstraints: boolean;
  readonly todoPaused: boolean;
}

/**
 * Template structure for continuation prompts
 */
export interface ContinuationPromptTemplates {
  readonly standard: {
    readonly base: string;
    readonly retry: string;
  };
  readonly yolo: {
    readonly base: string;
    readonly retry: string;
    readonly urgent: string;
  };
}

/**
 * Service responsible for generating continuation prompts and managing continuation logic
 */
export class TodoContinuationService {
  private static readonly MAX_CONTINUATION_ATTEMPTS = 3;
  private static readonly MIN_CONTINUATION_INTERVAL_MS = 1000;
  // TODO: Add timeout functionality in the future
  // private static readonly CONTINUATION_TIMEOUT_MS = 30000;
  private static readonly MAX_TASK_DESCRIPTION_LENGTH = 200;

  /**
   * Generates a continuation prompt based on the provided configuration
   * @param config Configuration for prompt generation
   * @returns Formatted continuation prompt string
   */
  generateContinuationPrompt(config: ContinuationPromptConfig): string {
    if (!config) {
      throw new Error('Configuration is required');
    }

    const taskDescription = this.truncateTaskDescription(
      config.taskDescription || '',
    );

    if (config.isYoloMode) {
      return this.generateYoloModePrompt(
        taskDescription,
        config.attemptCount,
        config.previousFailure,
      );
    } else {
      return this.generateStandardPrompt(
        taskDescription,
        config.attemptCount,
        config.previousFailure,
      );
    }
  }

  /**
   * Evaluates whether continuation should occur based on current conditions
   * @param context Current continuation context
   * @returns Evaluation result with decision and reasoning
   */
  checkContinuationConditions(
    context: ContinuationContext,
  ): ContinuationEvaluation {
    if (!context) {
      throw new Error('Context is required');
    }

    const conditions = this.evaluateAllConditions(context);

    // Check each condition and provide specific feedback
    if (!conditions.continuationEnabled) {
      return {
        shouldContinue: false,
        reason: 'Todo continuation is disabled in ephemeral settings',
        conditions,
      };
    }

    if (!conditions.hasActiveTodos) {
      return {
        shouldContinue: false,
        reason: 'No active todos found (pending or in_progress)',
        conditions,
      };
    }

    if (context.todoPaused) {
      return {
        shouldContinue: false,
        reason: 'Todo continuation paused by todo_pause tool',
        conditions,
      };
    }

    if (!conditions.noToolCallsMade) {
      return {
        shouldContinue: false,
        reason: 'Tool calls were made during stream - no continuation needed',
        conditions,
      };
    }

    if (!conditions.notCurrentlyContinuing) {
      return {
        shouldContinue: false,
        reason: 'Already continuing task',
        conditions,
      };
    }

    if (!conditions.withinAttemptLimits) {
      return {
        shouldContinue: false,
        reason: 'Continuation attempt limit reached',
        conditions,
      };
    }

    if (!conditions.withinTimeConstraints) {
      return {
        shouldContinue: false,
        reason: 'Time constraint violated - too soon since last attempt',
        conditions,
      };
    }

    // Find the active todo to continue
    const activeTodo = this.findBestActiveTodo(context.todos);
    if (!activeTodo) {
      return {
        shouldContinue: false,
        reason: 'No suitable active todo found',
        conditions,
      };
    }

    // All conditions met
    return {
      shouldContinue: true,
      reason: 'Active todo found and all continuation conditions satisfied',
      conditions,
      activeTodo,
    };
  }

  /**
   * Formats a todo item's content into a task description
   * @param todo Todo item to format
   * @returns Formatted task description string
   */
  formatTaskDescription(todo: Todo): string {
    if (!todo || !todo.content) {
      return 'Complete task';
    }

    let description = todo.content.trim();

    if (description.length === 0) {
      return 'Complete task';
    }

    // Clean up formatting
    description = description.replace(/\s+/g, ' '); // Normalize whitespace
    description = description.replace(/^[-*+]\s*/, ''); // Remove list markers

    // Truncate if too long
    if (
      description.length > TodoContinuationService.MAX_TASK_DESCRIPTION_LENGTH
    ) {
      description =
        description.substring(
          0,
          TodoContinuationService.MAX_TASK_DESCRIPTION_LENGTH - 3,
        ) + '...';
    }

    return description;
  }

  /**
   * Checks if continuation should be allowed based on configuration and state
   * @param config Application configuration
   * @param state Current continuation state
   * @returns Whether continuation is allowed
   */
  shouldAllowContinuation(config: Config, state: ContinuationState): boolean {
    // Check ephemeral setting safely
    let continuationEnabled: unknown = true;
    if (config && typeof config.getEphemeralSetting === 'function') {
      continuationEnabled = config.getEphemeralSetting('todo-continuation');
    } else if (isMockConfig(config)) {
      continuationEnabled = config.continuationEnabled;
    }

    if (continuationEnabled === false) {
      return false;
    }

    // Check attempt limits
    if (
      state.attemptCount >= TodoContinuationService.MAX_CONTINUATION_ATTEMPTS
    ) {
      return false;
    }

    // Check time constraints
    if (state.lastPromptTime) {
      const timeSinceLastPrompt = Date.now() - state.lastPromptTime.getTime();
      if (
        timeSinceLastPrompt <
        TodoContinuationService.MIN_CONTINUATION_INTERVAL_MS
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Creates a new, empty continuation state
   * @returns Initial continuation state
   */
  createContinuationState(): ContinuationState {
    return {
      isActive: false,
      attemptCount: 0,
      taskDescription: undefined,
      lastPromptTime: undefined,
    };
  }

  // Additional method mentioned in requirements but not in original pseudocode
  /**
   * Checks whether continuation should occur based on settings, todos, and tool calls
   * @param settings Application settings/config
   * @param hasActiveTodos Whether there are active todos
   * @param hasToolCalls Whether tool calls were made
   * @returns Whether continuation should proceed
   */
  shouldContinue(
    settings: Config,
    hasActiveTodos: boolean,
    hasToolCalls: boolean,
  ): boolean {
    // Don't continue if tool calls were made
    if (hasToolCalls) {
      return false;
    }

    // Don't continue if no active todos
    if (!hasActiveTodos) {
      return false;
    }

    // Check if continuation is enabled safely
    let continuationEnabled: unknown = true;
    if (settings && typeof settings.getEphemeralSetting === 'function') {
      continuationEnabled = settings.getEphemeralSetting('todo-continuation');
    } else if (isMockConfig(settings)) {
      continuationEnabled = settings.continuationEnabled;
    }

    return continuationEnabled !== false;
  }

  // Additional method mentioned in requirements but not in original pseudocode
  /**
   * Formats a prompt for task description and YOLO mode
   * @param taskDescription Description of the task to continue
   * @param isYoloMode Whether YOLO mode is enabled
   * @returns Formatted prompt string
   */
  formatPrompt(taskDescription: string, isYoloMode: boolean): string {
    const truncatedDescription = this.truncateTaskDescription(taskDescription);

    if (isYoloMode) {
      return this.generateYoloModePrompt(truncatedDescription);
    } else {
      return this.generateStandardPrompt(truncatedDescription);
    }
  }

  /**
   * Private method to truncate task descriptions to acceptable length
   * @param description Task description to truncate
   * @returns Truncated description
   */
  private truncateTaskDescription(description: string): string {
    if (!description || description.length === 0) {
      return 'Complete task';
    }

    if (
      description.length <= TodoContinuationService.MAX_TASK_DESCRIPTION_LENGTH
    ) {
      return description;
    }

    // Try to truncate at word boundary
    const truncated = description.substring(
      0,
      TodoContinuationService.MAX_TASK_DESCRIPTION_LENGTH,
    );
    const lastSpaceIndex = truncated.lastIndexOf(' ');

    if (
      lastSpaceIndex >
      TodoContinuationService.MAX_TASK_DESCRIPTION_LENGTH * 0.8
    ) {
      // Good word boundary found
      return truncated.substring(0, lastSpaceIndex) + '...';
    } else {
      // No good word boundary, hard truncate
      return (
        truncated.substring(
          0,
          TodoContinuationService.MAX_TASK_DESCRIPTION_LENGTH - 3,
        ) + '...'
      );
    }
  }

  /**
   * Private method to generate standard continuation prompt
   * @param taskDescription Task description
   * @param attemptCount Optional attempt count
   * @returns Standard prompt string
   */
  private generateStandardPrompt(
    taskDescription: string,
    attemptCount?: number,
    previousFailure?: string,
  ): string {
    const basePrompt = [
      'You have an active task that needs completion:',
      `'${taskDescription}'`,
      '',
      "Continue working on this task. Call todo_pause('reason') ONLY if there's an error preventing you from continuing.",
      '',
      'Remember to:',
      '- Focus on the specific task described',
      '- Make concrete progress toward completion',
      '- Update the task status when appropriate',
      '- Use todo_pause() if you encounter blockers',
    ].join('\n');

    let result = basePrompt;

    if (previousFailure) {
      result += `\n\nPrevious failure information: ${previousFailure}`;
    }

    if (attemptCount && attemptCount > 1) {
      const retryNote = `\n\nNote: This is continuation attempt #${attemptCount}. Please make sure to take concrete action.`;
      result += retryNote;
    }

    return result;
  }

  /**
   * Private method to generate YOLO mode continuation prompt
   * @param taskDescription Task description
   * @param attemptCount Optional attempt count
   * @returns YOLO mode prompt string
   */
  private generateYoloModePrompt(
    taskDescription: string,
    attemptCount?: number,
    previousFailure?: string,
  ): string {
    const basePrompt = [
      'CONTINUE TASK IMMEDIATELY:',
      `'${taskDescription}'`,
      '',
      "You MUST continue working on this task. Call todo_pause('reason') ONLY if there's an error preventing you from proceeding.",
      '',
      'YOLO MODE - Take action now:',
      '- Execute the task without asking for confirmation',
      '- Make concrete progress immediately',
      '- Only pause if there are actual blocking errors',
      '- Update task status when complete',
    ].join('\n');

    let result = basePrompt;

    if (previousFailure) {
      result += `\n\nPrevious failure information: ${previousFailure}`;
    }

    if (attemptCount && attemptCount > 1) {
      const urgentRetry = `\n\nATTEMPT #${attemptCount} - YOU MUST TAKE ACTION NOW. No more analysis, proceed with execution.`;
      result += urgentRetry;
    }

    return result;
  }

  /**
   * Private method to evaluate all continuation conditions
   * @param context Continuation context
   * @returns Evaluated condition set
   */
  private evaluateAllConditions(context: ContinuationContext): ConditionSet {
    // Safely get ephemeral setting with fallback
    let continuationSetting: unknown = true;
    if (
      context.config &&
      typeof context.config.getEphemeralSetting === 'function'
    ) {
      continuationSetting =
        context.config.getEphemeralSetting('todo-continuation');
    } else if (isMockConfig(context.config)) {
      // Support test mock structure
      continuationSetting = context.config.continuationEnabled;
    }

    const hasActiveTodos = this.hasAnyActiveTodos(context.todos);
    const todoPaused = context.todoPaused === true;
    const hadBlockingToolCalls =
      context.hadToolCalls && (todoPaused || !hasActiveTodos);

    return {
      hasActiveTodos,
      noToolCallsMade: !hadBlockingToolCalls,
      continuationEnabled: continuationSetting !== false,
      notCurrentlyContinuing: !context.currentState.isActive,
      withinAttemptLimits:
        context.currentState.attemptCount <
        TodoContinuationService.MAX_CONTINUATION_ATTEMPTS,
      withinTimeConstraints: this.checkTimeConstraints(
        context.currentState.lastPromptTime,
      ),
      todoPaused,
    };
  }

  /**
   * Private method to check if there are any active todos
   * @param todos Array of todos to check
   * @returns Whether active todos exist
   */
  private hasAnyActiveTodos(todos: readonly Todo[]): boolean {
    return todos.some(
      (todo) => todo.status === 'pending' || todo.status === 'in_progress',
    );
  }

  /**
   * Private method to find the best active todo to continue
   * @param todos Array of todos to search
   * @returns Best active todo or undefined
   */
  private findBestActiveTodo(todos: readonly Todo[]): Todo | undefined {
    // Priority 1: Find in_progress todos (should be max 1)
    const inProgressTodos = todos.filter(
      (todo) => todo.status === 'in_progress',
    );
    if (inProgressTodos.length > 0) {
      return inProgressTodos[0];
    }

    // Priority 2: Find pending todos, prioritize by priority
    const pendingTodos = todos.filter((todo) => todo.status === 'pending');
    if (pendingTodos.length > 0) {
      // Sort by priority: high > medium > low
      const priorityOrder: Record<string, number> = {
        high: 3,
        medium: 2,
        low: 1,
      };
      pendingTodos.sort((a, b) => {
        const aPriority = priorityOrder[a.priority || 'medium'] || 2;
        const bPriority = priorityOrder[b.priority || 'medium'] || 2;
        return bPriority - aPriority; // Descending order (high to low)
      });
      return pendingTodos[0];
    }

    return undefined;
  }

  /**
   * Private method to check time constraints for continuation
   * @param lastPromptTime Time of last continuation prompt
   * @returns Whether time constraints are satisfied
   */
  private checkTimeConstraints(lastPromptTime?: Date): boolean {
    if (!lastPromptTime) {
      return true; // No previous attempt, allowed
    }

    const timeSinceLastPrompt = Date.now() - lastPromptTime.getTime();
    return (
      timeSinceLastPrompt >=
      TodoContinuationService.MIN_CONTINUATION_INTERVAL_MS
    );
  }
}

/**
 * Factory function to create a new TodoContinuationService instance
 * @returns New service instance
 */
export function createTodoContinuationService(): TodoContinuationService {
  return new TodoContinuationService();
}
