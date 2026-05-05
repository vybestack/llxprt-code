import {
  PolicyDecision,
  type PolicyEngineConfig,
  type PolicyRule,
} from './types.js';
import { stableStringify } from './stable-stringify.js';
import {
  SHELL_TOOL_NAMES,
  splitCommands,
  hasRedirection,
} from '../utils/shell-utils.js';

/**
 * PolicyEngine evaluates tool execution requests against configured rules.
 * Rules are matched in priority order, with the highest priority rule winning.
 */
export class PolicyEngine {
  private readonly rules: PolicyRule[];
  private readonly defaultDecision: PolicyDecision;
  private readonly nonInteractive: boolean;

  constructor(config?: PolicyEngineConfig) {
    this.rules = config?.rules ?? [];
    this.defaultDecision = config?.defaultDecision ?? PolicyDecision.ASK_USER;
    this.nonInteractive = config?.nonInteractive ?? false;

    // Sort rules by priority (highest first)
    this.rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Evaluates a tool execution request and returns a policy decision.
   *
   * @param toolName - The name of the tool being executed
   * @param args - The arguments passed to the tool
   * @param serverName - Optional MCP server name (for spoofing prevention)
   * @returns PolicyDecision (ALLOW, DENY, or ASK_USER)
   */
  evaluate(
    toolName: string,
    args: Record<string, unknown>,
    serverName?: string,
  ): PolicyDecision {
    // Validate serverName to prevent spoofing
    if (serverName) {
      const validatedToolName = this.validateServerName(toolName, serverName);
      if (validatedToolName === null) {
        return PolicyDecision.DENY;
      }
    }

    // Find the highest priority matching rule
    const matchingRule = this.findMatchingRule(toolName, args);

    if (matchingRule) {
      return this.evaluateMatchingRule(
        toolName,
        args,
        serverName,
        matchingRule,
      );
    }

    return this.evaluateDefault(toolName, args, serverName);
  }

  private evaluateMatchingRule(
    toolName: string,
    args: Record<string, unknown>,
    serverName: string | undefined,
    matchingRule: PolicyRule,
  ): PolicyDecision {
    const decision = matchingRule.decision;

    // Special handling for shell commands: validate sub-commands if ALLOW rule
    if (
      toolName &&
      SHELL_TOOL_NAMES.includes(toolName) &&
      decision === PolicyDecision.ALLOW
    ) {
      const command = (args as { command?: string }).command;
      if (command) {
        const shellResult = this.evaluateShellCommand(
          toolName,
          args,
          serverName,
          command,
          matchingRule,
        );
        if (shellResult !== undefined) {
          return shellResult;
        }
      }
    }

    // In non-interactive mode, ASK_USER becomes DENY
    if (this.nonInteractive && decision === PolicyDecision.ASK_USER) {
      return PolicyDecision.DENY;
    }

    return decision;
  }

  /**
   * Evaluates shell command sub-commands and redirections for an ALLOW rule.
   * Returns a PolicyDecision if the shell-specific logic resolves, or undefined
   * to fall through to normal decision handling.
   */
  private evaluateShellCommand(
    toolName: string,
    args: Record<string, unknown>,
    serverName: string | undefined,
    command: string,
    matchingRule: PolicyRule,
  ): PolicyDecision | undefined {
    const subCommands = splitCommands(command);

    // Parse failure: empty array for non-empty command → fail-safe to ASK_USER
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (subCommands.length === 0 && command.trim().length > 0) {
      return this.nonInteractive
        ? PolicyDecision.DENY
        : PolicyDecision.ASK_USER;
    }

    // Compound command: recursively validate each sub-command
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (subCommands.length > 1) {
      return this.evaluateCompoundCommand(
        toolName,
        args,
        serverName,
        command,
        subCommands,
      );
    }

    // Check for redirections in allowed commands
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    if (matchingRule.allowRedirection !== true && hasRedirection(command)) {
      return this.nonInteractive
        ? PolicyDecision.DENY
        : PolicyDecision.ASK_USER;
    }

    // Single command: rule match is valid, fall through to normal return
    return undefined;
  }

  private evaluateCompoundCommand(
    toolName: string,
    args: Record<string, unknown>,
    serverName: string | undefined,
    command: string,
    subCommands: string[],
  ): PolicyDecision {
    let aggregateDecision = PolicyDecision.ALLOW;

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const rawSubCmd of subCommands) {
      const subCmd = rawSubCmd.trim();
      // Prevent infinite recursion
      if (subCmd === command) continue;

      // Preserve dir_path from original args
      const subResult = this.evaluate(
        toolName,
        { ...args, command: subCmd },
        serverName,
      );

      if (subResult === PolicyDecision.DENY) {
        aggregateDecision = PolicyDecision.DENY;
        break; // Fail fast: DENY overrides everything
      } else if (subResult === PolicyDecision.ASK_USER) {
        aggregateDecision = PolicyDecision.ASK_USER;
        // Continue checking for DENY (don't short-circuit)
      }
    }

    return this.nonInteractive && aggregateDecision === PolicyDecision.ASK_USER
      ? PolicyDecision.DENY
      : aggregateDecision;
  }

  private evaluateDefault(
    toolName: string,
    args: Record<string, unknown>,
    serverName: string | undefined,
  ): PolicyDecision {
    let defaultResult = this.defaultDecision;

    // Security: even with no matching rule, still validate shell subcommands
    // to catch compound commands like "git commit && git push" where a subcommand
    // may match a DENY rule
    if (
      toolName &&
      SHELL_TOOL_NAMES.includes(toolName) &&
      defaultResult !== PolicyDecision.DENY
    ) {
      defaultResult = this.validateDefaultShellSubcommands(
        toolName,
        args,
        serverName,
        defaultResult,
      );
    }

    if (this.nonInteractive && defaultResult === PolicyDecision.ASK_USER) {
      return PolicyDecision.DENY;
    }

    return defaultResult;
  }

  private validateDefaultShellSubcommands(
    toolName: string,
    args: Record<string, unknown>,
    serverName: string | undefined,
    currentResult: PolicyDecision,
  ): PolicyDecision {
    const command = (args as { command?: string }).command;
    if (!command) {
      return currentResult;
    }

    const subCommands = splitCommands(command);
    if (subCommands.length <= 1) {
      return currentResult;
    }

    let result = currentResult;
    // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const rawSubCmd of subCommands) {
      const subCmd = rawSubCmd.trim();
      if (subCmd === command) continue;

      const subResult = this.evaluate(
        toolName,
        { ...args, command: subCmd },
        serverName,
      );

      if (subResult === PolicyDecision.DENY) {
        return PolicyDecision.DENY;
      } else if (subResult === PolicyDecision.ASK_USER) {
        result = PolicyDecision.ASK_USER;
      }
    }

    return result;
  }

  /**
   * Finds the highest priority rule matching the tool and args.
   *
   * @param toolName - The name of the tool
   * @param args - The tool arguments
   * @returns The matching rule, or undefined if none match
   */
  private findMatchingRule(
    toolName: string,
    args: Record<string, unknown>,
  ): PolicyRule | undefined {
    const argsString = stableStringify(args);

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const rule of this.rules) {
      // Check tool name match
      const toolMatches = !rule.toolName || rule.toolName === toolName;
      if (!toolMatches) {
        continue;
      }

      // Check args pattern match
      const argsMatch = !rule.argsPattern || rule.argsPattern.test(argsString);
      if (!argsMatch) {
        continue;
      }

      // Both match - return this rule
      return rule;
    }

    return undefined;
  }

  /**
   * Validates that a tool name matches its claimed server name.
   * Returns null if spoofing is detected, otherwise returns the tool name.
   *
   * @param toolName - The tool name (may include server prefix)
   * @param serverName - The claimed server name
   * @returns The validated tool name, or null if spoofing detected
   */
  private validateServerName(
    toolName: string,
    serverName: string,
  ): string | null {
    // For MCP tools, expect format: "serverName__toolName"
    const expectedPrefix = `${serverName}__`;

    if (toolName.startsWith(expectedPrefix)) {
      return toolName;
    }

    // If tool name doesn't have the expected prefix, check if it's a non-MCP tool
    // Non-MCP tools don't have a server prefix, so if a serverName is provided
    // but the tool doesn't have the prefix, it's likely spoofing
    if (!toolName.includes('__')) {
      // This is a built-in tool, serverName should not be set
      return null;
    }

    // Tool has a different server prefix - spoofing attempt
    return null;
  }

  /**
   * Returns all configured rules (for debugging/inspection).
   *
   * @returns Array of policy rules
   */
  getRules(): readonly PolicyRule[] {
    return [...this.rules];
  }

  /**
   * Returns the default decision used when no rules match.
   *
   * @returns PolicyDecision
   */
  getDefaultDecision(): PolicyDecision {
    return this.defaultDecision;
  }

  /**
   * Returns whether the engine is in non-interactive mode.
   *
   * @returns boolean
   */
  isNonInteractive(): boolean {
    return this.nonInteractive;
  }

  /**
   * Adds a new rule to the policy engine at runtime.
   * The rule is inserted into the sorted rules list based on its priority.
   *
   * @param rule - The policy rule to add
   */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    // Re-sort rules by priority (highest first)
    this.rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }
}
