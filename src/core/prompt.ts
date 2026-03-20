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

// ── Template tag parser ──
// Tokenizes {% if %}, {% else %}, {% endif %} tags and plain text segments,
// then builds a tree that supports arbitrary nesting.

type Tag =
  | { type: 'text'; value: string }
  | { type: 'if'; key: string }
  | { type: 'else' }
  | { type: 'endif' };

type Node =
  | { type: 'text'; value: string }
  | { type: 'if'; key: string; trueBranch: Node[]; falseBranch: Node[] };

// Eat the trailing newline only when the tag is on its own line (no other content).
const TAG_RE = /^[ \t]*\{%\s*(if\s+[\w.]+|else|endif)\s*%\}[ \t]*\n?|\{%\s*(if\s+[\w.]+|else|endif)\s*%\}/gim;

function tokenize(prompt: string): Tag[] {
  const tags: Tag[] = [];
  let last = 0;
  for (const m of prompt.matchAll(TAG_RE)) {
    if (m.index > last) tags.push({ type: 'text', value: prompt.slice(last, m.index) });
    const directive = (m[1] ?? m[2]).toLowerCase();
    if (directive.startsWith('if ')) {
      tags.push({ type: 'if', key: directive.slice(3).trim() });
    } else if (directive === 'else') {
      tags.push({ type: 'else' });
    } else {
      tags.push({ type: 'endif' });
    }
    last = m.index + m[0].length;
  }
  if (last < prompt.length) tags.push({ type: 'text', value: prompt.slice(last) });
  return tags;
}

function parse(tags: Tag[]): Node[] {
  const nodes: Node[] = [];
  let i = 0;

  function parseBlock(): Node[] {
    const block: Node[] = [];
    while (i < tags.length) {
      const tag = tags[i];
      if (tag.type === 'text') {
        block.push({ type: 'text', value: tag.value });
        i++;
      } else if (tag.type === 'if') {
        i++;
        const trueBranch = parseBlock();
        let falseBranch: Node[] = [];
        if (i < tags.length && tags[i].type === 'else') {
          i++;
          falseBranch = parseBlock();
        }
        if (i < tags.length && tags[i].type === 'endif') {
          i++;
        }
        block.push({ type: 'if', key: tag.key, trueBranch, falseBranch });
      } else {
        // else or endif — boundary for the parent parseBlock call
        break;
      }
    }
    return block;
  }

  while (i < tags.length) {
    nodes.push(...parseBlock());
  }
  return nodes;
}

function evaluate(nodes: Node[], ctx: TemplateContext): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') {
      out += node.value;
    } else {
      const branch = isTruthy(ctx, node.key) ? node.trueBranch : node.falseBranch;
      out += evaluate(branch, ctx);
    }
  }
  return out;
}

function resolveConditionals(prompt: string, ctx: TemplateContext): string {
  if (!prompt.includes('{%')) return prompt;
  return evaluate(parse(tokenize(prompt)), ctx);
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
