import { useState, useEffect } from 'react';
import { api } from '../api';
import { Pencil, X } from 'lucide-react';

interface AccountSettingsModalProps {
  onClose: () => void;
}

export function AccountSettingsModal({ onClose }: AccountSettingsModalProps) {
  const [tab, setTab] = useState<'usage' | 'keys' | 'password'>('usage');
  const [keys, setKeys] = useState<Record<string, string | null>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  // Password change
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');

  // Usage / budget
  const [usage, setUsage] = useState<{
    monthly_spent_usd: number;
    monthly_limit_usd: number;
    is_exempt: boolean;
    month: string;
    has_own_keys: Record<string, boolean>;
  } | null>(null);

  useEffect(() => {
    api.getApiKeys().then(res => setKeys(res.keys)).catch(() => {});
    api.getUsage().then(setUsage).catch(() => {});
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
            className={`account-tab${tab === 'usage' ? ' account-tab--active' : ''}`}
            onClick={() => { setTab('usage'); setMessage(null); }}
          >
            Usage
          </button>
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
          {tab === 'usage' && (
            <>
              {!usage ? (
                <p style={{ fontSize: 12, color: 'var(--c-muted)' }}>Loading...</p>
              ) : usage.is_exempt ? (
                <p style={{ fontSize: 13, color: 'var(--c-muted)', margin: 0 }}>
                  No spending limit — {usage.monthly_spent_usd > 0 ? `$${usage.monthly_spent_usd.toFixed(2)} used this month` : 'no usage this month'}.
                </p>
              ) : (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                      <span>Monthly usage ({usage.month})</span>
                      <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>
                        ${usage.monthly_spent_usd.toFixed(2)} / ${usage.monthly_limit_usd.toFixed(2)}
                      </span>
                    </div>
                    <div style={{ height: 8, background: 'var(--c-bg-elevated)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, (usage.monthly_spent_usd / usage.monthly_limit_usd) * 100)}%`,
                        background: usage.monthly_spent_usd >= usage.monthly_limit_usd
                          ? 'var(--c-red)'
                          : usage.monthly_spent_usd >= usage.monthly_limit_usd * 0.8
                            ? 'var(--c-yellow, #e5a100)'
                            : 'var(--c-green)',
                        borderRadius: 4,
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>
                  {usage.monthly_spent_usd >= usage.monthly_limit_usd && (
                    <p style={{ fontSize: 12, color: 'var(--c-red)', margin: '0 0 12px' }}>
                      Budget exceeded. Add your own API keys in the <button
                        style={{ background: 'none', border: 'none', color: 'var(--c-accent)', cursor: 'pointer', padding: 0, fontSize: 12, textDecoration: 'underline' }}
                        onClick={() => setTab('keys')}
                      >API Keys</button> tab to continue.
                    </p>
                  )}
                  {usage.monthly_spent_usd >= usage.monthly_limit_usd * 0.8 && usage.monthly_spent_usd < usage.monthly_limit_usd && (
                    <p style={{ fontSize: 12, color: 'var(--c-yellow, #e5a100)', margin: '0 0 12px' }}>
                      Approaching limit. Add your own API keys to avoid interruptions.
                    </p>
                  )}
                </>
              )}
              {usage && Object.values(usage.has_own_keys).some(Boolean) && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 12, color: 'var(--c-muted)', margin: '0 0 8px' }}>Your API keys</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(usage.has_own_keys).filter(([, hasKey]) => hasKey).map(([provider]) => (
                      <span
                        key={provider}
                        style={{
                          fontSize: 11,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: 'var(--c-green-bg, rgba(0,180,0,0.1))',
                          color: 'var(--c-green)',
                          fontFamily: 'var(--font-mono, monospace)',
                        }}
                      >
                        {provider} ✓
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="modal__actions" style={{ marginTop: 16 }}>
                <button className="btn" onClick={onClose}>Close</button>
              </div>
            </>
          )}

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
