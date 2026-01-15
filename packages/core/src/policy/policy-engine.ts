import {
  PolicyDecision,
  type PolicyEngineConfig,
  type PolicyRule,
} from './types.js';
import { stableStringify } from './stable-stringify.js';

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
        // Server name spoofing detected - deny
        return PolicyDecision.DENY;
      }
    }

    // Find the highest priority matching rule
    const matchingRule = this.findMatchingRule(toolName, args);

    if (matchingRule) {
      const decision = matchingRule.decision;

      // In non-interactive mode, ASK_USER becomes DENY
      if (this.nonInteractive && decision === PolicyDecision.ASK_USER) {
        return PolicyDecision.DENY;
      }

      return decision;
    }

    // No matching rule - use default decision
    if (
      this.nonInteractive &&
      this.defaultDecision === PolicyDecision.ASK_USER
    ) {
      return PolicyDecision.DENY;
    }

    return this.defaultDecision;
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
