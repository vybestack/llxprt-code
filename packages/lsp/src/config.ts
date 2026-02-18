/* @plan PLAN-20250212-LSP.P03 */

import type { LspServerConfig } from './types.js';

export interface LspServiceConfig {
  servers: LspServerConfig[];
}

export const defaultLspServiceConfig: LspServiceConfig = {
  servers: [],
};
