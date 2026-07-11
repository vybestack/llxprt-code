/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as crypto from 'node:crypto';
import type * as http from 'node:http';
import type { openBrowserSecurely } from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';

export interface MCPOAuthProviderDependencies {
  randomBytes?: typeof crypto.randomBytes;
  createHash?: typeof crypto.createHash;
  createServer?: typeof http.createServer;
  openBrowser?: typeof openBrowserSecurely;
}
