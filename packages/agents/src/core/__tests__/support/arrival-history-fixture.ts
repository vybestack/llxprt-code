/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ResponseArrival } from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';

class ArrivalTestHistory extends HistoryService {
  readonly arrivals: ResponseArrival[] = [];
  override async openResponseArrival(
    ...args: Parameters<HistoryService['openResponseArrival']>
  ): Promise<ResponseArrival> {
    const arrival = await super.openResponseArrival(...args);
    this.arrivals.push(arrival);
    return arrival;
  }
}
export function arrivalHistoryFixture(): () => HistoryService {
  const histories: ArrivalTestHistory[] = [];
  afterEach(async () => {
    for (const history of histories) {
      for (const arrival of history.arrivals) await arrival.interrupt();
      await history.dispose();
    }
    histories.length = 0;
  });
  return () => {
    const history = new ArrivalTestHistory();
    histories.push(history);
    return history;
  };
}
