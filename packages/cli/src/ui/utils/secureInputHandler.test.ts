/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecureInputHandler } from './secureInputHandler.js';
import * as os from 'os';
import * as path from 'path';
import { writeFileSync } from 'fs';

describe('SecureInputHandler', () => {
  let handler: SecureInputHandler;

  beforeEach(() => {
    handler = new SecureInputHandler();
  });

  describe('shouldUseSecureMode', () => {
    it('should detect /key command with argument', () => {
      expect(handler.shouldUseSecureMode('/key abc')).toBe(true);
      expect(handler.shouldUseSecureMode('/key test-key-123')).toBe(true);
      expect(handler.shouldUseSecureMode('  /key   secret  ')).toBe(true);
    });

    it('should detect /key command even without argument', () => {
      expect(handler.shouldUseSecureMode('/key')).toBe(true);
      expect(handler.shouldUseSecureMode('/key ')).toBe(true);
      expect(handler.shouldUseSecureMode('/ke')).toBe(false);
      expect(handler.shouldUseSecureMode('key abc')).toBe(false);
    });

    it('should detect /keyfile command', () => {
      expect(handler.shouldUseSecureMode('/keyfile')).toBe(true);
      expect(handler.shouldUseSecureMode('/keyfile ')).toBe(true);
      expect(handler.shouldUseSecureMode('/keyfile ~/.mykey')).toBe(true);
      expect(handler.shouldUseSecureMode('  /keyfile   ~/.ssh/key  ')).toBe(
        true,
      );
    });

    it('should not detect other commands', () => {
      expect(handler.shouldUseSecureMode('/help')).toBe(false);
      expect(handler.shouldUseSecureMode('/clear')).toBe(false);
      expect(handler.shouldUseSecureMode('hello world')).toBe(false);
    });
  });

  describe('processInput', () => {
    it('should mask API key in /key command', () => {
      const input = '/key my-secret-api-key';
      const processed = handler.processInput(input);

      // The key portion is 'my-secret-api-key' which is 17 characters
      // First 2: 'my', Last 2: 'ey', Middle: 13 asterisks
      expect(processed).toBe('/key my*************ey');
      expect(handler.isInSecureMode()).toBe(true);
      expect(handler.getActualValue()).toBe(input);
    });

    it('should mask short API keys completely', () => {
      const input = '/key abc123';
      const processed = handler.processInput(input);

      expect(processed).toBe('/key ******');
      expect(handler.getActualValue()).toBe(input);
    });

    it('should not mask file paths in /keyfile command', () => {
      const input = '/keyfile ~/.ssh/mykey';
      const processed = handler.processInput(input);

      // File paths should not be masked
      expect(processed).toBe(input);
      expect(handler.isInSecureMode()).toBe(true);
      expect(handler.getActualValue()).toBe(input);
    });

    it('should not mask non-key commands', () => {
      const input = '/help me with this';
      const processed = handler.processInput(input);

      expect(processed).toBe(input);
      expect(handler.isInSecureMode()).toBe(false);
    });

    it('should handle progressive typing', () => {
      // Simulate typing character by character
      handler.reset();

      // Each test should simulate the full input progression
      handler.reset();
      expect(handler.processInput('/')).toBe('/');
      expect(handler.isInSecureMode()).toBe(false);

      handler.reset();
      expect(handler.processInput('/k')).toBe('/k');
      expect(handler.isInSecureMode()).toBe(false);

      handler.reset();
      expect(handler.processInput('/ke')).toBe('/ke');
      expect(handler.isInSecureMode()).toBe(false);

      // Secure mode starts at /key
      handler.reset();
      expect(handler.processInput('/key')).toBe('/key');
      expect(handler.isInSecureMode()).toBe(true);

      handler.reset();
      expect(handler.processInput('/key ')).toBe('/key ');
      expect(handler.isInSecureMode()).toBe(true);

      // Masking starts when key content appears
      handler.reset();
      expect(handler.processInput('/key a')).toBe('/key *');
      expect(handler.isInSecureMode()).toBe(true);

      handler.reset();
      expect(handler.processInput('/key ab')).toBe('/key **');

      handler.reset();
      expect(handler.processInput('/key abc')).toBe('/key ***');

      // 'abcd1234' is 8 characters, so it should be fully masked
      handler.reset();
      expect(handler.processInput('/key abcd1234')).toBe('/key ********');
    });

    it('should exit secure mode when text is cleared', () => {
      handler.processInput('/key secret');
      expect(handler.isInSecureMode()).toBe(true);

      handler.processInput('');
      expect(handler.isInSecureMode()).toBe(false);
      expect(handler.getActualValue()).toBe('');
    });
  });

  describe('sanitizeForHistory', () => {
    it('should sanitize /key commands for history', () => {
      const command = '/key my-very-secret-api-key-12345';
      const sanitized = handler.sanitizeForHistory(command);

      // The key portion is 'my-very-secret-api-key-12345' which is 28 characters
      // First 2: 'my', Last 2: '45', Middle: 24 asterisks
      expect(sanitized).toBe('/key my************************45');
      expect(sanitized).not.toContain('secret');
    });

    it('should not sanitize other commands', () => {
      const commands = ['/help', '/clear', 'normal text', '/auth login'];

      commands.forEach((cmd) => {
        expect(handler.sanitizeForHistory(cmd)).toBe(cmd);
      });
    });

    it('should not mask /keyfile paths', () => {
      const command = '/keyfile ~/.mykey';
      const sanitized = handler.sanitizeForHistory(command);
      // File paths should not be masked
      expect(sanitized).toBe(command);
    });

    it('should handle edge cases', () => {
      expect(handler.sanitizeForHistory('')).toBe('');
      expect(handler.sanitizeForHistory('/key')).toBe('/key');
      expect(handler.sanitizeForHistory('/key ')).toBe('/key ');
    });
  });

  describe('reset', () => {
    it('should clear all secure state', () => {
      handler.processInput('/key secret-key');
      expect(handler.isInSecureMode()).toBe(true);
      expect(handler.getActualValue()).toBe('/key secret-key');

      handler.reset();

      expect(handler.isInSecureMode()).toBe(false);
      expect(handler.getActualValue()).toBe('');
    });
  });

  describe('masking behavior', () => {
    it('should show first and last 2 characters for long keys', () => {
      const testCases = [
        { input: '/key 123456789', expected: '/key 12*****89' }, // 9 chars: 12 + 5 asterisks + 89
        { input: '/key abcdefghijklmnop', expected: '/key ab************op' }, // 16 chars: ab + 12 asterisks + op
        { input: '/key AAAAAAAAAA', expected: '/key AA******AA' }, // 10 chars: AA + 6 asterisks + AA
      ];

      testCases.forEach(({ input, expected }) => {
        handler.reset();
        expect(handler.processInput(input)).toBe(expected);
      });
    });

    it('should mask pasted API keys immediately', () => {
      // Simulate pasting a full command with API key
      handler.reset();
      const pastedContent = '/key sk-proj-abcdefghijklmnopqrstuvwxyz123456789';
      const masked = handler.processInput(pastedContent);

      expect(masked).toBe('/key sk***************************************89');
      expect(handler.isInSecureMode()).toBe(true);
      expect(handler.getActualValue()).toBe(pastedContent);
    });

    it('should handle multi-line pasted content correctly', () => {
      // Simulate pasting API key with newline at the end
      handler.reset();
      const pastedContent =
        '/key sk-proj-abcdefghijklmnopqrstuvwxyz123456789\n';
      const masked = handler.processInput(pastedContent);

      expect(masked).toBe('/key sk***************************************89\n');
      expect(handler.isInSecureMode()).toBe(true);
      expect(handler.getActualValue()).toBe(pastedContent);
    });

    it('should handle progressive input then paste scenario', () => {
      // Simulate typing "/key " then pasting content with newline
      handler.reset();

      // First, user types "/key "
      let result = handler.processInput('/key ');
      expect(result).toBe('/key ');
      expect(handler.isInSecureMode()).toBe(true);

      // Then user pastes a key with newline
      result = handler.processInput(
        '/key sk-proj-abcdefghijklmnopqrstuvwxyz123456789\n',
      );
      expect(result).toBe('/key sk***************************************89\n');
      expect(handler.isInSecureMode()).toBe(true);
    });

    it('should not mask space after /key command', () => {
      // When user types "/key " the space should not be masked
      handler.reset();
      const result = handler.processInput('/key ');
      expect(result).toBe('/key '); // Should NOT be '/key *'
      expect(handler.isInSecureMode()).toBe(true);
    });

    it('should handle type /key[space] then paste scenario correctly', () => {
      // This is the exact scenario the user reported
      handler.reset();

      // Step 1: User types "/key "
      let result = handler.processInput('/key ');
      expect(result).toBe('/key '); // Space should not be masked

      // Step 2: User pastes content from pbcopy (with trailing newline)
      result = handler.processInput('/key mySecretAPIKeyFromFile\n');
      expect(result).toBe('/key my******************le\n'); // Should be masked with newline preserved

      // Verify we can get the actual value
      expect(handler.getActualValue()).toBe('/key mySecretAPIKeyFromFile\n');
    });

    it('should mask API key with carriage return after the key', () => {
      // Test with a carriage return (CR) after the key
      handler.reset();
      const keyWithCR = '/key mySecretKey123\r';
      const result = handler.processInput(keyWithCR);

      // The key should be masked and the carriage return preserved
      expect(result).toBe('/key my**********23\r');
      expect(handler.getActualValue()).toBe(keyWithCR);
    });

    it('should debug CR issue - what actually happens', () => {
      handler.reset();

      // Simulate the exact scenario: type "/key " then paste with CR
      const afterTyping = '/key ';
      const afterPaste = '/key mySecretKey123\r';

      // First, user types "/key "
      const result1 = handler.processInput(afterTyping);
      const debug1 = {
        input: JSON.stringify(afterTyping),
        output: JSON.stringify(result1),
        isSecure: handler.isInSecureMode(),
      };

      // Then paste happens
      const result2 = handler.processInput(afterPaste);
      const debug2 = {
        input: JSON.stringify(afterPaste),
        output: JSON.stringify(result2),
        isSecure: handler.isInSecureMode(),
        shouldBeSecure: handler.shouldUseSecureMode(afterPaste),
      };

      // What does the regex actually match?
      const match = afterPaste.match(/^\/key\s+([\s\S]*)/);
      const debug3 = {
        matched: !!match,
        groups: match ? match.map((g) => JSON.stringify(g)) : null,
      };

      // Also test with actual line ending characters
      const withLF = '/key mySecretKey123\n';
      const withCRLF = '/key mySecretKey123\r\n';
      const withMultipleCR = '/key mySecretKey123\r\r';

      const lfResult = handler.processInput(withLF);
      const crlfResult = handler.processInput(withCRLF);
      const multiCRResult = handler.processInput(withMultipleCR);

      // Write debug output to a file
      const debugOutput = JSON.stringify(
        {
          afterTyping: debug1,
          afterPaste: debug2,
          regexMatch: debug3,
          lineEndingTests: {
            LF: { input: withLF, output: lfResult },
            CRLF: { input: withCRLF, output: crlfResult },
            multiCR: { input: withMultipleCR, output: multiCRResult },
          },
        },
        null,
        2,
      );
      // Use os.tmpdir() for cross-platform temp directory
      const tmpPath = path.join(os.tmpdir(), 'cr-debug.json');
      writeFileSync(tmpPath, debugOutput);

      // Expectations
      expect(result1).toBe('/key ');
      expect(result2).toBe('/key my**********23\r');
      expect(lfResult).toBe('/key my**********23\n');
      expect(crlfResult).toBe('/key my**********23\r\n');
      expect(multiCRResult).toBe('/key my**********23\r\r');
    });

    it('should mask only the key part when content has newline in the middle', () => {
      // Simulate pasting API key with newline and additional content
      handler.reset();
      const pastedContent = '/key sk-proj-secret123\nsome other text';
      const masked = handler.processInput(pastedContent);

      expect(masked).toBe('/key sk*************23\nsome other text');
      expect(handler.isInSecureMode()).toBe(true);
      expect(handler.getActualValue()).toBe(pastedContent);
    });

    it('should mask short keys completely', () => {
      const testCases = [
        { input: '/key a', expected: '/key *' },
        { input: '/key ab', expected: '/key **' },
        { input: '/key abc', expected: '/key ***' },
        { input: '/key 12345678', expected: '/key ********' },
      ];

      testCases.forEach(({ input, expected }) => {
        handler.reset();
        expect(handler.processInput(input)).toBe(expected);
      });
    });
  });

  /**
   * Integration tests for /toolkey input masking.
   * Tests that the SecureInputHandler recognizes /toolkey as a secure command,
   * masks the PAT value portion, sanitizes history, and does NOT mask /toolkeyfile.
   *
   * @plan PLAN-20260206-TOOLKEY.P10
   */
  describe('/toolkey input masking', () => {
    /** @plan PLAN-20260206-TOOLKEY.P10 @requirement REQ-006.1, REQ-002.5 */
    describe('shouldUseSecureMode', () => {
      it('should detect /toolkey command', () => {
        expect(handler.shouldUseSecureMode('/toolkey')).toBe(true);
        expect(handler.shouldUseSecureMode('/toolkey ')).toBe(true);
        expect(handler.shouldUseSecureMode('/toolkey exa')).toBe(true);
        expect(handler.shouldUseSecureMode('/toolkey exa sk-key')).toBe(true);
      });

      it('should NOT detect /toolkeyfile command as secure (paths are not sensitive)', () => {
        expect(handler.shouldUseSecureMode('/toolkeyfile')).toBe(false);
        expect(handler.shouldUseSecureMode('/toolkeyfile exa ~/key')).toBe(
          false,
        );
      });
    });

    /** @plan PLAN-20260206-TOOLKEY.P10 @requirement REQ-006.1 */
    describe('processInput', () => {
      it('should mask PAT in /toolkey command', () => {
        handler.reset();
        const input = '/toolkey exa sk-secret-key-12345678';
        const processed = handler.processInput(input);
        // The PAT portion 'sk-secret-key-12345678' should be masked
        expect(processed).toContain('/toolkey exa');
        expect(processed).not.toContain('secret-key-12345678');
        // First 2 and last 2 of PAT visible
        expect(processed).toContain('sk');
        expect(processed).toContain('78');
      });

      it('should NOT mask tool name in /toolkey command', () => {
        handler.reset();
        const input = '/toolkey exa sk-key123456789';
        const processed = handler.processInput(input);
        expect(processed).toContain('/toolkey exa');
      });

      it('should not mask when only /toolkey exa typed (no PAT yet)', () => {
        handler.reset();
        expect(handler.processInput('/toolkey exa')).toBe('/toolkey exa');
        handler.reset();
        expect(handler.processInput('/toolkey exa ')).toBe('/toolkey exa ');
      });

      it('should mask short PATs completely', () => {
        handler.reset();
        const input = '/toolkey exa abc';
        const processed = handler.processInput(input);
        expect(processed).toBe('/toolkey exa ***');
      });
    });

    /** @plan PLAN-20260206-TOOLKEY.P10 @requirement REQ-006.2 */
    describe('sanitizeForHistory', () => {
      it('should sanitize /toolkey commands for history', () => {
        const command = '/toolkey exa sk-secret-key-12345678';
        const sanitized = handler.sanitizeForHistory(command);
        expect(sanitized).not.toContain('secret-key');
        expect(sanitized).toContain('/toolkey exa');
      });

      it('should not sanitize /toolkeyfile commands', () => {
        const command = '/toolkeyfile exa ~/.ssh/exa-key';
        const sanitized = handler.sanitizeForHistory(command);
        expect(sanitized).toBe(command);
      });
    });
  });
});
