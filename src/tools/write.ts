import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolResult, ToolContext } from '../core/types.js';
import { Tool } from './base.js';

export class WriteTool extends Tool {
  readonly name = 'Write';
  readonly description = 'Write content to a file. Creates the file and any parent directories if they don\'t exist. Overwrites existing files.';
  readonly requiresApproval = true;
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: 'The path to the file to write (absolute or relative to cwd)',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['file_path', 'content'],
  };

  async execute(input: { file_path: string; content: string }, context: ToolContext): Promise<ToolResult> {
    const filePath = path.isAbsolute(input.file_path)
      ? input.file_path
      : path.resolve(context.cwd, input.file_path);

    try {
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, input.content, 'utf-8');

      return {
        output: `File written: ${filePath} (${input.content.length} bytes)`,
        isError: false,
        durationMs: 0,
      };
    } catch (err: any) {
      return { output: `Error writing file: ${err.message}`, isError: true, durationMs: 0 };
    }
  }
}
