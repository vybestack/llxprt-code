/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  classifyGenaiImporter,
  isGenaiImporterContent,
} from '../genai-import-inventory.ts';

describe('classifyGenaiImporter', () => {
  describe('gemini enclave (packages/providers/src/gemini)', () => {
    it('classifies a gemini provider source file as enclave', () => {
      const result = classifyGenaiImporter(
        'packages/providers/src/gemini/geminiResponseMapper.ts',
      );
      expect(result).toEqual({ kind: 'enclave' });
    });

    it('classifies a gemini provider test file as enclave', () => {
      const result = classifyGenaiImporter(
        'packages/providers/src/gemini/neutralConverters.test.ts',
      );
      expect(result).toEqual({ kind: 'enclave' });
    });

    it('classifies a deeply nested gemini file as enclave', () => {
      const result = classifyGenaiImporter(
        'packages/providers/src/gemini/subdir/deep/path/converter.ts',
      );
      expect(result).toEqual({ kind: 'enclave' });
    });
  });

  describe('code_assist enclave (packages/core/src/code_assist)', () => {
    it('classifies a code_assist source file as enclave', () => {
      const result = classifyGenaiImporter(
        'packages/core/src/code_assist/codeAssist.ts',
      );
      expect(result).toEqual({ kind: 'enclave' });
    });

    it('classifies a code_assist test file as enclave', () => {
      const result = classifyGenaiImporter(
        'packages/core/src/code_assist/codeAssist.test.ts',
      );
      expect(result).toEqual({ kind: 'enclave' });
    });

    it('classifies a deeply nested code_assist file as enclave', () => {
      const result = classifyGenaiImporter(
        'packages/core/src/code_assist/nested/module.ts',
      );
      expect(result).toEqual({ kind: 'enclave' });
    });
  });

  describe('core (packages/core, non-code_assist)', () => {
    it('classifies a core source file as #2348', () => {
      const result = classifyGenaiImporter(
        'packages/core/src/services/history/ContentConverters.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2348' });
    });

    it('classifies a core runtime file as #2348', () => {
      const result = classifyGenaiImporter(
        'packages/core/src/core/googleGenAIWrapper.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2348' });
    });

    it('classifies a core providers file as #2348', () => {
      const result = classifyGenaiImporter('packages/core/src/core/turn.ts');
      expect(result).toEqual({ kind: 'issue', issue: '#2348' });
    });
  });

  describe('agents (packages/agents)', () => {
    it('classifies an agents source file as #2349', () => {
      const result = classifyGenaiImporter(
        'packages/agents/src/core/MessageConverter.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2349' });
    });

    it('classifies an agents test file as #2349', () => {
      const result = classifyGenaiImporter(
        'packages/agents/src/core/chatSession.runtime.test.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2349' });
    });

    it('classifies a deeply nested agents file as #2349', () => {
      const result = classifyGenaiImporter(
        'packages/agents/src/core/agenticLoop/AgenticLoop.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2349' });
    });
  });

  describe('cli (packages/cli)', () => {
    it('classifies a cli source file as #2350', () => {
      const result = classifyGenaiImporter(
        'packages/cli/src/commands/someCommand.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2350' });
    });

    it('classifies a cli test file as #2350', () => {
      const result = classifyGenaiImporter(
        'packages/cli/src/commands/someCommand.test.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2350' });
    });
  });

  describe('leaf packages (#2351)', () => {
    it('classifies a tools source file as #2351', () => {
      const result = classifyGenaiImporter('packages/tools/src/tools/tools.ts');
      expect(result).toEqual({ kind: 'issue', issue: '#2351' });
    });

    it('classifies an mcp source file as #2351', () => {
      const result = classifyGenaiImporter(
        'packages/mcp/src/mcp-callable-tool.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2351' });
    });

    it('classifies a telemetry source file as #2351', () => {
      const result = classifyGenaiImporter(
        'packages/telemetry/src/api-events.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2351' });
    });

    it('classifies an a2a-server source file as #2351', () => {
      const result = classifyGenaiImporter(
        'packages/a2a-server/src/agent/task.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2351' });
    });

    it('classifies a test-utils source file as #2351', () => {
      const result = classifyGenaiImporter(
        'packages/test-utils/src/someHelper.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2351' });
    });

    it('classifies an a2a-server test file as #2351', () => {
      const result = classifyGenaiImporter(
        'packages/a2a-server/src/agent/task.test.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2351' });
    });
  });

  describe('providers non-gemini remainder (#2349)', () => {
    it('classifies a ProviderContentGenerator file as #2349', () => {
      const result = classifyGenaiImporter(
        'packages/providers/src/ProviderContentGenerator.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2349' });
    });

    it('classifies a non-gemini provider file as #2349', () => {
      const result = classifyGenaiImporter(
        'packages/providers/src/openai/openAiConverter.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2349' });
    });

    it('classifies a shared providers file as #2349', () => {
      const result = classifyGenaiImporter(
        'packages/providers/src/IProvider.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2349' });
    });
  });

  describe('first-match-wins ordering', () => {
    it('gemini enclave wins over core (gemini is under providers, not core)', () => {
      // A gemini file does not match the core prefix; this confirms gemini
      // is matched by its own enclave rule, not falling through.
      const result = classifyGenaiImporter(
        'packages/providers/src/gemini/geminiRequestBuilding.ts',
      );
      expect(result).toEqual({ kind: 'enclave' });
    });

    it('code_assist enclave wins over the broader core rule', () => {
      // code_assist is under packages/core/src/code_assist, which would
      // otherwise match the core (#2348) rule. The enclave rule must win.
      const result = classifyGenaiImporter(
        'packages/core/src/code_assist/deep/file.ts',
      );
      expect(result).toEqual({ kind: 'enclave' });
    });

    it('does NOT treat the gemini directory itself (no trailing slash) as enclave', () => {
      // The enclave prefix has a trailing slash; a bare directory path
      // must fall through to the broader providers (#2349) rule.
      const result = classifyGenaiImporter('packages/providers/src/gemini');
      expect(result).toEqual({ kind: 'issue', issue: '#2349' });
    });

    it('does NOT classify a sibling directory like gemini-backup as enclave', () => {
      // 'packages/providers/src/gemini-backup/' must NOT match the
      // 'packages/providers/src/gemini/' prefix — the trailing slash is
      // the boundary.
      const result = classifyGenaiImporter(
        'packages/providers/src/gemini-backup/converter.ts',
      );
      expect(result).toEqual({ kind: 'issue', issue: '#2349' });
    });
  });

  describe('unmatched paths (error)', () => {
    it('returns an error for a docs path', () => {
      const result = classifyGenaiImporter('docs/some-doc.ts');
      expect(result).toEqual({
        kind: 'error',
        error: expect.stringContaining('docs/some-doc.ts'),
      });
    });

    it('returns an error for an integration-tests path', () => {
      const result = classifyGenaiImporter('integration-tests/something.ts');
      expect(result).toEqual({
        kind: 'error',
        error: expect.stringContaining('integration-tests/something.ts'),
      });
    });

    it('returns an error for a scripts path', () => {
      const result = classifyGenaiImporter('scripts/some-script.ts');
      expect(result).toEqual({
        kind: 'error',
        error: expect.stringContaining('scripts/some-script.ts'),
      });
    });

    it('returns an error for a root-level file', () => {
      const result = classifyGenaiImporter('someFile.ts');
      expect(result).toEqual({
        kind: 'error',
        error: expect.stringContaining('someFile.ts'),
      });
    });

    it('returns an error for an unclassified package', () => {
      const result = classifyGenaiImporter(
        'packages/some-other-package/src/file.ts',
      );
      expect(result).toEqual({
        kind: 'error',
        error: expect.stringContaining(
          'packages/some-other-package/src/file.ts',
        ),
      });
    });
  });
});

describe('isGenaiImporterContent', () => {
  it('matches a single-quoted import specifier', () => {
    expect(isGenaiImporterContent("import { X } from '@google/genai';")).toBe(
      true,
    );
  });

  it('matches a double-quoted import specifier', () => {
    expect(isGenaiImporterContent('import { X } from "@google/genai";')).toBe(
      true,
    );
  });

  it('matches a subpath import', () => {
    expect(
      isGenaiImporterContent("import { X } from '@google/genai/sub';"),
    ).toBe(true);
  });

  it('matches a backtick (template literal) import specifier', () => {
    expect(isGenaiImporterContent('import(`@google/genai`);')).toBe(true);
  });

  it('matches a re-export from @google/genai', () => {
    expect(isGenaiImporterContent("export { X } from '@google/genai';")).toBe(
      true,
    );
  });

  it('matches a require() call', () => {
    expect(isGenaiImporterContent("const x = require('@google/genai');")).toBe(
      true,
    );
  });

  it('matches a dynamic await import()', () => {
    expect(
      isGenaiImporterContent("const x = await import('@google/genai');"),
    ).toBe(true);
  });

  it('does NOT match a prose comment mentioning the package', () => {
    expect(
      isGenaiImporterContent(
        '// structural checks — no @google/genai import) to neutral',
      ),
    ).toBe(false);
  });

  it('does NOT match an empty string', () => {
    expect(isGenaiImporterContent('')).toBe(false);
  });

  it('matches a quoted @google/genai reference even inside a comment (known limitation)', () => {
    // The regex is content-based, not AST-based: any quoted occurrence
    // is treated as an import. This documents that tradeoff.
    expect(isGenaiImporterContent("// see '@google/genai' for details")).toBe(
      true,
    );
  });

  it('does NOT match a similarly named package like @google/genai-utils', () => {
    expect(
      isGenaiImporterContent("import { X } from '@google/genai-utils';"),
    ).toBe(false);
  });

  it('does NOT match @google/genai embedded in a larger word', () => {
    // The pattern requires quote-adjacent boundaries: the quote precedes
    // 'fake', not '@google', so this does NOT match.
    expect(isGenaiImporterContent("const x = 'fake-@google/genai';")).toBe(
      false,
    );
  });
});
