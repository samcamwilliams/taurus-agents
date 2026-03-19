import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { SendHorizonal, Plus, Image } from 'lucide-react';
import { Lightbox } from './Lightbox';

const MAX_IMAGE_DIM = 1568; // Anthropic recommended max — keeps tokens reasonable

function resizeImage(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const { width, height } = img;
      if (width <= MAX_IMAGE_DIM && height <= MAX_IMAGE_DIM) {
        // Already small enough — use original bytes
        const reader = new FileReader();
        reader.onload = () => {
          resolve({ base64: (reader.result as string).split(',')[1], mediaType: file.type });
        };
        reader.readAsDataURL(file);
        URL.revokeObjectURL(img.src);
        return;
      }
      const scale = MAX_IMAGE_DIM / Math.max(width, height);
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/webp', 0.85);
      resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/webp' });
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  });
}

export type ImageAttachment = {
  base64: string;
  mediaType: string;
  name: string;
};

export interface InputBarHandle {
  /** Focus the textarea and select all text if present. */
  focusAndSelect(): void;
}

interface InputBarProps {
  placeholder?: string;
  /** Current run ID — used to persist draft text per-run in memory. */
  runId?: string;
  /** If set, pre-fill with this text (selected) when runId has no draft. */
  defaultValue?: string;
  onSend: (message: string, images?: ImageAttachment[]) => void;
}

/** In-memory draft storage keyed by runId (empty string = no run selected). */
const drafts = new Map<string, string>();

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar({ placeholder, runId, defaultValue, onSend }, ref) {
  const draftKey = runId ?? '';
  const [value, setValue] = useState(() => drafts.get(draftKey) ?? defaultValue ?? '');
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const prevKeyRef = useRef(draftKey);

  // Save draft when switching runs, restore draft for new run
  useEffect(() => {
    if (prevKeyRef.current !== draftKey) {
      // Save outgoing draft (but don't persist defaultValue-only drafts)
      const outgoing = prevKeyRef.current;
      const el = textareaRef.current;
      const currentText = el ? el.value : value;
      if (currentText) {
        drafts.set(outgoing, currentText);
      } else {
        drafts.delete(outgoing);
      }
      // Restore incoming draft (fall back to defaultValue for this key)
      const restored = drafts.get(draftKey) ?? defaultValue ?? '';
      setValue(restored);
      prevKeyRef.current = draftKey;
      // If this key has a defaultValue, focus + select all
      if (defaultValue && el) {
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(0, restored.length);
        });
      }
    }
  }, [draftKey, defaultValue]);

  // Keep draft map in sync as user types (skip defaultValue — it's not a real draft)
  useEffect(() => {
    if (value && value !== defaultValue) {
      drafts.set(draftKey, value);
    } else {
      drafts.delete(draftKey);
    }
  }, [value, draftKey, defaultValue]);

  // Expose focusAndSelect() to parent
  useImperativeHandle(ref, () => ({
    focusAndSelect() {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      if (el.value.length > 0) {
        el.setSelectionRange(0, el.value.length);
      }
    },
  }), []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const minHeight = window.matchMedia('(max-width: 900px)').matches ? 44 : 32;
    el.style.height = Math.max(minHeight, Math.min(el.scrollHeight, 200)) + 'px';
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
      resizeImage(file).then(({ base64, mediaType }) => {
        setImages(prev => [...prev, { base64, mediaType, name: file.name }]);
      });
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
    drafts.delete(draftKey);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFocus() {
    if (!window.matchMedia('(max-width: 900px)').matches) return;

    const scrollIntoView = () => {
      textareaRef.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
    };

    requestAnimationFrame(scrollIntoView);
    window.setTimeout(scrollIntoView, 180);
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
          onFocus={handleFocus}
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
});
