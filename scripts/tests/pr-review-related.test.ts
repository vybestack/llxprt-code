/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { discoverRelated } from '../pr-review-related.ts';
import { validateRelated } from '../pr-review-local.ts';
import { buildSynthesisPrompts } from '../pr-review-prompts.ts';

const repository = 'vybestack/llxprt-code';
function githubItem(
  number: number,
  extra: Record<string, unknown> = {},
): object {
  return {
    number,
    title: 'Sandbox container recovery',
    body: 'Container ownership and recovery behavior',
    html_url: `https://github.com/${repository}/issues/${number}`,
    repository_url: `https://api.github.com/repos/${repository}`,
    state: 'open',
    ...extra,
  };
}
describe('trusted related issue and PR discovery', () => {
  it('retrieves unlinked verified issues and PRs and exposes them to static related inference', async () => {
    const items = await discoverRelated({
      repository,
      title: 'Fix sandbox recovery $(touch /tmp/owned)',
      linkedIssues: [{ number: 3449, title: 'Sandbox orphan containers' }],
      pullRequestNumber: 3465,
      token: 'PRIVATE_TOKEN',
      transport: async (url, options) => {
        const request = new URL(url.toString());
        expect(request.origin).toBe('https://api.github.com');
        expect(request.pathname).toBe('/search/issues');
        expect(request.searchParams.get('q')).toContain(`repo:${repository}`);
        expect(request.searchParams.get('q')).not.toContain('$(');
        expect(request.searchParams.get('per_page')).toBe('20');
        expect(options?.method).toBe('GET');
        expect(options?.redirect).toBe('error');
        return Response.json({
          incomplete_results: false,
          items: [
            githubItem(2943),
            githubItem(3000, {
              html_url: `https://github.com/${repository}/pull/3000`,
              pull_request: {},
            }),
            githubItem(3449),
          ],
        });
      },
    });
    expect(items.map((item) => item.number)).toEqual([2943, 3000]);
    expect(items.map((item) => item.kind)).toEqual(['issue', 'pull-request']);
    const prompt = buildSynthesisPrompts({
      prContext: { number: 3465, title: 'Sandbox recovery' },
      themes: [],
      summaries: [],
      fullIssueBodies: items,
    }).related;
    expect(prompt).toContain('"number":2943');
    expect(prompt).toContain('collector verified identities and destinations');
    expect(
      validateRelated(
        '- #2943: sandbox ownership security\n- #3000: recovery work',
        items,
      ),
    ).toContain('#3000');
    expect(prompt).not.toContain('PRIVATE_TOKEN');
    expect(() => validateRelated('- #9999: fabricated', items)).toThrow();
  });
  it('bounds discovered metadata and excludes the current PR and already-linked issues', async () => {
    const items = await discoverRelated({
      repository,
      title: 'sandbox',
      linkedIssues: [],
      pullRequestNumber: 3465,
      transport: async () =>
        Response.json({
          incomplete_results: false,
          items: Array.from({ length: 20 }, (_, index) =>
            githubItem(index + 1, {
              title: 'a'.repeat(3000),
              body: '😀'.repeat(4000),
            }),
          ),
        }),
    });
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(20);
    expect(Buffer.byteLength(JSON.stringify(items))).toBeLessThanOrEqual(6000);
  });
  for (const extra of [
    { repository_url: 'https://api.github.com/repos/other/repo' },
    { html_url: 'https://evil.invalid/issues/2943' },
    { html_url: `https://github.com/${repository}/issues/9999` },
  ]) {
    it(`rejects unverifiable search metadata ${JSON.stringify(extra)}`, async () => {
      await expect(
        discoverRelated({
          repository,
          title: 'sandbox',
          linkedIssues: [],
          pullRequestNumber: 3465,
          transport: async () =>
            Response.json({
              incomplete_results: false,
              items: [githubItem(2943, extra)],
            }),
        }),
      ).rejects.toThrow('related corpus');
    });
  }
  it('returns a sanitized transport failure without exposing API or token text', async () => {
    await expect(
      discoverRelated({
        repository,
        title: 'sandbox',
        linkedIssues: [],
        pullRequestNumber: 3465,
        token: 'PRIVATE_TOKEN',
        transport: async () =>
          new Response('PRIVATE_TOKEN server text', { status: 403 }),
      }),
    ).rejects.toThrow('Related retrieval HTTP 403');
  });
});
