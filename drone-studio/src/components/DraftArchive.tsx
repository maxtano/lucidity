import { useEffect, useRef, useState } from 'react';
import { Download, FolderOpen, LoaderCircle, Save } from 'lucide-react';
import {
  createProposalCheckpoint,
  parseProposalCheckpoint,
  restoreProposalCheckpoint,
  serializeProposalCheckpoint,
  MAX_CHECKPOINT_BYTES,
  type ProposalCheckpoint,
} from '../agent/checkpoint';
import { readCheckpointText, writeCheckpointText } from '../agent/checkpoint-storage';
import type { AgentProposal, AgentResult } from '../agent/types';
import type { Project } from '../core/model';

type Props = {
  project: Project;
  proposal?: AgentProposal;
  proposalBase: Project | null;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onRestore: (result: AgentResult, base: Project) => void;
};

/** Explicit local/file saves. Opening a checkpoint restores only an unapplied proposal. */
export function DraftArchive({
  project,
  proposal,
  proposalBase,
  disabled,
  onBusy,
  onRestore,
}: Props) {
  const [saved, setSaved] = useState<ProposalCheckpoint | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const latest = useRef({ project, proposal, proposalBase });
  latest.current = { project, proposal, proposalBase };
  useEffect(() => {
    generation.current++;
    setWorking(false);
    onBusy(false);
    setSaved(null);
    setMessage('');
    setError('');
    try {
      const text = readCheckpointText(localStorage, project.id);
      if (text) {
        const checkpoint = parseProposalCheckpoint(text);
        if (checkpoint.base.projectId !== project.id)
          throw new Error(
            'The saved draft belongs to another project. Open its matching show first.'
          );
        setSaved(checkpoint);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The saved draft could not be read.');
    }
    return () => {
      generation.current++;
      onBusy(false);
    };
  }, [project.id, onBusy]);

  const perform = async (action: (current: () => void, snapshot: Project) => Promise<void>) => {
    if (disabled || working) return;
    const id = ++generation.current;
    const snapshot = project;
    const activeProposal = proposal;
    const activeBase = proposalBase;
    setWorking(true);
    onBusy(true);
    setError('');
    setMessage('');
    const current = () => {
      if (generation.current !== id || latest.current.project !== snapshot)
        throw new Error(
          'The show changed while opening or saving this draft. Try again with the current show.'
        );
      if (latest.current.proposal !== activeProposal || latest.current.proposalBase !== activeBase)
        throw new Error('The active draft changed. Try again with the current draft.');
    };
    try {
      await action(current, snapshot);
    } catch (cause) {
      if (generation.current === id)
        setError(
          cause instanceof Error ? cause.message : 'This draft could not be opened or saved.'
        );
    } finally {
      if (generation.current === id) {
        setWorking(false);
        onBusy(false);
      }
    }
  };
  const save = (download: boolean) => {
    const capturedProposal = proposal;
    const capturedBase = proposalBase;
    if (!capturedProposal || !capturedBase) return;
    void perform(async (current) => {
      const checkpoint = await createProposalCheckpoint(capturedBase, capturedProposal);
      current();
      if (
        latest.current.proposal !== capturedProposal ||
        latest.current.proposalBase !== capturedBase
      )
        throw new Error('The active draft changed. Save the current draft instead.');
      const text = serializeProposalCheckpoint(checkpoint);
      if (download) {
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'lucidity-agent-draft.lucid-draft.json';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage('Draft file prepared. Keep the matching show JSON with it.');
      } else {
        writeCheckpointText(localStorage, checkpoint.base.projectId, text);
        setSaved(checkpoint);
        setMessage(`Draft saved locally for revision ${checkpoint.base.revision}.`);
      }
    });
  };
  const restore = (checkpoint: ProposalCheckpoint) => {
    void perform(async (current, snapshot) => {
      const restored = await restoreProposalCheckpoint(snapshot, checkpoint);
      current();
      onRestore(restored, snapshot);
      setMessage('Draft opened and reviewed again. It is ready to preview or refine.');
    });
  };
  const openFile = (file: File) => {
    void perform(async (current, snapshot) => {
      if (file.size > MAX_CHECKPOINT_BYTES)
        throw new Error('Draft files must be no larger than 32 MB.');
      const checkpoint = parseProposalCheckpoint(await file.text());
      current();
      const restored = await restoreProposalCheckpoint(snapshot, checkpoint);
      current();
      onRestore(restored, snapshot);
      setMessage('Draft file opened and reviewed again. Your saved show is unchanged.');
    });
  };
  return (
    <details className="agent-archive">
      <summary>
        <FolderOpen size={13} /> Draft files{' '}
        {working && <LoaderCircle className="spin" size={12} />}
      </summary>
      <p>
        Keep an unapplied draft for later. Reopening checks the matching show and reviews the edit
        again.
      </p>
      <div className="agent-archive-actions">
        <button disabled={disabled || working} onClick={() => input.current?.click()}>
          <FolderOpen size={12} /> Open draft file
        </button>
        <button
          disabled={disabled || working || !proposal || !proposalBase}
          onClick={() => save(true)}
        >
          <Download size={12} /> Download draft
        </button>
        <button
          disabled={disabled || working || !proposal || !proposalBase}
          onClick={() => save(false)}
        >
          <Save size={12} /> Save draft locally
        </button>
      </div>
      <p className="agent-archive-limit">
        One local draft per project, up to 1 MB. Saving replaces its earlier local draft. Larger
        drafts can be downloaded.
      </p>
      {saved && (
        <div className="agent-saved-draft">
          <strong>{saved.proposal.title}</strong>
          <span>
            Saved for revision {saved.base.revision} · {new Date(saved.createdAt).toLocaleString()}
          </span>
          {saved.base.revision !== project.revision && (
            <p>
              The show is now revision {project.revision}. Restore is available only if its content
              still matches the original show exactly.
            </p>
          )}
          <button disabled={disabled || working} onClick={() => restore(saved)}>
            Restore saved draft
          </button>
        </div>
      )}
      {message && (
        <p className="agent-status" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="agent-run-error" role="alert">
          {error}
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept=".json,.lucid-draft.json,application/json"
        hidden
        aria-label="Open an agent draft file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) openFile(file);
        }}
      />
    </details>
  );
}
