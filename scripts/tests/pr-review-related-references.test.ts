/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { validateRelated } from '../pr-review-local.ts';

const issueUrl = 'https://github.com/vybestack/llxprt-code/issues/2943';
const pullUrl = 'https://github.com/vybestack/llxprt-code/pull/3465';
const corpus = [
  { number: 2943, url: issueUrl, kind: 'issue' },
  { number: 3465, url: pullUrl, kind: 'pull-request' },
];

describe('verified related destinations', () => {
  for (const destination of [
    'https://github.com/vybestack/llxprt-code/issues/9999',
    'https://github.com/vybestack/llxprt-code/issues/3465',
    'https://github.com/vybestack/llxprt-code/pull/2943',
    'https://github.com/other/repo/issues/2943',
    'https://external.invalid/issues/2943',
    '/issues/9999',
    `${issueUrl}?redirect=https://external.invalid`,
  ]) {
    it(`rejects #2943 linked to ${destination}`, () => {
      expect(() =>
        validateRelated(`- [#2943](${destination}): sandbox security`, corpus),
      ).toThrow('Related output contains unverified references');
    });
  }
  for (const related of [
    `- [#2943][target]: sandbox security\n\n[target]: https://external.invalid`,
    `- #2943: <https://external.invalid>`,
    `- other/repo#2943: sandbox security`,
    `- other-repo#2943: sandbox security`,
    `- #2943: https://github.com/other/repo/issues/2943`,
    `- #2943: <a href="https://external.invalid">sandbox security</a>`,
    `- ![#2943](${issueUrl}): sandbox security`,
    `- [#2943 and #3465](${issueUrl}): sandbox security`,
  ]) {
    it(`rejects alternate unverified destination syntax ${related}`, () => {
      expect(() => validateRelated(related, corpus)).toThrow(
        'Related output contains unverified references',
      );
    });
  }
  it('preserves actual verified issue and PR links with their explanations', () => {
    const related = `- [#2943](${issueUrl}): sandbox security\n- [#3465](${pullUrl}): startup recovery`;
    expect(validateRelated(related, corpus)).toBe(related);
  });
  it('preserves linked GitHub issue URLs supplied as html_url metadata', () => {
    const related = `- [#2943](${issueUrl}): sandbox security`;
    expect(
      validateRelated(related, [{ number: 2943, html_url: issueUrl }]),
    ).toBe(related);
  });
  it('preserves plain verified hash references without requiring URL metadata', () => {
    expect(
      validateRelated('- #2943: sandbox security', [{ number: 2943 }]),
    ).toBe('- #2943: sandbox security');
  });
  it('rejects links when no trusted destination is available', () => {
    expect(() =>
      validateRelated(`- [#2943](${issueUrl}): sandbox security`, [
        { number: 2943 },
      ]),
    ).toThrow('Related output contains unverified references');
  });
  it('rejects an invented plain hash reference', () => {
    expect(() => validateRelated('- #9999: sandbox security', corpus)).toThrow(
      'Related output contains unverified references',
    );
  });
  it('preserves empty related output', () => {
    expect(validateRelated('', corpus)).toBe('');
  });
});
