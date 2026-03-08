import { useState, useRef, useEffect } from 'react';

interface InputBarProps {
  placeholder?: string;
  onSend: (message: string) => void;
}

export function InputBar({ placeholder, onSend }: InputBarProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  function handleSend() {
    const msg = value.trim();
    if (!msg) return;
    onSend(msg);
    setValue('');
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="input-bar">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? 'Message agent... (Shift+Enter for newline)'}
        rows={1}
      />
      <button className="btn" onClick={handleSend}>Send</button>
    </div>
  );
}
