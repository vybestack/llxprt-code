/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { ProfileCommand } from '@vybestack/llxprt-code-core';
import { ProfileController } from '../profileController.js';
import {
  committed,
  configuredState,
  makeDeps,
  releaseAndAwait,
  seedMyLb,
  standardProvADocument,
} from './controllerTestFakes.js';

describe('load-balancer member provenance', () => {
  it.each(['m1p', 'm2p'])(
    'anchors a startup fork save to member %s rather than the LB parent',
    async (member) => {
      const harness = makeDeps();
      seedMyLb(harness.repo);
      const parent = await harness.repo.load('mylb');
      const { fingerprint: source } = await harness.repo.load(member);
      const controller = new ProfileController(harness.deps);
      committed(
        await releaseAndAwait(
          harness,
          controller.execute({
            kind: 'startup',
            profileName: 'mylb',
            member,
            model: 'm2',
            expectedRevision: 0,
          }),
        ),
      );
      const draftIdentity = configuredState(controller.getState()).identity;
      const saved = await controller.execute({
        kind: 'save',
        name: member,
        expectedRevision: 1,
      });
      expect(saved.kind).toStrictEqual('committed');
      expect(draftIdentity).toStrictEqual({
        kind: 'draft',
        derivedFrom: { name: member, source },
      });
      expect((await harness.repo.load(member)).document).toStrictEqual(
        standardProvADocument('m2'),
      );
      expect(await harness.repo.load('mylb')).toStrictEqual(parent);
      await controller.dispose();
    },
  );

  for (const kind of ['load', 'startup']) {
    it.each(['mylb', 'other-lb'])(
      `${kind} of %s refreshes a shared first member before later model forks`,
      async (target) => {
        const harness = makeDeps();
        seedMyLb(harness.repo);
        const parent = await harness.repo.load('mylb');
        harness.repo.seed('other-lb', {
          ...parent.document,
          modelParams: { temperature: 0.5 },
        });
        const controller = new ProfileController(harness.deps);
        committed(
          await releaseAndAwait(
            harness,
            controller.execute({
              kind: 'startup',
              profileName: 'mylb',
              expectedRevision: 0,
            }),
          ),
        );
        const changedMember = {
          ...standardProvADocument('m2'),
          modelParams: { temperature: 0.25 },
        };
        harness.repo.seed('m1p', changedMember);
        const command: ProfileCommand =
          kind === 'load'
            ? { kind: 'load', name: target, expectedRevision: 1 }
            : { kind: 'startup', profileName: target, expectedRevision: 1 };
        committed(await releaseAndAwait(harness, controller.execute(command)));
        expect(
          configuredState(controller.getState()).activeMember?.sourceDocument,
        ).toStrictEqual(changedMember);
        committed(
          await releaseAndAwait(
            harness,
            controller.execute({
              kind: 'model',
              member: 'm1p',
              model: 'm1',
              expectedRevision: 2,
            }),
          ),
        );
        expect(configuredState(controller.getState()).document).toStrictEqual({
          ...changedMember,
          model: 'm1',
        });
        await controller.dispose();
      },
    );
  }
});
