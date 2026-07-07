/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  DEFAULT_AGENT_ID,
  debugLogger,
  getErrorMessage,
  type ContractPart,
  type DiscoveredMCPResource,
} from '@vybestack/llxprt-code-core';
import type {
  HistoryItemToolGroup,
  IndividualToolCallDisplay,
} from '../types.js';
import { ToolCallStatus } from '../types.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { AtCommandProcessResult } from './atCommandProcessorHelpers.js';

export type McpClientManagerForResources =
  | {
      getClient?:
        | ((
            name: string,
          ) => { readResource(uri: string): Promise<unknown> } | undefined)
        | undefined;
    }
  | undefined;

export interface ResourceReadParams {
  resourceAttachments: DiscoveredMCPResource[];
  processedQueryParts: Array<ContractPart | string>;
  addItem: UseHistoryManagerReturn['addItem'];
  userMessageTimestamp: number;
  mcpClientManager: McpClientManagerForResources;
}

type ResourceResponse = {
  contents?: Array<{
    text?: string;
    blob?: string;
    mimeType?: string;
    resource?: { text?: string; blob?: string; mimeType?: string };
  }>;
};

type ResourceClient = {
  readResource: (uri: string) => Promise<ResourceResponse>;
};

export async function processResourceAttachments({
  resourceAttachments,
  processedQueryParts,
  addItem,
  userMessageTimestamp,
  mcpClientManager,
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
      mcpClientManager,
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
  mcpClientManager: McpClientManagerForResources,
  processedQueryParts: Array<ContractPart | string>,
  index: number,
): Promise<IndividualToolCallDisplay> {
  const client = getResourceClient(mcpClientManager, resource.serverName);
  if (!client) return buildMissingClientDisplay(resource, uri, index);
  try {
    const response = await client.readResource(uri);
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
      text: `\nContent from @${resource.serverName}:${uri}:\n`,
    });
    processedQueryParts.push(...contentParts);
    return buildSuccessResourceDisplay(resource, uri, index);
  } catch (error) {
    return buildErrorResourceDisplay(resource, uri, index, error);
  }
}
function getResourceClient(
  mcpClientManager: McpClientManagerForResources,
  serverName: string,
): ResourceClient | undefined {
  const client = mcpClientManager?.getClient?.(serverName);
  return client === undefined
    ? undefined
    : {
        readResource: async (uri) =>
          normalizeResourceResponse(await client.readResource(uri)),
      };
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

function buildMissingClientDisplay(
  resource: DiscoveredMCPResource,
  uri: string,
  index: number,
): IndividualToolCallDisplay {
  return buildResourceDisplay(
    resource,
    uri,
    index,
    ToolCallStatus.Error,
    `Error reading resource ${uri}: MCP client for server '${resource.serverName}' is not available or not connected.`,
  );
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
): Array<ContractPart | string> {
  const parts: Array<ContractPart | string> = [];
  for (const content of response.contents ?? []) {
    const candidate = content.resource ?? content;
    if (candidate.text) {
      parts.push({ text: candidate.text });
      continue;
    }
    // Preserve the legacy text marker instead of inlining opaque binary payloads into prompt history.
    if (candidate.blob) {
      const mimeType = candidate.mimeType ?? 'application/octet-stream';
      const sizeBytes = computeBase64ByteLength(candidate.blob);
      parts.push({
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
