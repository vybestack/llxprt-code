import {
  PolicyDecision,
  ApprovalMode,
  type PolicyEngineConfig,
  type PolicyRule,
} from './types.js';
import { stableStringify } from './stable-stringify.js';
import {
  SHELL_TOOL_NAMES,
  splitCommands,
  hasRedirection,
} from './utils/shell-utils.js';

const cloneRule = (rule: PolicyRule): PolicyRule => ({
  ...rule,
  modes: rule.modes ? [...rule.modes] : undefined,
});

const compareRulePriority = (a: PolicyRule, b: PolicyRule): number =>
  (b.priority ?? 0) - (a.priority ?? 0);

/**
 * PolicyEngine evaluates tool execution requests against configured rules.
 * Rules are matched in priority order, with the highest priority rule winning.
 *
 * Internally, rules are kept in a single sorted base list. Mode-specific
 * behavior is expressed declaratively via the `modes` field on individual
 * rules, which is evaluated dynamically at evaluate() time against
 * `currentMode`. `currentMode` is updated atomically via `setApprovalMode()`,
 * which is the sole mechanism for mode transitions — no rules are added or
 * removed on transition, only the mode filter changes.
 */
export class PolicyEngine {
  private readonly baseRules: PolicyRule[];
  private readonly defaultDecision: PolicyDecision;
  private readonly nonInteractive: boolean;
  private currentMode: ApprovalMode;

  constructor(config?: PolicyEngineConfig) {
    this.baseRules = config?.rules ? config.rules.map(cloneRule) : [];
    this.defaultDecision = config?.defaultDecision ?? PolicyDecision.ASK_USER;
    this.nonInteractive = config?.nonInteractive ?? false;
    this.currentMode = config?.approvalMode ?? ApprovalMode.DEFAULT;

    // Sort base rules by priority (highest first)
    this.baseRules.sort(compareRulePriority);
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
    if (subCommands.length === 0 && command.trim().length > 0) {
      return this.nonInteractive
        ? PolicyDecision.DENY
        : PolicyDecision.ASK_USER;
    }

    // Compound command: recursively validate each sub-command
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
    // Filter out the original command to prevent infinite recursion
    const subCommandsToEvaluate = subCommands
      .map((rawSubCmd) => rawSubCmd.trim())
      .filter((subCmd) => subCmd !== command);

    let aggregateDecision = PolicyDecision.ALLOW;
    for (const subCmd of subCommandsToEvaluate) {
      // Preserve dir_path from original args
      const subResult = this.evaluate(
        toolName,
        { ...args, command: subCmd },
        serverName,
      );

      if (subResult === PolicyDecision.DENY) {
        // Fail fast: DENY overrides everything
        return PolicyDecision.DENY;
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

    return this.baseRules.find((rule) => {
      // Check tool name match
      const toolMatches = !rule.toolName || rule.toolName === toolName;
      if (!toolMatches) {
        return false;
      }

      // Check mode applicability: rules with `modes` only match when the
      // engine's current approval mode is in the list
      if (
        rule.modes &&
        rule.modes.length > 0 &&
        !rule.modes.includes(this.currentMode)
      ) {
        return false;
      }

      // Check args pattern match
      return !rule.argsPattern || rule.argsPattern.test(argsString);
    });
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
    return this.baseRules.map(cloneRule);
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
    this.baseRules.push(cloneRule(rule));
    this.baseRules.sort(compareRulePriority);
  }

  /**
   * Updates the current approval mode.
   *
   * Mode-specific rules (those carrying a `modes` filter) are evaluated
   * dynamically at evaluate() time against this mode — they are not loaded
   * or unloaded. Because evaluation reads the current mode synchronously,
   * the new mode applies to subsequent rule matches in the same process.
   *
   * @param mode - The new approval mode
   */
  setApprovalMode(mode: ApprovalMode): void {
    this.currentMode = mode;
  }
}
