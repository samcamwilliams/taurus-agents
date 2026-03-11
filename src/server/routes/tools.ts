import { json, route, type Route } from '../helpers.js';
import { DEFAULT_MODEL, DEFAULT_DOCKER_IMAGE, DEFAULT_TOOLS, READ_ONLY_TOOLS, SUPERVISOR_TOOLS, DEFAULT_MAX_TURNS, DEFAULT_TIMEOUT_MS } from '../../core/defaults.js';
import { TOOL_CATALOG } from '../../tools/catalog.js';

export function toolRoutes(): Route[] {
  return [
    route('GET', '/api/tools', async (_req, res) => {
      json(res, {
        tools: TOOL_CATALOG,
        defaults: {
          model: DEFAULT_MODEL,
          docker_image: DEFAULT_DOCKER_IMAGE,
          tools: DEFAULT_TOOLS,
          readonly_tools: READ_ONLY_TOOLS,
          supervisor_tools: SUPERVISOR_TOOLS,
          max_turns: DEFAULT_MAX_TURNS,
          timeout_ms: DEFAULT_TIMEOUT_MS,
        },
      });
    }),
  ];
}
