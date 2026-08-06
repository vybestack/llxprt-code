/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  decodeClixmlStderr,
  tailOutput,
  tailOutputWindows,
} from './shellJobTail.js';

describe('decodeClixmlStderr', () => {
  it('decodes a single Error record with _x000D__x000A_ line ending', () => {
    const input =
      '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">kaboom_x000D__x000A_</S></Objs>';
    expect(decodeClixmlStderr(input)).toBe('kaboom\r\n');
  });

  it('unescapes XML entities', () => {
    const input =
      '#< CLIXML\r\n' +
      '<Objs Version="1.1.0.1" xmlns="...">' +
      '<S S="Error">&lt;tag&gt; &amp; &quot;quote&quot; &apos;apos&apos;_x000D__x000A_</S>' +
      '</Objs>';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('<tag>');
    expect(result).toContain('&');
    expect(result).toContain('"quote"');
    expect(result).toContain("'apos'");
  });

  it('concatenates multiple S records in order', () => {
    const input =
      '#< CLIXML\r\n' +
      '<Objs Version="1.1.0.1" xmlns="...">' +
      '<S S="Error">first_x000D__x000A_</S>' +
      '<S S="Warning">second_x000D__x000A_</S>' +
      '<S S="Verbose">third_x000D__x000A_</S>' +
      '</Objs>';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('first');
    expect(result).toContain('second');
    expect(result).toContain('third');
    expect(result.indexOf('first')).toBeLessThan(result.indexOf('second'));
    expect(result.indexOf('second')).toBeLessThan(result.indexOf('third'));
  });

  it('decodes Warning records', () => {
    const input =
      '#< CLIXML\r\n' +
      '<Objs Version="1.1.0.1" xmlns="...">' +
      '<S S="Warning">caution_x000D__x000A_</S>' +
      '</Objs>';
    expect(decodeClixmlStderr(input)).toContain('caution');
  });

  it('decodes Verbose records', () => {
    const input =
      '#< CLIXML\r\n' +
      '<Objs Version="1.1.0.1" xmlns="...">' +
      '<S S="Verbose">detail_x000D__x000A_</S>' +
      '</Objs>';
    expect(decodeClixmlStderr(input)).toContain('detail');
  });

  it('decodes Debug records', () => {
    const input =
      '#< CLIXML\r\n' +
      '<Objs Version="1.1.0.1" xmlns="...">' +
      '<S S="Debug">trace_x000D__x000A_</S>' +
      '</Objs>';
    expect(decodeClixmlStderr(input)).toContain('trace');
  });

  it('passes plain (non-CLIXML) stderr through byte-identical', () => {
    const plain = 'native-err \r\n';
    expect(decodeClixmlStderr(plain)).toBe(plain);
  });

  it('passes empty string through unchanged', () => {
    expect(decodeClixmlStderr('')).toBe('');
  });

  it('passes whitespace-only stderr through unchanged', () => {
    expect(decodeClixmlStderr('  \r\n  ')).toBe('  \r\n  ');
  });

  it('strips the marker and emits malformed CLIXML remainder verbatim', () => {
    const malformed = '#< CLIXML\r\n<<<broken>>>';
    // Only the recognised marker is suppressed; the unrecognised remainder is
    // emitted verbatim (no whole-document raw fallback).
    expect(decodeClixmlStderr(malformed)).toBe('<<<broken>>>');
  });

  it('emits a truncated trailing record verbatim after suppressing the marker', () => {
    const truncated =
      '#< CLIXML\r\n<Objs Version="1.1.0.1"><S S="Error">unterminated';
    // Marker + complete <Objs> open tag suppressed; the incomplete record is
    // not recognised so it is emitted verbatim — nothing is lost.
    expect(decodeClixmlStderr(truncated)).toBe('<S S="Error">unterminated');
  });
});

describe('decodeClixmlStderr — mid-document fragments', () => {
  // A bounded tail read of a CLIXML log starts somewhere inside <Objs>, so the
  // slice will NOT begin with the `#< CLIXML` marker. The decoder must still
  // recognise and decode the records it can see.

  it('decodes <S S="Error"> records when the slice starts inside <Objs>', () => {
    const fragment =
      '<S S="Error">midstream-error_x000D__x000A_</S>' +
      '<S S="Warning">also_x000D__x000A_</S></Objs>';
    const result = decodeClixmlStderr(fragment);
    expect(result).toContain('midstream-error\r\n');
    expect(result).toContain('also\r\n');
    expect(result).not.toContain('<S S=');
    expect(result).not.toContain('<Objs');
  });

  it('preserves text before a stray </S> and decodes a later complete record', () => {
    // Slice starts inside an unterminated record text, then a complete record.
    // The leading fragment and its stray </S> are NOT recognised, so they are
    // emitted verbatim — nothing is lost — and the later record still decodes.
    const fragment =
      'broken-tail_x000D__x000A_</S><S S="Error">recovered_x000D__x000A_</S>';
    const result = decodeClixmlStderr(fragment);
    expect(result).toContain('recovered\r\n');
    expect(result).toContain('broken-tail');
    expect(result).not.toContain('<S S=');
  });

  it('passes genuinely plain stderr byte-identical even with stray angle brackets', () => {
    const plain = 'something went wrong at line 3\n';
    expect(decodeClixmlStderr(plain)).toBe(plain);
  });
});

describe('decodeClixmlStderr — native text mixed with CLIXML (F3)', () => {
  it('preserves native text BEFORE a CLIXML record', () => {
    const input = 'native-error\n<S S="Error">ps-error_x000A_</S>';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('native-error\n');
    expect(result).toContain('ps-error\n');
    expect(result).not.toContain('<S S=');
  });

  it('preserves native text BETWEEN two CLIXML records', () => {
    const input =
      '<S S="Error">first_x000A_</S>' +
      'in-between-native\n' +
      '<S S="Warning">second_x000A_</S>';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('first\n');
    expect(result).toContain('in-between-native\n');
    expect(result).toContain('second\n');
    expect(result).not.toContain('<S S=');
    // Order: first before in-between before second
    expect(result.indexOf('first')).toBeLessThan(result.indexOf('in-between'));
    expect(result.indexOf('in-between')).toBeLessThan(result.indexOf('second'));
  });

  it('preserves native text AFTER the last CLIXML record', () => {
    const input = '<S S="Error">err_x000A_</S>trailing-native';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('err\n');
    expect(result).toContain('trailing-native');
    expect(result).not.toContain('<S S=');
  });

  it('preserves native text before, between, and after records simultaneously', () => {
    const input =
      'before-native\n' +
      '<S S="Error">rec-one_x000A_</S>' +
      'middle-native\n' +
      '<S S="Warning">rec-two_x000A_</S>' +
      'after-native';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('before-native\n');
    expect(result).toContain('rec-one\n');
    expect(result).toContain('middle-native\n');
    expect(result).toContain('rec-two\n');
    expect(result).toContain('after-native');
    expect(result).not.toContain('<S S=');
    expect(result).not.toContain('<Objs');
  });

  it('preserves native text before and after a full CLIXML document', () => {
    const input =
      'native-before\n' +
      '#< CLIXML\r\n' +
      '<Objs Version="1.1.0.1" xmlns="x">' +
      '<S S="Error">doc-err_x000A_</S>' +
      '</Objs>' +
      '\nnative-after';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('native-before\n');
    expect(result).toContain('doc-err\n');
    expect(result).toContain('native-after');
    expect(result).not.toContain('<S S=');
    expect(result).not.toContain('<Objs');
    expect(result).not.toContain('#< CLIXML');
  });

  it('preserves content of an Info stream record rather than dropping it', () => {
    // The decoder treats ALL <S S="..."> records identically — any stream
    // type (Error, Warning, Info, Verbose, Debug) has its unescaped content
    // emitted. There is no supported/unsupported stream distinction.
    const input = 'log output <S S="Info">not-real-clixml</S> trailing';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('log output ');
    expect(result).toContain('not-real-clixml');
    expect(result).toContain(' trailing');
    expect(result).not.toContain('<S S=');
  });

  it('preserves text before a stray </S> (no byte loss)', () => {
    const fragment =
      'incomplete-tail_x000A_</S><S S="Error">recovered_x000A_</S>';
    const result = decodeClixmlStderr(fragment);
    expect(result).toContain('recovered\n');
    expect(result).toContain('incomplete-tail');
    expect(result).not.toContain('<S S=');
  });
});

describe('decodeClixmlStderr — native text inside <Objs> (G3)', () => {
  it('preserves native text inside <Objs> between records', () => {
    const input =
      '<Objs Version="1.1.0.1" xmlns="x">' +
      '<S S="Error">one_x000A_</S>' +
      'native-between' +
      '<S S="Warning">two_x000A_</S>' +
      '</Objs>';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('one\n');
    expect(result).toContain('native-between');
    expect(result).toContain('two\n');
    expect(result).not.toContain('<S S=');
    expect(result).not.toContain('<Objs');
    // Order preserved
    expect(result.indexOf('one')).toBeLessThan(
      result.indexOf('native-between'),
    );
    expect(result.indexOf('native-between')).toBeLessThan(
      result.indexOf('two'),
    );
  });

  it('preserves native text inside <Objs> with full CLIXML marker', () => {
    const input =
      '#< CLIXML\r\n' +
      '<Objs Version="1.1.0.1" xmlns="x">' +
      '<S S="Error">first_x000A_</S>' +
      'interleaved-native' +
      '<S S="Warning">second_x000A_</S>' +
      '</Objs>';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('first\n');
    expect(result).toContain('interleaved-native');
    expect(result).toContain('second\n');
    expect(result).not.toContain('<S S=');
    expect(result).not.toContain('<Objs');
    expect(result).not.toContain('#< CLIXML');
  });
});

describe('decodeClixmlStderr — malformed after valid record (no-loss rule)', () => {
  it('decodes the valid record and emits the truncated tail verbatim', () => {
    const input = '<S S="Error">valid_x000A_</S><S S="Error">truncated';
    // The valid record decodes; the truncated opener is emitted verbatim.
    expect(decodeClixmlStderr(input)).toBe('valid\n<S S="Error">truncated');
  });

  it('decodes the valid record and emits the unclosed tag verbatim', () => {
    const input = '<S S="Warning">ok_x000A_</S><S S="Error">no-close';
    expect(decodeClixmlStderr(input)).toBe('ok\n<S S="Error">no-close');
  });

  it('decodes the valid record and emits many unmatched openers verbatim', () => {
    const valid = '<S S="Error">good_x000A_</S>';
    const malformed = '<S S="Error">unmatched'.repeat(100);
    const input = valid + malformed;
    expect(decodeClixmlStderr(input)).toBe('good\n' + malformed);
  });
});

describe('decodeClixmlStderr — linear scanning of complete records (G4)', () => {
  it('handles 30k short COMPLETE records without quadratic blowup and EXACT output', () => {
    // This is the actual quadratic path: N complete records, each with its own
    // </S>. The old findNextClixmlToken rescanned the entire suffix for every
    // absent token class on every iteration.
    const inRecords: string[] = [];
    const outRecords: string[] = [];
    for (let i = 0; i < 30000; i++) {
      inRecords.push(`<S S="Error">r${i}_x000A_</S>`);
      outRecords.push(`r${i}\n`);
    }
    const input = inRecords.join('');
    const expected = outRecords.join('');

    const start = Date.now();
    const result = decodeClixmlStderr(input);
    const elapsed = Date.now() - start;

    // EXACT equality over all 30 000 records — an implementation dropping any
    // middle record would fail this.
    expect(result).toBe(expected);
    // No raw CLIXML markup leaks.
    expect(result).not.toContain('<S S=');
    expect(result).not.toContain('</S>');
    // Time bound — a true linear scan processes 30k short records quickly.
    expect(elapsed).toBeLessThan(2000);
  });

  it('handles many complete records inside <Objs> without quadratic blowup', () => {
    const records: string[] = ['<Objs Version="1.1.0.1" xmlns="x">'];
    for (let i = 0; i < 20000; i++) {
      records.push(`<S S="Error">m${i}_x000A_</S>`);
    }
    records.push('</Objs>');
    const input = records.join('');

    const start = Date.now();
    const result = decodeClixmlStderr(input);
    const elapsed = Date.now() - start;

    expect(result).toContain('m0\n');
    expect(result).toContain('m19999\n');
    expect(result).not.toContain('<S S=');
    expect(result).not.toContain('<Objs');
    expect(elapsed).toBeLessThan(2000);
  });

  it('handles a large unmatched-opener (malformed-prefix) input with EXACT output and a time bound', () => {
    // A large input of only unmatched openers: every '<' is unrecognised and
    // emitted verbatim. This must stay linear and must not lose or rewrite any
    // byte. The whole input is the expected output.
    const opener = '<S S="Error">unmatched';
    const count = 30000;
    const input = opener.repeat(count);

    const start = Date.now();
    const result = decodeClixmlStderr(input);
    const elapsed = Date.now() - start;

    // Exact verbatim preservation — no byte lost or rewritten.
    expect(result).toBe(input);
    // Linear time bound.
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('decodeClixmlStderr — strict no-loss rule (H1)', () => {
  // The guiding invariant: only a positively recognised, complete, well-formed
  // construct may be rewritten. Every other byte is emitted verbatim, in order.
  it('preserves native text before a stray </S> AND decodes the later record', () => {
    const input = 'native</S><S S="Error">ok</S>';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('native');
    expect(result).toContain('ok');
  });

  it('preserves content of an unsupported-stream record instead of dropping it', () => {
    const input = '<S S="Error">ok</S><S S="Info">keep</S>';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('ok');
    expect(result).toContain('keep');
  });

  it('preserves <ObjsBogus> verbatim (tag-name boundary check)', () => {
    const input = '<ObjsBogus>';
    expect(decodeClixmlStderr(input)).toBe(input);
  });

  it('preserves nested records verbatim (content contains <)', () => {
    const input = '<S S="Error">outer<S S="Warning">inner</S></S>';
    expect(decodeClixmlStderr(input)).toBe(input);
  });

  it('preserves a truncated trailing record verbatim', () => {
    const input = '<S S="Error">incomplete';
    expect(decodeClixmlStderr(input)).toBe(input);
  });

  it('preserves native text between records inside <Objs>', () => {
    const input =
      '<Objs Version="1.1.0.1" xmlns="x">' +
      '<S S="Error">one</S>' +
      'native-between' +
      '<S S="Warning">two</S>' +
      '</Objs>';
    const result = decodeClixmlStderr(input);
    expect(result).toContain('one');
    expect(result).toContain('native-between');
    expect(result).toContain('two');
    expect(result).not.toContain('<S S=');
    expect(result).not.toContain('<Objs');
    // Order preserved.
    expect(result.indexOf('one')).toBeLessThan(
      result.indexOf('native-between'),
    );
    expect(result.indexOf('native-between')).toBeLessThan(
      result.indexOf('two'),
    );
  });

  it('preserves every non-wrapper character across a corpus (no data loss)', () => {
    // For each corpus input, assert the "kept" characters (record contents and
    // all verbatim text) appear in order in the output — a subsequence check.
    const isSubsequence = (keep: string, out: string): boolean => {
      let oi = 0;
      for (const ch of keep) {
        const found = out.indexOf(ch, oi);
        if (found === -1) return false;
        oi = found + 1;
      }
      return true;
    };

    const cases: Array<{ input: string; keep: string }> = [
      { input: '<S S="Error">hello</S>', keep: 'hello' },
      {
        input: 'native-text<S S="Warning">world</S>',
        keep: 'native-textworld',
      },
      {
        input:
          '<Objs Version="1"><S S="Error">a</S>mid<S S="Debug">b</S></Objs>',
        keep: 'amidb',
      },
      { input: '<S S="Info">unsupported</S>', keep: 'unsupported' },
      // Stray </S> and plain brackets stay verbatim (no CLIXML recognised).
      { input: 'before</S>after', keep: 'before</S>after' },
      // Tag-name boundary: emitted verbatim in full.
      { input: '<ObjsBogus>', keep: '<ObjsBogus>' },
      // Nested record: emitted verbatim in full.
      {
        input: '<S S="Error">nest<S S="Warning">x</S></S>',
        keep: '<S S="Error">nest<S S="Warning">x</S></S>',
      },
      // Truncated record: emitted verbatim in full.
      { input: '<S S="Error">incomplete', keep: '<S S="Error">incomplete' },
      // Marker + container suppressed, record content kept.
      {
        input:
          '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="x"><S S="Error">keep-me</S></Objs>',
        keep: 'keep-me',
      },
      // (I1) Marker matched anywhere with no boundary → verbatim.
      { input: 'prefix#< CLIXMLsuffix', keep: 'prefix#< CLIXMLsuffix' },
      // (I1) Unterminated attribute quote in <Objs> → verbatim.
      {
        input: '<Objs attr="unterminated>',
        keep: '<Objs attr="unterminated>',
      },
      // (I1) Unterminated attribute quote in <S> wrapper → verbatim.
      {
        input: '<S S="Error" attr="unterminated>keep</S>',
        keep: '<S S="Error" attr="unterminated>keep</S>',
      },
      // (I1) Closing tag with attributes → verbatim.
      { input: '</Objs foo="bar">', keep: '</Objs foo="bar">' },
    ];

    for (const { input, keep } of cases) {
      const out = decodeClixmlStderr(input);
      expect(isSubsequence(keep, out)).toBe(true);
    }
  });
});

describe('decodeClixmlStderr (I1) — well-formedness verification', () => {
  // (I1-a) The marker must be a complete line marker, not matched anywhere.
  it('emits prefix#< CLIXMLsuffix verbatim (marker not at line boundary)', () => {
    expect(decodeClixmlStderr('prefix#< CLIXMLsuffix')).toBe(
      'prefix#< CLIXMLsuffix',
    );
  });

  it('suppresses the marker when it IS a real line marker at index 0', () => {
    const input = '#< CLIXML\r\nbody';
    // Marker at index 0, followed by CRLF → recognised and suppressed.
    expect(decodeClixmlStderr(input)).toBe('body');
  });

  it('suppresses the marker when preceded by a line feed', () => {
    const input = 'preceding\n#< CLIXML\nbody';
    // # is after \n → valid line marker; suppressed.
    expect(decodeClixmlStderr(input)).toBe('preceding\nbody');
  });

  // (I1-b) Container tag with unterminated attribute quote → verbatim.
  it('emits <Objs attr="unterminated> verbatim', () => {
    expect(decodeClixmlStderr('<Objs attr="unterminated>')).toBe(
      '<Objs attr="unterminated>',
    );
  });

  // (I1-c) Record wrapper with unterminated attribute quote → verbatim.
  it('emits <S S="Error" attr="unterminated>keep</S> verbatim', () => {
    expect(decodeClixmlStderr('<S S="Error" attr="unterminated>keep</S>')).toBe(
      '<S S="Error" attr="unterminated>keep</S>',
    );
  });

  // Closing tags must have no attributes.
  it('emits </Objs foo="bar"> verbatim (closing tags take no attributes)', () => {
    expect(decodeClixmlStderr('</Objs foo="bar">')).toBe('</Objs foo="bar">');
  });

  // Do not over-correct: a well-formed multi-attribute <Objs> IS suppressed.
  it('suppresses a well-formed multi-attribute <Objs> (real PowerShell header)', () => {
    const header =
      '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">';
    const input = `${header}<S S="Error">err_x000A_</S></Objs>`;
    const result = decodeClixmlStderr(input);
    expect(result).not.toContain('<Objs');
    expect(result).toContain('err\n');
  });

  // A > inside a quoted attribute value does not prematurely end the tag.
  it('handles a > inside a quoted attribute value without premature termination', () => {
    // The > inside the xmlns URL is inside a quoted value; the tag must still
    // be lexed as a complete, well-formed <Objs> open tag and suppressed.
    const input =
      '<Objs Version="1.1.0.1" xmlns="http://x>y"><S S="Error">ok</S></Objs>';
    const result = decodeClixmlStderr(input);
    expect(result).not.toContain('<Objs');
    expect(result).toContain('ok');
  });

  // PERFORMANCE: one valid record followed by 30 000 unmatched openers.
  it('processes 30k unmatched openers after one valid record in linear time', () => {
    const valid = '<S S="Error">good_x000A_</S>';
    const opener = '<S S="Error">';
    const count = 30000;
    const input = valid + opener.repeat(count);
    const expected = 'good\n' + opener.repeat(count);

    const start = Date.now();
    const result = decodeClixmlStderr(input);
    const elapsed = Date.now() - start;

    expect(result).toBe(expected);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('decodeClixmlStderr — strict lexer counterexamples (round 5)', () => {
  // Each of these was a confirmed byte-loss counterexample under the old
  // lexWellFormedTag scanner. The strict lexTag must emit each VERBATIM.

  it('(a) unterminated single-quoted attribute — emit verbatim', () => {
    const input = "#< CLIXML\n<Objs attr='unterminated>suffix";
    expect(decodeClixmlStderr(input)).toBe("<Objs attr='unterminated>suffix");
  });

  it('(b) illegal < inside double-quoted attribute value — emit verbatim', () => {
    const input = '#< CLIXML\n<Objs attr="a<b">suffix';
    expect(decodeClixmlStderr(input)).toBe('<Objs attr="a<b">suffix');
  });

  it('(c) malformed opener does not swallow the real following opener', () => {
    // The bogus <S bogus= fails at the '=' (no quote follows), emitting
    // <S bogus= verbatim. The real <S S="Error">keep</S> then decodes.
    const input = '#< CLIXML\n<S bogus=<S S="Error">keep</S>';
    expect(decodeClixmlStderr(input)).toBe('<S bogus=keep');
  });

  it('(d) self-closing opener does not pair with a later </S>', () => {
    // <S S="Error"/> is consumed as an empty record. The stray </S> is
    // emitted verbatim along with the native text.
    const input = '<S S="Error"/>native</S>';
    expect(decodeClixmlStderr(input)).toBe('native</S>');
  });

  it('single-quoted WELL-FORMED attribute is still suppressed', () => {
    const input = "<S S='Error'>x</S>";
    expect(decodeClixmlStderr(input)).toBe('x');
  });

  it('bare <S> with no attributes is NOT a record — emit verbatim', () => {
    const input = '<S>keep</S>';
    expect(decodeClixmlStderr(input)).toBe('<S>keep</S>');
  });

  it('self-closing <S S="Error"/> followed by native</S> preserves native</S>', () => {
    const input = '<S S="Error"/>native</S>';
    expect(decodeClixmlStderr(input)).toBe('native</S>');
  });

  it('well-formed multi-attribute <Objs> with mixed quote styles is suppressed', () => {
    const input = '<Objs a="x" b=\'y\'><S S="Error">ok</S></Objs>';
    expect(decodeClixmlStderr(input)).toBe('ok');
  });

  it('whitespace around = is a grammar failure — emit verbatim', () => {
    const input = '<Objs a = "x">';
    expect(decodeClixmlStderr(input)).toBe('<Objs a = "x">');
  });

  it('missing whitespace before attribute is a grammar failure — emit verbatim', () => {
    const input = '<Objsa="x">';
    expect(decodeClixmlStderr(input)).toBe('<Objsa="x">');
  });

  it('real PowerShell <Objs> header with xmlns is suppressed', () => {
    const header =
      '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">';
    const input = `${header}<S S="Error">err</S></Objs>`;
    const result = decodeClixmlStderr(input);
    expect(result).toBe('err');
  });

  it('PERFORMANCE: 30k malformed <S openers complete in linear time with exact output', () => {
    const marker = '#< CLIXML\n';
    const body = '<S '.repeat(30000);
    const input = marker + body;
    const expected = body; // marker suppressed, body emitted verbatim

    const start = Date.now();
    const result = decodeClixmlStderr(input);
    const elapsed = Date.now() - start;

    expect(result).toBe(expected);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe('decodeClixmlStderr — duplicate attribute names (round 7)', () => {
  // Duplicate attribute names are not well-formed XML. Previously
  // attributes.set() silently overwrote the duplicate, letting the decoder
  // SUPPRESS malformed input. Now the strict lexer rejects the tag at the
  // duplicate name's start offset, so the malformed tag is emitted verbatim
  // and nothing is silently lost.

  it('preserves <Objs a="x" a="y"> verbatim (previously suppressed to empty)', () => {
    const input = '<Objs a="x" a="y">';
    expect(decodeClixmlStderr(input)).toBe('<Objs a="x" a="y">');
  });

  it('preserves <S S="Error" S="Warning">x</S> verbatim (previously rewritten to x)', () => {
    const input = '<S S="Error" S="Warning">x</S>';
    expect(decodeClixmlStderr(input)).toBe('<S S="Error" S="Warning">x</S>');
  });

  it('preserves a duplicate attribute on a real-looking PowerShell header verbatim', () => {
    const header =
      '<Objs Version="1.1.0.1" Version="1.2.0.0" xmlns="http://schemas.microsoft.com/powershell/2004/04">';
    const input = `${header}<S S="Error">err_x000A_</S></Objs>`;
    // The malformed header (duplicate Version) is emitted verbatim — it is
    // NOT suppressed as a well-formed container opener would be. The
    // well-formed inner record still decodes and the well-formed </Objs>
    // closer is still suppressed.
    expect(decodeClixmlStderr(input)).toBe(`${header}err
`);
  });

  // REGRESSION GUARD: distinct attribute names must still be suppressed.
  it('still suppresses the genuine PowerShell header with distinct attribute names', () => {
    const header =
      '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">';
    const input = `${header}<S S="Error">err_x000A_</S></Objs>`;
    expect(decodeClixmlStderr(input)).toBe('err\n');
  });

  // REGRESSION GUARD: a normal record still decodes.
  it('still decodes a normal <S S="Error">text</S> record to text', () => {
    expect(decodeClixmlStderr('<S S="Error">text</S>')).toBe('text');
  });
});

describe('tailOutputWindows — bounded stderr read', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clixml-tail-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('bounds the merged result when stderr far exceeds maxBytes and keeps the LAST records', () => {
    const stdoutPath = path.join(dir, 'out.log');
    const errPath = path.join(dir, 'err.log');
    fs.writeFileSync(stdoutPath, 'stdout-line\n', 'utf8');

    // Build a CLIXML stderr much larger than maxBytes with many distinct records.
    const records: string[] = [];
    for (let i = 0; i < 500; i++) {
      records.push(`<S S="Error">err-${i}_x000D__x000A_</S>`);
    }
    const clixml =
      '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="x">' +
      records.join('') +
      '</Objs>';
    fs.writeFileSync(errPath, clixml, 'utf8');

    const maxBytes = 256;
    const result = tailOutputWindows(stdoutPath, errPath, 'job-1', {
      maxBytes,
      lines: 1000,
    });

    // The merged result is bounded on UTF-8 bytes, far smaller than the full CLIXML.
    expect(Buffer.byteLength(result.output, 'utf8')).toBeLessThan(
      Buffer.byteLength(clixml, 'utf8'),
    );
    expect(Buffer.byteLength(result.output, 'utf8')).toBeLessThanOrEqual(
      maxBytes,
    );
    // It contains the LAST records, not the first.
    expect(result.output).toContain('err-499');
    expect(result.output).not.toContain('err-0');
    // No raw CLIXML XML leaks to the model.
    expect(result.output).not.toContain('<S S=');
    expect(result.output).not.toContain('<Objs');
  });

  it('decodes a CLIXML document whose tail slice starts inside <Objs>', () => {
    const stdoutPath = path.join(dir, 'out.log');
    const errPath = path.join(dir, 'err.log');
    fs.writeFileSync(stdoutPath, '', 'utf8');

    // Padding makes the bounded tail read begin mid-document.
    const padding: string[] = [];
    for (let i = 0; i < 400; i++) {
      padding.push(`<S S="Error">pad-${i}_x000D__x000A_</S>`);
    }
    const tail = '<S S="Error">real-error_x000D__x000A_</S></Objs>';
    const clixml =
      '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="x">' +
      padding.join('') +
      tail;
    fs.writeFileSync(errPath, clixml, 'utf8');

    const result = tailOutputWindows(stdoutPath, errPath, 'job-2', {
      maxBytes: 200,
      lines: 1000,
    });

    expect(result.output).toContain('real-error');
    expect(result.output).not.toContain('<S S=');
    expect(result.output).not.toContain('<Objs');
  });

  it('passes plain (non-CLIXML) stderr through byte-identical within the merged shape', () => {
    const stdoutPath = path.join(dir, 'out.log');
    const errPath = path.join(dir, 'err.log');
    fs.writeFileSync(stdoutPath, 'stdout-content\n', 'utf8');
    const plain = 'native-error line one\nnative-error line two\n';
    fs.writeFileSync(errPath, plain, 'utf8');

    const result = tailOutputWindows(stdoutPath, errPath, 'job-3', {
      maxBytes: 4096,
      lines: 50,
    });

    expect(result.output).toContain('stdout-content');
    expect(result.output).toContain('[stderr]');
    expect(result.output).toContain('native-error line one');
    expect(result.output).toContain('native-error line two');
    expect(result.output).not.toContain('<S S=');
    expect(result.output).not.toContain('<Objs');
  });

  it('respects the merged line budget when stderr contributes many lines', () => {
    const stdoutPath = path.join(dir, 'out.log');
    const errPath = path.join(dir, 'err.log');
    fs.writeFileSync(stdoutPath, 'stdout-content\n', 'utf8');

    // Many short plain-stderr lines, each within the byte budget in total.
    const lines: string[] = [];
    for (let i = 0; i < 100; i++) {
      lines.push(`err-line-${i}`);
    }
    fs.writeFileSync(errPath, lines.join('\n') + '\n', 'utf8');

    const lineBudget = 10;
    const result = tailOutputWindows(stdoutPath, errPath, 'job-4', {
      maxBytes: 65536,
      lines: lineBudget,
    });

    // The merged output never exceeds the requested line budget.
    const outputLineCount = result.output.split('\n').length;
    expect(outputLineCount).toBeLessThanOrEqual(lineBudget);
    // The LAST stderr lines are kept.
    expect(result.output).toContain('err-line-99');
    expect(result.output).not.toContain('err-line-0');
  });

  it('sets truncated=true when raw stderr was truncated but decoded to empty (I3)', () => {
    const stdoutPath = path.join(dir, 'out.log');
    const errPath = path.join(dir, 'err.log');
    fs.writeFileSync(stdoutPath, '', 'utf8');

    // A CLIXML stderr that suppresses entirely to empty. We write enough
    // copies so that the bounded tail read starts mid-file (hasEarlierData),
    // but the tail slice is still all complete markers that suppress to "".
    // Each "#< CLIXML\r\n" marker is 11 bytes.
    const markerLine = '#< CLIXML\r\n';
    const copies = 50;
    const totalBytes = copies * 11;
    // maxBytes = (copies - 1) * 11 so the tail starts at byte 11 (start of
    // the 2nd marker) — hasEarlierData is true and all 49 markers in the tail
    // are complete line markers that suppress to empty.
    const maxBytes = (copies - 1) * 11;
    fs.writeFileSync(errPath, markerLine.repeat(copies), 'utf8');

    const result = tailOutputWindows(stdoutPath, errPath, 'job-i3', {
      maxBytes,
      lines: 1000,
    });

    // Decoded stderr is empty/whitespace so it is not appended, but the raw
    // stderr WAS truncated — truncated must be true.
    expect(result.output.trim()).toBe('');
    expect(result.truncated).toBe(true);
    expect(totalBytes).toBeGreaterThan(maxBytes);
  });

  it('preserves whitespace-only stderr (F5: " \\t" is genuine content)', () => {
    const stdoutPath = path.join(dir, 'out.log');
    const errPath = path.join(dir, 'err.log');
    fs.writeFileSync(stdoutPath, '', 'utf8');

    // Whitespace-only output must NOT be treated as empty. The old .trim()
    // check discarded it; the .length === 0 check preserves it.
    fs.writeFileSync(errPath, ' \t', 'utf8');

    const result = tailOutputWindows(stdoutPath, errPath, 'job-f5', {
      maxBytes: 4096,
      lines: 50,
    });

    // When stdout content is empty, the merged output is just the stderr
    // content. The [stderr] header is keyed off stdoutResult.output.length > 0
    // (content), not mere file existence — the stdout file exists here but is
    // 0 bytes, so the header is correctly omitted.
    expect(result.output).toBe(' \t');
  });

  describe('tailOutputWindows — UTF-8 byte budget (F6)', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clixml-utf8-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('caps on UTF-8 bytes at a valid character boundary for multi-byte content', () => {
      const stdoutPath = path.join(dir, 'out.log');
      const errPath = path.join(dir, 'err.log');
      fs.writeFileSync(stdoutPath, '', 'utf8');

      // Each é is 2 UTF-8 bytes but 1 UTF-16 code unit. The old code counted
      // code units, so 10 of them (10 code units) would pass a maxBytes=10
      // check despite being 20 UTF-8 bytes.
      const multi = 'é'.repeat(100) + '\n';
      fs.writeFileSync(errPath, multi, 'utf8');

      const maxBytes = 10;
      const result = tailOutputWindows(stdoutPath, errPath, 'job-f6', {
        maxBytes,
        lines: 1000,
      });

      expect(Buffer.byteLength(result.output, 'utf8')).toBeLessThanOrEqual(
        maxBytes,
      );
      // Must not split a multi-byte sequence — every character in the output is
      // a complete é, not a replacement char or partial byte.
      expect(result.output).not.toContain('\uFFFD');
    });
  });
});

describe('tailOutput — defensive maxBytes clamping (A2)', () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tail-clamp-'));
    logPath = path.join(dir, 'out.log');
    fs.writeFileSync(logPath, 'hello world\nsecond line\n', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // The file is non-empty, so a clamped-to-zero read omits real data. Reporting
  // truncated: true is the honest result; claiming false would hide the loss.
  it('does not throw and returns empty, explicitly truncated output for a negative maxBytes', () => {
    const result = tailOutput(logPath, 'job-neg', {
      maxBytes: -100,
      lines: 50,
    });
    expect(result.output).toBe('');
    expect(result.truncated).toBe(true);
  });

  it('does not throw and returns empty, explicitly truncated output for zero maxBytes', () => {
    const result = tailOutput(logPath, 'job-zero', { maxBytes: 0, lines: 50 });
    expect(result.output).toBe('');
    expect(result.truncated).toBe(true);
  });

  it('does not throw and clamps a fractional maxBytes to its floor', () => {
    // maxBytes 5.9 floors to 5, so output is at most 5 bytes from the tail.
    const result = tailOutput(logPath, 'job-frac', {
      maxBytes: 5.9,
      lines: 50,
    });
    expect(result.output.length).toBeLessThanOrEqual(5);
  });

  it('does not throw for NaN maxBytes and returns empty, explicitly truncated output', () => {
    const result = tailOutput(logPath, 'job-nan', {
      maxBytes: Number.NaN,
      lines: 50,
    });
    expect(result.output).toBe('');
    expect(result.truncated).toBe(true);
  });

  it('does not throw for Infinity maxBytes and returns all content', () => {
    const result = tailOutput(logPath, 'job-inf', {
      maxBytes: Number.POSITIVE_INFINITY,
      lines: 50,
    });
    expect(result.output).toContain('hello world');
    expect(result.output).toContain('second line');
  });
});
