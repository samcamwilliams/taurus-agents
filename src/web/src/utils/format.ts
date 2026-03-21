/** Format a USD cost with appropriate precision. */
export function fmtCost(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

/** Format token count with K/M suffix. */
export function fmtTokens(n: number): string {
  if (n < 0) n = 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Format a timestamp: time-only for today, date+time for older. */
export function fmtSmartTime(date: Date): string {
  const now = new Date();
  const isToday = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (isToday) return date.toLocaleTimeString();
  const sameYear = date.getFullYear() === now.getFullYear();
  const datePart = sameYear
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${datePart}, ${date.toLocaleTimeString()}`;
}

const INJECTED_MESSAGE_PREFIX_RE = /^\[(?:Message from [^\]]+ at [^\]]+|You were spawned by [^\]]+ at [^\]]+ with message:)\]\s*\n?/;

export function stripInjectedMessageEnvelope(content: unknown): unknown {
  if (typeof content === 'string') {
    return content.replace(INJECTED_MESSAGE_PREFIX_RE, '');
  }
  if (!Array.isArray(content) || content.length === 0) return content;

  let changed = false;
  const next = [...content];
  const first = next[0] as any;
  if (first?.type === 'text' && typeof first.text === 'string') {
    const stripped = first.text.replace(INJECTED_MESSAGE_PREFIX_RE, '');
    if (stripped !== first.text) {
      changed = true;
      if (stripped) {
        next[0] = { ...first, text: stripped };
      } else {
        next.shift();
      }
    }
  }
  return changed ? next : content;
}

/** Extract plain text from message content for clipboard. */
export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return JSON.stringify(content, null, 2);
  return content
    .map((block: any) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'thinking') return ''; // skip thinking blocks in copy
      if (block.type === 'tool_use') return `**${block.name}**\n\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\``;
      if (block.type === 'tool_result') {
        const text = typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
            : JSON.stringify(block.content);
        return `Result:\n${text}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}
