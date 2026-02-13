/**
 * @plan PLAN-20260211-HIGHDENSITY.P22
 * @requirement REQ-HD-010.1, REQ-HD-010.2, REQ-HD-010.3, REQ-HD-010.4, REQ-HD-010.5
 */
import { describe, it, expect } from 'vitest';
import { getCompressionPrompt } from '../prompts.js';

describe('getCompressionPrompt enriched sections', () => {
  const prompt = getCompressionPrompt();

  it('contains <task_context> section inside <state_snapshot>', () => {
    expect(prompt).toContain('<task_context>');
    expect(prompt).toContain('</task_context>');
    const snapshotStart = prompt.indexOf('<state_snapshot>');
    const snapshotEnd = prompt.indexOf('</state_snapshot>');
    const taskContextStart = prompt.indexOf('<task_context>');
    expect(taskContextStart).toBeGreaterThan(snapshotStart);
    expect(taskContextStart).toBeLessThan(snapshotEnd);
  });

  it('contains <user_directives> section inside <state_snapshot>', () => {
    expect(prompt).toContain('<user_directives>');
    expect(prompt).toContain('</user_directives>');
    const snapshotStart = prompt.indexOf('<state_snapshot>');
    const snapshotEnd = prompt.indexOf('</state_snapshot>');
    const sectionStart = prompt.indexOf('<user_directives>');
    expect(sectionStart).toBeGreaterThan(snapshotStart);
    expect(sectionStart).toBeLessThan(snapshotEnd);
  });

  it('contains <errors_encountered> section inside <state_snapshot>', () => {
    expect(prompt).toContain('<errors_encountered>');
    expect(prompt).toContain('</errors_encountered>');
    const snapshotStart = prompt.indexOf('<state_snapshot>');
    const snapshotEnd = prompt.indexOf('</state_snapshot>');
    const sectionStart = prompt.indexOf('<errors_encountered>');
    expect(sectionStart).toBeGreaterThan(snapshotStart);
    expect(sectionStart).toBeLessThan(snapshotEnd);
  });

  it('contains <code_references> section inside <state_snapshot>', () => {
    expect(prompt).toContain('<code_references>');
    expect(prompt).toContain('</code_references>');
    const snapshotStart = prompt.indexOf('<state_snapshot>');
    const snapshotEnd = prompt.indexOf('</state_snapshot>');
    const sectionStart = prompt.indexOf('<code_references>');
    expect(sectionStart).toBeGreaterThan(snapshotStart);
    expect(sectionStart).toBeLessThan(snapshotEnd);
  });

  it('preserves all 5 original sections', () => {
    expect(prompt).toContain('<overall_goal>');
    expect(prompt).toContain('<key_knowledge>');
    expect(prompt).toContain('<current_progress>');
    expect(prompt).toContain('<active_tasks>');
    expect(prompt).toContain('<open_questions>');
  });

  it('new sections appear after original sections', () => {
    const openQuestionsEnd = prompt.indexOf('</open_questions>');
    const taskContextStart = prompt.indexOf('<task_context>');
    expect(taskContextStart).toBeGreaterThan(openQuestionsEnd);
  });
});
