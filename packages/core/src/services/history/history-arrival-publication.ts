/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ResponseArrival } from './history-response-arrival.js';
import type { HistoryStorePort } from './historyStorePort.js';
import type { IContent } from './IContent.js';

export function withArrivalPublication<T>(
  arrival: ResponseArrival,
  host: {
    journal: HistoryStorePort;
    enqueue(run: () => Promise<void>): Promise<void>;
    assertAdmission(): void;
    prepare(start: number): T;
    prepareAfc(content: IContent): IContent;
    publish(token: T): void;
    cancel(token: T): void;
    added(content: IContent): void;
    first(content: IContent): void;
    origin: string | undefined;
  },
): ResponseArrival {
  return {
    selectAttempt: (id) => arrival.selectAttempt(id),
    appendToolArguments: (delta) => arrival.appendToolArguments(delta),
    replaceAfcHistory: (contents) =>
      arrival.replaceAfcHistory(
        (async function* () {
          for await (const content of contents) yield host.prepareAfc(content);
        })(),
      ),
    append: (block) => arrival.append(block),
    interrupt: (outcome) => arrival.interrupt(outcome),
    seal: (metadata) =>
      host.enqueue(async () => {
        host.assertAdmission();
        const before = host.journal.getLength();
        const scope = host.journal.openPublication();
        let ticket: { value: T } | undefined;
        let published = false;
        let first: IContent | undefined;
        const observe = async (): Promise<void> => {
          const sealed = await host.journal.lastContent();
          if (sealed === undefined)
            throw new Error('Sealed response is missing');
          host.added(sealed);
          if (before === 0 && first === undefined)
            first = {
              speaker: sealed.speaker,
              blocks: [],
              metadata: sealed.metadata,
            };
        };
        try {
          await arrival.seal(metadata, observe);
          await observe();
          ticket = { value: host.prepare(before) };
          scope.close(true);
          if (first !== undefined) host.first(first);
          host.publish(ticket.value);
          published = true;
        } catch (error) {
          const added = host.journal.getLength() - before;
          if (added > 0)
            host.journal.apply({
              kind: 'rewind',
              itemsRemoved: added,
              origin: host.origin,
            });
          throw error;
        } finally {
          scope.close(false);
          if (!published && ticket !== undefined) host.cancel(ticket.value);
        }
      }),
  };
}
