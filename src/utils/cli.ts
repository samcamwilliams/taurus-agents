/**
 * Box table — renders a Unicode box with rows and separators.
 *
 *   box('Title', [
 *     ['URL', 'http://localhost:7777'],
 *     ['Agents', '3'],
 *     null,  // separator
 *     ['User', 'admin'],
 *   ]);
 *
 * Auto-sizes to fit the widest label + value. Labels are right-padded
 * with a colon, values fill the remaining width.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESOURCES_DIR = path.join(__dirname, '..', '..', 'resources');

/** Load the CLI logo from resources/logo-cli/. Falls back to plain text. */
export function loadLogo(variant: 'default' | 'alt' = 'default'): string {
  try {
    const file = path.join(RESOURCES_DIR, 'logo-cli', `${variant}.txt`);
    return fs.readFileSync(file, 'utf-8').trimEnd();
  } catch {
    return 'TAURUS';
  }
}

type BoxRow = [label: string, value: string] | null;

export function box(title: string, rows: BoxRow[]): string {
  // Derive label column width from the longest label (+ ": ")
  const labelW = rows.reduce((m, r) => r ? Math.max(m, r[0].length + 2) : m, 0);

  // Derive total inner width from the widest content row and the title
  const maxContent = rows.reduce((m, r) => r ? Math.max(m, labelW + r[1].length) : m, 0);
  const inner = Math.max(maxContent, title.length + 4); // pad title by 2 each side minimum

  const hr = '─'.repeat(inner + 2);
  const titlePad = Math.floor((inner - title.length) / 2);

  const lines: string[] = [];
  lines.push(`  ┌${hr}┐`);
  lines.push(`  │${' '.repeat(titlePad + 1)}${title}${' '.repeat(inner - titlePad - title.length + 1)}│`);
  lines.push(`  ├${hr}┤`);

  for (const r of rows) {
    if (r === null) {
      lines.push(`  ├${hr}┤`);
    } else {
      const label = `${r[0]}:`.padEnd(labelW);
      lines.push(`  │ ${(label + r[1]).padEnd(inner)} │`);
    }
  }

  lines.push(`  └${hr}┘`);
  return lines.join('\n');
}
