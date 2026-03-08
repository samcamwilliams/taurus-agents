import { useState } from 'react';
import { api } from '../api';

interface CreateAgentModalProps {
  onClose: () => void;
  onCreated: (agentId: string) => void;
}

export function CreateAgentModal({ onClose, onCreated }: CreateAgentModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'observer' | 'actor'>('observer');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful agent. Today\'s date is {{date}}.');
  const [tools, setTools] = useState('Read, Glob, Grep');
  const [cwd, setCwd] = useState('');
  const [model, setModel] = useState('');
  const [dockerImage, setDockerImage] = useState('');

  async function handleCreate() {
    if (!name || !systemPrompt) {
      alert('Name and system prompt are required');
      return;
    }

    const result = await api.createAgent({
      name,
      type,
      system_prompt: systemPrompt,
      tools: tools.split(',').map(s => s.trim()).filter(Boolean),
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

        <label>Tools (comma-separated)</label>
        <input type="text" value={tools} onChange={e => setTools(e.target.value)} placeholder="Read, Glob, Grep, Bash" />

        <label>Working Directory</label>
        <input type="text" value={cwd} onChange={e => setCwd(e.target.value)} placeholder="/path/to/project" />

        <label>Model (optional)</label>
        <input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder="claude-sonnet-4-20250514" />

        <label>Docker Image (optional, default: ubuntu:22.04)</label>
        <input type="text" value={dockerImage} onChange={e => setDockerImage(e.target.value)} placeholder="ubuntu:22.04" />

        <div className="modal__actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={handleCreate}>Create</button>
        </div>
      </div>
    </div>
  );
}
