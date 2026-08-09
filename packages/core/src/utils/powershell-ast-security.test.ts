/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect, describe, it, beforeEach, afterEach, vi } from 'bun:test';
import { checkCommandPermissions, isCommandAllowed } from './shell-utils.js';
import {
  initializeParser,
  isParserAvailable,
  parseCommandDetailsForLanguage,
} from './shell-parser.js';
import type { Config } from '../config/config.js';

/**
 * Security remediation tests for PR #3198 review findings (#3181).
 *
 * Each test exercises a concrete bypass vector identified by CodeRabbit/OCR.
 * Tests are RED before the production fix and GREEN after.
 */
await initializeParser();
const pwshAvailable = isParserAvailable('powershell');
if (!pwshAvailable) {
  throw new Error('PowerShell grammar failed to load under Bun');
}

const mockPlatform = vi.fn();
void vi.mock('os', () => ({
  default: { platform: mockPlatform, homedir: vi.fn() },
  platform: mockPlatform,
  homedir: vi.fn(),
}));

function makeConfig(
  overrides: Partial<{
    coreTools: string[];
    excludeTools: string[];
    shellReplacement: string;
  }> = {},
): Config {
  return {
    getCoreTools: () => overrides.coreTools ?? [],
    getExcludeTools: () => overrides.excludeTools ?? [],
    getAllowedTools: () => [],
    getShellReplacement: () =>
      (overrides.shellReplacement ?? 'allowlist') as never,
    getEphemeralSetting: () => undefined,
  } as unknown as Config;
}

describe.skipIf(!pwshAvailable)(
  'PowerShell security: -Command abbreviation payload extraction (#4)',
  () => {
    const blocklist: Config = makeConfig({
      excludeTools: ['ShellTool(rm)'],
    });

    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
    });
    afterEach(() => {
      vi.clearAllMocks();
    });

    it('blocks blocklisted command behind -Comm abbreviation in blocklist mode', () => {
      const { allowed } = isCommandAllowed(
        'powershell -Comm "rm -rf /tmp"',
        blocklist,
        'powershell',
      );
      expect(allowed).toBe(false);
    });

    it('blocks blocklisted command behind -Comma abbreviation in blocklist mode', () => {
      const { allowed } = isCommandAllowed(
        'powershell -Comma "rm -rf /tmp"',
        blocklist,
        'powershell',
      );
      expect(allowed).toBe(false);
    });

    it('blocks blocklisted command behind pwsh -Comm abbreviation', () => {
      const { allowed } = isCommandAllowed(
        'pwsh -Comm "rm -rf /tmp"',
        blocklist,
        'powershell',
      );
      expect(allowed).toBe(false);
    });

    it('blocks blocklisted command behind -Comm with bare payload', () => {
      const { allowed } = isCommandAllowed(
        'pwsh -Comm rm -rf /tmp',
        blocklist,
        'powershell',
      );
      expect(allowed).toBe(false);
    });

    // PowerShell accepts -co as an unambiguous abbreviation of -Command.
    it('blocks blocklisted command behind -co abbreviation in blocklist mode', () => {
      const { allowed } = isCommandAllowed(
        'powershell -co "rm -rf /tmp"',
        blocklist,
        'powershell',
      );
      expect(allowed).toBe(false);
    });

    it('blocks executable content supplied in an argument after a quoted -Command payload', () => {
      const { allowed } = isCommandAllowed(
        "powershell -Command 'Write-Output safe' '; rm -rf /tmp'",
        blocklist,
        'powershell',
      );
      expect(allowed).toBe(false);
    });
  },
);

describe.skipIf(!pwshAvailable)(
  'PowerShell security: -EncodedCommand payload decoding (#4)',
  () => {
    const blocklist: Config = makeConfig({
      excludeTools: ['ShellTool(rm)'],
    });
    const strictConfig: Config = makeConfig({
      coreTools: ['ShellTool(git)'],
    });

    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
    });
    afterEach(() => {
      vi.clearAllMocks();
    });

    function encodeCmd(cmd: string): string {
      return Buffer.from(cmd, 'utf16le').toString('base64');
    }

    it('blocks blocklisted command decoded from -EncodedCommand', () => {
      const encoded = encodeCmd('rm -rf /tmp');
      const { allowed } = isCommandAllowed(
        `powershell -EncodedCommand ${encoded}`,
        blocklist,
        'powershell',
      );
      expect(allowed).toBe(false);
    });

    // PowerShell accepts -enc, -en, and even -e as -EncodedCommand. Each must
    // be decoded and recursed so a hidden blocklisted command is caught.
    it('blocks blocklisted command decoded from -enc abbreviation', () => {
      const encoded = encodeCmd('rm -rf /tmp');
      const { allowed } = isCommandAllowed(
        `powershell -enc ${encoded}`,
        blocklist,
        'powershell',
      );
      expect(allowed).toBe(false);
    });

    it('blocks blocklisted command decoded from -en abbreviation', () => {
      const encoded = encodeCmd('rm -rf /tmp');
      const { allowed } = isCommandAllowed(
        `powershell -en ${encoded}`,
        blocklist,
        'powershell',
      );
      expect(allowed).toBe(false);
    });

    it('blocks blocklisted command decoded from -e abbreviation', () => {
      const encoded = encodeCmd('rm -rf /tmp');
      const { allowed } = isCommandAllowed(
        `powershell -e ${encoded}`,
        blocklist,
        'powershell',
      );
      expect(allowed).toBe(false);
    });

    it('fails closed for -EncodedCommand in strict allowlist', () => {
      const encoded = encodeCmd('rm -rf /tmp');
      const result = checkCommandPermissions(
        `powershell -EncodedCommand ${encoded}`,
        strictConfig,
        undefined,
        'powershell',
      );
      expect(result.allAllowed).toBe(false);
    });

    it('treats non-canonical Base64 as unresolved instead of decoding it permissively', () => {
      const command = 'powershell -EncodedCommand cg!!BtAA==';
      const result = parseCommandDetailsForLanguage(command, 'powershell');

      expect(result).toMatchObject({ hasError: false });
      expect(result?.details).toContainEqual(
        expect.objectContaining({
          text: command,
          nameKind: 'expression',
        }),
      );
      expect(result?.details).not.toContainEqual(
        expect.objectContaining({
          name: 'rm',
        }),
      );
    });

    it('fails closed for invalid base64 in -EncodedCommand strict allowlist', () => {
      const result = checkCommandPermissions(
        'powershell -EncodedCommand @@@notbase64@@@',
        strictConfig,
        undefined,
        'powershell',
      );
      expect(result.allAllowed).toBe(false);
    });

    it('decodes nested blocklisted command from -EncodedCommand in all mode', () => {
      const encoded = encodeCmd('iex "rm -rf /tmp"');
      const allConfig = makeConfig({
        excludeTools: ['ShellTool(rm)'],
        shellReplacement: 'all',
      });
      const { allowed } = isCommandAllowed(
        `powershell -EncodedCommand ${encoded}`,
        allConfig,
        'powershell',
      );
      expect(allowed).toBe(false);
    });
  },
);

describe.skipIf(!pwshAvailable)(
  'PowerShell security: empty invocation target fail-closed (#15)',
  () => {
    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
    });
    afterEach(() => {
      vi.clearAllMocks();
    });

    it('hard-denies empty & target in strict allowlist', () => {
      const strictConfig = makeConfig({ coreTools: ['ShellTool(git)'] });
      const result = checkCommandPermissions(
        "& ''",
        strictConfig,
        undefined,
        'powershell',
      );
      expect(result.allAllowed).toBe(false);
      expect(result.isHardDenial).toBe(true);
    });

    it('hard-denies empty & target under session allowlist', () => {
      const sessionAllowlist = new Set(['git']);
      const result = checkCommandPermissions(
        "& ''",
        makeConfig({ coreTools: [] }),
        sessionAllowlist,
        'powershell',
      );
      expect(result.allAllowed).toBe(false);
      expect(result.isHardDenial).toBe(true);
    });
  },
);

describe.skipIf(!pwshAvailable)(
  'PowerShell security: diagnostic naming references tree-sitter-pwsh (#6)',
  () => {
    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
    });
    afterEach(() => {
      vi.clearAllMocks();
    });

    it('errorReason references tree-sitter-pwsh not powershell-tree-sitter', () => {
      const config = makeConfig();
      const { allowed, reason } = isCommandAllowed(
        'Get-ChildItem |',
        config,
        'powershell',
      );
      expect(allowed).toBe(false);
      expect(reason).toContain('tree-sitter-pwsh');
      expect(reason).not.toContain('powershell-tree-sitter');
    });
  },
);

describe.skipIf(!pwshAvailable)(
  'PowerShell security: dynamic Start-Process targets fail closed (#3)',
  () => {
    // When Start-Process is itself allowlisted, a dynamic (non-static) target
    // such as a parenthesized member access must still fail closed under a
    // strict allowlist. Static targets resolve to a name; dynamic targets must
    // be classified as unresolved so no specific pattern can match them.
    const strictConfig: Config = makeConfig({
      coreTools: ['ShellTool(start-process)'],
    });

    beforeEach(() => {
      mockPlatform.mockReturnValue('linux');
    });
    afterEach(() => {
      vi.clearAllMocks();
    });

    it('fails closed for parenthesized member-access target', () => {
      const result = checkCommandPermissions(
        'Start-Process ($obj.FullName)',
        strictConfig,
        undefined,
        'powershell',
      );
      expect(result.allAllowed).toBe(false);
    });

    it('fails closed for element-access target', () => {
      const result = checkCommandPermissions(
        'Start-Process $args[0]',
        strictConfig,
        undefined,
        'powershell',
      );
      expect(result.allAllowed).toBe(false);
    });

    it('fails closed for string-concatenation target', () => {
      const result = checkCommandPermissions(
        'Start-Process ("a" + $b)',
        strictConfig,
        undefined,
        'powershell',
      );
      expect(result.allAllowed).toBe(false);
    });

    it('still allows a static quoted target when explicitly allowlisted', () => {
      const allowTarget = makeConfig({
        coreTools: ['ShellTool(start-process)', 'ShellTool(notepad.exe)'],
      });
      const result = checkCommandPermissions(
        'Start-Process "notepad.exe"',
        allowTarget,
        undefined,
        'powershell',
      );
      expect(result.allAllowed).toBe(true);
    });
  },
);

describe.skipIf(!pwshAvailable)(
  'PowerShell path command-name canonicalization',
  () => {
    it('normalizes a relative executable path to its basename', () => {
      const command = String.raw`.\foo.exe --safe`;
      const result = parseCommandDetailsForLanguage(command, 'powershell');
      expect(result).toMatchObject({ hasError: false });
      expect(result?.details).toContainEqual({
        name: 'foo.exe',
        text: command,
        canonicalText: 'foo.exe --safe',
        nameKind: 'static',
      });
    });

    it('matches relative executable paths by canonical basename', () => {
      const command = String.raw`.\foo.exe --safe`;
      expect(
        isCommandAllowed(
          command,
          makeConfig({ coreTools: ['ShellTool(foo.exe)'] }),
          'powershell',
        ).allowed,
      ).toBe(true);
      expect(
        isCommandAllowed(
          command,
          makeConfig({ excludeTools: ['ShellTool(foo.exe)'] }),
          'powershell',
        ).allowed,
      ).toBe(false);
    });
  },
);

describe.skipIf(!pwshAvailable)(
  'PowerShell security: multi-byte text round-trips through AST offsets',
  () => {
    // web-tree-sitter exposes startIndex/endIndex as UTF-16 code-unit offsets
    // (matching String.prototype.slice) in this runtime. A review finding
    // claimed these were byte offsets that corrupt multi-byte text. This test
    // locks in the correct behavior: a command containing 2-byte (é), 3-byte
    // (€), and 4-byte/surrogate-pair (😀) characters must produce intact
    // detail text, not garbled slices. If a future tree-sitter version ever
    // changes offset semantics, this test will fail loudly.
    it('extracts intact later command text after Unicode input', () => {
      const command =
        'Write-Host "é-€-😀"; & "C:\\tools\\café-€-😀.exe" --safe';
      const result = parseCommandDetailsForLanguage(command, 'powershell');
      const detail = result?.details.find(
        (candidate) => candidate.name === 'café-€-😀.exe',
      );
      expect(detail).toBeDefined();
      // The later node starts after multi-byte/surrogate-pair input, so this
      // catches byte-offset slicing as well as corruption within the basename.
      expect(detail?.text).toBe('& "C:\\tools\\café-€-😀.exe" --safe');
    });

    it('matches a later Unicode blocklisted target after Unicode input', () => {
      const blocklist = makeConfig({
        excludeTools: ['ShellTool(café-€-😀.exe)'],
      });
      const { allowed } = isCommandAllowed(
        'Write-Host "é-€-😀"; & "C:\\tools\\café-€-😀.exe"',
        blocklist,
        'powershell',
      );
      expect(allowed).toBe(false);
    });
  },
);
