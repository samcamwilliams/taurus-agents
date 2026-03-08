import { useState, useRef, useEffect, useCallback } from 'react';
import { SendHorizonal, Plus, Image } from 'lucide-react';
import { Lightbox } from './Lightbox';

export type ImageAttachment = {
  base64: string;
  mediaType: string;
  name: string;
};

interface InputBarProps {
  placeholder?: string;
  onSend: (message: string, images?: ImageAttachment[]) => void;
}

export function InputBar({ placeholder, onSend }: InputBarProps) {
  const [value, setValue] = useState('');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [value]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  function addFiles(files: FileList | File[]) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1];
        setImages(prev => [...prev, { base64, mediaType: file.type, name: file.name }]);
      };
      reader.readAsDataURL(file);
    }
  }

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addFiles(imageFiles);
    }
  }, []);

  function removeImage(index: number) {
    setImages(prev => prev.filter((_, i) => i !== index));
  }

  function handleSend() {
    const msg = value.trim();
    if (!msg && images.length === 0) return;
    onSend(msg, images.length > 0 ? images : undefined);
    setValue('');
    setImages([]);
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
      {images.length > 0 && (
        <div className="input-bar__attachments">
          {images.map((img, i) => (
            <div key={i} className="input-bar__thumb">
              <Lightbox
                src={`data:${img.mediaType};base64,${img.base64}`}
                alt={img.name}
                className="input-bar__thumb-img"
              />
              <button className="input-bar__thumb-remove" onClick={() => removeImage(i)}>&times;</button>
            </div>
          ))}
        </div>
      )}
      <div className="input-bar__input-wrap">
        <div className="input-bar__plus-wrap" ref={menuRef}>
          <button
            className="input-bar__plus"
            onClick={() => setMenuOpen(!menuOpen)}
            title="Attach"
          ><Plus size={18} /></button>
          {menuOpen && (
            <div className="input-bar__menu">
              <button onClick={() => { fileRef.current?.click(); setMenuOpen(false); }}>
                <Image size={14} /> Image
              </button>
            </div>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder ?? 'Message agent... (Shift+Enter for newline)'}
          rows={1}
        />
        <button
          className="input-bar__send"
          onClick={handleSend}
          disabled={!value.trim() && images.length === 0}
          title="Send (Enter)"
        >
          <SendHorizonal size={16} />
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
