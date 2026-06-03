/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import type { AnyDeclarativeTool } from '@vybestack/llxprt-code-core';
import { Colors } from '../colors.js';
import { useKeypress } from '../hooks/useKeypress.js';

interface ToolsDialogProps {
  tools: AnyDeclarativeTool[];
  action: 'enable' | 'disable';
  disabledTools: string[];
  onSelect: (toolName: string) => void;
  onClose: () => void;
}

const EmptyToolsMessage: React.FC<{ action: 'enable' | 'disable' }> = ({
  action,
}) => (
  <Box flexDirection="column" paddingX={2} paddingY={1}>
    <Text color={Colors.AccentYellow}>
      {action === 'disable'
        ? 'All tools are already disabled.'
        : 'No tools are currently disabled.'}
    </Text>
    <Box marginTop={1}>
      <Text color={Colors.DimComment}>Press ESC to return</Text>
    </Box>
  </Box>
);

const SelectedToolInfo: React.FC<{
  selectedTool: AnyDeclarativeTool | undefined;
}> = ({ selectedTool }) => {
  if (selectedTool == null) return null;
  return (
    <Box marginTop={1}>
      <Text color={Colors.DimComment}>Tool name: {selectedTool.name}</Text>
    </Box>
  );
};

export const ToolsDialog: React.FC<ToolsDialogProps> = ({
  tools,
  action,
  disabledTools,
  onSelect,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const availableTools = tools.filter((tool) => {
    if (action === 'disable') {
      return !disabledTools.includes(tool.name);
    }
    return disabledTools.includes(tool.name);
  });

  const items = availableTools.map((tool) => ({
    key: tool.name,
    label: tool.displayName,
    value: tool.name,
  }));

  const handleSelect = useCallback(
    (value: string) => {
      onSelect(value);
    },
    [onSelect],
  );

  const handleHighlight = useCallback(
    (value: string) => {
      const index = items.findIndex((item) => item.value === value);
      if (index >= 0) {
        setSelectedIndex(index);
      }
    },
    [items],
  );

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onClose();
      }
    },
    { isActive: true },
  );

  if (availableTools.length === 0) {
    return <EmptyToolsMessage action={action} />;
  }

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={Colors.AccentBlue}>
          Select a tool to {action}:
        </Text>
      </Box>
      <RadioButtonSelect
        items={items}
        onSelect={handleSelect}
        onHighlight={handleHighlight}
        isFocused={true}
        initialIndex={selectedIndex}
      />
      <SelectedToolInfo selectedTool={availableTools[selectedIndex]} />
      <Box marginTop={1}>
        <Text color={Colors.DimComment}>
          Press ENTER to {action} • ESC to cancel
        </Text>
      </Box>
    </Box>
  );
};
