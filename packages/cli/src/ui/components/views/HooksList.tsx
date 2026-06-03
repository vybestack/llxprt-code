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

const SecurityWarning: React.FC = () => (
  <Box
    flexDirection="column"
    borderStyle="round"
    borderColor={Colors.Warning}
    paddingX={1}
    marginBottom={1}
  >
    <Text color={Colors.Warning} bold>
      Security Warning:
    </Text>
    <Text color={Colors.Warning}>
      Hooks can execute arbitrary commands on your system. Only use hooks from
      sources you trust.
    </Text>
  </Box>
);

const buildHookDetails = (entry: HookRegistryEntry): string[] => {
  const details: string[] = [];
  details.push(entry.source);
  if (entry.config.name && entry.config.command) {
    details.push(`command: ${entry.config.command}`);
  }
  if (entry.matcher) {
    details.push(`matcher: ${entry.matcher}`);
  }
  if (entry.sequential === true) {
    details.push('sequential');
  }
  if (entry.config.timeout != null && entry.config.timeout > 0) {
    details.push(`timeout: ${entry.config.timeout}ms`);
  }
  return details;
};

interface HookEntryProps {
  entry: HookRegistryEntry;
  index: number;
  eventName: string;
}

const HookEntry: React.FC<HookEntryProps> = ({ entry, index, eventName }) => {
  const commandName =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing
    entry.config.name || entry.config.command || `${entry.config.type} hook`;
  const statusColor = entry.enabled ? Colors.AccentGreen : Colors.DimComment;
  const statusText = entry.enabled ? 'enabled' : 'disabled';
  const details = buildHookDetails(entry);

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
};

interface EventGroupProps {
  eventName: string;
  entries: HookRegistryEntry[];
}

const EventGroup: React.FC<EventGroupProps> = ({ eventName, entries }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Text color={Colors.AccentCyan} bold>
      {eventName}
    </Text>
    <Box flexDirection="column" paddingLeft={2}>
      {entries.map((entry, index) => (
        <HookEntry
          key={`${eventName}-${index}`}
          entry={entry}
          index={index}
          eventName={eventName}
        />
      ))}
    </Box>
  </Box>
);

const HooksTip: React.FC = () => (
  <Box marginTop={1}>
    <Text color={Colors.DimComment}>
      Tip: Use /hooks enable &lt;name&gt; or /hooks disable &lt;name&gt; to
      manage hooks
    </Text>
  </Box>
);

const groupHooksByEvent = (
  hooks: readonly HookRegistryEntry[],
): Map<string, HookRegistryEntry[]> => {
  const byEvent = new Map<string, HookRegistryEntry[]>();
  for (const entry of hooks) {
    const eventName = entry.eventName;
    if (!byEvent.has(eventName)) {
      byEvent.set(eventName, []);
    }
    byEvent.get(eventName)!.push(entry);
  }
  return byEvent;
};

export const HooksList: React.FC<HooksListProps> = ({ hooks }) => {
  if (hooks.length === 0) {
    return <Text color={Colors.Foreground}>No hooks configured.</Text>;
  }

  const byEvent = groupHooksByEvent(hooks);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <SecurityWarning />
      {Array.from(byEvent.entries()).map(([eventName, entries]) => (
        <EventGroup key={eventName} eventName={eventName} entries={entries} />
      ))}
      <HooksTip />
    </Box>
  );
};
