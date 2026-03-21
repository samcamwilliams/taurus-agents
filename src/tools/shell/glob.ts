import type { ToolResult, ToolContext } from '../../core/types.js';
import { Tool } from '../base.js';
import type { PersistentShell } from '../../daemon/persistent-shell.js';
import { shellQuote } from './shell-quote.js';

export class ShellGlobTool extends Tool {
  readonly name = 'Glob';
  readonly group = 'Search';
  readonly description = 'Find files matching a glob pattern. Supports ** for recursive matching (e.g. "**/*.ts", "src/**/*.js"). Returns matching file paths sorted by name.';
  readonly inputSchema = {
    type: 'object' as const,
    properties: {
      pattern: { type: 'string', description: 'The glob pattern to match files against (e.g. "**/*.ts", "src/*.js")' },
      path: { type: 'string', description: 'The directory to search in. Defaults to cwd.' },
    },
    required: ['pattern'],
  };

  constructor(private shell: PersistentShell) { super(); }

  async execute(input: { pattern: string; path?: string }, context: ToolContext): Promise<ToolResult> {
    const searchDir = input.path
      ? (input.path.startsWith('/') ? input.path : `${context.cwd}/${input.path}`)
      : context.cwd;

    // Use bash globstar for full glob support (**, brace expansion, etc.)
    // The pattern is interpolated raw so bash expands globs and braces.
    // The search directory is safely quoted via shellQuote.
    // globstar requires bash 4+; on macOS host (bash 3.2) shopt fails and we fall through to find.
    const filters = `grep -v node_modules | grep -v '.git/' | sort | head -500`;
    const globCmd = `cd ${shellQuote(searchDir)} && shopt -s globstar nullglob && files=(${input.pattern}) && for f in "\${files[@]}"; do [ -f "$f" ] && echo "$f"; done | ${filters}`;

    // Fallback for bash 3.2 (macOS host mode): use find with -name.
    // Handles *.ext and **/*.ext patterns. Brace expansion (*.{ts,tsx}) works via bash expansion
    // of the find command line itself (bash 3.2 supports brace expansion, just not globstar).
    const pat = input.pattern;
    const hasDoublestar = pat.includes('**');
    const parts = pat.split('/');
    const namePattern = parts.pop()!;
    const subDir = parts.filter(p => p !== '**').join('/');
    const findTarget = subDir ? `${searchDir}/${subDir}` : searchDir;
    const depthFlag = hasDoublestar ? '' : '-maxdepth 1';
    const stripPrefix = `${searchDir}/`.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&');
    const findCmd = `find ${shellQuote(findTarget)} ${depthFlag} -type f -name ${shellQuote(namePattern)} ` +
      `! -path '*/node_modules/*' ! -path '*/.git/*' ! -name '.*' 2>/dev/null | ` +
      `sed 's|^${stripPrefix}||' | ${filters}`;

    const cmd = `(${globCmd}) 2>/dev/null || (${findCmd})`;
    const result = await this.shell.exec(cmd);

    const files = result.stdout.trim().split('\n').filter(Boolean);
    if (files.length === 0) {
      return { output: `No files matched pattern: ${input.pattern}`, isError: false, durationMs: result.durationMs };
    }

    return {
      output: `${files.length} file(s) found:\n${files.join('\n')}`,
      isError: false,
      durationMs: result.durationMs,
    };
  }
}

