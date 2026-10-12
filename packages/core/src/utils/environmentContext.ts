/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Returns the working-directory preamble for the environment context: a single
 * directory line, or a bulleted list for multiple directories. Folder-tree
 * listing is removed (issue #3072); this only names the working directories.
 */
export async function getDirectoryContextString(
  workspaceDirectories: readonly string[],
): Promise<string> {
  let workingDirPreamble: string;
  if (workspaceDirectories.length === 1) {
    workingDirPreamble = `I'm currently working in the directory: ${workspaceDirectories[0]}`;
  } else {
    const dirList = workspaceDirectories.map((dir) => `  - ${dir}`).join('\n');
    workingDirPreamble = `I'm currently working in the following directories:\n${dirList}`;
  }

  return workingDirPreamble;
}

/**
 * Retrieves environment-related information to be included in the chat context:
 * program identity, locale date, platform, working-directory preamble, and
 * environment memory. No folder-tree listing is produced.
 * @param {Config} config - The runtime configuration and services.
 * @returns A promise that resolves to a single text part with the environment info.
 */
export async function getEnvironmentContext(
  environmentMemory: string,
  workspaceDirectories: readonly string[],
): Promise<Array<{ text: string }>> {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const platform = process.platform;
  const directoryContext =
    await getDirectoryContextString(workspaceDirectories);

  const context = `
This is LLxprt Code. We are setting up the context for our chat.
Today's date is ${today} (formatted according to the user's locale).
My operating system is: ${platform}
${directoryContext}

${environmentMemory}
        `.trim();

  return [{ text: context }];
}
