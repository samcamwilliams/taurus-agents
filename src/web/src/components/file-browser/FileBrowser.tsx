import { useState, useCallback, useEffect, useRef, type KeyboardEvent } from 'react';
import { FileTree } from './FileTree';
import { FileEditor } from './FileEditor';
import { ChevronDown, ChevronLeft, Folder, HardDrive } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import type { Theme } from '../../hooks/useTheme';
import './file-browser.scss';

interface Props {
  agentId: string;
  theme: Theme;
}

const QUICK_PLACES = [
  { path: '/workspace', label: 'Workspace', icon: Folder },
  { path: '/shared', label: 'Shared', icon: HardDrive },
];

export function FileBrowser({ agentId, theme }: Props) {
  const isMobile = useIsMobile();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
  const [rootPath, setRootPath] = useState('/workspace');
  const [pathInput, setPathInput] = useState('/workspace');
  const [placesOpen, setPlacesOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const placesRef = useRef<HTMLDivElement>(null);

  const handleDirtyChange = useCallback((path: string, dirty: boolean) => {
    setDirtyPaths(prev => {
      const next = new Set(prev);
      if (dirty) next.add(path); else next.delete(path);
      return next.size !== prev.size ? next : prev;
    });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!placesOpen) return;
    function handler(e: MouseEvent) {
      if (placesRef.current && !placesRef.current.contains(e.target as Node)) {
        setPlacesOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [placesOpen]);

  useEffect(() => {
    if (!isMobile) {
      setTreeOpen(true);
      return;
    }
    setTreeOpen(selectedFile === null);
  }, [isMobile, selectedFile]);

  useEffect(() => {
    setSelectedFile(null);
    setTreeOpen(!isMobile);
  }, [agentId, isMobile]);

  function handlePathSubmit() {
    const p = pathInput.trim() || '/workspace';
    setRootPath(p);
  }

  function handlePathKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handlePathSubmit();
  }

  function handleQuickPlace(path: string) {
    setPathInput(path);
    setRootPath(path);
    setPlacesOpen(false);
  }

  return (
    <div className={`fb${isMobile ? ' fb--mobile' : ''}${treeOpen ? ' fb--tree-open' : ''}`}>
      {isMobile && (
        <div className="fb__mobile-bar">
          <button className="btn btn--sm" onClick={() => setTreeOpen(true)}>
            <Folder size={13} /> Files
          </button>
          <div className="fb__mobile-path">{selectedFile ?? rootPath}</div>
        </div>
      )}

      {/* Left: file tree */}
      <div className="fb__tree-pane">
        {isMobile && (
          <div className="fb__tree-mobile-head">
            <button
              className="btn btn--sm"
              onClick={() => setTreeOpen(false)}
              disabled={!selectedFile}
            >
              <ChevronLeft size={13} /> Editor
            </button>
            <span className="fb__tree-mobile-title">Files</span>
          </div>
        )}
        <div className="fb__tree-header" ref={placesRef}>
          <input
            className="fb__path-input"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onBlur={handlePathSubmit}
            onKeyDown={handlePathKeyDown}
            spellCheck={false}
          />
          <button
            className="fb__places-btn"
            onClick={() => setPlacesOpen(!placesOpen)}
            title="Quick places"
          >
            <ChevronDown size={14} />
          </button>
          {placesOpen && (
            <div className="fb__places-menu">
              {QUICK_PLACES.map(place => {
                const Icon = place.icon;
                const isActive = rootPath === place.path;
                return (
                  <button
                    key={place.path}
                    className={isActive ? 'active' : ''}
                    onClick={() => handleQuickPlace(place.path)}
                  >
                    <Icon size={14} />
                    <span className="fb__places-label">{place.label}</span>
                    <span className="fb__places-path">{place.path}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <FileTree
          agentId={agentId}
          rootPath={rootPath}
          selectedPath={selectedFile ?? undefined}
          dirtyPaths={dirtyPaths}
          onSelect={(path) => {
            setSelectedFile(path);
            if (isMobile) setTreeOpen(false);
          }}
        />
      </div>

      {/* Right: editor */}
      <div className="fb__right-pane">
        <div className="fb__content">
          {selectedFile ? (
            <FileEditor agentId={agentId} filePath={selectedFile} onDirtyChange={handleDirtyChange} theme={theme} />
          ) : (
            <div className="fb__empty">Select a file to edit</div>
          )}
        </div>
      </div>
    </div>
  );
}
