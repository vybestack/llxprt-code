/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// URLs for documentation and tutorials
const DOCS_URL = 'https://github.com/vybestack/llxprt-code/blob/main/README.md';
const TUTORIALS_URL = 'https://github.com/vybestack/llxprt-code/tree/main/docs';

/**
 * Opens the documentation in the default browser
 */
export const openDocumentation = async (): Promise<void> => {
  // In a real implementation, this would use a library like `open` to launch the browser
  // For now, we'll just log the URL
  console.log(`Opening documentation: ${DOCS_URL}`);

  // Mock implementation:
  // await open(DOCS_URL);
};

/**
 * Opens the tutorials page in the default browser
 */
export const openTutorials = async (): Promise<void> => {
  // In a real implementation, this would use a library like `open` to launch the browser
  // For now, we'll just log the URL
  console.log(`Opening tutorials: ${TUTORIALS_URL}`);

  // Mock implementation:
  // await open(TUTORIALS_URL);
};
