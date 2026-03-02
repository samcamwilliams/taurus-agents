import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolResult, ToolContext } from '../core/types.js';
import { Tool } from './base.js';

export class EditTool extends Tool {
  readonly name = 'Edit';
  readonly description = 'Edit a file by replacing an exact string match. The old_string must appear exactly once in the file. Use this for precise, targeted edits.';
  readonly requiresApproval = true;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: 'The path to the file to edit',
      },
      old_string: {
        type: 'string',
        description: 'The exact string to find and replace. Must be unique in the file.',
      },
      new_string: {
        type: 'string',
        description: 'The string to replace it with. Must be different from old_string.',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  };

  async execute(input: { file_path: string; old_string: string; new_string: string }, context: ToolContext): Promise<ToolResult> {
    const filePath = path.isAbsolute(input.file_path)
      ? input.file_path
      : path.resolve(context.cwd, input.file_path);

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      // Check old_string appears exactly once
      const occurrences = content.split(input.old_string).length - 1;
      if (occurrences === 0) {
        return {
          output: `old_string not found in ${filePath}. Make sure it matches exactly (including whitespace and indentation).`,
          isError: true,
          durationMs: 0,
        };
      }
      if (occurrences > 1) {
        return {
          output: `old_string appears ${occurrences} times in ${filePath}. It must be unique. Provide more surrounding context to make it unique.`,
          isError: true,
          durationMs: 0,
        };
      }

      if (input.old_string === input.new_string) {
        return { output: 'old_string and new_string are identical. No changes made.', isError: true, durationMs: 0 };
      }

      const newContent = content.replace(input.old_string, input.new_string);
      await fs.writeFile(filePath, newContent, 'utf-8');

      return {
        output: `Edited ${filePath}: replaced ${input.old_string.length} chars with ${input.new_string.length} chars`,
        isError: false,
        durationMs: 0,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { output: `File not found: ${filePath}`, isError: true, durationMs: 0 };
      }
      return { output: `Error editing file: ${err.message}`, isError: true, durationMs: 0 };
    }
  }
}
