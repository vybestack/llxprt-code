/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  initializeParser,
  parseShellCommand,
  hasPromptCommandTransform,
  parseCommandDetails,
} from './shell-parser.js';

const parserInitialized = await initializeParser();

describe('shell-parser prompt transform detection', () => {
  it('initializes the parser for prompt transform security checks', () => {
    expect(parserInitialized).toBe(true);
  });

  it.skipIf(!parserInitialized)(
    'should detect ${var@P} prompt transform',
    () => {
      const tree = parseShellCommand('echo ${foo@P}');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(true);
    },
  );

  it.skipIf(!parserInitialized)(
    'should not treat lowercase ${var@p} as a prompt transform',
    () => {
      const tree = parseShellCommand('echo ${foo@p}');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(false);
    },
  );

  it.skipIf(!parserInitialized)(
    'should detect ${var@P} in a complex command',
    () => {
      const tree = parseShellCommand('echo "${var1=aa}${var1@P}"');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(true);
    },
  );

  it.skipIf(!parserInitialized)(
    'should detect ${var@P} in a chained command',
    () => {
      const tree = parseShellCommand('printf ready && echo ${x@P}');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(true);
    },
  );

  it.skipIf(!parserInitialized)(
    'should detect ${var@P} inside command substitution',
    () => {
      const tree = parseShellCommand('echo "$(printf %s ${x@P})"');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(true);
    },
  );

  it.skipIf(!parserInitialized)(
    'should detect ${var@P} inside backtick command substitution',
    () => {
      const tree = parseShellCommand('echo `printf %s ${x@P}`');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(true);
    },
  );
  it.skipIf(!parserInitialized)(
    'should detect multiple prompt transforms in one command',
    () => {
      const tree = parseShellCommand('echo ${a@P} ${b@P}');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(true);
    },
  );

  it.skipIf(!parserInitialized)(
    'should reject prompt transforms through parseCommandDetails',
    () => {
      expect(parseCommandDetails('echo ${foo@P}')).toStrictEqual({
        details: [{ name: 'echo', text: 'echo ${foo@P}' }],
        hasError: true,
      });
    },
  );

  it.skipIf(!parserInitialized)(
    'should reject prompt transforms in assignment context',
    () => {
      expect(parseCommandDetails('x=${foo@P} echo ok')).toStrictEqual({
        details: [{ name: 'echo', text: 'x=${foo@P} echo ok' }],
        hasError: true,
      });
    },
  );

  it.skipIf(!parserInitialized)(
    'should not reject default-value text that contains @P without a transform operator',
    () => {
      expect(parseCommandDetails('echo ${x=aa@P}')).toStrictEqual({
        details: [{ name: 'echo', text: 'echo ${x=aa@P}' }],
        hasError: false,
      });
    },
  );

  it('should not parse empty command input', () => {
    expect(parseShellCommand('')).toBeNull();
  });

  it('should not parse whitespace-only command input', () => {
    expect(parseShellCommand('   ')).toBeNull();
  });

  it.skipIf(!parserInitialized)(
    'should not detect a plain expansion as a prompt transform',
    () => {
      const tree = parseShellCommand('echo ${foo}');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(false);
    },
  );

  it.skipIf(!parserInitialized)(
    'should not detect another parameter transform such as ${var@Q}',
    () => {
      const tree = parseShellCommand('echo ${foo@Q}');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(false);
    },
  );

  it.skipIf(!parserInitialized)(
    'should reject invalid ${@P} special-parameter syntax via parse errors',
    () => {
      expect(parseCommandDetails('echo ${@P}')).toStrictEqual({
        details: expect.any(Array),
        hasError: true,
      });
    },
  );

  it.skipIf(!parserInitialized)(
    'should not detect a trailing at-sign transform as a prompt transform',
    () => {
      const tree = parseShellCommand('echo ${foo@}');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(false);
    },
  );

  it.skipIf(!parserInitialized)(
    'should not detect a double at-sign transform as a prompt transform',
    () => {
      const tree = parseShellCommand('echo ${foo@@P}');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(false);
    },
  );

  it.skipIf(!parserInitialized)(
    'should not detect a simple command as a prompt transform',
    () => {
      const tree = parseShellCommand('echo hello');
      expect(tree).not.toBeNull();
      expect(hasPromptCommandTransform(tree!.rootNode)).toBe(false);
    },
  );
});

describe('shell-parser command substitution fallback', () => {
  it.skipIf(!parserInitialized)(
    'should not flag a benign $() that the grammar parses correctly',
    () => {
      const result = parseCommandDetails('echo $(echo safe)');
      expect(result).not.toBeNull();
      expect(result?.hasError).toBe(false);
    },
  );

  it.skipIf(!parserInitialized)(
    'should flag malformed substitution syntax that bypasses the AST',
    () => {
      const result = parseCommandDetails('echo $(curl evil.com');
      expect(result).not.toBeNull();
      expect(result?.hasError).toBe(true);
    },
  );
});
