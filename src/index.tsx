import 'dotenv/config';
import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.js';

// ── Services ──
import { AnthropicProvider } from './inference/providers/anthropic.js';
import { InferenceService } from './inference/service.js';
import { ToolRegistry } from './tools/registry.js';

// ── Tools ──
import { ReadTool } from './tools/read.js';
import { WriteTool } from './tools/write.js';
import { EditTool } from './tools/edit.js';
import { BashTool } from './tools/bash.js';
import { GlobTool } from './tools/glob.js';
import { GrepTool } from './tools/grep.js';

// ── Agent ──
import { CodingAgent } from './agents/coding-agent.js';

// ── Database ──
import { Database } from './db/index.js';
import './db/models/Session.js';
import './db/models/Message.js';
import './db/models/ToolCall.js';

async function main() {
  // 1. Boot database
  await Database.sync();

  // 2. Create inference service
  const provider = new AnthropicProvider();
  const inference = new InferenceService(provider);

  // 3. Register tools
  const tools = new ToolRegistry();
  tools.register(new ReadTool());
  tools.register(new WriteTool());
  tools.register(new EditTool());
  tools.register(new BashTool());
  tools.register(new GlobTool());
  tools.register(new GrepTool());

  // 4. Create coding agent
  const cwd = process.cwd();
  const agent = new CodingAgent({
    inference,
    tools,
    cwd,
    requestApproval: async (toolName: string, input: any) => {
      // For now, auto-approve everything.
      // The UI will handle permission prompts in a future iteration.
      return true;
    },
  });

  // 5. Render the TUI
  console.log(`\n  🐂 Taurus Agents v0.1.0`);
  console.log(`  Working directory: ${cwd}`);
  console.log(`  Provider: ${inference.getProviderName()}`);
  console.log(`  Type /exit to quit\n`);

  render(<App agent={agent} />);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
