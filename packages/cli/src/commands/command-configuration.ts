/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Argv,
  Options,
  ParserConfigurationOptions,
  PositionalOptions,
} from 'yargs';

interface CommandArguments {
  _: Array<string | number>;
  scope?: string;
  name?: string;
  names?: string[];
  source?: string;
  path?: string;
  all?: boolean;
  [name: string]: unknown;
}

interface CommandConfiguration {
  positional(key: string, options: PositionalOptions): CommandConfiguration;
  option(key: string, options: Options): CommandConfiguration;
  check(validate: (args: CommandArguments) => boolean): CommandConfiguration;
  conflicts(key: string, other: string): CommandConfiguration;
  usage(message: string): CommandConfiguration;
  parserConfiguration(
    options: Partial<ParserConfigurationOptions>,
  ): CommandConfiguration;
}

export function configureCommandOptions<T>(
  parser: Argv<T>,
  configure: (configuration: CommandConfiguration) => void,
): Argv<T> {
  configure(parser);
  return parser;
}
