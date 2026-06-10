/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { safeJsonStringify } from '../utils/safeJsonStringify.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  type ToolInvocation,
  type ToolMcpConfirmationDetails,
  type ToolResult,
  type PolicyUpdateOptions,
} from './tools.js';
import { ToolErrorType } from '../types/tool-error.js';
import type {
  IMcpToolService,
  McpFunctionCall,
  McpResponsePart,
} from '../interfaces/IMcpToolService.js';
import type { IToolMessageBus } from '../interfaces/IToolMessageBus.js';

type ToolParams = Record<string, unknown>;

// Discriminated union for MCP Content Blocks to ensure type safety.
type McpTextBlock = {
  type: 'text';
  text: string;
};

type McpMediaBlock = {
  type: 'image' | 'audio';
  mimeType: string;
  data: string;
};

type McpResourceBlock = {
  type: 'resource';
  resource: {
    text?: string;
    blob?: string;
    mimeType?: string;
  };
};

type McpResourceLinkBlock = {
  type: 'resource_link';
  uri: string;
  title?: string;
  name?: string;
};

type McpContentBlock =
  | McpTextBlock
  | McpMediaBlock
  | McpResourceBlock
  | McpResourceLinkBlock;

class DiscoveredMCPToolInvocation extends BaseToolInvocation<
  ToolParams,
  ToolResult
> {
  private static readonly allowlist: Set<string> = new Set();

  constructor(
    private readonly mcpToolService: IMcpToolService,
    readonly serverName: string,
    readonly serverToolName: string,
    readonly displayName: string,
    readonly trust: boolean | undefined,
    params: ToolParams = {},
    messageBus?: IToolMessageBus,
  ) {
    // Use composite format for policy checks: serverName__toolName
    // This enables server wildcards (e.g., "google-workspace__*")
    // while still allowing specific tool rules
    super(
      params,
      messageBus,
      `${serverName}__${serverToolName}`,
      displayName,
      serverName,
    );
  }

  protected override getPolicyUpdateOptions(
    _outcome: ToolConfirmationOutcome,
  ): PolicyUpdateOptions | undefined {
    return { mcpName: this.serverName };
  }

  override async shouldConfirmExecute(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const serverAllowListKey = this.serverName;
    const toolAllowListKey = `${this.serverName}.${this.serverToolName}`;

    if (
      this.mcpToolService.isTrustedFolder?.() === true &&
      this.trust === true
    ) {
      return false; // server is trusted, no confirmation needed
    }

    if (
      DiscoveredMCPToolInvocation.allowlist.has(serverAllowListKey) ||
      DiscoveredMCPToolInvocation.allowlist.has(toolAllowListKey)
    ) {
      return false; // server and/or tool already allowlisted
    }

    const confirmationDetails: ToolMcpConfirmationDetails = {
      type: 'mcp',
      title: 'Confirm MCP Tool Execution',
      serverName: this.serverName, // Include serverName for spoofing prevention
      toolName: this.serverToolName, // Display original tool name in confirmation
      toolDisplayName: this.displayName, // Display global registry name exposed to model and user
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        if (outcome === ToolConfirmationOutcome.ProceedAlwaysServer) {
          DiscoveredMCPToolInvocation.allowlist.add(serverAllowListKey);
        } else if (outcome === ToolConfirmationOutcome.ProceedAlwaysTool) {
          DiscoveredMCPToolInvocation.allowlist.add(toolAllowListKey);
        } else if (outcome === ToolConfirmationOutcome.ProceedAlwaysAndSave) {
          DiscoveredMCPToolInvocation.allowlist.add(toolAllowListKey);
          await this.publishPolicyUpdate(outcome);
        }
      },
    };
    return confirmationDetails;
  }

  // Determine if the response contains tool errors
  // This is needed because CallToolResults should return errors inside the response.
  // ref: https://modelcontextprotocol.io/specification/2025-06-18/schema#calltoolresult
  isMCPToolError(rawResponseParts: McpResponsePart[]): boolean {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- MCP tool payload data.
    const functionResponse = rawResponseParts?.[0]?.functionResponse;
    const response = functionResponse?.response;

    interface McpError {
      isError?: boolean | string;
    }

    if (response) {
      // Check for top-level isError (MCP Spec compliant)
      const isErrorTop = (response as { isError?: boolean | string }).isError;
      if (isErrorTop === true || isErrorTop === 'true') {
        return true;
      }

      // Legacy check for nested error object (keep for backward compatibility if any tools rely on it)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- MCP tool payload data.
      const error = (response as { error?: McpError })?.error;
      const isError = error?.isError;

      if (error && (isError === true || isError === 'true')) {
        return true;
      }
    }
    return false;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const functionCalls: McpFunctionCall[] = [
      {
        name: this.serverToolName,
        args: this.params,
      },
    ];

    // Race MCP tool call with abort signal to respect cancellation
    const rawResponseParts = await new Promise<McpResponsePart[]>(
      (resolve, reject) => {
        if (signal.aborted) {
          const error = new Error('Tool call aborted');
          error.name = 'AbortError';
          reject(error);
          return;
        }
        const onAbort = () => {
          cleanup();
          const error = new Error('Tool call aborted');
          error.name = 'AbortError';
          reject(error);
        };
        const cleanup = () => {
          signal.removeEventListener('abort', onAbort);
        };
        signal.addEventListener('abort', onAbort, { once: true });

        this.mcpToolService
          .callTool(functionCalls)
          .then((res) => {
            cleanup();
            resolve(res);
          })
          .catch((err) => {
            cleanup();
            reject(err);
          });
      },
    );

    // Ensure the response is not an error
    if (this.isMCPToolError(rawResponseParts)) {
      const errorMessage = `MCP tool '${
        this.serverToolName
      }' reported tool error for function call: ${safeJsonStringify(
        functionCalls[0],
      )} with response: ${safeJsonStringify(rawResponseParts)}`;
      return {
        llmContent: errorMessage,
        returnDisplay: `Error: MCP tool '${this.serverToolName}' reported an error.`,
        error: {
          message: errorMessage,
          type: ToolErrorType.MCP_TOOL_ERROR,
        },
      };
    }

    const transformedParts = transformMcpContentToParts(rawResponseParts);

    return {
      llmContent: transformedParts,
      returnDisplay: getStringifiedResultForDisplay(rawResponseParts),
    };
  }

  getDescription(): string {
    return safeJsonStringify(this.params);
  }

  override getToolName(): string {
    return `${this.serverName}__${this.serverToolName}`;
  }

  protected override getServerName(): string | undefined {
    return this.serverName;
  }
}

export class DiscoveredMCPTool extends BaseDeclarativeTool<
  ToolParams,
  ToolResult
> {
  constructor(
    private readonly mcpToolService: IMcpToolService,
    readonly serverName: string,
    readonly serverToolName: string,
    description: string,
    override readonly parameterSchema: unknown,
    readonly trust?: boolean,
    nameOverride?: string,
    messageBus?: IToolMessageBus,
  ) {
    super(
      nameOverride ?? generateMcpToolName(serverName, serverToolName),
      `${serverToolName} (${serverName} MCP Server)`,
      description,
      Kind.Other,
      parameterSchema,
      true, // isOutputMarkdown
      false, // canUpdateOutput
      messageBus,
    );
  }

  getFullyQualifiedPrefix(): string {
    return `${this.serverName}__`;
  }

  getFullyQualifiedName(): string {
    return `${this.getFullyQualifiedPrefix()}${generateValidName(this.serverToolName)}`;
  }

  /**
   * @deprecated This method is no longer used as MCP tools now receive unique names during creation.
   * The unique name is formed as generateMcpToolName(serverName, serverToolName) in the discovery process.
   */
  asFullyQualifiedTool(): DiscoveredMCPTool {
    return new DiscoveredMCPTool(
      this.mcpToolService,
      this.serverName,
      this.serverToolName,
      this.description,
      this.parameterSchema,
      this.trust,
      this.getFullyQualifiedName(),
      this.messageBus,
    );
  }

  protected createInvocation(
    params: ToolParams,
    messageBus?: IToolMessageBus,
  ): ToolInvocation<ToolParams, ToolResult> {
    return new DiscoveredMCPToolInvocation(
      this.mcpToolService,
      this.serverName,
      this.serverToolName,
      this.displayName,
      this.trust,
      params,
      messageBus,
    );
  }
}

function transformTextBlock(block: McpTextBlock): McpResponsePart {
  return { text: block.text };
}

function transformImageAudioBlock(
  block: McpMediaBlock,
  toolName: string,
): McpResponsePart[] {
  return [
    {
      text: `[Tool '${toolName}' provided the following ${
        block.type
      } data with mime-type: ${block.mimeType}]`,
    },
    {
      inlineData: {
        mimeType: block.mimeType,
        data: block.data,
      },
    },
  ];
}

function transformResourceBlock(
  block: McpResourceBlock,
  toolName: string,
): McpResponsePart | McpResponsePart[] | null {
  const resource = block.resource;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- MCP tool payload data.
  if (resource?.text) {
    return { text: resource.text };
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- MCP tool payload data.
  if (resource?.blob) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string mimeType is invalid, should fall through to default
    const mimeType = resource.mimeType || 'application/octet-stream';
    return [
      {
        text: `[Tool '${toolName}' provided the following embedded resource with mime-type: ${mimeType}]`,
      },
      {
        inlineData: {
          mimeType,
          data: resource.blob,
        },
      },
    ];
  }
  return null;
}

function transformResourceLinkBlock(
  block: McpResourceLinkBlock,
): McpResponsePart {
  return {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string title should fall through to name
    text: `Resource Link: ${block.title || block.name} at ${block.uri}`,
  };
}

/**
 * Transforms the raw MCP content blocks from the SDK response into a
 * standard response part array.
 * @param sdkResponse The raw response part array from the MCP service.
 * @returns A clean response part array ready for the scheduler.
 */
function transformMcpContentToParts(
  sdkResponse: McpResponsePart[],
): McpResponsePart[] {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- MCP tool payload data.
  const funcResponse = sdkResponse?.[0]?.functionResponse;
  const mcpContent = funcResponse?.response?.content as McpContentBlock[];
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string tool name should fall through to 'unknown tool'
  const toolName = funcResponse?.name || 'unknown tool';

  if (!Array.isArray(mcpContent)) {
    return [{ text: '[Error: Could not parse tool response]' }];
  }

  const transformed = mcpContent.flatMap(
    (block: McpContentBlock): McpResponsePart | McpResponsePart[] | null => {
      switch (block.type) {
        case 'text':
          return transformTextBlock(block);
        case 'image':
        case 'audio':
          return transformImageAudioBlock(block, toolName);
        case 'resource':
          return transformResourceBlock(block, toolName);
        case 'resource_link':
          return transformResourceLinkBlock(block);
        default:
          return null;
      }
    },
  );

  return transformed.filter((part): part is McpResponsePart => part !== null);
}

/**
 * Processes the raw response from the MCP tool to generate a clean,
 * human-readable string for display in the CLI. It summarizes non-text
 * content and presents text directly.
 *
 * @param rawResponse The raw response part array from the MCP service.
 * @returns A formatted string representing the tool's output.
 */
function getStringifiedResultForDisplay(
  rawResponse: McpResponsePart[],
): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- MCP tool payload data.
  const mcpContent = rawResponse?.[0]?.functionResponse?.response
    ?.content as McpContentBlock[];

  if (!Array.isArray(mcpContent)) {
    return '```json\n' + JSON.stringify(rawResponse, null, 2) + '\n```';
  }

  const displayParts = mcpContent.map((block: McpContentBlock): string => {
    switch (block.type) {
      case 'text':
        return block.text;
      case 'image':
        return `[Image: ${block.mimeType}]`;
      case 'audio':
        return `[Audio: ${block.mimeType}]`;
      case 'resource_link':
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string title should fall through to name
        return `[Link to ${block.title || block.name}: ${block.uri}]`;
      case 'resource':
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- MCP tool payload data.
        if (block.resource?.text) {
          return block.resource.text;
        }
        /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string mimeType should fall through to 'unknown type' */
        return `[Embedded Resource: ${
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- MCP tool payload data.
          block.resource?.mimeType || 'unknown type'
        }]`;
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      default:
        return `[Unknown content type: ${(block as { type: string }).type}]`;
    }
  });

  return displayParts.join('\n');
}

/** Visible for testing */
export function generateValidName(name: string) {
  // Replace invalid characters (based on 400 error message from Gemini API) with underscores
  let validToolname = name.replace(/[^a-zA-Z0-9_.-]/g, '_');

  // If longer than 63 characters, replace middle with '___'
  // (Gemini API says max length 64, but actual limit seems to be 63)
  if (validToolname.length > 63) {
    validToolname =
      validToolname.slice(0, 28) + '___' + validToolname.slice(-32);
  }
  return validToolname;
}

/**
 * Generates a valid MCP tool name that includes server and tool information
 * while ensuring it meets API requirements.
 */
export function generateMcpToolName(
  serverName: string,
  toolName: string,
): string {
  const fullName = `mcp__${serverName}__${toolName}`;
  return generateValidName(fullName);
}
