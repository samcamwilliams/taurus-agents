import { useEffect, useState } from 'react';
import { api } from '../api';
import { ToolPicker } from './ToolPicker';

interface CreateAgentModalProps {
  onClose: () => void;
  onCreated: (agentId: string) => void;
}

export function CreateAgentModal({ onClose, onCreated }: CreateAgentModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'observer' | 'actor'>('observer');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful agent. Today\'s date is {{date}}.');
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [cwd, setCwd] = useState('');
  const [model, setModel] = useState('');
  const [dockerImage, setDockerImage] = useState('');
  const [defaults, setDefaults] = useState<{ model: string; docker_image: string } | null>(null);

  useEffect(() => {
    api.listTools().then(res => {
      setSelectedTools(new Set(res.defaults.tools));
      setDefaults(res.defaults);
    }).catch(() => {});
  }, []);

  async function handleCreate() {
    if (!name || !systemPrompt) {
      alert('Name and system prompt are required');
      return;
    }

    const result = await api.createAgent({
      name,
      type,
      system_prompt: systemPrompt,
      tools: [...selectedTools],
      cwd: cwd || undefined,
      model: model || undefined,
      docker_image: dockerImage || undefined,
    });

    if (result.error) {
      alert(result.error);
      return;
    }

    onCreated(result.id);
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>Create Agent</h3>

        <label>Name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. code-reviewer" />

        <label>Type</label>
        <select value={type} onChange={e => setType(e.target.value as 'observer' | 'actor')}>
          <option value="observer">Observer (read-only)</option>
          <option value="actor">Actor (can mutate)</option>
        </select>

        <label>System Prompt</label>
        <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} placeholder="You are a..." />

        <label>Tools</label>
        <ToolPicker selected={selectedTools} onChange={setSelectedTools} />

        <label>Working Directory</label>
        <input type="text" value={cwd} onChange={e => setCwd(e.target.value)} placeholder="/path/to/project" />

        <label>Model (optional)</label>
        <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder={defaults?.model ?? ''} />

        <label>Docker Image (optional)</label>
        <input type="text" value={dockerImage} onChange={e => setDockerImage(e.target.value)} placeholder={defaults?.docker_image ?? ''} />

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleCreate}>Create</button>
        </div>
      </div>
    </div>
  );
}
