/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural tests for the `github` tool.
 *
 * The properties that matter are: every mutating operation prompts, no read
 * operation prompts, unknown operations are rejected before reaching the
 * broker, and the tool never handles a credential.
 *
 * @plan PLAN-20260731-GHBROKER.P15
 * @requirement REQ-008, REQ-012, REQ-013
 * @pseudocode 003-github-broker.md lines 38-55
 */

import { describe, it, expect } from 'bun:test';
import {
  GithubTool,
  MUTATING_OPS,
  SUPPORTED_OPS,
  renderChecks,
  type GitHubBrokerClient,
} from './github.js';
import { GITHUB_OP_SPECS, type GithubParamKind } from './github-ops.js';

/** Records the operations dispatched to the broker. */
function textOrEmpty(value: string | null | undefined): string {
  return value ?? '';
}

function stubClient(
  result: Record<string, unknown> = { ok: true },
): GitHubBrokerClient & { calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    async runOperation(op, params) {
      calls.push([op, params]);
      return result;
    },
  };
}

/**
 * A valid sample value for every parameter kind. Typed as
 * `Record<GithubParamKind, unknown>` so adding a kind to the catalog without
 * supplying a sample here is a compile error — the fixture can no longer go
 * stale the way a hand-maintained switch with a `default` case can.
 */
const VALID_SAMPLE_BY_KIND: Record<GithubParamKind, unknown> = {
  repo: 'o/n',
  number: 1,
  boolean: true,
  state: 'open',
  stateIssue: 'open',
  label: ['x'],
  threadId: 'PRRT_kwDOabc',
  body: 'x',
  freetext: 'x',
  limit: 5,
  closeReason: 'completed',
  color: '#ff0000',
  assignee: ['x'],
  milestone: 'x',
  project: 'x',
  branch: 'x',
};

/**
 * Minimal valid parameters for an operation: each op's required parameters
 * supplied with a kind-appropriate sample, nothing else. Derived from the
 * catalog's `required` list, so a new op or a changed required set is picked
 * up automatically — there is no hand-maintained `default` case to mask a
 * missing op or supply the wrong shape.
 */
function validParamsFor(op: string): Record<string, unknown> {
  const spec = GITHUB_OP_SPECS[op];
  const params: Record<string, unknown> = {};
  for (const name of spec.required) {
    params[name] = VALID_SAMPLE_BY_KIND[spec.params[name]];
  }
  return params;
}

function githubReadParams(operation: string): Record<string, unknown> {
  if (operation.startsWith('search.')) return { query: 'sandbox' };
  if (operation.endsWith('.list')) return { limit: 5 };
  return { number: 1 };
}

describe('github tool', () => {
  describe('operation validation', () => {
    /**
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-002
     */
    it('rejects an unknown operation before it reaches the broker', () => {
      const tool = new GithubTool(stubClient());
      expect(tool.validateToolParams({ op: 'issue.destroy' })).not.toBeNull();
      expect(() => tool.build({ op: 'issue.destroy' })).toThrow(
        /must be equal to one of/,
      );
    });

    /**
     * The operation list lives in the schema as an enum, so the model sees
     * the valid values in the function declaration rather than discovering
     * them by trial and error.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('publishes the operation list in the parameter schema', () => {
      const tool = new GithubTool(stubClient());
      const schema = tool.parameterSchema as {
        properties: { op: { enum: string[] } };
      };
      expect(schema.properties.op.enum).toStrictEqual([...SUPPORTED_OPS]);
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('accepts every supported operation', () => {
      const tool = new GithubTool(stubClient());
      for (const op of SUPPORTED_OPS) {
        expect(
          tool.validateToolParams({ op, ...validParamsFor(op) }),
        ).toBeNull();
      }
    });

    /**
     * The fixture must derive straight from the catalog so it cannot go stale:
     * it returns exactly each op's required parameters (no more, no less) with
     * kind-appropriate samples. A future op or a changed required set is picked
     * up automatically; there is no `default` case to mask a missing op.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('validParamsFor returns exactly each op catalog required set', () => {
      for (const op of SUPPORTED_OPS) {
        const required = GITHUB_OP_SPECS[op].required;
        expect(Object.keys(validParamsFor(op)).sort()).toStrictEqual(
          [...required].sort(),
        );
      }
    });
  });

  describe('confirmation', () => {
    /**
     * A prompt-injected agent must not write under the user's identity
     * unattended.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-012
     */
    it('prompts for every mutating operation', async () => {
      const tool = new GithubTool(stubClient());
      for (const op of MUTATING_OPS) {
        const invocation = tool.build({ op, ...validParamsFor(op) });
        const confirmation = await invocation.shouldConfirmExecute(
          new AbortController().signal,
        );
        expect(confirmation).not.toBe(false);
      }
    });

    /**
     * Prompting on reads would make the tool intolerable to use.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-012
     */

    it('never prompts for a read operation', async () => {
      const tool = new GithubTool(stubClient());
      const reads = SUPPORTED_OPS.filter((op) => !MUTATING_OPS.has(op));
      expect(reads.length).toBeGreaterThan(0);
      // Use parameters each op actually takes. Passing `number` to
      // issue.list or search.issues exercised a shape those ops never
      // receive, so the assertion held for the wrong reason.
      for (const op of reads) {
        const invocation = tool.build({ op, ...githubReadParams(op) });
        const confirmation = await invocation.shouldConfirmExecute(
          new AbortController().signal,
        );
        expect(confirmation).toBe(false);
      }
    });

    /**
     * Every mutating op in the tool must exist in the supported set, or a
     * write could silently bypass confirmation by being unreachable here.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-012
     */
    it('lists every mutating operation among the supported operations', () => {
      for (const op of MUTATING_OPS) {
        expect(SUPPORTED_OPS).toContain(op);
      }
    });

    /**
     * The inverse direction, which is the one that fails open. Anything not
     * in MUTATING_OPS is treated as a read and skips confirmation, so a
     * write added to SUPPORTED_OPS without being classified would silently
     * execute unattended. Pinning the read set means adding an operation
     * forces a deliberate choice here rather than defaulting to no prompt.
     *
     * @plan PLAN-20260731-GHBROKER.P19
     * @requirement REQ-012
     */

    const observeClassifiesEverySupportedOperationAsReadOrMutatingAt217 =
      () => {
        const KNOWN_READ_OPS = [
          'issue.view',
          'issue.list',
          'pr.view',
          'pr.list',
          'pr.diff',
          'pr.checks',
          'pr.reviews',
          'search.issues',
          'search.prs',
          'run.list',
          'label.list',
        ];
        const unclassified = SUPPORTED_OPS.filter(
          (op) => !MUTATING_OPS.has(op) && !KNOWN_READ_OPS.includes(op),
        );
        return { unclassified };
      };

    it('classifies every supported operation as read or mutating', () => {
      const { unclassified } =
        observeClassifiesEverySupportedOperationAsReadOrMutatingAt217();
      expect(unclassified).toStrictEqual([]);
    });
  });

  describe('dispatch', () => {
    /**
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-009
     */
    it('forwards parameters except op, including repo', async () => {
      const client = stubClient({ number: 42 });
      const tool = new GithubTool(client);
      const invocation = tool.build({
        op: 'issue.view',
        number: 42,
        repo: 'acoliver/other',
        comments: true,
      });
      await invocation.execute(new AbortController().signal);
      expect(client.calls).toHaveLength(1);
      const [op, params] = client.calls[0];
      expect(op).toBe('issue.view');
      expect(params).toStrictEqual({
        number: 42,
        repo: 'acoliver/other',
        comments: true,
      });
      expect(params).not.toHaveProperty('op');
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-013
     */
    it('returns shaped data as JSON for the model', async () => {
      const tool = new GithubTool(stubClient({ number: 7, title: 'X' }));
      const result = await tool
        .build({ op: 'issue.view', number: 7 })
        .execute(new AbortController().signal);
      expect(String(result.llmContent)).toContain('"number": 7');
      expect(String(result.llmContent)).toContain('"title": "X"');
    });

    /**
     * A broker failure must surface as a tool error, not a thrown exception
     * that aborts the turn.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-013
     */
    it('reports a broker failure as a tool error', async () => {
      const failing: GitHubBrokerClient = {
        async runOperation() {
          throw new Error('NOT_FOUND: no such issue');
        },
      };
      const tool = new GithubTool(failing);
      const result = await tool
        .build({ op: 'issue.view', number: 1 })
        .execute(new AbortController().signal);
      expect(result.error?.message).toContain('NOT_FOUND');
      expect(String(result.llmContent)).toContain('NOT_FOUND');
    });

    /**
     * A bare broker message like "404 Not Found" gives the model no clue it
     * came from a GitHub operation, so the failure path must prefix it like
     * every other tool in the package. An empty message must not blank the
     * display — it falls back to a non-empty "Unknown error" detail.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-013
     */

    it('prefixes a failure with the github context and guards an empty message', async () => {
      const empty: GitHubBrokerClient = {
        async runOperation() {
          throw new Error('');
        },
      };
      const tool = new GithubTool(empty);
      const result = await tool
        .build({ op: 'issue.view', number: 1 })
        .execute(new AbortController().signal);
      expect(result.returnDisplay).not.toBe('');
      expect(result.returnDisplay).toContain('GitHub operation failed');
      expect(textOrEmpty(result.error?.message)).not.toBe('');
      expect(result.error?.message).toContain('Unknown error');
    });
  });

  describe('watch presentation', () => {
    const watchResult = {
      concluded: true,
      cancelled: false,
      summary: { pass: 2, fail: 1, pending: 0, skipping: 0 },
      checks: [
        { name: 'test', bucket: 'pass' },
        { name: 'lint', bucket: 'fail' },
        { name: 'build', bucket: 'pass' },
      ],
    };

    /**
     * After waiting minutes for CI, the thing that broke is what you need,
     * not an alphabetical roster.
     *
     * @plan PLAN-20260731-GHBROKER.P14
     * @requirement REQ-011
     */
    it('lists failures first', () => {
      const rendered = renderChecks(watchResult, true);
      const lines = rendered.split(String.fromCharCode(10));
      expect(lines[1]).toContain('lint');
      expect(lines[0]).toContain('complete');
      expect(lines[0]).toContain('1 fail');
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P14
     * @requirement REQ-011
     */
    it('distinguishes cancelled from complete', () => {
      expect(
        renderChecks(
          { ...watchResult, concluded: false, cancelled: true },
          true,
        ),
      ).toContain('cancelled');
      expect(renderChecks({ ...watchResult }, true)).toContain('complete');
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P14
     * @requirement REQ-011
     */
    it('handles a watch that reported no checks', () => {
      expect(renderChecks({ checks: [] }, true)).toBe('No checks reported.');
    });

    /**
     * A multi-minute silent block is indistinguishable from a hang, so the
     * watch must emit progress immediately rather than after the first tick.
     *
     * @plan PLAN-20260731-GHBROKER.P14
     * @requirement REQ-011
     */

    const observeReportsProgressAsSoonAsAWatchStartsAt382 = async () => {
      const updates: string[] = [];
      const tool = new GithubTool(stubClient(watchResult));
      await tool
        .build({ op: 'pr.checks', number: 1, watch: true })
        .execute(new AbortController().signal, (u) => {
          if (u.mode === 'append') updates.push(u.data);
        });
      return { updates };
    };

    it('reports progress as soon as a watch starts', async () => {
      const { updates } =
        await observeReportsProgressAsSoonAsAWatchStartsAt382();
      expect(updates.length).toBeGreaterThan(0);
      expect(updates[0]).toContain('Waiting for checks on #1');
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P14
     * @requirement REQ-011
     */

    const observeEmitsNoProgressForANonWatchOperationAt399 = async () => {
      const updates: string[] = [];
      const tool = new GithubTool(stubClient({ number: 1 }));
      await tool
        .build({ op: 'pr.checks', number: 1 })
        .execute(new AbortController().signal, (u) => {
          if (u.mode === 'append') updates.push(u.data);
        });
      return { updates };
    };

    it('emits no progress for a non-watch operation', async () => {
      const { updates } =
        await observeEmitsNoProgressForANonWatchOperationAt399();
      expect(updates).toStrictEqual([]);
    });

    /**
     * A watched pr.checks must still render through renderGithubResult so the
     * explicit repo suffix appears. The render path no longer special-cases
     * isWatching().
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-013
     */
    it('a watched pr.checks renders the repo suffix', async () => {
      const tool = new GithubTool(stubClient(watchResult));
      const result = await tool
        .build({ op: 'pr.checks', number: 1, watch: true, repo: 'o/n' })
        .execute(new AbortController().signal);
      expect(result.returnDisplay).toContain('o/n');
    });
  });

  describe('description', () => {
    /**
     * The description is what steers a model to this tool instead of
     * shelling out to gh, so the guidance must actually be present.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('documents gh-flag naming, cross-repo use and the blocking watch', () => {
      const tool = new GithubTool(stubClient());
      expect(tool.description).toContain('mirror');
      expect(tool.description).toContain('owner/name');
      expect(tool.description).toContain('BLOCKS');
      expect(tool.description).toContain('actionable');
    });

    /**
     * The per-op reference block in the description names each operation and
     * its required parameters, so a model reading the declaration can tell
     * what a given op needs without a failed round trip.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('contains a per-op reference line for every op naming its required params', () => {
      const tool = new GithubTool(stubClient());
      for (const op of SUPPORTED_OPS) {
        expect(tool.description).toContain(op);
        for (const required of GITHUB_OP_SPECS[op].required) {
          expect(tool.description).toContain(required);
        }
      }
    });
  });

  describe('parameter schema and op-specific validation (issue #3030)', () => {
    /**
     * The regression test for the reported defect: the model must be able to
     * SEE every parameter any operation accepts in the function declaration,
     * so a typo now fails at schema validation with a precise message instead
     * of reaching the broker.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('declares every op-accepted parameter in PARAMETER_SCHEMA.properties', () => {
      const tool = new GithubTool(stubClient());
      const schema = tool.parameterSchema as {
        properties: Record<string, unknown>;
      };
      const declared = Object.keys(schema.properties);
      for (const op of SUPPORTED_OPS) {
        for (const param of Object.keys(GITHUB_OP_SPECS[op].params)) {
          expect(declared).toContain(param);
        }
      }
    });

    /**
     * A declared parameter with an empty description is invisible guidance:
     * the model sees the name but not which operations take it or what shape
     * the value has. Adding a parameter to the catalog must therefore force a
     * description to be written for it.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */

    it('gives every declared parameter a non-empty description', () => {
      const tool = new GithubTool(stubClient());
      const schema = tool.parameterSchema as {
        properties: Record<string, { description?: string }>;
      };
      for (const [, prop] of Object.entries(schema.properties)) {
        expect(textOrEmpty(prop.description)).not.toBe('');
      }
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('sets additionalProperties to false', () => {
      const tool = new GithubTool(stubClient());
      const schema = tool.parameterSchema as {
        additionalProperties: boolean;
      };
      expect(schema.additionalProperties).toBe(false);
    });

    /**
     * A missing required parameter is rejected before any broker call, with a
     * message that names what the op needs.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('rejects issue.comment missing body with a message naming body', () => {
      const tool = new GithubTool(stubClient());
      const err = tool.validateToolParams({ op: 'issue.comment', number: 438 });
      expect(err).not.toBeNull();
      expect(err).toContain('body');
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('accepts a complete issue.comment', () => {
      const tool = new GithubTool(stubClient());
      expect(
        tool.validateToolParams({
          op: 'issue.comment',
          number: 438,
          body: 'hi',
        }),
      ).toBeNull();
    });

    /**
     * A parameter that is valid for one op but not another is rejected at
     * build time: `body` is not accepted by `issue.view`.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('build throws when a param is not accepted by the op', () => {
      const tool = new GithubTool(stubClient());
      expect(() =>
        tool.build({ op: 'issue.view', number: 1, body: 'x' }),
      ).toThrow(/body/);
    });

    /**
     * A `type: ['string','array']` union is unprojectable: every provider's
     * `normalizeType` collapses it to `'string'`, so the model would be told
     * arrays are invalid. The label/assignee family must declare a concrete
     * array type so a model can pass an array.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('declares label/assignee params as array<string>, never a type union', () => {
      const tool = new GithubTool(stubClient());
      const schema = tool.parameterSchema as {
        properties: Record<
          string,
          { type?: unknown; items?: { type?: string } }
        >;
      };
      for (const name of [
        'label',
        'addLabel',
        'removeLabel',
        'assignee',
        'addAssignee',
        'removeAssignee',
      ]) {
        const prop = schema.properties[name];
        expect(prop.type).toBe('array');
        expect(prop.items?.type).toBe('string');
      }
    });

    /**
     * No property in the whole schema may declare `type` as an array. A
     * future addition that reintroduces a union type would silently break
     * provider projection, so loop over every property to catch it.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('no schema property declares type as an array', () => {
      const tool = new GithubTool(stubClient());
      const schema = tool.parameterSchema as {
        properties: Record<string, { type?: unknown }>;
      };
      for (const [, prop] of Object.entries(schema.properties)) {
        expect(Array.isArray(prop.type)).toBe(false);
      }
    });

    /**
     * `number` and `limit` must be `integer`, not `number`, so a value like
     * 1.5 is rejected by value validation rather than passing the schema and
     * being rejected only by the broker.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-008
     */
    it('declares number and limit as integer type', () => {
      const tool = new GithubTool(stubClient());
      const schema = tool.parameterSchema as {
        properties: Record<string, { type?: string }>;
      };
      expect(schema.properties.number.type).toBe('integer');
      expect(schema.properties.limit.type).toBe('integer');
    });

    /**
     * Per-op value rules are enforced before the call is made: issue.list
     * uses the stateIssue kind (open/closed/all) so "merged" is rejected at
     * the tool boundary, not after a broker round trip.
     *
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-002, REQ-008
     */
    it('rejects issue.list state:merged at the tool boundary', () => {
      const tool = new GithubTool(stubClient());
      expect(
        tool.validateToolParams({ op: 'issue.list', state: 'merged' }),
      ).not.toBeNull();
    });

    /**
     * @plan PLAN-20260731-GHBROKER.P15
     * @requirement REQ-002
     */
    it('rejects a non-integer number at the tool boundary', () => {
      const tool = new GithubTool(stubClient());
      expect(
        tool.validateToolParams({ op: 'issue.view', number: 1.5 }),
      ).not.toBeNull();
    });
  });
});
