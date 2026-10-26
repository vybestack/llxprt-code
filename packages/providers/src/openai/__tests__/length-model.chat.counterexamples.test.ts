/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the named chat counterexamples against the length model.
 * The expected values are the frozen outputs of today's builders (the
 * counterexample fixture). The Kimi rules of the reviews are run as controls
 * and must be wrong. The frozen corpus draws no tool video, so the hand-built
 * video histories are checked against today's chat body writer directly.
 */

import { describe, expect, it } from 'bun:test';
import {
  chatScenarios,
  type ChatScenario,
} from '../../__tests__/support/frozenWire/explicit/chatCases.js';
import { readExplicitFixture } from '../../__tests__/support/frozenWire/explicit/explicitFixture.js';
import { normalizedRows } from '../../__tests__/support/frozenWire/normalizedRows.js';
import { recordedMembers } from '../../__tests__/support/lengthModel/recorded.js';
import { nativeChatMessages } from '../native-chat-messages.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { analyzeChat } from './support/lengthModel/chatLengthModel.js';
import {
  HARNESS_SYSTEM_INSTRUCTION,
  chatSettingsOf,
} from './support/lengthModel/frozenChatInputs.js';
import type { KimiNameRule } from './support/lengthModel/kimiIdFacts.js';
import { toolVideoHistories } from './support/lengthModel/toolVideoHistories.js';

const FORMS = ['raw', 'normalized'] as const;

interface ScenarioRun {
  readonly formatId: string;
  readonly form: (typeof FORMS)[number];
  readonly scenario: ChatScenario;
}

function runs(scenarios: readonly ChatScenario[]): ScenarioRun[] {
  return scenarios.flatMap((scenario) =>
    scenario.formatIds.flatMap((formatId) =>
      FORMS.map((form) => ({ formatId, form, scenario })),
    ),
  );
}

async function analysisOf(run: ScenarioRun, kimiRule?: KimiNameRule) {
  const { scenario, formatId, form } = run;
  const rows =
    form === 'raw'
      ? scenario.send.rows
      : await normalizedRows(scenario.send.rows);
  return analyzeChat(
    rows,
    chatSettingsOf(formatId, scenario.send.ephemerals ?? {}, kimiRule),
    scenario.send.systemInstruction ?? HARNESS_SYSTEM_INSTRUCTION,
    1,
  );
}

describe('chat length model against the frozen chat counterexamples', () => {
  const fixture = readExplicitFixture('chat');
  const scenarios = chatScenarios();

  for (const run of runs(scenarios)) {
    const { scenario, formatId, form } = run;
    it(`${scenario.name} (${formatId}, ${form})`, async () => {
      const analysis = await analysisOf(run);
      const [recorded] = recordedMembers(
        fixture.cases[scenario.name],
        `${formatId}/${form}`,
      );
      expect(analysis.predicted).toBe(recorded);
      expect(analysis.associativity.failures).toBe(0);
    });
  }

  async function disagreements(
    pick: (run: ScenarioRun) => boolean,
    kimiRule: KimiNameRule,
  ): Promise<string[]> {
    const wrong: string[] = [];
    for (const run of runs(scenarios).filter(pick)) {
      const [recorded] = recordedMembers(
        fixture.cases[run.scenario.name],
        `${run.formatId}/${run.form}`,
      );
      const analysis = await analysisOf(run, kimiRule);
      if (analysis.predicted !== recorded) wrong.push(run.scenario.name);
    }
    return wrong;
  }

  const kimiRuns = (run: ScenarioRun): boolean =>
    run.formatId === 'openai-chat-kimi';

  it("control: a model that names each id after the call's own name is wrong on the later-duplicate cases", async () => {
    const wrong = await disagreements(kimiRuns, 'ownName');
    expect(wrong).toContain(
      'chat ids: later eligible duplicate with another name',
    );
  });

  it('control: a model that takes the last raw name is wrong on the unnamed duplicate', async () => {
    const wrong = await disagreements(kimiRuns, 'lastRawName');
    expect(wrong).toContain('chat ids: unnamed duplicate');
  });

  it('control: a model with no exception list is wrong on the duplicate cases', async () => {
    const wrong: string[] = [];
    for (const run of runs(scenarios).filter(kimiRuns)) {
      const [recorded] = recordedMembers(
        fixture.cases[run.scenario.name],
        `${run.formatId}/${run.form}`,
      );
      const { predicted, kimiDigits } = await analysisOf(run);
      if (kimiDigits === undefined) throw new Error('Kimi digits missing');
      const bare = predicted - kimiDigits.exact + kimiDigits.withoutExceptions;
      if (bare !== recorded) wrong.push(run.scenario.name);
    }
    expect(wrong.length).toBeGreaterThan(0);
  });

  it('the Kimi closed form equals the exact walk on every normalized counterexample', async () => {
    for (const run of runs(scenarios).filter(kimiRuns)) {
      if (run.form !== 'normalized') continue;
      const { kimiDigits } = await analysisOf(run);
      expect(kimiDigits?.closed.digits).toBe(kimiDigits?.exact);
    }
  });
});

const VIDEO_SETTINGS: RowFormatSettings = {
  formatId: 'openai-chat:plain',
  formatRev: 1,
  model: 'video-test',
  endpoint: 'https://example.test/v1',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
};

describe('chat length model against tool videos in the chat body writer', () => {
  for (const video of toolVideoHistories()) {
    it(`video histories: ${video.name}`, async () => {
      async function* rows() {
        for (const row of video.rows) yield structuredClone(row);
      }
      let bytes = Buffer.byteLength(
        `[${JSON.stringify({ role: 'system', content: HARNESS_SYSTEM_INSTRUCTION })}]`,
      );
      for await (const chunk of nativeChatMessages(
        rows(),
        VIDEO_SETTINGS,
        'none',
        -1,
        undefined,
        !video.rows.some(
          (row) =>
            row.speaker === 'ai' &&
            row.blocks.some((block) => block.type === 'tool_call'),
        ),
      ))
        bytes += chunk.byteLength;
      const analysis = analyzeChat(
        video.rows,
        chatSettingsOf('openai-chat-plain', {}),
        HARNESS_SYSTEM_INSTRUCTION,
        1,
      );
      expect(analysis.predicted).toBe(bytes);
      expect(analysis.reached.has(5)).toBe(true);
    });
  }
});
