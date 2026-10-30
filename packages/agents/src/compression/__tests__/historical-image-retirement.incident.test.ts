/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3984 incident: 25 earlier images plus a 237,140 byte newest image
 * total 15,915,624 normalized bytes, over the original 15 MiB (15,728,640)
 * request media budget. The request must still be sent, with the oldest
 * historical pixels replaced by honest text notes in the REQUEST VIEW only.
 * Real LocalMediaStore, HistoryService, ProviderContentEnforcer, production
 * send seam, and AnthropicProvider projection; only HTTP is stubbed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestMediaByteOverflowError } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import {
  FIFTEEN_MIB,
  RetirementSession,
  aiTurn,
  collectImageData,
  countRetirementNotes,
  imageTurn,
  rejection,
  type AdmittedImage,
} from './image-retirement-harness.js';

const INCIDENT_TOTAL_BYTES = 15_915_624;
const NEWEST_IMAGE_BYTES = 237_140;
const OLDER_IMAGE_COUNT = 25;

/** Raw lengths (multiples of 3, no padding) whose base64 sums to the incident. */
function incidentRawLengths(): number[] {
  const olderGroups = (INCIDENT_TOTAL_BYTES - NEWEST_IMAGE_BYTES) / 4;
  const base = Math.floor(olderGroups / OLDER_IMAGE_COUNT);
  const remainder = olderGroups - base * OLDER_IMAGE_COUNT;
  const older = Array.from(
    { length: OLDER_IMAGE_COUNT },
    (_, index) => (base + (index < remainder ? 1 : 0)) * 3,
  );
  return [...older, (NEWEST_IMAGE_BYTES / 4) * 3];
}

describe('historical image retirement at the incident size (issue #3984)', () => {
  let directory = '';
  let session: RetirementSession;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-issue3984-retire-'));
    session = new RetirementSession(directory, undefined);
  });
  afterEach(async () => {
    session.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  async function seedIncident(): Promise<{
    readonly images: AdmittedImage[];
    readonly newest: AdmittedImage;
  }> {
    const images: AdmittedImage[] = [];
    for (const [index, length] of incidentRawLengths().entries()) {
      images.push(await session.admit(length, index + 1));
    }
    for (const [index, image] of images.slice(0, -1).entries()) {
      session.history.add(imageTurn(image.reference, `old-${index}`));
      session.history.add(aiTurn(`seen ${index}`));
    }
    if (images.length === 0) throw new Error('fixture is empty');
    const newest = images[images.length - 1];
    return { images, newest };
  }

  it('totals the reported 15,915,624 bytes across 26 images at the original 15 MiB budget', async () => {
    const { images } = await seedIncident();

    const total = images.reduce(
      (sum, image) => sum + image.reference.normalizedBase64Length,
      0,
    );

    expect([images.length, total, FIFTEEN_MIB]).toStrictEqual([
      26,
      INCIDENT_TOTAL_BYTES,
      15_728_640,
    ]);
  });

  it('sends the newest image and a bounded set of newer images, replacing only the oldest with notes', async () => {
    const { images, newest } = await seedIncident();
    const pending = [imageTurn(newest.reference, 'latest')];

    await session.send(pending);

    const body = session.lastBody();
    const sentImages = collectImageData(body, []);
    const retiredCount = images.length - sentImages.length;
    expect({
      sentIsNewestSuffix:
        JSON.stringify(sentImages) ===
        JSON.stringify(images.slice(retiredCount).map((image) => image.base64)),
      newestArrived: sentImages[sentImages.length - 1] === newest.base64,
      retiredAtLeastOne: retiredCount > 0,
      oneNotePerRetiredImage: countRetirementNotes(body) === retiredCount,
      withinBudget:
        sentImages.reduce((sum, data) => sum + data.length, 0) <=
        Math.floor(FIFTEEN_MIB * 0.75),
      compressionRuns: session.compressionRuns,
    }).toStrictEqual({
      sentIsNewestSuffix: true,
      newestArrived: true,
      retiredAtLeastOne: true,
      oneNotePerRetiredImage: true,
      withinBudget: true,
      compressionRuns: 0,
    });
  });

  it('keeps canonical history, stored originals and reservations untouched', async () => {
    const { images, newest } = await seedIncident();
    const before = JSON.stringify(session.history.getAll());

    await session.send([imageTurn(newest.reference, 'latest')]);

    if (images.length === 0) throw new Error('fixture is empty');
    const oldest = images[0];
    const original = await session.store.readVerified(oldest.reference);
    expect({
      history: JSON.stringify(session.history.getAll()) === before,
      originalReadable: Buffer.from(original).equals(Buffer.from(oldest.bytes)),
      activeRequests: session.resolver.accounting().activeRequestCount,
      reserved: await session.store.hasReservations(oldest.reference.contentId),
    }).toStrictEqual({
      history: true,
      originalReadable: true,
      activeRequests: 0,
      reserved: false,
    });
  });

  it('transmits exactly the projected contents with a matching content length', async () => {
    const { newest } = await seedIncident();

    await session.send([imageTurn(newest.reference, 'latest')]);

    const sent = session.sent;
    expect([
      sent.length,
      sent[0]?.contentLength === String(Buffer.byteLength(sent[0]?.body ?? '')),
    ]).toStrictEqual([1, true]);
  });

  it('keeps an explicit 15 MiB-equal budget identical to the default', async () => {
    session.dispose();
    session = new RetirementSession(directory, FIFTEEN_MIB);
    const { images, newest } = await seedIncident();

    await session.send([imageTurn(newest.reference, 'latest')]);

    const sentImages = collectImageData(session.lastBody(), []);
    expect(sentImages.length).toBeLessThan(images.length);
  });

  it('fails with the typed byte error, not silent dropping, for an explicit zero budget', async () => {
    session.dispose();
    session = new RetirementSession(directory, 0);
    const { newest } = await seedIncident();

    const error = await rejection(
      session.send([imageTurn(newest.reference, 'latest')]),
    );

    expect(error).toBeInstanceOf(RequestMediaByteOverflowError);
  });

  it('releases reservations and leaves canonical history intact when transport fails', async () => {
    const { newest } = await seedIncident();
    const before = JSON.stringify(session.history.getAll());
    session.transportFailure = new Error('connection reset');

    const error = await rejection(
      session.send([imageTurn(newest.reference, 'latest')]),
    );

    expect({
      rejected: error instanceof Error,
      history: JSON.stringify(session.history.getAll()) === before,
      activeRequests: session.resolver.accounting().activeRequestCount,
    }).toStrictEqual({ rejected: true, history: true, activeRequests: 0 });
  });

  it('reports an unreadable retained image instead of retiring it or compressing', async () => {
    const { newest } = await seedIncident();
    const missing = await session.admitMissing(600_000, 99);
    session.history.add(imageTurn(missing.reference, 'missing'));
    session.history.add(aiTurn('seen missing'));

    const error = await rejection(
      session.send([imageTurn(newest.reference, 'latest')]),
    );

    expect({
      namesTheUnreadableImage:
        error instanceof Error &&
        error.message.includes('blob verification failed') &&
        error.message.includes('turn-missing'),
      byteOverflow: error instanceof RequestMediaByteOverflowError,
      compressionRuns: session.compressionRuns,
      sent: session.sent.length,
    }).toStrictEqual({
      namesTheUnreadableImage: true,
      byteOverflow: false,
      compressionRuns: 0,
      sent: 0,
    });
  });
});
