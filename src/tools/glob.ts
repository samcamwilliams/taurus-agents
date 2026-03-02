import fg from 'fast-glob';
import path from 'node:path';
import type { ToolResult, ToolContext } from '../core/types.js';
import { Tool } from './base.js';

export class GlobTool extends Tool {
  readonly name = 'Glob';
  readonly description = 'Find files matching a glob pattern. Returns matching file paths sorted by name. Use patterns like "**/*.ts", "src/**/*.js", "*.json".';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'The glob pattern to match files against',
      },
      path: {
        type: 'string',
        description: 'The directory to search in. Defaults to cwd.',
      },
    },
    required: ['pattern'],
  };

  async execute(input: { pattern: string; path?: string }, context: ToolContext): Promise<ToolResult> {
    const searchDir = input.path
      ? (path.isAbsolute(input.path) ? input.path : path.resolve(context.cwd, input.path))
      : context.cwd;

    try {
      const files = await fg(input.pattern, {
        cwd: searchDir,
        dot: false,
        ignore: ['**/node_modules/**', '**/.git/**'],
        onlyFiles: true,
      });

      files.sort();

      if (files.length === 0) {
        return { output: `No files matched pattern: ${input.pattern}`, isError: false, durationMs: 0 };
      }

      const output = files.join('\n');
      return {
        output: `${files.length} files found:\n${output}`,
        isError: false,
        durationMs: 0,
      };
    } catch (err: any) {
      return { output: `Glob error: ${err.message}`, isError: true, durationMs: 0 };
    }
  }
}
