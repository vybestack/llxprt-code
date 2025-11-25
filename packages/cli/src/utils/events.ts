/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'events';

export enum AppEvent {
  OpenDebugConsole = 'open-debug-console',
  LogError = 'log-error',
  OauthDisplayMessage = 'oauth-display-message',
  Flicker = 'flicker',
  SelectionWarning = 'selection-warning',
  McpClientUpdate = 'mcp-client-update',
}

export const appEvents = new EventEmitter();
