/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type { ToolChoice } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import { DirectMessageProcessor } from './DirectMessageProcessor.js';
import { StreamProcessor } from './StreamProcessor.js';

type ToolGroupArray = Array<{
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
  }>;
}>;

type V2ToolSelectionRequest = {
  model: string;
  contents: unknown[];
  tools: Array<{
    name: string;
    description?: string;
    parametersJsonSchema: unknown;
  }>;
};

type ProcessorVariant = {
  name: string;
  applyToolSelectionHook: (
    toolChoice: ToolChoice | undefined,
    toolsFromConfig: ToolGroupArray,
  ) => Promise<{
    tools: ToolGroupArray;
    firedRequest?: V2ToolSelectionRequest;
  }>;
};

const STUB_MODEL = 'stub-model';

function createHookConfig(
  toolChoice: ToolChoice | undefined,
  firedRequest: { request?: V2ToolSelectionRequest },
): {
  getEnableHooks: () => boolean;
  getHookSystem: () => object;
} {
  return {
    getEnableHooks: () => true,
    getHookSystem: () => ({
      initialize: async () => undefined,
      fireBeforeToolSelectionEvent: async (request: V2ToolSelectionRequest) => {
        firedRequest.request = request;
        return {
          applyToolChoiceModifications: () => ({
            tools: [],
            ...(toolChoice !== undefined ? { toolChoice } : {}),
          }),
        };
      },
    }),
  };
}

function createTools(): ToolGroupArray {
  return [
    {
      functionDeclarations: [
        { name: 'alpha', description: 'alpha tool' },
        { name: 'beta', description: 'beta tool' },
      ],
    },
    {
      functionDeclarations: [{ name: 'gamma', description: 'gamma tool' }],
    },
  ];
}

/** Real `_applyToolSelectionHook` on a prototype-only processor stub. */
function makeVariant(
  name: string,
  ProcessorClass: typeof DirectMessageProcessor | typeof StreamProcessor,
): ProcessorVariant {
  return {
    name,
    applyToolSelectionHook: async (toolChoice, toolsFromConfig) => {
      const processor = Object.create(ProcessorClass.prototype) as unknown as {
        runtimeContext: { state: { model: string } };
        _applyToolSelectionHook: (
          configForHooks: unknown,
          tools: ToolGroupArray,
        ) => Promise<{ tools: ToolGroupArray }>;
      };
      processor.runtimeContext = { state: { model: STUB_MODEL } };
      const firedRequest: { request?: V2ToolSelectionRequest } = {};
      const result = await processor._applyToolSelectionHook(
        createHookConfig(toolChoice, firedRequest),
        toolsFromConfig,
      );
      return { tools: result.tools, firedRequest: firedRequest.request };
    },
  };
}

const variants: ProcessorVariant[] = [
  makeVariant('DirectMessageProcessor', DirectMessageProcessor),
  makeVariant('StreamProcessor', StreamProcessor),
];

describe.each(variants)(
  '$name BeforeToolSelection allowedToolNames',
  ({ applyToolSelectionHook }) => {
    it('fires the v2 envelope: model from scope, empty contents, flattened tool declarations', async () => {
      const toolsFromConfig = createTools();

      const { firedRequest } = await applyToolSelectionHook(
        undefined,
        toolsFromConfig,
      );

      expect(firedRequest).toStrictEqual({
        model: STUB_MODEL,
        contents: [],
        tools: [
          {
            name: 'alpha',
            parametersJsonSchema: {},
            description: 'alpha tool',
          },
          { name: 'beta', parametersJsonSchema: {}, description: 'beta tool' },
          {
            name: 'gamma',
            parametersJsonSchema: {},
            description: 'gamma tool',
          },
        ],
      });
    });

    it('leaves tools unchanged when the hook supplies no toolChoice', async () => {
      const toolsFromConfig = createTools();

      const result = await applyToolSelectionHook(undefined, toolsFromConfig);

      expect(result.tools).toStrictEqual(toolsFromConfig);
    });

    it('leaves tools unchanged when allowedToolNames is omitted', async () => {
      const toolsFromConfig = createTools();

      const result = await applyToolSelectionHook(
        { mode: 'auto' },
        toolsFromConfig,
      );

      expect(result.tools).toStrictEqual(toolsFromConfig);
    });

    it('returns no tools when allowedToolNames is an empty array', async () => {
      const toolsFromConfig = createTools();

      const result = await applyToolSelectionHook(
        { mode: 'none', allowedToolNames: [] },
        toolsFromConfig,
      );

      expect(result.tools).toStrictEqual([]);
    });

    it('filters tools to only the allowed tool names', async () => {
      const toolsFromConfig = createTools();

      const result = await applyToolSelectionHook(
        { mode: 'auto', allowedToolNames: ['beta', 'gamma'] },
        toolsFromConfig,
      );

      expect(result.tools).toStrictEqual([
        {
          functionDeclarations: [{ name: 'beta', description: 'beta tool' }],
        },
        {
          functionDeclarations: [{ name: 'gamma', description: 'gamma tool' }],
        },
      ]);
    });

    it('filters using canonicalized names', async () => {
      const toolsFromConfig = createTools();

      const result = await applyToolSelectionHook(
        { mode: 'auto', allowedToolNames: ['BETA'] },
        toolsFromConfig,
      );

      expect(result.tools).toStrictEqual([
        {
          functionDeclarations: [{ name: 'beta', description: 'beta tool' }],
        },
      ]);
    });

    it('leaves tools unchanged when allowedToolNames is not an array', async () => {
      const toolsFromConfig = createTools();

      const result = await applyToolSelectionHook(
        {
          mode: 'auto',
          allowedToolNames: 'beta' as unknown as string[],
        },
        toolsFromConfig,
      );

      expect(result.tools).toStrictEqual(toolsFromConfig);
    });
  },
);
