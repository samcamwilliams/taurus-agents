/**
 * prompt.ts — System prompt template expansion.
 *
 * Supports:
 *   {{include:path}}              — include from resources/prompts/ (recursive, max 5 deep)
 *   {{key}}, {{ns.key}}           — variable replacement (flat or dotted)
 *   {% if key %}...{% endif %}    — conditional block (truthy = exists and non-empty)
 *   {% if key %}...{% else %}...{% endif %}
 */

import fs from 'node:fs';
import path from 'node:path';

/** Flat or nested context bag for variable replacement. */
export type TemplateContext = Record<string, string | Record<string, string>>;

/**
 * Build the default context (date/time variables).
 * Merge with any extra context passed by the caller.
 */
function buildContext(extra?: TemplateContext, asOf?: Date): TemplateContext {
  const now = asOf ?? new Date();
  const defaults: TemplateContext = {
    datetime: now.toISOString(),
    date: now.toISOString().split('T')[0],
    time: now.toTimeString().split(' ')[0],
    year: String(now.getFullYear()),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  return { ...defaults, ...extra };
}

/**
 * Resolve a dotted key like "agent.name" against a context object.
 * Returns the string value or undefined if not found.
 */
function resolveKey(ctx: TemplateContext, key: string): string | undefined {
  const lower = key.toLowerCase();
  // Try flat key first: {{datetime}}
  const flat = ctx[lower];
  if (typeof flat === 'string') return flat;

  // Try dotted path: {{agent.name}}
  const dot = lower.indexOf('.');
  if (dot > 0) {
    const ns = lower.slice(0, dot);
    const prop = lower.slice(dot + 1);
    const group = ctx[ns];
    if (group && typeof group === 'object') {
      return group[prop];
    }
  }
  return undefined;
}

/**
 * Check if a context key is truthy.
 * - Namespace key (e.g. "parent"): true if the namespace exists and has properties
 * - Dotted key (e.g. "parent.name"): true if it resolves to a non-empty string
 * - Flat key (e.g. "datetime"): true if it resolves to a non-empty string
 */
function isTruthy(ctx: TemplateContext, key: string): boolean {
  const lower = key.toLowerCase();
  const val = ctx[lower];
  if (val !== undefined) {
    if (typeof val === 'string') return val.length > 0;
    if (typeof val === 'object') return Object.keys(val).length > 0;
  }
  // Dotted path
  const resolved = resolveKey(ctx, key);
  return resolved !== undefined && resolved.length > 0;
}

/**
 * Process {% if key %}...{% else %}...{% endif %} conditionals.
 * No nesting — inner blocks are processed on the next pass if needed.
 */
function resolveConditionals(prompt: string, ctx: TemplateContext): string {
  // Match {% if %}...{% endif %} blocks, consuming the newline after each tag line
  // so that tag-only lines don't leave blank lines in the output.
  return prompt.replace(
    /\{%\s*if\s+([\w.]+)\s*%\}\n?([\s\S]*?)\{%\s*endif\s*%\}\n?/gi,
    (_match, key, body) => {
      const elseParts = body.split(/\{%\s*else\s*%\}\n?/i);
      const trueBranch = elseParts[0];
      const falseBranch = elseParts[1] ?? '';
      const result = isTruthy(ctx, key) ? trueBranch : falseBranch;
      // Strip one trailing newline from the chosen branch to avoid double-spacing
      return result.replace(/\n$/, '');
    },
  );
}

/**
 * Resolve {{include:name}} directives from resources/prompts/.
 * Recursive up to `maxDepth` levels. Path-traversal is blocked.
 */
function resolveIncludes(prompt: string, maxDepth = 5): string {
  const promptsDir = fs.realpathSync(path.resolve('resources', 'prompts'));

  const resolveOne = (name: string): string => {
    const clean = name.trim()
      .replace(/\0/g, '')           // strip null bytes
      .replace(/[^\w/.\-]/g, '');   // allow only alphanumeric, /, ., - (no .., unicode, %xx)
    if (!clean || clean.includes('..')) return '[include denied]';
    const resolved = fs.realpathSync(path.join(promptsDir, clean));
    if (!resolved.startsWith(promptsDir + path.sep)) return '[include denied]';
    return fs.readFileSync(resolved, 'utf-8');
  };

  for (let depth = 0; depth < maxDepth && /\{\{include:[^}]+\}\}/i.test(prompt); depth++) {
    prompt = prompt.replace(/\{\{include:([^}]+)\}\}/gi, (_match, name) => {
      try { return resolveOne(name); } catch { return '[include failed: not found]'; }
    });
  }
  return prompt;
}

/**
 * Expand a system prompt template.
 *
 * 1. Resolve {{include:...}} directives (recursive)
 * 2. Replace {{key}} and {{ns.key}} variables from context
 *
 * Unmatched placeholders are left as-is.
 */
export function expandSystemPrompt(prompt: string, context?: TemplateContext, asOf?: Date): string {
  const ctx = buildContext(context, asOf);

  // Pass 1: includes
  prompt = resolveIncludes(prompt);

  // Pass 2: conditionals ({% if key %}...{% endif %})
  prompt = resolveConditionals(prompt, ctx);

  // Pass 3: variable replacement (supports dotted keys like {{agent.name}})
  return prompt.replace(/\{\{([\w.]+)\}\}/gi, (match, key) => {
    return resolveKey(ctx, key) ?? match;
  });
}
