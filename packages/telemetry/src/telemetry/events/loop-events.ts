/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export enum LoopType {
  CONSECUTIVE_IDENTICAL_TOOL_CALLS = 'consecutive_identical_tool_calls',
  CHANTING_IDENTICAL_SENTENCES = 'chanting_identical_sentences',
  MAX_TURNS_EXCEEDED = 'max_turns_exceeded',
}

export class LoopDetectedEvent {
  'event.name': 'loop_detected';
  'event.timestamp': string;
  loop_type: LoopType;
  prompt_id: string;

  constructor(loop_type: LoopType, prompt_id: string) {
    this['event.name'] = 'loop_detected';
    this['event.timestamp'] = new Date().toISOString();
    this.loop_type = loop_type;
    this.prompt_id = prompt_id;
  }
}

export class NextSpeakerCheckEvent {
  'event.name': 'next_speaker_check';
  'event.timestamp': string;
  prompt_id: string;
  finish_reason: string;
  result: string;

  constructor(prompt_id: string, finish_reason: string, result: string) {
    this['event.name'] = 'next_speaker_check';
    this['event.timestamp'] = new Date().toISOString();
    this.prompt_id = prompt_id;
    this.finish_reason = finish_reason;
    this.result = result;
  }
}

export class SlashCommandEvent {
  'event.name': 'slash_command';
  'event.timestamp': string;
  command: string;
  subcommand?: string;

  constructor(command: string, subcommand?: string) {
    this['event.name'] = 'slash_command';
    this['event.timestamp'] = new Date().toISOString();
    this.command = command;
    this.subcommand = subcommand;
  }
}

export class MalformedJsonResponseEvent {
  'event.name': 'malformed_json_response';
  'event.timestamp': string;
  model: string;

  constructor(model: string) {
    this['event.name'] = 'malformed_json_response';
    this['event.timestamp'] = new Date().toISOString();
    this.model = model;
  }
}
