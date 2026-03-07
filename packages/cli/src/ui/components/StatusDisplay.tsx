/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { HookStatusDisplay } from './HookStatusDisplay.js';
import { ContextSummaryDisplay } from './ContextSummaryDisplay.js';
import type { ActiveHook } from '../types.js';
import type { IdeContext, MCPServerConfig } from '@vybestack/llxprt-code-core';

interface StatusDisplayProps {
  activeHooks: ActiveHook[];
  geminiMdFileCount?: number;
  contextFileNames?: string[];
  mcpServers?: Record<string, MCPServerConfig>;
  blockedMcpServers?: Array<{ name: string; extensionName: string }>;
  ideContext?: IdeContext;
  skillCount?: number;
}

/**
 * Component that coordinates status display priorities:
 * 1. Hook status (highest priority)
 * 2. Context summary
 * 
 * When hooks are executing, only the hook status is shown.
 * When no hooks are executing, the context summary is shown.
 */
export const StatusDisplay: React.FC<StatusDisplayProps> = ({
  activeHooks,
  geminiMdFileCount = 0,
  contextFileNames = [],
  mcpServers,
  blockedMcpServers,
  ideContext,
  skillCount = 0,
}) => {
  // Priority 1: Hook status
  if (activeHooks.length > 0) {
    return <HookStatusDisplay activeHooks={activeHooks} />;
  }

  // Priority 2: Context summary
  return (
    <ContextSummaryDisplay
      geminiMdFileCount={geminiMdFileCount}
      contextFileNames={contextFileNames}
      mcpServers={mcpServers}
      blockedMcpServers={blockedMcpServers}
      ideContext={ideContext}
      skillCount={skillCount}
    />
  );
};
