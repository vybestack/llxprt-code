/**
 * Boundary validation helper for settings-defined subagent definitions.
 *
 * The `subagents.definitions` setting originates from user-authored
 * settings.json, so it must be validated at the boundary before use.
 */

/**
 * The shape of a single settings-defined subagent definition as written
 * by users in settings.json.
 */
export interface SubagentDefinition {
  profile: string;
  systemPrompt: string;
}

/**
 * Parses and validates the `subagents.definitions` value from the global
 * settings record.
 *
 * @returns The validated definitions map, or `undefined` if the setting is
 *   absent or does not match the expected shape.
 */
export function parseSettingsSubagentDefinitions(
  allSettings: Record<string, unknown>,
): Record<string, SubagentDefinition> | undefined {
  const subagentsSettings = allSettings['subagents'];
  if (!isRecord(subagentsSettings)) {
    return undefined;
  }
  const definitions = subagentsSettings['definitions'];
  if (!isRecord(definitions)) {
    return undefined;
  }

  const result: Record<string, SubagentDefinition> = {};
  for (const [name, def] of Object.entries(definitions)) {
    if (
      isRecord(def) &&
      typeof def['profile'] === 'string' &&
      typeof def['systemPrompt'] === 'string'
    ) {
      result[name] = {
        profile: def['profile'],
        systemPrompt: def['systemPrompt'],
      };
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
