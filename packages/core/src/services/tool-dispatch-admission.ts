/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  BaseDeclarativeTool,
  type AnyDeclarativeTool,
  type AnyToolInvocation,
} from '@vybestack/llxprt-code-tools';

export class ToolDispatchAdmission {
  private readonly controller = new AbortController();
  private readonly accepted = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  assertOpen(): void {
    if (this.controller.signal.aborted) throw this.controller.signal.reason;
  }

  bind(
    tool: AnyDeclarativeTool,
    authorized: () => boolean,
  ): AnyDeclarativeTool {
    const assertAuthorized = (): void => {
      this.assertOpen();
      if (!authorized()) throw new Error(`Tool '${tool.name}' is unavailable`);
    };
    return new Proxy(tool, {
      get: (target, key): unknown => {
        if (key === 'build')
          return (...args: Parameters<AnyDeclarativeTool['build']>) => {
            assertAuthorized();
            return this.bindInvocation(target.build(...args), assertAuthorized);
          };
        if (key === 'buildAndExecute')
          return async (
            ...args: Parameters<AnyDeclarativeTool['buildAndExecute']>
          ) => {
            assertAuthorized();
            return this.bindInvocation(
              target.build(args[0]),
              assertAuthorized,
            ).execute(args[1], args[2]);
          };
        if (key === 'validateBuildAndExecute')
          return async (
            ...args: Parameters<AnyDeclarativeTool['validateBuildAndExecute']>
          ) => {
            assertAuthorized();
            return this.accept(args[1], assertAuthorized, (signal) =>
              target.validateBuildAndExecute(args[0], signal),
            );
          };
        if (key === 'schema') return structuredClone(target.schema);
        const value: unknown = Reflect.get(target, key, target);
        if (key === 'execute' && typeof value === 'function')
          return async (...args: unknown[]) => {
            assertAuthorized();
            const signal = args[1] ?? this.controller.signal;
            if (!(signal instanceof AbortSignal))
              throw new Error('Direct tool dispatch requires an AbortSignal');
            return this.accept(signal, assertAuthorized, async (combined) =>
              Reflect.apply(value, target, [
                args[0],
                combined,
                ...args.slice(2),
              ]),
            );
          };
        if (
          [
            'withBackgroundJobs',
            'withChildDisplay',
            'withAsyncTaskService',
            'withSessionApproval',
          ].includes(String(key)) &&
          typeof value === 'function'
        )
          return (...args: unknown[]): AnyDeclarativeTool => {
            assertAuthorized();
            const replacement: unknown = Reflect.apply(value, target, args);
            if (!(replacement instanceof BaseDeclarativeTool))
              throw new Error(
                'Session binding did not construct a declarative tool',
              );
            return this.bind(replacement, authorized);
          };
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  private bindInvocation(
    invocation: AnyToolInvocation,
    assertAuthorized: () => void,
  ): AnyToolInvocation {
    return new Proxy(invocation, {
      get: (target, key): unknown => {
        if (key === 'execute')
          return async (...args: Parameters<AnyToolInvocation['execute']>) => {
            assertAuthorized();
            return this.accept(args[0], assertAuthorized, (signal) =>
              target.execute(signal, args[1], args[2], args[3], args[4]),
            );
          };
        if (key === 'shouldConfirmExecute')
          return (
            ...args: Parameters<AnyToolInvocation['shouldConfirmExecute']>
          ) => {
            assertAuthorized();
            return this.accept(args[0], assertAuthorized, async (signal) => {
              const details = await target.shouldConfirmExecute(signal);
              assertAuthorized();
              if (details === false) return false;
              return {
                ...details,
                onConfirm: async (
                  ...confirmation: Parameters<typeof details.onConfirm>
                ) => {
                  assertAuthorized();
                  return this.accept(args[0], assertAuthorized, async () =>
                    details.onConfirm(confirmation[0], confirmation[1]),
                  );
                },
              };
            });
          };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  private accept<T>(
    signal: AbortSignal,
    authorize: () => void,
    execute: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const combined = AbortSignal.any([signal, this.controller.signal]);
    const operation = Promise.resolve().then(() => {
      authorize();
      combined.throwIfAborted();
      return execute(combined);
    });
    this.accepted.add(operation);
    void operation.then(
      () => this.accepted.delete(operation),
      () => this.accepted.delete(operation),
    );
    return operation;
  }

  close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    const accepted = [...this.accepted];
    this.controller.abort(new Error('Tool dispatch admission is closed'));
    this.closing = Promise.allSettled(accepted).then((results) => {
      const failures = results.flatMap((result) =>
        result.status === 'rejected' &&
        result.reason !== this.controller.signal.reason
          ? [result.reason]
          : [],
      );
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'Accepted tool dispatch cleanup failed',
        );
    });
    return this.closing;
  }
}
