/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export function adverseTexts(): string[] {
  return [
    '',
    'a'.repeat(4096),
    'ABC',
    'ABCdefABCdef',
    ' A',
    ' \u0301A',
    '\u0301',
    '\u0301A',
    'a\u0301A',
    "I'M WE'RE they've it'd a'ſ A'ſ AB'LL",
    "a'rex a'llx a'Ve a'Re AB'RE",
    '1234567890 １２３４٥٦٧٨𝟘𝟙𝟚𝟛',
    '\r\n\r\n \t\r\n/!!!/\r\n//A',
    '   x',
    '   ',
    '\t\r\n \tX',
    '\u0085\u0085a\u00a0\u2007\u2028\u2029\ufeff\u001c\u001f',
    'a\u0085b\ufeffc',
    '雪中文 한글 Русский العربية हिन्दी தமிழ் Ελληνικά',
    '🙂👩🏽‍💻🏳️‍🌈🇺🇳\u200d\ufe0f',
    '\u01c5\u01c6\u02b0\u0300\u037a\u2160\u16f00',
    '<|endoftext|><|fim_prefix|><|fim_middle|><|fim_suffix|><|im_start|>',
    ' '.repeat(1024) + 'A\n',
    '!'.repeat(1024),
    '/\r\n/\r\n/',
    '\u1c89\u1c8a\u{10d50}\u{10d70}\u{1e4d0}\u{1e5d0}',
  ];
}

export function* differentialTexts(
  count: number,
  seed: number,
): Generator<string> {
  const atoms = [
    'a',
    'A',
    'AB',
    'ab',
    'Ab',
    'ABCdef',
    '雪',
    '한',
    'ع',
    'é',
    '\u0301',
    '\u01c5',
    '\u02b0',
    '🙂',
    '👩🏽‍💻',
    '\u200d',
    '\ufe0f',
    ' ',
    '\t',
    '\r',
    '\n',
    '\r\n',
    '\u0085',
    '\ufeff',
    '\u00a0',
    '\u2028',
    '\u001c',
    '1',
    '1234',
    '٥',
    '𝟘',
    '/',
    '!',
    '.,',
    '\\',
    '"',
    "'s",
    "'ſ",
    "'RE",
    "'ll",
    "'Ve",
    "'d",
    "'t",
    '<|endoftext|>',
    '\u1c89',
    '\u{1e5d0}',
  ];
  let state = seed >>> 0;
  function next(): number {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  }
  for (let index = 0; index < count; index++) {
    let text = '';
    const length = 1 + (next() % 96);
    for (let atom = 0; atom < length; atom++)
      text += atoms[next() % atoms.length];
    yield text;
  }
}
