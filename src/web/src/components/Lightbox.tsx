import { useEffect, useState } from 'react';

/**
 * Clickable thumbnail image that expands into a fullscreen lightbox overlay.
 * Click or press Esc to close.
 */
export function Lightbox({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <>
      <img className={className} src={src} alt={alt} onClick={() => setOpen(true)} />
      {open && (
        <div className="lightbox" onClick={() => setOpen(false)}>
          <img className="lightbox__img" src={src} alt={alt} />
        </div>
      )}
    </>
  );
}
