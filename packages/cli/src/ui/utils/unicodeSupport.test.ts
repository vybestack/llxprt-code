/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  ASCII_BORDER_STYLES,
  ASCII_SPINNER_NAME,
  configureUnicodeSupport,
  detectUnicodeSupport,
  getBorderStyle,
  getSpinnerType,
  isUnicodeSupported,
  resetUnicodeSupportForTesting,
} from './unicodeSupport.js';

describe('detectUnicodeSupport', () => {
  describe('force mode', () => {
    it('returns true on win32', () => {
      expect(detectUnicodeSupport('force', 'win32', {})).toBe(true);
    });

    it('returns true on darwin', () => {
      expect(detectUnicodeSupport('force', 'darwin', {})).toBe(true);
    });

    it('returns true on linux', () => {
      expect(detectUnicodeSupport('force', 'linux', {})).toBe(true);
    });
  });

  describe('off mode', () => {
    it('returns false on win32', () => {
      expect(detectUnicodeSupport('off', 'win32', {})).toBe(false);
    });

    it('returns false on darwin', () => {
      expect(detectUnicodeSupport('off', 'darwin', {})).toBe(false);
    });

    it('returns false on linux', () => {
      expect(detectUnicodeSupport('off', 'linux', {})).toBe(false);
    });
  });

  describe('auto mode', () => {
    it('returns true on darwin', () => {
      expect(detectUnicodeSupport('auto', 'darwin', {})).toBe(true);
    });

    it('returns true on linux', () => {
      expect(detectUnicodeSupport('auto', 'linux', {})).toBe(true);
    });

    it('returns false on win32 by default', () => {
      expect(detectUnicodeSupport('auto', 'win32', {})).toBe(false);
    });

    it('returns true on win32 when LLXPRT_FORCE_UNICODE=1', () => {
      expect(
        detectUnicodeSupport('auto', 'win32', { LLXPRT_FORCE_UNICODE: '1' }),
      ).toBe(true);
    });

    it('returns false on win32 when LLXPRT_FORCE_UNICODE is not exactly 1', () => {
      expect(
        detectUnicodeSupport('auto', 'win32', {
          LLXPRT_FORCE_UNICODE: 'true',
        }),
      ).toBe(false);
    });
  });
});

describe('module singleton', () => {
  afterEach(() => {
    resetUnicodeSupportForTesting(true);
  });

  it('defaults to supported (preserves legacy Unicode-glyph behavior)', () => {
    resetUnicodeSupportForTesting();
    expect(isUnicodeSupported()).toBe(true);
  });

  it('reflects configureUnicodeSupport(off)', () => {
    configureUnicodeSupport('off');
    expect(isUnicodeSupported()).toBe(false);
  });

  it('reflects configureUnicodeSupport(force)', () => {
    configureUnicodeSupport('off');
    configureUnicodeSupport('force');
    expect(isUnicodeSupported()).toBe(true);
  });

  it('configureUnicodeSupport(auto) respects the current platform', () => {
    configureUnicodeSupport('auto');
    expect(isUnicodeSupported()).toBe(process.platform !== 'win32');
  });
});

describe('ASCII_BORDER_STYLES', () => {
  it('provides a round style with ASCII corners', () => {
    expect(ASCII_BORDER_STYLES.round.topLeft).toBe('+');
    expect(ASCII_BORDER_STYLES.round.topRight).toBe('+');
    expect(ASCII_BORDER_STYLES.round.bottomLeft).toBe('+');
    expect(ASCII_BORDER_STYLES.round.bottomRight).toBe('+');
    expect(ASCII_BORDER_STYLES.round.top).toBe('-');
    expect(ASCII_BORDER_STYLES.round.bottom).toBe('-');
    expect(ASCII_BORDER_STYLES.round.left).toBe('|');
    expect(ASCII_BORDER_STYLES.round.right).toBe('|');
  });

  it('provides a single style with ASCII corners', () => {
    expect(ASCII_BORDER_STYLES.single.topLeft).toBe('+');
    expect(ASCII_BORDER_STYLES.single.top).toBe('-');
    expect(ASCII_BORDER_STYLES.single.left).toBe('|');
  });
});

describe('ASCII_SPINNER_NAME', () => {
  it('is the "line" cli-spinner (pure ASCII frames)', () => {
    expect(ASCII_SPINNER_NAME).toBe('line');
  });
});

describe('getBorderStyle', () => {
  afterEach(() => {
    resetUnicodeSupportForTesting(true);
  });

  it('returns the named style string when Unicode is supported', () => {
    expect(getBorderStyle('round', true)).toBe('round');
    expect(getBorderStyle('single', true)).toBe('single');
  });

  it('returns an ASCII border object when round is unsupported', () => {
    expect(getBorderStyle('round', false)).toStrictEqual(
      ASCII_BORDER_STYLES.round,
    );
  });

  it('returns an ASCII border object when single is unsupported', () => {
    expect(getBorderStyle('single', false)).toStrictEqual(
      ASCII_BORDER_STYLES.single,
    );
  });

  it('reads the singleton when no explicit flag is given', () => {
    configureUnicodeSupport('off');
    expect(getBorderStyle('round')).toStrictEqual(ASCII_BORDER_STYLES.round);
    configureUnicodeSupport('force');
    expect(getBorderStyle('round')).toBe('round');
  });
});

describe('getSpinnerType', () => {
  afterEach(() => {
    resetUnicodeSupportForTesting(true);
  });

  it('returns the spinner type unchanged when supported', () => {
    expect(getSpinnerType('dots', true)).toBe('dots');
  });

  it('returns the ASCII spinner name when unsupported', () => {
    expect(getSpinnerType('dots', false)).toBe(ASCII_SPINNER_NAME);
    expect(getSpinnerType('dots', false)).toBe('line');
  });

  it('reads the singleton when no explicit flag is given', () => {
    configureUnicodeSupport('off');
    expect(getSpinnerType('dots')).toBe(ASCII_SPINNER_NAME);
    configureUnicodeSupport('force');
    expect(getSpinnerType('dots')).toBe('dots');
  });
});
