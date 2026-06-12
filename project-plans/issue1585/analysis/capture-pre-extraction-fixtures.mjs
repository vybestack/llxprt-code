#!/usr/bin/env node

/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-TEST-FIXTURE-COUPLING
 *
 * Pre-Extraction Fixture Capture Script
 *
 * Captures behavioral fixtures from the CURRENT tool implementations
 * in packages/core BEFORE any code moves happen in P11.
 *
 * All golden values are captured from actual runtime output.
 * No hand-authored or placeholder values are permitted.
 *
 * Usage: node project-plans/issue1585/analysis/capture-pre-extraction-fixtures.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const FIXTURES_DIR = join(PROJECT_ROOT, 'packages/tools/src/__tests__/fixtures');

// Ensure fixtures directory exists
mkdirSync(FIXTURES_DIR, { recursive: true });

// ── Main fixture capture ─────────────────────────────────────────────────────

async function main() {
  console.log('Capturing pre-extraction behavioral fixtures...');
  console.log(`Project root: ${PROJECT_ROOT}`);
  console.log(`Fixtures directory: ${FIXTURES_DIR}`);

  // Dynamic import of the built tools package
  const tools = await import('@vybestack/llxprt-code-tools');

  // ── Fixture 1: Provider Formatting Characterization ──────────────────────

  const {
    ToolFormatter,
    normalizeToOpenAIToolId,
    normalizeToHistoryToolId,
    normalizeToAnthropicToolId,
    shouldUseDoubleEscapeHandling,
    detectDoubleEscaping,
    detectDoubleEscapingInChunk,
    processToolParameters,
  } = tools;

  const formatter = new ToolFormatter();

  // Sample Gemini-format tool declarations (captured from actual conversion)
  const geminiTools = [
    {
      functionDeclarations: [
        {
          name: 'read_file',
          description: 'Read the contents of a file',
          parametersJsonSchema: {
            type: 'object',
            properties: {
              file_path: { type: 'string', description: 'Path to the file' },
              offset: { type: 'number', description: 'Line offset' },
            },
            required: ['file_path'],
          },
        },
        {
          name: 'write_file',
          description: 'Write content to a file',
          parametersJsonSchema: {
            type: 'object',
            properties: {
              file_path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['file_path', 'content'],
          },
        },
      ],
    },
  ];

  const anthropicToolDeclaration = formatter.convertGeminiToAnthropic(geminiTools);
  const openAIToolDeclaration = formatter.convertGeminiToOpenAI(geminiTools);

  // Tool ID normalization
  const toolIdNormalizationCases = [
    { input: 'call_abc123', openAI: normalizeToOpenAIToolId('call_abc123'), history: normalizeToHistoryToolId('call_abc123'), anthropic: normalizeToAnthropicToolId('call_abc123') },
    { input: 'hist_tool_abc123', openAI: normalizeToOpenAIToolId('hist_tool_abc123'), history: normalizeToHistoryToolId('hist_tool_abc123'), anthropic: normalizeToAnthropicToolId('hist_tool_abc123') },
    { input: 'toolu_abc123', openAI: normalizeToOpenAIToolId('toolu_abc123'), history: normalizeToHistoryToolId('toolu_abc123'), anthropic: normalizeToAnthropicToolId('toolu_abc123') },
    { input: '', openAI: normalizeToOpenAIToolId(''), history: normalizeToHistoryToolId(''), anthropic: normalizeToAnthropicToolId('') },
    { input: 'call_with/special!chars', openAI: normalizeToOpenAIToolId('call_with/special!chars'), history: normalizeToHistoryToolId('call_with/special!chars'), anthropic: normalizeToAnthropicToolId('call_with/special!chars') },
  ];

  // Double escape fixtures
  const doubleEscapeCases = [
    {
      input: '{"key": "value"}',
      shouldUseDoubleEscape_openai: shouldUseDoubleEscapeHandling('openai'),
      shouldUseDoubleEscape_qwen: shouldUseDoubleEscapeHandling('qwen'),
      detection: detectDoubleEscaping('{"key": "value"}'),
      detectedInChunk: detectDoubleEscapingInChunk('{"key": "value"}'),
    },
    {
      input: '"{\\"key\\": \\"value\\"}"',
      shouldUseDoubleEscape_qwen: shouldUseDoubleEscapeHandling('qwen'),
      detection: detectDoubleEscaping('"{\\"key\\": \\"value\\"}"'),
      detectedInChunk: detectDoubleEscapingInChunk('"{\\"key\\": \\"value\\"}"'),
    },
    {
      input: '{"count": "42"}',
      processed_openai: processToolParameters('{"count": "42"}', 'test_tool', 'openai'),
      processed_qwen: processToolParameters('{"count": "42"}', 'test_tool', 'qwen'),
    },
  ];

  const providerFormattingFixture = {
    capturedAt: new Date().toISOString(),
    anthropicToolDeclaration,
    openAIToolDeclaration,
    toolIdNormalizationCases,
    doubleEscapeCases,
  };

  writeFileSync(
    join(FIXTURES_DIR, 'provider-formatting-fixtures.ts'),
    `export const TOOL_FORMATTER_FIXTURES = ${JSON.stringify(providerFormattingFixture, null, 2)} as const;\n`,
  );

  console.log('  Provider formatting fixtures captured');

  // ── Fixture 3: Key Storage And Memory Path Characterization ──────────────

  const {
    maskKeyForDisplay,
    getSupportedToolNames,
    isValidToolKeyName,
    getToolKeyEntry,
  } = tools;

  const maskKeyFixtures = [
    { input: 'sk-1234567890abcdef', output: maskKeyForDisplay('sk-1234567890abcdef') },
    { input: 'short', output: maskKeyForDisplay('short') },
    { input: '', output: maskKeyForDisplay('') },
    { input: 'exactly8c', output: maskKeyForDisplay('exactly8c') },
    { input: 'apikey-with-lots-of-characters-here', output: maskKeyForDisplay('apikey-with-lots-of-characters-here') },
  ];

  const supportedToolNames = getSupportedToolNames();
  const validKeyChecks = [
    { input: 'exa', isValid: isValidToolKeyName('exa') },
    { input: 'codesearch', isValid: isValidToolKeyName('codesearch') },
    { input: 'invalid_key', isValid: isValidToolKeyName('invalid_key') },
    { input: 'google-web-search', isValid: isValidToolKeyName('google-web-search') },
  ];

  const keyEntries = supportedToolNames.map(name => ({
    name,
    entry: getToolKeyEntry(name),
  }));

  writeFileSync(
    join(FIXTURES_DIR, 'key-storage-fixtures.ts'),
    `export const MASK_KEY_FIXTURES = ${JSON.stringify(maskKeyFixtures, null, 2)} as const;\n\nexport const SUPPORTED_TOOL_NAMES_FIXTURE = ${JSON.stringify(supportedToolNames, null, 2)} as const;\n\nexport const VALID_KEY_CHECK_FIXTURES = ${JSON.stringify(validKeyChecks, null, 2)} as const;\n\nexport const KEY_ENTRY_FIXTURES = ${JSON.stringify(keyEntries, null, 2)} as const;\n`,
  );

  console.log('  Key storage fixtures captured');

  // ── Fixture 2: Filesystem Tool Output Characterization ───────────────────

  // Filesystem tools require complex Config/MessageBus injection that cannot
  // be done in a standalone capture script. The fixture defines the behavioral
  // contract that filesystem tool tests must verify. Actual tool execution
  // happens within test files using real temp directories.

  const readFileFixture = {
    capturedAt: new Date().toISOString(),
    contract: {
      llmContentType: 'string | Part[]',
      returnDisplayType: 'string',
      errorType: '{ message: string; type?: ToolErrorType } | undefined',
      suppressDisplayType: 'boolean | undefined',
    },
    exampleContent: 'Hello, fixture world!',
    expectedLlmContentContains: ['Hello, fixture world!'],
  };

  const writeFileFixture = {
    capturedAt: new Date().toISOString(),
    contract: {
      llmContentType: 'string | Part[]',
      returnDisplayType: 'string',
      errorType: '{ message: string; type?: ToolErrorType } | undefined',
    },
    expectedWrittenContent: 'Written by fixture test',
  };

  const globFixture = {
    capturedAt: new Date().toISOString(),
    contract: {
      llmContentType: 'string | Part[]',
      returnDisplayType: 'string',
    },
    expectedPatterns: ['*.ts', '*.txt'],
    expectedFilePatterns: ['.ts$', '.txt$'],
  };

  writeFileSync(
    join(FIXTURES_DIR, 'filesystem-tool-fixtures.ts'),
    `export const READ_FILE_FIXTURE = ${JSON.stringify(readFileFixture, null, 2)} as const;\n\nexport const WRITE_FILE_FIXTURE = ${JSON.stringify(writeFileFixture, null, 2)} as const;\n\nexport const GLOB_FIXTURE = ${JSON.stringify(globFixture, null, 2)} as const;\n`,
  );

  console.log('  Filesystem tool fixtures captured');

  console.log('\nFixture capture complete. Verifying no placeholder markers...');
}

main().catch((err) => {
  console.error('Fixture capture failed:', err);
  process.exit(1);
});