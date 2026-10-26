import { useEffect, useRef, useState } from 'react';
import { FileCode2, Play, Plus, Save, Square, Terminal, Download } from 'lucide-react';
import type { Job } from './workbench-service';
import { api, downloadFile, errorText } from './client';
import { WorkspaceNavigation, useWorkspaceNavigation } from './WorkspaceNavigation';
export function CodeWorkspace({ active = true }: { active?: boolean }) {
  const navigation = useWorkspaceNavigation();
  const [panel, setPanel] = useState<'editor' | 'terminal'>('editor');
  const openPanel = (next: 'editor' | 'terminal') => {
    setPanel(next);
    navigation?.dismiss();
  };
  const [files, setFiles] = useState<string[]>([]),
    [name, setName] = useState('hello.mjs'),
    [content, setContent] = useState(
      "// Your Lucidity workspace\nconsole.log('Ready to build.');\n"
    ),
    [command, setCommand] = useState('node hello.mjs'),
    [jobs, setJobs] = useState<Job[]>([]),
    [allowed, setAllowed] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(true),
    [root, setRoot] = useState('');
  const edited = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current && edited.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  const refreshFiles = async () => {
    try {
      setFiles((await api<{ files: string[] }>('workbench/files')).files);
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void refreshFiles();
    void api<{ root: string }>('workbench/status')
      .then((s) => setRoot(s.root))
      .catch(() => {});
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await api<{ jobs: Job[] }>('workbench/jobs', undefined, controller.signal);
        if (!controller.signal.aborted) setJobs(data.jobs);
      } catch (e) {
        if (!controller.signal.aborted) setError(errorText(e));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api('workbench/file', { name, content });
      setStatus(`Saved ${name}`);
      setDirty(false);
      await refreshFiles();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    if (!allowed) return;
    setBusy(true);
    setError('');
    try {
      const job = await api<Job>('workbench/run', { command, confirmed: true });
      setJobs((old) => [job, ...old]);
      setAllowed(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const running = jobs.find((j) => j.state === 'running');
  return (
    <section className="platform-stack">
      <div className="platform-page-heading">
        <h1>Code</h1>
      </div>
      <WorkspaceNavigation active={active}>
        <nav className="app-local-navigation code-files" aria-label="Code navigation">
          <button
            className={panel === 'editor' ? 'selected' : ''}
            aria-current={panel === 'editor' ? 'page' : undefined}
            onClick={() => openPanel('editor')}
          >
            <FileCode2 size={15} />
            Editor
          </button>
          <button
            className={panel === 'terminal' ? 'selected' : ''}
            aria-current={panel === 'terminal' ? 'page' : undefined}
            onClick={() => openPanel('terminal')}
          >
            <Terminal size={15} />
            Terminal{running && <span className="navigation-count">Running</span>}
          </button>
          <div className="platform-section-heading">
            <h3 className="navigation-section-title">Workspace files</h3>
            <button
              aria-label="New file"
              onClick={() => {
                if (dirty && !window.confirm('Discard the unsaved editor contents?')) return;
                openPanel('editor');
                edited.current = true;
                setName(`script-${Date.now()}.mjs`);
                setContent('');
                setDirty(true);
              }}
            >
              <Plus size={17} />
            </button>
          </div>
          {files.map((file) => (
            <button
              key={file}
              className={file === name ? 'selected' : ''}
              onClick={async () => {
                if (dirty && !window.confirm('Discard the unsaved editor contents?')) return;
                try {
                  const result = await api<{ content: string }>(
                    `workbench/file?name=${encodeURIComponent(file)}`
                  );
                  openPanel('editor');
                  setName(file);
                  setContent(result.content);
                  setDirty(false);
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              <FileCode2 size={14} />
              {file}
            </button>
          ))}
          {!files.length && <p>No saved files</p>}
          <details className="code-location">
            <summary>Workspace folder</summary>
            <code>{root}</code>
          </details>
        </nav>
      </WorkspaceNavigation>
      <div className="code-grid" hidden={panel !== 'editor'}>
        <div className="platform-card code-editor">
          <div className="platform-toolbar">
            <input
              aria-label="File name"
              value={name}
              onChange={(e) => {
                edited.current = true;
                setName(e.target.value);
                setDirty(true);
              }}
            />
            <span>{dirty ? 'Unsaved' : 'Saved'}</span>
            <button
              className="platform-button"
              aria-label="Download code file"
              onClick={() => downloadFile(name, content, 'text/plain')}
            >
              <Download size={14} />
            </button>
            <button className="platform-primary" disabled={busy} onClick={() => void save()}>
              <Save size={14} />
              Save
            </button>
          </div>
          <textarea
            aria-label="Code editor"
            spellCheck={false}
            value={content}
            onChange={(e) => {
              edited.current = true;
              setContent(e.target.value);
              setDirty(true);
            }}
          />
        </div>
      </div>
      <div className="platform-card code-terminal" hidden={panel !== 'terminal'}>
        <div className="platform-section-heading">
          <h2>
            <Terminal size={18} />
            Terminal
          </h2>
          <span className="platform-pill">Local execution</span>
        </div>
        <p>
          Commands run with your computer’s permissions in the workspace folder. Disconnect the
          aircraft link first. Save edited files before running them.
        </p>
        <label className="platform-check">
          <input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} />
          I reviewed this command and want to run it locally.
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
          className="platform-toolbar"
        >
          <span className="terminal-dollar">$</span>
          <input
            aria-label="Terminal command"
            value={command}
            spellCheck={false}
            onChange={(e) => {
              setCommand(e.target.value);
              setAllowed(false);
            }}
          />
          <button
            className="platform-primary"
            disabled={!allowed || !!running || busy || !command.trim()}
          >
            <Play size={14} />
            Run
          </button>
          {running && (
            <button
              type="button"
              className="platform-stop"
              onClick={() =>
                void api('workbench/stop', { id: running.id }).catch((e) => setError(errorText(e)))
              }
            >
              <Square size={14} />
              Stop
            </button>
          )}
        </form>
        {jobs.length ? (
          jobs.slice(0, 5).map((job) => (
            <div className="terminal-job" key={job.id}>
              <div>
                <code>{job.label}</code>
                <span>
                  {job.state}
                  {job.exitCode !== null ? ` · exit ${job.exitCode}` : ''}
                </span>
              </div>
              <pre>{job.output || 'Waiting for output…'}</pre>
            </div>
          ))
        ) : (
          <pre className="terminal-idle">No commands run.</pre>
        )}
      </div>
      {status && (
        <p role="status" className="platform-notice">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="platform-error">
          {error}
        </p>
      )}
    </section>
  );
}
