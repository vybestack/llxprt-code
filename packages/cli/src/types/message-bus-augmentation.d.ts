/**
 * Module augmentation to surface the extended ToolConfirmationResponse fields
 * while local development is ahead of the published core package.
 */
import type {
  ToolConfirmationOutcome,
  ToolConfirmationPayload,
} from '@vybestack/llxprt-code-core';

declare module '@vybestack/llxprt-code-core' {
  interface ToolConfirmationResponse {
    outcome?: ToolConfirmationOutcome;
    payload?: ToolConfirmationPayload;
  }
}
