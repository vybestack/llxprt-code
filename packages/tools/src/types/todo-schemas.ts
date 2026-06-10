/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

export const TodoStatus = z.enum(['pending', 'in_progress', 'completed']);

// Create a coercion schema for IDs that accepts both strings and numbers
// This handles providers like GLM that send numeric IDs
const IdSchema = z
  .union([z.string(), z.number()])
  .transform((val) => String(val));

export const TodoToolCallSchema = z.object({
  id: IdSchema,
  name: z.string(),
  parameters: z.record(z.any()),
  timestamp: z.date(),
});

export const SubtaskSchema = z.object({
  id: IdSchema,
  content: z.string().min(1),
  toolCalls: z.array(TodoToolCallSchema).optional(),
});

export const TodoSchema = z.object({
  id: IdSchema,
  content: z.string().min(1),
  status: TodoStatus,
  subtasks: z.array(SubtaskSchema).optional(),
  toolCalls: z.array(TodoToolCallSchema).optional(),
});

export const TodoArraySchema = z.array(TodoSchema);

export type TodoToolCall = z.infer<typeof TodoToolCallSchema>;
export type Subtask = z.infer<typeof SubtaskSchema>;
export type Todo = z.infer<typeof TodoSchema>;
export type TodoStatus = z.infer<typeof TodoStatus>;
