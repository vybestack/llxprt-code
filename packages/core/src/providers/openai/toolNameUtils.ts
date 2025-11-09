/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Utility functions for handling tool names in streaming responses
 * Particularly important for qwen models that may send tool names in separate chunks
 */

import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:providers:openai:toolNameUtils');

/**
 * Enhances tool name extraction for qwen and other providers that may send tool names in chunks
 * @param currentName Current accumulated tool name
 * @param newName New name chunk from streaming
 * @param isComplete Whether the stream for this tool call is complete
 * @returns Enhanced tool name with fallback strategies
 */
export function enhanceToolNameExtraction(
  currentName: string,
  newName: string | undefined,
  isComplete: boolean,
): { name: string; isFallback: boolean } {
  // If we already have a valid name, keep it
  if (currentName && currentName.trim()) {
    return { name: currentName.trim(), isFallback: false };
  }

  // Try to use the new name chunk
  if (newName && newName.trim()) {
    return { name: newName.trim(), isFallback: false };
  }

  // If stream is complete and we still don't have a name, this is an issue
  if (isComplete && !currentName && !newName) {
    logger.error(
      () => 'Tool name extraction failed - no name found in streaming chunks',
      {
        currentName,
        newName,
        isComplete,
      },
    );

    // Use a more specific fallback that indicates the real issue
    return {
      name: 'missing_tool_name_check_stream_chunks',
      isFallback: true,
    };
  }

  // Still streaming, return empty for now
  return { name: currentName || '', isFallback: false };
}

/**
 * Validates a tool name for consistency with expected tool names
 * @param toolName The tool name to validate
 * @param availableToolNames Array of available tool names
 * @returns Validated tool name or null if invalid
 */
export function validateToolName(
  toolName: string,
  availableToolNames: string[] = [],
): { isValid: boolean; correctedName?: string; reason?: string } {
  if (!toolName || !toolName.trim()) {
    return {
      isValid: false,
      reason: 'Tool name is empty or missing',
    };
  }

  const trimmedName = toolName.trim();

  // Direct match
  if (availableToolNames.includes(trimmedName)) {
    return { isValid: true, correctedName: trimmedName };
  }

  // Case-insensitive match
  const caseInsensitiveMatch = availableToolNames.find(
    (availableName) =>
      availableName.toLowerCase() === trimmedName.toLowerCase(),
  );
  if (caseInsensitiveMatch) {
    logger.debug(
      () =>
        `Tool name case correction: '${trimmedName}' -> '${caseInsensitiveMatch}'`,
      {
        originalName: trimmedName,
        correctedName: caseInsensitiveMatch,
      },
    );
    return {
      isValid: true,
      correctedName: caseInsensitiveMatch,
      reason: 'Case-insensitive match applied',
    };
  }

  // Partial match (for names that might be truncated)
  const partialMatch = availableToolNames.find(
    (availableName) =>
      availableName.startsWith(trimmedName) ||
      trimmedName.startsWith(availableName),
  );
  if (
    partialMatch &&
    (availableToolNames.length === 1 || trimmedName.length > 3)
  ) {
    logger.debug(
      () =>
        `Tool name partial match correction: '${trimmedName}' -> '${partialMatch}'`,
      {
        originalName: trimmedName,
        correctedName: partialMatch,
      },
    );
    return {
      isValid: true,
      correctedName: partialMatch,
      reason: 'Partial match applied',
    };
  }

  // Name is not found in available tools
  return {
    isValid: false,
    reason: `Tool name '${trimmedName}' not found in available tools: [${availableToolNames.join(', ')}]`,
  };
}

/**
 * Processes final tool name validation with comprehensive fallback strategy
 * @param toolName The tool name to process
 * @param availableToolNames Array of available tool names
 * @returns Final validated tool name
 */
export function processFinalToolName(
  toolName: string,
  availableToolNames: string[] = [],
): string {
  // First, validate against available tools
  const validation = validateToolName(toolName, availableToolNames);

  if (validation.isValid && validation.correctedName) {
    return validation.correctedName;
  }

  // If validation failed, log the issue and return a more informative fallback
  logger.error(() => 'Tool name validation failed, using enhanced fallback', {
    originalName: toolName,
    availableToolNames,
    reason: validation.reason,
  });

  // Use a more descriptive fallback that includes debugging information
  const fallbackName =
    toolName && toolName.trim()
      ? `tool_name_not_found_${toolName.replace(/[^a-zA-Z0-9]/g, '_')}`
      : 'missing_tool_name';

  return fallbackName;
}

/**
 * Safely extracts tool name from streaming delta with comprehensive error handling
 * @param delta The streaming delta object
 * @param currentIndex Current tool call index
 * @param availableToolNames Array of available tool names
 * @returns Safe tool name extraction result
 */
export function safeExtractToolName(
  delta: Record<string, unknown>,
  currentIndex: number,
  availableToolNames: string[] = [],
): {
  name: string;
  hasName: boolean;
  isComplete: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];
  let hasName = false;
  let isComplete = false;

  // Extract name from various delta structures
  let extractedName = '';

  // Standard OpenAI format
  if (
    delta?.function &&
    typeof delta.function === 'object' &&
    'name' in delta.function
  ) {
    extractedName = String(delta.function.name);
    hasName = true;
  }

  // Alternative format (some providers use different structures)
  if (!extractedName && 'name' in delta) {
    extractedName = String(delta.name);
    hasName = true;
  }

  // Check if this is a completion signal
  if (
    delta?.finish_reason === 'tool_calls' ||
    (currentIndex >= 0 && delta?.index !== undefined)
  ) {
    isComplete = true;
  }

  // Validate the extracted name
  if (hasName) {
    const validation = validateToolName(extractedName, availableToolNames);

    if (!validation.isValid) {
      warnings.push(validation.reason || 'Unknown validation error');
      extractedName = processFinalToolName(extractedName, availableToolNames);
    } else if (
      validation.correctedName &&
      validation.correctedName !== extractedName
    ) {
      warnings.push(validation.reason || 'Name was corrected');
      extractedName = validation.correctedName;
    }
  }

  return {
    name: extractedName,
    hasName,
    isComplete,
    warnings,
  };
}
