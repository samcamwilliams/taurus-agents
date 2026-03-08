import { useEffect, useState } from 'react';
import { api } from '../api';

interface ToolDef {
  name: string;
  group: string;
  description: string;
}

interface ToolPickerProps {
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}

export function ToolPicker({ selected, onChange }: ToolPickerProps) {
  const [tools, setTools] = useState<ToolDef[]>([]);

  useEffect(() => {
    api.listTools().then(res => setTools(res.tools)).catch(() => {});
  }, []);

  if (tools.length === 0) return null;

  function toggle(name: string) {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  }

  const groups = [...new Set(tools.map(t => t.group))];

  return (
    <div className="tool-picker">
      {groups.map(group => (
        <div key={group} className="tool-picker__group">
          <span className="tool-picker__group-label">{group}</span>
          <div className="tool-picker__pills">
            {tools.filter(t => t.group === group).map(tool => (
              <button
                key={tool.name}
                type="button"
                className={`tool-picker__pill ${selected.has(tool.name) ? 'active' : ''}`}
                onClick={() => toggle(tool.name)}
                title={tool.description}
              >
                {tool.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
