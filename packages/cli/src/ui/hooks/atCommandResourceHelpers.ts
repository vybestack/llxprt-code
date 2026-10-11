/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_AGENT_ID,
  getErrorMessage,
  type ContentBlock,
  type DiscoveredMCPResource,
} from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import type {
  HistoryItemToolGroup,
  IndividualToolCallDisplay,
} from '../types.js';
import { ToolCallStatus } from '../types.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { AtCommandProcessResult } from './atCommandProcessorHelpers.js';

export type ReadMcpResource = (server: string, uri: string) => Promise<unknown>;

export interface ResourceReadParams {
  resourceAttachments: DiscoveredMCPResource[];
  processedQueryParts: ContentBlock[];
  addItem: UseHistoryManagerReturn['addItem'];
  userMessageTimestamp: number;
  readResource: ReadMcpResource;
}

type ResourceResponse = {
  contents?: Array<{
    text?: string;
    blob?: string;
    mimeType?: string;
    resource?: { text?: string; blob?: string; mimeType?: string };
  }>;
};

export async function processResourceAttachments({
  resourceAttachments,
  processedQueryParts,
  addItem,
  userMessageTimestamp,
  readResource,
}: ResourceReadParams): Promise<
  IndividualToolCallDisplay[] | AtCommandProcessResult
> {
  const resourceReadDisplays: IndividualToolCallDisplay[] = [];
  // Keep reads sequential so the first failure can stop processing and the
  // prompt parts stay in the same order as the user's resource mentions.
  for (const [index, resource] of resourceAttachments.entries()) {
    const uri = resource.uri;
    if (!uri) continue;
    const display = await readSingleResource(
      resource,
      uri,
      readResource,
      processedQueryParts,
      index,
    );
    resourceReadDisplays.push(display);
    if (display.status === ToolCallStatus.Error) {
      return handleResourceReadError(
        resourceReadDisplays,
        addItem,
        userMessageTimestamp,
      );
    }
  }
  return resourceReadDisplays;
}

async function readSingleResource(
  resource: DiscoveredMCPResource,
  uri: string,
  readResource: ReadMcpResource,
  processedQueryParts: ContentBlock[],
  index: number,
): Promise<IndividualToolCallDisplay> {
  try {
    const response = normalizeResourceResponse(
      await readResource(resource.serverName, uri),
    );
    const contentParts = convertResourceContentsToParts(response);
    if (contentParts.length === 0) {
      return buildErrorResourceDisplay(
        resource,
        uri,
        index,
        new Error('Resource response did not include readable content.'),
      );
    }
    processedQueryParts.push({
      type: 'text',
      text: `\nContent from @${resource.serverName}:${uri}:\n`,
    });
    processedQueryParts.push(...contentParts);
    return buildSuccessResourceDisplay(resource, uri, index);
  } catch (error) {
    return buildErrorResourceDisplay(resource, uri, index, error);
  }
}
function normalizeResourceResponse(value: unknown): ResourceResponse {
  if (isResourceResponse(value)) {
    return value;
  }
  return {};
}

function isResourceResponse(value: unknown): value is ResourceResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('contents' in value)) {
    debugLogger.warn(
      "MCP resource response has no 'contents', discarding response",
    );
    return false;
  }
  if (!Array.isArray(value.contents)) {
    debugLogger.warn(
      "MCP resource response has non-array 'contents', discarding response",
    );
    return false;
  }
  return value.contents.every(
    (item) => typeof item === 'object' && item !== null,
  );
}

function buildResourceDisplay(
  resource: DiscoveredMCPResource,
  uri: string,
  index: number,
  status: ToolCallStatus,
  resultDisplay: string,
): IndividualToolCallDisplay {
  return {
    callId: `mcp-resource-${resource.serverName}-${uri}-${index}`,
    name: `resources/read (${resource.serverName})`,
    description: uri,
    status,
    resultDisplay,
    confirmationDetails: undefined,
  };
}

function buildSuccessResourceDisplay(
  resource: DiscoveredMCPResource,
  uri: string,
  index: number,
): IndividualToolCallDisplay {
  return buildResourceDisplay(
    resource,
    uri,
    index,
    ToolCallStatus.Success,
    `Successfully read resource ${uri}`,
  );
}

function buildErrorResourceDisplay(
  resource: DiscoveredMCPResource,
  uri: string,
  index: number,
  error: unknown,
): IndividualToolCallDisplay {
  return buildResourceDisplay(
    resource,
    uri,
    index,
    ToolCallStatus.Error,
    `Error reading resource ${uri}: ${getErrorMessage(error)}`,
  );
}

function handleResourceReadError(
  resourceReadDisplays: IndividualToolCallDisplay[],
  addItem: UseHistoryManagerReturn['addItem'],
  userMessageTimestamp: number,
): AtCommandProcessResult {
  addToolGroup(addItem, userMessageTimestamp, resourceReadDisplays);
  const firstError = resourceReadDisplays.find(
    (d) => d.status === ToolCallStatus.Error,
  );
  if (!firstError) {
    debugLogger.error('handleResourceReadError called with no error displays');
    return {
      processedQuery: null,
      error: 'Unexpected error processing @ command',
    };
  }
  const errorMessages = resourceReadDisplays
    .filter((d) => d.status === ToolCallStatus.Error)
    .map((d) => d.resultDisplay);
  debugLogger.error(errorMessages.filter(Boolean).join(', '));
  return {
    processedQuery: null,
    error: `Exiting due to an error processing the @ command: ${firstError.resultDisplay}`,
  };
}

export function addToolGroup(
  addItem: UseHistoryManagerReturn['addItem'],
  userMessageTimestamp: number,
  tools: IndividualToolCallDisplay[],
): void {
  const item: Omit<HistoryItemToolGroup, 'id'> = {
    type: 'tool_group',
    agentId: DEFAULT_AGENT_ID,
    tools,
  };
  addItem(item, userMessageTimestamp);
}

function convertResourceContentsToParts(
  response: ResourceResponse,
): ContentBlock[] {
  const parts: ContentBlock[] = [];
  for (const content of response.contents ?? []) {
    const candidate = content.resource ?? content;
    if (candidate.text) {
      parts.push({ type: 'text', text: candidate.text });
      continue;
    }
    // Preserve the legacy text marker instead of inlining opaque binary payloads into prompt history.
    if (candidate.blob) {
      const mimeType = candidate.mimeType ?? 'application/octet-stream';
      const sizeBytes = computeBase64ByteLength(candidate.blob);
      parts.push({
        type: 'text',
        text: `[Binary resource content ${mimeType}, ${sizeBytes} bytes]`,
      });
    }
  }
  return parts;
}

function computeBase64ByteLength(base64: string): number {
  let padding = 0;
  if (base64.endsWith('==')) {
    padding = 2;
  } else if (base64.endsWith('=')) {
    padding = 1;
  }
  return Math.floor(base64.length / 4) * 3 - padding;
}
