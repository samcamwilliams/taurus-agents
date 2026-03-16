import { useState, useEffect } from 'react';
import { api } from '../api';
import { Pencil, X } from 'lucide-react';

interface AccountSettingsModalProps {
  onClose: () => void;
}

export function AccountSettingsModal({ onClose }: AccountSettingsModalProps) {
  const [tab, setTab] = useState<'keys' | 'password'>('keys');
  const [keys, setKeys] = useState<Record<string, string | null>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Password change
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  useEffect(() => {
    api.getApiKeys().then(res => setKeys(res.keys)).catch(() => {});
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function isKeySet(key: string) {
    return keys[key] != null;
  }

  function handleEdit(key: string, value: string) {
    setEdits(prev => ({ ...prev, [key]: value }));
  }

  function handleClear(key: string) {
    setEdits(prev => ({ ...prev, [key]: '' }));
  }

  async function handleSaveKeys() {
    // Only send keys that were edited
    const toSave: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(edits)) {
      toSave[key] = value || null; // empty string → null (delete)
    }
    if (Object.keys(toSave).length === 0) return;

    setSaving(true);
    setMessage(null);
    try {
      await api.updateApiKeys(toSave);
      // Refresh from server
      const res = await api.getApiKeys();
      setKeys(res.keys);
      setEdits({});
      setMessage({ text: 'API keys updated' });
    } catch (err: any) {
      setMessage({ text: err.message || 'Failed to save', error: true });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    if (!currentPw || !newPw) return;
    if (newPw !== confirmPw) {
      setMessage({ text: 'New passwords do not match', error: true });
      return;
    }
    if (newPw.length < 6) {
      setMessage({ text: 'Password must be at least 6 characters', error: true });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api.changePassword(currentPw, newPw);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setMessage({ text: 'Password changed' });
    } catch (err: any) {
      setMessage({ text: err.message || 'Failed to change password', error: true });
    } finally {
      setSaving(false);
    }
  }

  const hasEdits = Object.keys(edits).length > 0;

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 520 }}>
        <div className="modal__header">
          <h3>Account Settings</h3>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--c-border)' }}>
          <button
            className={`account-tab${tab === 'keys' ? ' account-tab--active' : ''}`}
            onClick={() => { setTab('keys'); setMessage(null); }}
          >
            API Keys
          </button>
          <button
            className={`account-tab${tab === 'password' ? ' account-tab--active' : ''}`}
            onClick={() => { setTab('password'); setMessage(null); }}
          >
            Password
          </button>
        </div>
        <div className="modal__body">
          {tab === 'keys' && (
            <>
              <p style={{ fontSize: 12, color: 'var(--c-muted)', margin: '0 0 16px' }}>
                Per-user API keys override the server defaults. Leave blank to use the server key.
              </p>
              {Object.keys(keys).map((key) => {
                const isSet = isKeySet(key);
                const isEditing = key in edits;
                return (
                  <div key={key} style={{ marginBottom: 12 }}>
                    <label style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11 }}>{key}</label>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="password"
                          value={edits[key]}
                          onChange={e => handleEdit(key, e.target.value)}
                          placeholder={`Enter ${key}`}
                          style={{ marginBottom: 0 }}
                          autoFocus={!Object.keys(edits).some(k => k !== key && k in edits)}
                        />
                        <button
                          className="btn btn--sm"
                          onClick={() => {
                            setEdits(prev => {
                              const next = { ...prev };
                              delete next[key];
                              return next;
                            });
                          }}
                          title="Cancel"
                          style={{ flexShrink: 0, marginBottom: 0, height: 32 }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : isSet ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="text"
                          value={keys[key]!}
                          disabled
                          style={{ marginBottom: 0, opacity: 0.6 }}
                        />
                        <button
                          className="btn btn--sm"
                          onClick={() => handleEdit(key, '')}
                          title="Change key"
                          style={{ flexShrink: 0, marginBottom: 0, height: 32 }}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="btn btn--sm danger"
                          onClick={() => handleClear(key)}
                          title="Remove key"
                          style={{ flexShrink: 0, marginBottom: 0, height: 32 }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="text"
                          value=""
                          disabled
                          placeholder="Not set (using server default)"
                          style={{ marginBottom: 0, opacity: 0.4 }}
                        />
                        <button
                          className="btn btn--sm"
                          onClick={() => handleEdit(key, '')}
                          title="Set key"
                          style={{ flexShrink: 0, marginBottom: 0, height: 32 }}
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="modal__actions">
                {message && (
                  <span style={{ fontSize: 12, color: message.error ? 'var(--c-red)' : 'var(--c-green)', marginRight: 'auto', alignSelf: 'center' }}>
                    {message.text}
                  </span>
                )}
                <button className="btn" onClick={onClose}>Cancel</button>
                <button className="btn primary" onClick={handleSaveKeys} disabled={!hasEdits || saving}>
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </>
          )}

          {tab === 'password' && (
            <>
              <label>Current Password</label>
              <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
              <label>New Password</label>
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} />
              <label>Confirm New Password</label>
              <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
              <div className="modal__actions">
                {message && (
                  <span style={{ fontSize: 12, color: message.error ? 'var(--c-red)' : 'var(--c-green)', marginRight: 'auto', alignSelf: 'center' }}>
                    {message.text}
                  </span>
                )}
                <button className="btn" onClick={onClose}>Cancel</button>
                <button className="btn primary" onClick={handleChangePassword} disabled={!currentPw || !newPw || !confirmPw || saving}>
                  {saving ? 'Changing...' : 'Change Password'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
