import fs from 'node:fs/promises';
import path from 'node:path';
import type { ToolResult, ToolContext } from '../core/types.js';
import { Tool } from './base.js';

export class ReadTool extends Tool {
  readonly name = 'Read';
  readonly description = 'Read a file from the filesystem. Returns contents with line numbers. Supports offset and limit for large files.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: 'The path to the file to read (absolute or relative to cwd)',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (1-based). Optional.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read. Optional, defaults to 2000.',
      },
    },
    required: ['file_path'],
  };

  async execute(input: { file_path: string; offset?: number; limit?: number }, context: ToolContext): Promise<ToolResult> {
    const filePath = path.isAbsolute(input.file_path)
      ? input.file_path
      : path.resolve(context.cwd, input.file_path);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      const offset = Math.max(1, input.offset ?? 1);
      const limit = input.limit ?? 2000;
      const slice = lines.slice(offset - 1, offset - 1 + limit);

      // Format with line numbers (like cat -n)
      const numbered = slice.map((line, i) => {
        const lineNum = String(offset + i).padStart(6, ' ');
        return `${lineNum}\t${line}`;
      }).join('\n');

      const totalLines = lines.length;
      const header = `File: ${filePath} (${totalLines} lines)`;
      const truncated = slice.length < lines.length
        ? `\n[Showing lines ${offset}-${offset + slice.length - 1} of ${totalLines}]`
        : '';

      return {
        output: `${header}${truncated}\n${numbered}`,
        isError: false,
        durationMs: 0,
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return { output: `File not found: ${filePath}`, isError: true, durationMs: 0 };
      }
      if (err.code === 'EISDIR') {
        return { output: `${filePath} is a directory, not a file. Use Glob to list directory contents.`, isError: true, durationMs: 0 };
      }
      return { output: `Error reading file: ${err.message}`, isError: true, durationMs: 0 };
    }
  }
}
