/**
 * Renders a JSON array-of-objects as a clean table.
 * Auto-detects columns from keys. Status-like values get colored pills.
 */

interface DataTableProps {
  data: Record<string, unknown>[];
}

const STATUS_COLORS: Record<string, string> = {
  complete: 'var(--c-green)',
  completed: 'var(--c-green)',
  done: 'var(--c-green)',
  success: 'var(--c-green)',
  pending: 'var(--c-yellow)',
  queued: 'var(--c-yellow)',
  waiting: 'var(--c-yellow)',
  'in-progress': 'var(--c-accent)',
  'in_progress': 'var(--c-accent)',
  running: 'var(--c-accent)',
  active: 'var(--c-accent)',
  failed: 'var(--c-red)',
  error: 'var(--c-red)',
  cancelled: 'var(--c-muted)',
  stopped: 'var(--c-muted)',
  idle: 'var(--c-muted)',
};

function getStatusColor(value: string): string | null {
  return STATUS_COLORS[value.toLowerCase()] ?? null;
}

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="dt-null">—</span>;
  }

  if (typeof value === 'boolean') {
    return <span className="dt-bool">{value ? '✓' : '✗'}</span>;
  }

  if (typeof value === 'number') {
    return <span className="dt-num">{value}</span>;
  }

  if (typeof value === 'string') {
    const color = getStatusColor(value);
    if (color) {
      return <span className="dt-pill" style={{ background: color }}>{value}</span>;
    }
    // Truncate long strings
    if (value.length > 100) {
      return <span className="dt-str" title={value}>{value.slice(0, 100)}…</span>;
    }
    return <span className="dt-str">{value}</span>;
  }

  if (typeof value === 'object') {
    // Nested object/array — render as compact JSON or sub-pills
    if (Array.isArray(value)) {
      return <span className="dt-str">{value.join(', ')}</span>;
    }
    // Object with string values → mini key-value table
    const entries = Object.entries(value as Record<string, unknown>);
    const allStrings = entries.every(([, v]) => typeof v === 'string');
    if (allStrings && entries.length <= 6) {
      return (
        <table className="dt-subtable">
          <tbody>
            {entries.map(([k, v]) => {
              const color = getStatusColor(v as string);
              return (
                <tr key={k}>
                  <td className="dt-subtable__key">{k}</td>
                  <td className="dt-subtable__val">
                    {color
                      ? <span className="dt-pill dt-pill--sm" style={{ background: color }}>{v as string}</span>
                      : <span className="dt-str">{v as string}</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }
    return <span className="dt-str">{JSON.stringify(value)}</span>;
  }

  return <span>{String(value)}</span>;
}

export function DataTable({ data }: DataTableProps) {
  if (data.length === 0) {
    return <div className="dt-empty">No data</div>;
  }

  // Collect all unique keys across all rows, preserving first-seen order
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  return (
    <div className="dt-wrapper">
      <table className="dt-table">
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col} className="dt-th">
                {col.replace(/_/g, ' ').replace(/\bid\b/gi, 'ID')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="dt-row">
              {columns.map(col => (
                <td key={col} className="dt-td">
                  <CellValue value={row[col]} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Check if data is suitable for table rendering */
export function isTabularJson(data: unknown): data is Record<string, unknown>[] {
  return Array.isArray(data) && data.length > 0 && data.every(item => typeof item === 'object' && item !== null && !Array.isArray(item));
}
