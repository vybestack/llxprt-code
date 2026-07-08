/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guard test codifying the removal of the client-side Google web tools.
 *
 * Issue #2443: Permanently remove google_web_search and google_web_fetch.
 * These broken client tools are superseded by exa_web_search and
 * direct_web_fetch.
 *
 * Two kinds of guard are used:
 *  - `in` operator checks for symbols that previously existed as *runtime*
 *    values on the public surface (classes and constants). Type-only exports
 *    and internal symbols are erased at compile time, so the `in` operator is
 *    meaningless for them and is intentionally not used.
 *  - dynamic-import rejection for the source modules themselves. If the module
 *    no longer resolves, none of its symbols (value, type, or internal) can be
 *    re-exported, so this is the effective guard for the removed
 *    GoogleWebFetchToolParams type and GoogleWebSearchToolInvocation class.
 */

import { describe, it, expect } from 'vitest';
import * as ToolsNamespace from '../index.js';
import * as TypesNamespace from '../types/tool-names.js';

describe('Removed Google client tools', () => {
  it('does not export GoogleWebSearchTool', () => {
    expect('GoogleWebSearchTool' in ToolsNamespace).toBe(false);
  });

  it('does not export GoogleWebFetchTool', () => {
    expect('GoogleWebFetchTool' in ToolsNamespace).toBe(false);
  });

  it('does not export GOOGLE_WEB_SEARCH_TOOL constant', () => {
    expect('GOOGLE_WEB_SEARCH_TOOL' in TypesNamespace).toBe(false);
  });

  it('does not export GOOGLE_WEB_FETCH_TOOL constant', () => {
    expect('GOOGLE_WEB_FETCH_TOOL' in TypesNamespace).toBe(false);
  });

  it('does not re-export the constants from the package root', () => {
    expect('GOOGLE_WEB_SEARCH_TOOL' in ToolsNamespace).toBe(false);
    expect('GOOGLE_WEB_FETCH_TOOL' in ToolsNamespace).toBe(false);
  });

  // The source modules must no longer resolve. This is the effective guard
  // for the removed type-only export (GoogleWebFetchToolParams) and the
  // internal invocation class (GoogleWebSearchToolInvocation): neither
  // existed as a runtime property, so the modules' absence is the real check.
  it('does not ship the google-web-search module', async () => {
    await expect(import('../tools/google-web-search.js')).rejects.toThrow(
      /Cannot find module|Failed to (?:resolve|load)/i,
    );
  });

  it('does not ship the google-web-fetch module', async () => {
    await expect(import('../tools/google-web-fetch.js')).rejects.toThrow(
      /Cannot find module|Failed to (?:resolve|load)/i,
    );
  });

  it('does not ship the google-web-search-invocation module', async () => {
    await expect(
      import('../tools/google-web-search-invocation.js'),
    ).rejects.toThrow(/Cannot find module|Failed to (?:resolve|load)/i);
  });
});

describe('Replacement web tools remain available', () => {
  it('exports ExaWebSearchTool', () => {
    expect('ExaWebSearchTool' in ToolsNamespace).toBe(true);
  });

  it('exports DirectWebFetchTool', () => {
    expect('DirectWebFetchTool' in ToolsNamespace).toBe(true);
  });

  it('exports EXA_WEB_SEARCH_TOOL constant', () => {
    expect('EXA_WEB_SEARCH_TOOL' in TypesNamespace).toBe(true);
  });

  it('exports DIRECT_WEB_FETCH_TOOL constant', () => {
    expect('DIRECT_WEB_FETCH_TOOL' in TypesNamespace).toBe(true);
  });
});
