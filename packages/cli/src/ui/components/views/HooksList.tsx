/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import type { HookRegistryEntry } from '@vybestack/llxprt-code-core';

interface HooksListProps {
  hooks: readonly HookRegistryEntry[];
}

export const HooksList: React.FC<HooksListProps> = ({ hooks }) => {
  if (hooks.length === 0) {
    return <Text color={Colors.Foreground}>No hooks configured.</Text>;
  }

  // Group hooks by event name
  const byEvent = new Map<string, HookRegistryEntry[]>();
  for (const entry of hooks) {
    const eventName = entry.eventName;
    if (!byEvent.has(eventName)) {
      byEvent.set(eventName, []);
    }
    byEvent.get(eventName)!.push(entry);
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {Array.from(byEvent.entries()).map(([eventName, entries]) => (
        <Box key={eventName} flexDirection="column" marginBottom={1}>
          <Text color={Colors.AccentCyan} bold>
            {eventName}
          </Text>
          <Box flexDirection="column" paddingLeft={2}>
            {entries.map((entry, index) => {
              const commandName =
                entry.config.name ||
                entry.config.command ||
                `${entry.config.type} hook`;
              const statusColor = entry.enabled
                ? Colors.AccentGreen
                : Colors.DimComment;
              const statusText = entry.enabled ? 'enabled' : 'disabled';

              const details: string[] = [];
              details.push(entry.source);
              // Show command separately when name exists
              if (entry.config.name && entry.config.command) {
                details.push(`command: ${entry.config.command}`);
              }
              if (entry.matcher) {
                details.push(`matcher: ${entry.matcher}`);
              }
              if (entry.sequential) {
                details.push('sequential');
              }
              if (entry.config.timeout) {
                details.push(`timeout: ${entry.config.timeout}ms`);
              }

              return (
                <Box key={`${eventName}-${index}`} flexDirection="column">
                  <Box>
                    <Text color={Colors.AccentYellow}>{commandName}</Text>
                    <Text color={statusColor}> [{statusText}]</Text>
                  </Box>
                  {entry.config.description && (
                    <Text color={Colors.DimComment} italic>
                      {entry.config.description}
                    </Text>
                  )}
                  <Text color={Colors.DimComment}>{details.join(' • ')}</Text>
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={Colors.DimComment}>
          Tip: Use /hooks enable &lt;name&gt; or /hooks disable &lt;name&gt; to
          manage hooks
        </Text>
      </Box>
    </Box>
  );
};
