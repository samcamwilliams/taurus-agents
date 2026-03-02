import { spawn } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';
import path from 'node:path';
import type { ToolResult, ToolContext } from '../core/types.js';
import { Tool } from './base.js';

const MAX_OUTPUT = 50_000; // 50KB

export class GrepTool extends Tool {
  readonly name = 'Grep';
  readonly description = 'Search file contents using regex patterns (powered by ripgrep). Returns matching lines with file paths and line numbers.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'The regex pattern to search for',
      },
      path: {
        type: 'string',
        description: 'File or directory to search in. Defaults to cwd.',
      },
      glob: {
        type: 'string',
        description: 'Glob pattern to filter files (e.g. "*.ts", "*.{js,jsx}")',
      },
      case_insensitive: {
        type: 'boolean',
        description: 'Case insensitive search. Default false.',
      },
    },
    required: ['pattern'],
  };

  async execute(
    input: { pattern: string; path?: string; glob?: string; case_insensitive?: boolean },
    context: ToolContext,
  ): Promise<ToolResult> {
    const searchPath = input.path
      ? (path.isAbsolute(input.path) ? input.path : path.resolve(context.cwd, input.path))
      : context.cwd;

    return new Promise<ToolResult>((resolve) => {
      const args = [
        '--line-number',
        '--no-heading',
        '--color', 'never',
        '--max-count', '100',
        '-g', '!node_modules',
        '-g', '!.git',
      ];

      if (input.case_insensitive) args.push('--ignore-case');
      if (input.glob) args.push('--glob', input.glob);

      args.push(input.pattern, searchPath);

      let output = '';
      const proc = spawn(rgPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      proc.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (output.length > MAX_OUTPUT) {
          output = output.slice(0, MAX_OUTPUT) + '\n[output truncated]';
          if (proc.pid) proc.kill('SIGTERM');
        }
      });

      proc.stderr.on('data', (chunk) => {
        output += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code === 1 && !output) {
          // Exit code 1 = no matches (not an error)
          resolve({ output: `No matches for pattern: ${input.pattern}`, isError: false, durationMs: 0 });
          return;
        }

        resolve({
          output: output || '(no output)',
          isError: code !== 0 && code !== 1,
          durationMs: 0,
        });
      });

      proc.on('error', (err) => {
        resolve({ output: `Grep error: ${err.message}`, isError: true, durationMs: 0 });
      });
    });
  }
}
