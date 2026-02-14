/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  McpClient,
  ExtensionEvents,
  ExtensionsStartingEvent,
  ExtensionsStoppingEvent,
} from '@vybestack/llxprt-code-core';
import { EventEmitter } from 'node:events';

export enum AppEvent {
  OpenDebugConsole = 'open-debug-console',
  OauthDisplayMessage = 'oauth-display-message',
  Flicker = 'flicker',
  McpClientUpdate = 'mcp-client-update',
  McpServersDiscoveryStart = 'mcp-servers-discovery-start',
  McpServerConnected = 'mcp-server-connected',
  McpServerError = 'mcp-server-error',
  LogError = 'log-error',
}

export interface FlickerEvent {
  contentHeight: number;
  terminalHeight: number;
  overflow: number;
}

export interface McpServersDiscoveryStartEvent {
  count: number;
}

export interface McpServerConnectedEvent {
  name: string;
}

export interface McpServerErrorEvent {
  name: string;
  error: string;
}

export interface AppEvents extends ExtensionEvents {
  [AppEvent.OpenDebugConsole]: never[];
  [AppEvent.OauthDisplayMessage]: string[];
  [AppEvent.Flicker]: FlickerEvent[];
  [AppEvent.McpClientUpdate]: Array<Map<string, McpClient> | never>;
  [AppEvent.McpServersDiscoveryStart]: McpServersDiscoveryStartEvent[];
  [AppEvent.McpServerConnected]: McpServerConnectedEvent[];
  [AppEvent.McpServerError]: McpServerErrorEvent[];
  [AppEvent.LogError]: [message: string, error?: Error];
  extensionsStarting: ExtensionsStartingEvent[];
  extensionsStopping: ExtensionsStoppingEvent[];
}

export const appEvents = new EventEmitter<AppEvents>();
