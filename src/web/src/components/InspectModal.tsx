import { useRef } from 'react';
import { Copy, X } from 'lucide-react';
import type { MessageRecord } from '../types';

interface InspectModalProps {
  message: MessageRecord;
  onClose: () => void;
}

export function InspectModal({ message, onClose }: InspectModalProps) {
  const preRef = useRef<HTMLPreElement>(null);

  const json = JSON.stringify(message, null, 2);

  function handleCopy() {
    navigator.clipboard.writeText(json);
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inspect-modal">
        <div className="inspect-modal__header">
          <h3>Inspect Message</h3>
          <div className="inspect-modal__actions">
            <button className="inspect-modal__btn" onClick={handleCopy} title="Copy JSON">
              <Copy size={13} />
            </button>
            <button className="inspect-modal__btn" onClick={onClose} title="Close">
              <X size={13} />
            </button>
          </div>
        </div>
        <pre ref={preRef} className="inspect-modal__content">{json}</pre>
      </div>
    </div>
  );
}
