/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { CallerOwnedToolQuery } from '../../../../../providers/src/utils/caller-owned-tool-query.js';
import {
  kimiStrategy,
  mistralStrategy,
} from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';

/** Counts rows admitted to the legacy in-memory index builders, not wire conversion. */
export function observeCompressionIndexRows(): {
  readonly state: { rows: number };
  restore(): void;
} {
  const state = { rows: 0 };
  const create = CallerOwnedToolQuery.create;
  CallerOwnedToolQuery.create = async (
    ...args: Parameters<typeof create>
  ): ReturnType<typeof create> => {
    state.rows += args[0].count;
    return create(...args);
  };
  const restores = [kimiStrategy, mistralStrategy].map((strategy) => {
    const createMapper = strategy.createStreamingMapper;
    strategy.createStreamingMapper = (
      ...args: Parameters<typeof createMapper>
    ): ReturnType<typeof createMapper> => {
      const mapper = createMapper(...args);
      return {
        ...mapper,
        observe(content): void {
          state.rows++;
          mapper.observe(content);
        },
      };
    };
    return (): void => {
      strategy.createStreamingMapper = createMapper;
    };
  });
  return {
    state,
    restore(): void {
      CallerOwnedToolQuery.create = create;
      for (const restore of restores) restore();
    },
  };
}
