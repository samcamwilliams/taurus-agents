import { useState, useRef } from 'react';

interface InputBarProps {
  placeholder?: string;
  onSend: (message: string) => void;
}

export function InputBar({ placeholder, onSend }: InputBarProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSend() {
    const msg = value.trim();
    if (!msg) return;
    onSend(msg);
    setValue('');
    inputRef.current?.focus();
  }

  return (
    <div className="input-bar">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
        placeholder={placeholder ?? 'Send message to running agent...'}
      />
      <button className="btn" onClick={handleSend}>Send</button>
    </div>
  );
}
