/**
 * Single-quote a string for shell, escaping any embedded single quotes.
 *
 * Inside single quotes, the shell treats every character literally — no $expansion,
 * no `command substitution`, no !history, no \escapes. The only character that
 * can't appear inside single quotes is a single quote itself.
 *
 * To embed a literal single quote we: close the current single-quoted segment,
 * add an escaped single quote (\') outside any quotes, then re-open a new
 * single-quoted segment:  'it'\''s'  → shell sees:  it's
 *
 * Use this instead of JSON.stringify() for file paths and arguments in shell
 * commands. JSON.stringify produces double-quoted strings where $, `, and !
 * are still interpreted by the shell.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
