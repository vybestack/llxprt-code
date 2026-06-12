/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { DirectMessageProcessor } from './DirectMessageProcessor.js';
import { StreamProcessor } from './StreamProcessor.js';

type ToolGroupArray = Array<{
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
  }>;
}>;

type HookToolConfig = {
  allowedFunctionNames?: string[];
};

type ProcessorVariant = {
  name: string;
  applyToolSelectionHook: (
    hookToolConfig: HookToolConfig,
    toolsFromConfig: ToolGroupArray,
  ) => Promise<ToolGroupArray>;
};

function createHookConfig(hookToolConfig: HookToolConfig): {
  getEnableHooks: () => boolean;
  getHookSystem: () => {
    initialize: () => Promise<void>;
    fireBeforeToolSelectionEvent: (_tools: ToolGroupArray) => Promise<{
      applyToolConfigModifications: (_request: { tools: ToolGroupArray }) => {
        toolConfig: HookToolConfig;
      };
    }>;
  };
} {
  return {
    getEnableHooks: () => true,
    getHookSystem: () => ({
      initialize: async () => undefined,
      fireBeforeToolSelectionEvent: async () => ({
        applyToolConfigModifications: () => ({
          toolConfig: hookToolConfig,
        }),
      }),
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

const variants: ProcessorVariant[] = [
  {
    name: 'DirectMessageProcessor',
    applyToolSelectionHook: async (
      hookToolConfig: HookToolConfig,
      toolsFromConfig: ToolGroupArray,
    ) => {
      const processor = Object.create(
        DirectMessageProcessor.prototype,
      ) as DirectMessageProcessor;
      const applyHook = (
        processor as unknown as {
          _applyToolSelectionHook: (
            configForHooks: unknown,
            tools: ToolGroupArray,
          ) => Promise<ToolGroupArray>;
        }
      )._applyToolSelectionHook;

      return applyHook.call(
        processor,
        createHookConfig(hookToolConfig),
        toolsFromConfig,
      );
    },
  },
  {
    name: 'StreamProcessor',
    applyToolSelectionHook: async (
      hookToolConfig: HookToolConfig,
      toolsFromConfig: ToolGroupArray,
    ) => {
      const processor = Object.create(
        StreamProcessor.prototype,
      ) as StreamProcessor;
      const applyHook = (
        processor as unknown as {
          _applyToolSelectionHook: (
            configForHooks: unknown,
            tools: unknown,
          ) => Promise<unknown>;
        }
      )._applyToolSelectionHook;

      return (await applyHook.call(
        processor,
        createHookConfig(hookToolConfig),
        toolsFromConfig,
      )) as ToolGroupArray;
    },
  },
];

describe.each(variants)(
  '$name BeforeToolSelection allowedFunctionNames',
  ({ applyToolSelectionHook }) => {
    it('leaves tools unchanged when allowedFunctionNames is omitted', async () => {
      const toolsFromConfig = createTools();

      const result = await applyToolSelectionHook({}, toolsFromConfig);

      expect(result).toStrictEqual(toolsFromConfig);
    });

    it('leaves tools unchanged when allowedFunctionNames is explicitly undefined', async () => {
      const toolsFromConfig = createTools();

      const result = await applyToolSelectionHook(
        { allowedFunctionNames: undefined },
        toolsFromConfig,
      );

      expect(result).toStrictEqual(toolsFromConfig);
    });

    it('returns no tools when allowedFunctionNames is an empty array', async () => {
      const toolsFromConfig = createTools();

      const result = await applyToolSelectionHook(
        { allowedFunctionNames: [] },
        toolsFromConfig,
      );

      expect(result).toStrictEqual([]);
    });

    it('filters tools to only the allowed function names', async () => {
      const toolsFromConfig = createTools();

      const result = await applyToolSelectionHook(
        { allowedFunctionNames: ['beta', 'gamma'] },
        toolsFromConfig,
      );

      expect(result).toStrictEqual([
        {
          functionDeclarations: [{ name: 'beta', description: 'beta tool' }],
        },
        {
          functionDeclarations: [{ name: 'gamma', description: 'gamma tool' }],
        },
      ]);
    });

    it('leaves tools unchanged when allowedFunctionNames is not an array', async () => {
      const toolsFromConfig = createTools();

      const result = await applyToolSelectionHook(
        { allowedFunctionNames: 'beta' as unknown as string[] },
        toolsFromConfig,
      );

      expect(result).toStrictEqual(toolsFromConfig);
    });
  },
);
