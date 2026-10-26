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
    prepare(): T;
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
    append: (block) => arrival.append(block),
    interrupt: (outcome) => arrival.interrupt(outcome),
    seal: (metadata) =>
      host.enqueue(async () => {
        host.assertAdmission();
        const wasEmpty = host.journal.getLength() === 0;
        const scope = host.journal.openPublication();
        let ticket: { value: T } | undefined;
        let published = false;
        try {
          await arrival.seal(metadata);
          const sealed = await host.journal.lastContent('ai');
          if (sealed === undefined)
            throw new Error('Sealed response is missing');
          ticket = { value: host.prepare() };
          try {
            host.added(sealed);
          } catch (error) {
            host.journal.apply({
              kind: 'rewind',
              itemsRemoved: 1,
              cutSeq: sealed.metadata?.chronology?.seq,
              origin: host.origin,
            });
            throw error;
          }
          scope.close(true);
          if (wasEmpty) host.first(sealed);
          host.publish(ticket.value);
          published = true;
        } finally {
          scope.close(false);
          if (!published && ticket !== undefined) host.cancel(ticket.value);
        }
      }),
  };
}
