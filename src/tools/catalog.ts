/**
 * Tool catalog — single source of truth.
 *
 * Imports each tool class, instantiates with stubs to extract metadata.
 * The name/group/description live on the classes, not duplicated here.
 */

import type { Tool } from './base.js';
import { ShellReadTool } from './shell/read.js';
import { ShellWriteTool } from './shell/write.js';
import { ShellEditTool } from './shell/edit.js';
import { ShellGlobTool } from './shell/glob.js';
import { ShellGrepTool } from './shell/grep.js';
import { PersistentBashTool } from './shell/bash.js';
import { WebFetchTool } from './web/web-fetch.js';
import { WebSearchTool } from './web/web-search.js';
import { BrowserTool } from './web/browser.js';
import { PauseTool } from './control/pause.js';
import { SpawnTool } from './control/spawn.js';
import { DelegateTool } from './control/delegate.js';
import { SupervisorTool } from './control/supervisor.js';
import { FileTracker } from './shell/file-tracker.js';

const noop: any = () => {};
const stub: any = {};

const ALL_TOOLS: Tool[] = [
  new ShellReadTool(stub, new FileTracker()),
  new ShellWriteTool(stub, new FileTracker()),
  new ShellEditTool(stub, new FileTracker()),
  new ShellGlobTool(stub),
  new ShellGrepTool(stub),
  new PersistentBashTool(stub, noop),
  new WebSearchTool(stub),
  new WebFetchTool(),
  new BrowserTool(stub),
  new PauseTool(noop, noop),
  new SpawnTool(noop, noop),
  new DelegateTool(noop, noop),
  new SupervisorTool(noop, noop),
];

export interface ToolMeta {
  name: string;
  group: string;
  description: string;
}

export const TOOL_CATALOG: ToolMeta[] = ALL_TOOLS.map(t => ({
  name: t.name,
  group: t.group,
  description: t.description.split('\n')[0],
}));

/**
 * Full tool definitions exactly as the LLM sees them.
 * Mirrors ToolRegistry.getToolDefinitions() but without needing a live registry.
 */
export const TOOL_DEFINITIONS = ALL_TOOLS.map(t => {
  const schema = t.inputSchema as Record<string, any>;
  return {
    name: t.name,
    group: t.group,
    description: t.description,
    input_schema: {
      ...schema,
      properties: {
        description: {
          type: 'string',
          description: 'Brief reason for this tool call (shown to the user)',
        },
        ...schema.properties,
      },
    },
  };
});
