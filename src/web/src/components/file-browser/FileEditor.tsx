import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { fileApi } from './api';
import { DataTable, isTabularJson } from '../DataTable';
import { Markdown } from '../Markdown';

interface Props {
  agentId: string;
  filePath: string;
  onDirtyChange?: (path: string, dirty: boolean) => void;
}

type ViewMode = 'raw' | 'table' | 'rendered';

// Map file extensions to Monaco language IDs
const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  yml: 'yaml', yaml: 'yaml',
  xml: 'xml', svg: 'xml',
  sql: 'sql',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  toml: 'ini',
  ini: 'ini',
  env: 'ini',
};

function detectLanguage(filePath: string): string {
  const name = filePath.split('/').pop()?.toLowerCase() || '';

  // Special filenames
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile';
  if (name === 'makefile' || name === 'gnumakefile') return 'makefile';
  if (name === '.env' || name.startsWith('.env.')) return 'ini';

  const ext = name.split('.').pop() || '';
  return EXT_TO_LANG[ext] || 'plaintext';
}

export function FileEditor({ agentId, filePath, onDirtyChange }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [savedContent, setSavedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('raw');
  const editorRef = useRef<any>(null);

  // Parse JSON for table view (memoized, based on saved content to avoid flicker)
  const tableData = useMemo(() => {
    if (!content) return null;
    try {
      const parsed = JSON.parse(content);
      if (isTabularJson(parsed)) return parsed;
    } catch { /* not valid JSON */ }
    return null;
  }, [content]);

  const hasTableView = tableData !== null;
  const isMarkdown = /\.md$/i.test(filePath);

  // Load file content + auto-switch view mode on load
  useEffect(() => {
    setViewMode('raw');
    setContent(null);
    setSavedContent(null);
    setLoading(true);
    setError(null);
    const isMd = /\.md$/i.test(filePath);
    fileApi.readFile(agentId, filePath).then(data => {
      setContent(data.content);
      setSavedContent(data.content);
      setLoading(false);
      // Auto-switch to rich view
      try {
        const parsed = JSON.parse(data.content);
        if (isTabularJson(parsed)) { setViewMode('table'); return; }
      } catch { /* not JSON */ }
      if (isMd) setViewMode('rendered');
    }).catch(err => {
      setError(err.message);
      setLoading(false);
    });
  }, [agentId, filePath]);

  const handleSave = useCallback(async () => {
    if (content === null || saving) return;
    setSaving(true);
    try {
      await fileApi.writeFile(agentId, filePath, content);
      setSavedContent(content);
    } catch (err: any) {
      setError(err.message);
    }
    setSaving(false);
  }, [agentId, filePath, content, saving]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    // Cmd/Ctrl+S to save
    editor.addCommand(
      // Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyS
      2048 | 49, // CtrlCmd=2048, KeyS=49
      () => handleSave(),
    );
  };

  const isDirty = content !== savedContent;

  useEffect(() => {
    onDirtyChange?.(filePath, isDirty);
  }, [filePath, isDirty, onDirtyChange]);

  if (loading) {
    return <div className="fb-editor__status">Loading...</div>;
  }

  if (error) {
    return <div className="fb-editor__status fb-editor__status--error">{error}</div>;
  }

  return (
    <div className="fb-editor">
      <div className="fb-editor__toolbar">
        <span className="fb-editor__path">{filePath}</span>
        {isDirty && <span className="fb-editor__dirty">modified</span>}
        {hasTableView && (
          <div className="fb-editor__view-toggle">
            <button
              className={`fb-editor__view-opt ${viewMode === 'table' ? 'fb-editor__view-opt--active' : ''}`}
              onClick={() => setViewMode('table')}
            >
              Table
            </button>
            <button
              className={`fb-editor__view-opt ${viewMode === 'raw' ? 'fb-editor__view-opt--active' : ''}`}
              onClick={() => setViewMode('raw')}
            >
              Raw
            </button>
          </div>
        )}
        {isMarkdown && !hasTableView && (
          <div className="fb-editor__view-toggle">
            <button
              className={`fb-editor__view-opt ${viewMode === 'rendered' ? 'fb-editor__view-opt--active' : ''}`}
              onClick={() => setViewMode('rendered')}
            >
              Rendered
            </button>
            <button
              className={`fb-editor__view-opt ${viewMode === 'raw' ? 'fb-editor__view-opt--active' : ''}`}
              onClick={() => setViewMode('raw')}
            >
              Raw
            </button>
          </div>
        )}
        <button
          className="btn btn--sm"
          onClick={handleSave}
          disabled={!isDirty || saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {viewMode === 'table' && tableData ? (
        <DataTable data={tableData} />
      ) : viewMode === 'rendered' && isMarkdown ? (
        <div className="fb-editor__rendered">
          <Markdown>{content ?? ''}</Markdown>
        </div>
      ) : (
        <div className="fb-editor__monaco">
          <Editor
            value={content ?? ''}
            language={detectLanguage(filePath)}
            theme="vs-dark"
            onChange={(val) => setContent(val ?? '')}
            onMount={handleMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'SF Mono', 'Fira Code', Consolas, 'Liberation Mono', Menlo, monospace",
              scrollBeyondLastLine: false,
              renderLineHighlight: 'line',
              lineNumbers: 'on',
              tabSize: 2,
              wordWrap: 'on',
              automaticLayout: true,
              quickSuggestions: false,
              suggestOnTriggerCharacters: false,
              parameterHints: { enabled: false },
              hover: { enabled: false },
            }}
          />
        </div>
      )}
    </div>
  );
}
