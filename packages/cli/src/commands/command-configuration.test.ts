/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import yargs from 'yargs/yargs';
import { configureCommandOptions } from './command-configuration.js';

describe('command option configuration', () => {
  it('parses configured positionals, defaults and choices with real yargs', async () => {
    const result = await yargs([])
      .exitProcess(false)
      .command({
        command: 'disable <name>',
        builder: (parser) =>
          configureCommandOptions(parser, (configuration) =>
            configuration
              .positional('name', { type: 'string', demandOption: true })
              .option('scope', {
                type: 'string',
                choices: ['user', 'workspace'],
                default: 'workspace',
              }),
          ),
        handler: () => {},
      })
      .parseAsync(['disable', 'alpha']);
    expect(`${result['name']}@${result['scope']}`).toBe('alpha@workspace');
  });

  it('preserves parser checks and rejects conflicting input', async () => {
    const parser = yargs([])
      .exitProcess(false)
      .fail(false)
      .command({
        command: 'install [source]',
        builder: (instance) =>
          configureCommandOptions(instance, (configuration) =>
            configuration
              .positional('source', { type: 'string' })
              .option('path', { type: 'string' })
              .conflicts('source', 'path')
              .check((args) => {
                if (!args.source && !args.path)
                  throw new Error('source or path required');
                return true;
              }),
          ),
        handler: () => {},
      });
    await expect(
      Promise.resolve().then(() =>
        parser.parseAsync(['install', 'alpha', '--path', 'beta']),
      ),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it('runs command checks when required source options are absent', async () => {
    const parser = yargs([])
      .exitProcess(false)
      .fail(false)
      .command({
        command: 'install [source]',
        builder: (instance) =>
          configureCommandOptions(instance, (configuration) =>
            configuration
              .positional('source', { type: 'string' })
              .check((args) => {
                if (!args.source) throw new Error('source required');
                return true;
              }),
          ),
        handler: () => {},
      });
    await expect(
      Promise.resolve().then(() => parser.parseAsync(['install'])),
    ).rejects.toThrow('source required');
  });

  it('rejects choices outside the configured scope', async () => {
    const parser = yargs([])
      .exitProcess(false)
      .fail(false)
      .command({
        command: 'disable <name>',
        builder: (instance) =>
          configureCommandOptions(instance, (configuration) =>
            configuration
              .positional('name', { type: 'string', demandOption: true })
              .option('scope', {
                type: 'string',
                choices: ['user', 'workspace'],
              }),
          ),
        handler: () => {},
      });
    await expect(
      Promise.resolve().then(() =>
        parser.parseAsync(['disable', 'alpha', '--scope', 'system']),
      ),
    ).rejects.toThrow(/Invalid values/);
  });
});
