/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guard test codifying the removal of the client-side Google web tools.
 *
 * Issue #2443: Permanently remove google_web_search and google_web_fetch.
 * These broken client tools are superseded by exa_web_search and
 * direct_web_fetch. This test uses the `in` operator (no type assertions,
 * per dev-docs/RULES.md) to assert the removed symbols no longer exist
 * on the tools package public surface.
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

  it('does not export GoogleWebFetchToolParams', () => {
    expect('GoogleWebFetchToolParams' in ToolsNamespace).toBe(false);
  });

  it('does not export GoogleWebSearchToolInvocation', () => {
    expect('GoogleWebSearchToolInvocation' in ToolsNamespace).toBe(false);
  });

  it('does not export GOOGLE_WEB_SEARCH_TOOL constant', () => {
    expect('GOOGLE_WEB_SEARCH_TOOL' in TypesNamespace).toBe(false);
  });

  it('does not export GOOGLE_WEB_FETCH_TOOL constant', () => {
    expect('GOOGLE_WEB_FETCH_TOOL' in TypesNamespace).toBe(false);
  });

  it('does not re-export GOOGLE_WEB_SEARCH_TOOL from package root', () => {
    expect('GOOGLE_WEB_SEARCH_TOOL' in ToolsNamespace).toBe(false);
  });

  it('does not re-export GOOGLE_WEB_FETCH_TOOL from package root', () => {
    expect('GOOGLE_WEB_FETCH_TOOL' in ToolsNamespace).toBe(false);
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
