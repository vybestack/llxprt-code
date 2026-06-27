/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ApprovalMode,
  DEFAULT_FILE_FILTERING_OPTIONS,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
  OutputFormat,
} from '@vybestack/llxprt-code-core';
import { resolveIntermediateConfig } from '../intermediateConfig.js';
import type { CliArgs } from '../cliArgParser.js';
import type { Settings } from '../settings.js';
import type { ContextResolutionResult } from '../interactiveContext.js';

vi.mock('../policy.js', () => ({
  createPolicyEngineConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...original,
    isRipgrepAvailable: vi.fn().mockResolvedValue(false),
  };
});

const baseArgv: CliArgs = {
  model: undefined,
  sandbox: undefined,
  sandboxImage: undefined,
  sandboxEngine: undefined,
  sandboxProfileLoad: undefined,
  debug: undefined,
  prompt: undefined,
  promptInteractive: undefined,
  outputFormat: undefined,
  showMemoryUsage: undefined,
  yolo: undefined,
  approvalMode: undefined,
  telemetry: undefined,
  checkpointing: undefined,
  telemetryTarget: undefined,
  telemetryOtlpEndpoint: undefined,
  telemetryLogPrompts: undefined,
  telemetryOutfile: undefined,
  allowedMcpServerNames: undefined,
  allowedTools: undefined,
  experimentalAcp: undefined,
  experimentalUi: undefined,
  extensions: undefined,
  listExtensions: undefined,
  provider: undefined,
  key: undefined,
  keyfile: undefined,
  baseurl: undefined,
  proxy: undefined,
  includeDirectories: undefined,
  profileLoad: undefined,
  loadMemoryFromIncludeDirectories: undefined,
  ideMode: undefined,
  screenReader: undefined,
  sessionSummary: undefined,
  dumponerror: undefined,
  promptWords: undefined,
  query: undefined,
  set: undefined,
  continue: undefined,
  nobrowser: undefined,
  listSessions: undefined,
  deleteSession: undefined,
};

const baseContext: ContextResolutionResult = {
  debugMode: false,
  memoryImportFormat: 'tree',
  ideMode: false,
  folderTrust: false,
  trustedFolder: true,
  fileService: {} as ContextResolutionResult['fileService'],
  fileFiltering: DEFAULT_FILE_FILTERING_OPTIONS,
  memoryFileFiltering: DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
  includeDirectories: [],
  resolvedLoadMemoryFromIncludeDirectories: false,
  jitContextEnabled: false,
  interactive: false,
  allExtensions: [],
  activeExtensions: [],
  extensionContextFilePaths: [],
};

async function resolveOutputFormat(outputFormat: string | undefined) {
  const result = await resolveIntermediateConfig(
    { ...baseArgv, outputFormat },
    {} as Settings,
    {} as Settings,
    baseContext,
    ApprovalMode.DEFAULT,
  );
  return result.outputFormat;
}

describe('resolveIntermediateConfig output format', () => {
  it('preserves stream-json output format', async () => {
    await expect(resolveOutputFormat(OutputFormat.STREAM_JSON)).resolves.toBe(
      OutputFormat.STREAM_JSON,
    );
  });

  it('preserves json output format', async () => {
    await expect(resolveOutputFormat(OutputFormat.JSON)).resolves.toBe(
      OutputFormat.JSON,
    );
  });

  it('defaults omitted output format to text', async () => {
    await expect(resolveOutputFormat(undefined)).resolves.toBe(
      OutputFormat.TEXT,
    );
  });

  it('defaults unknown output format to text', async () => {
    await expect(resolveOutputFormat('yaml')).resolves.toBe(OutputFormat.TEXT);
  });

  it('defaults empty string output format to text', async () => {
    await expect(resolveOutputFormat('')).resolves.toBe(OutputFormat.TEXT);
  });

  it('defaults whitespace-padded output format to text', async () => {
    await expect(resolveOutputFormat(' json ')).resolves.toBe(
      OutputFormat.TEXT,
    );
  });

  it('defaults case-variant output format to text', async () => {
    await expect(resolveOutputFormat('JSON')).resolves.toBe(OutputFormat.TEXT);
  });
});
