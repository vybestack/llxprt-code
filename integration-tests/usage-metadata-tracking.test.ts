/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test, expect } from '@playwright/test';

test.describe('Token usage tracking', () => {
  test('should track and display token usage with OpenAI provider', async ({
    page,
  }) => {
    // Start the CLI with OpenAI provider
    await page.goto('/');

    // Switch to OpenAI provider
    await page.keyboard.type('/provider openai');
    await page.keyboard.press('Enter');

    // Wait for provider switch confirmation
    await expect(
      page.locator('text=Switched from gemini to openai'),
    ).toBeVisible();

    // Send a message
    await page.keyboard.type('Hello, how are you?');
    await page.keyboard.press('Enter');

    // Wait for response
    await page.waitForTimeout(2000);

    // Check that context percentage has decreased from 100%
    // Look for the context percentage in the footer area
    const contextText = await page
      .locator('text=/\\d+% context left/')
      .textContent();

    // Should not be 100% anymore
    expect(contextText).not.toContain('100% context left');

    // Should contain a percentage less than 100
    const percentageMatch = contextText?.match(/(\d+)% context left/);
    expect(percentageMatch).toBeTruthy();

    if (percentageMatch) {
      const percentage = parseInt(percentageMatch[1]);
      expect(percentage).toBeLessThan(100);
      expect(percentage).toBeGreaterThan(0);
    }
  });

  test('should accumulate token usage across multiple messages', async ({
    page,
  }) => {
    await page.goto('/');

    // Switch to OpenAI provider
    await page.keyboard.type('/provider openai');
    await page.keyboard.press('Enter');
    await expect(
      page.locator('text=Switched from gemini to openai'),
    ).toBeVisible();

    // Send first message
    await page.keyboard.type('Count to 5');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Get first percentage
    const firstContextText = await page
      .locator('text=/\\d+% context left/')
      .textContent();
    const firstMatch = firstContextText?.match(/(\d+)% context left/);
    const firstPercentage = firstMatch ? parseInt(firstMatch[1]) : 100;

    // Send second message
    await page.keyboard.type('Now count to 10');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    // Get second percentage
    const secondContextText = await page
      .locator('text=/\\d+% context left/')
      .textContent();
    const secondMatch = secondContextText?.match(/(\d+)% context left/);
    const secondPercentage = secondMatch ? parseInt(secondMatch[1]) : 100;

    // Second percentage should be less than first
    expect(secondPercentage).toBeLessThan(firstPercentage);
  });
});

test.describe('Usage metadata events', () => {
  test('should emit usage metadata events from provider', async ({ page }) => {
    // Enable console logging to capture debug messages
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'log') {
        consoleLogs.push(msg.text());
      }
    });

    await page.goto('/');

    // Switch to OpenAI provider
    await page.keyboard.type('/provider openai');
    await page.keyboard.press('Enter');
    await expect(
      page.locator('text=Switched from gemini to openai'),
    ).toBeVisible();

    // Send a message
    await page.keyboard.type('Say hello');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);

    // Check for usage data logs
    const usageDataLog = consoleLogs.find(
      (log) =>
        log.includes('[OpenAIProvider] Usage data received:') ||
        log.includes('[GeminiCompatibleWrapper] Usage data received:'),
    );

    expect(usageDataLog).toBeTruthy();

    // Check for usage metadata event
    const usageEventLog = consoleLogs.find(
      (log) => log.includes('UsageMetadata') || log.includes('usage_metadata'),
    );

    expect(usageEventLog).toBeTruthy();
  });
});
