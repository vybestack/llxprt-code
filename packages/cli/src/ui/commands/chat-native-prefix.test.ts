/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withCLI,
  row,
  contents,
  blocks,
  runCommand,
  persistedContents,
  operationFileCreates,
  useTempDir,
  pinHistoryBackend,
} from './native-prefix-test-helpers.js';

describe('actual native CLI clear and restore', () => {
  pinHistoryBackend('journal');
  const directory = useTempDir('cli-native-prefix-');
  for (const size of [3, 64, 65, 5000]) {
    for (const command of ['clear', 'restore']) {
      it(`${command} selects the original rows over ${size} rows without scratch files`, async () => {
        await withCLI(
          directory(),
          size,
          async ({ client, context, recording }) => {
            const restoreCut = size % 2 === 0 ? size - 2 : size - 1;
            const cut = command === 'clear' ? 2 : restoreCut;
            const receipt = await operationFileCreates(async () => {
              expect(
                await runCommand(
                  context,
                  command,
                  command === 'restore' ? '1' : '',
                ),
              ).toBeUndefined();
            });
            expect(receipt).toStrictEqual({ directories: [], files: [] });
            expect(blocks(await contents(client.getHistory()))).toStrictEqual(
              Array.from({ length: cut }, (_, i) => row(i).blocks),
            );
            expect(blocks(await persistedContents(recording))).toStrictEqual(
              Array.from({ length: cut }, (_, i) => row(i).blocks),
            );
          },
        );
      });
    }
  }
});
