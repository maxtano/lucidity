import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Clock3,
  FolderOpen,
  Layers3,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '../design-system';
import './StudioHome.css';
import { WorkspaceArt } from '../platform/Visuals';

export interface StoryboardSummary {
  id: string;
  name: string;
  droneCount: number;
  sceneCount: number;
  duration: number;
  updatedAt: number;
  bench?: boolean;
  flightStudy?: boolean;
  flightCandidate?: boolean;
}

export interface StudioHomeProps {
  embedded?: boolean;
  storyboards: StoryboardSummary[];
  deletedStoryboards?: StoryboardSummary[];
  activeId: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => boolean;
  onRestore?: (id: string) => boolean;
  onCreate: () => void;
  onOpenStarter: () => void;
  onImport: () => void;
}

function durationLabel(duration: number) {
  const seconds = Number.isFinite(duration) ? Math.max(0, Math.ceil(duration)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function savedDate(timestamp: number) {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
        date
      )
    : null;
}

export function StudioHome({
  embedded = false,
  storyboards,
  deletedStoryboards = [],
  activeId,
  onOpen,
  onDelete,
  onRestore,
  onCreate,
  onOpenStarter,
  onImport,
}: StudioHomeProps) {
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [focusSavedHeading, setFocusSavedHeading] = useState(false);
  const savedHeading = useRef<HTMLHeadingElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (deleteId && !storyboards.some((storyboard) => storyboard.id === deleteId))
      setDeleteId(null);
  }, [deleteId, storyboards]);
  useEffect(() => {
    if (focusSavedHeading) {
      savedHeading.current?.focus();
      setFocusSavedHeading(false);
    }
  }, [focusSavedHeading]);
  const cancelDelete = () => {
    setDeleteId(null);
    deleteTrigger.current?.focus();
  };

  return (
    <div className="studio-home">
      {!embedded && (
        <header className="studio-home-header">
          <div className="studio-home-header-inner">
            <div className="studio-home-brand" aria-label="Drone Show library">
              <Layers3 size={20} aria-hidden="true" />
              <span>Drone Show</span>
              <small>STORYBOARD LIBRARY</small>
            </div>
          </div>
        </header>
      )}

      <section className="studio-home-main" aria-label="Drone Show library">
        <div className="studio-home-title-row">
          <h1 id="studio-home-title">Your storyboards</h1>
          <div className="studio-home-header-actions">
            <button className="studio-home-import" type="button" onClick={onImport}>
              <Upload size={15} />
              Import storyboard
            </button>
            <Button variant="primary" className="studio-home-primary" onClick={onCreate}>
              <Plus size={16} />
              New storyboard
            </Button>
          </div>
        </div>

        <section className="studio-home-starter" aria-labelledby="studio-home-starter-title">
          <div>
            <h2 id="studio-home-starter-title">First drone test</h2>
            <p>One drone. Props off. Preview, assign, run.</p>
          </div>
          <Button variant="feature" onClick={onOpenStarter}>
            Open storyboard
            <ArrowRight size={15} />
          </Button>
        </section>

        <section className="studio-home-library" aria-labelledby="studio-home-library-title">
          <div className="studio-home-library-heading">
            <div>
              <h2 id="studio-home-library-title" ref={savedHeading} tabIndex={-1}>
                Saved<span>{storyboards.length}</span>
              </h2>
            </div>
            <span className="studio-home-local-note">
              <span />
              Saved on this device
            </span>
          </div>
          {storyboards.length ? (
            <div className="studio-home-storyboard-grid">
              {storyboards.map((storyboard, index) => {
                const updated = savedDate(storyboard.updatedAt);
                const confirmingDelete = deleteId === storyboard.id;
                return (
                  <article
                    className="studio-home-storyboard"
                    key={storyboard.id}
                    onKeyDown={(event) => {
                      if (confirmingDelete && event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelDelete();
                      }
                    }}
                  >
                    <button
                      className="studio-home-storyboard-open"
                      type="button"
                      aria-label={`Open ${storyboard.name}`}
                      disabled={confirmingDelete}
                      onClick={() => onOpen(storyboard.id)}
                    />
                    <Button
                      className="studio-home-storyboard-delete"
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${storyboard.name}`}
                      aria-expanded={confirmingDelete}
                      title={`Delete ${storyboard.name}`}
                      onClick={(event) => {
                        deleteTrigger.current = event.currentTarget;
                        setDeleteId(storyboard.id);
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                    <div className="studio-home-storyboard-top">
                      <span>
                        <Layers3 size={14} />
                        STORYBOARD {String(index + 1).padStart(2, '0')}
                      </span>
                      {storyboard.id === activeId && <small>Last opened</small>}
                    </div>
                    {confirmingDelete && (
                      <div
                        className="studio-home-delete-confirmation"
                        role="group"
                        aria-label={`Move ${storyboard.name} to Recently deleted?`}
                      >
                        <p>Move “{storyboard.name}” to Recently deleted?</p>
                        <div>
                          <Button size="sm" autoFocus onClick={cancelDelete}>
                            Cancel
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              if (onDelete(storyboard.id)) {
                                setDeleteId(null);
                                setFocusSavedHeading(true);
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="studio-home-storyboard-art">
                      {!storyboard.bench && !storyboard.flightStudy && !storyboard.flightCandidate && <WorkspaceArt kind="show" />}
                      <span>{storyboard.flightCandidate ? 'Flight candidate · field checks required' : storyboard.flightStudy ? 'Flight study · simulation' : storyboard.bench ? 'Props-off sequence' : 'Formation study'}</span>
                    </div>
                    <div className="studio-home-storyboard-title">
                      <h3>{storyboard.name}</h3>
                      <ArrowUpRight size={17} />
                    </div>
                    <dl>
                      <div>
                        <dt>Drones</dt>
                        <dd>{storyboard.droneCount.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Scenes</dt>
                        <dd>{storyboard.sceneCount.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Duration</dt>
                        <dd>{durationLabel(storyboard.duration)}</dd>
                      </div>
                    </dl>
                    <div className="studio-home-storyboard-footer">
                      <Clock3 size={11} />
                      <span>{updated ? `Updated ${updated}` : 'Saved locally'}</span>
                      <span>
                        Open storyboard
                        <ArrowRight size={12} />
                      </span>
                    </div>
                  </article>
                );
              })}
              <button className="studio-home-new-card" type="button" onClick={onCreate}>
                <span>
                  <Plus size={24} strokeWidth={1.3} />
                </span>
                <strong>New storyboard</strong>
                <small>Make room for your next idea.</small>
              </button>
            </div>
          ) : (
            <div className="studio-home-empty">
              <span className="studio-home-empty-icon">
                <FolderOpen size={28} strokeWidth={1.3} />
              </span>
              <h3>Your first storyboard is waiting.</h3>
              <p>Start a new storyboard, then add scenes and preview your show.</p>
              <Button variant="primary" className="studio-home-primary" onClick={onCreate}>
                <Plus size={16} />
                Create your first storyboard
              </Button>
              <button className="studio-home-empty-import" type="button" onClick={onImport}>
                Or import an existing storyboard
                <ArrowRight size={13} />
              </button>
            </div>
          )}
          {deletedStoryboards.length > 0 && (
            <details className="studio-home-deleted">
              <summary>
                Recently deleted <span>({deletedStoryboards.length})</span>
              </summary>
              <p>Restore a storyboard to return it to Saved.</p>
              <ul>
                {deletedStoryboards.map((storyboard) => (
                  <li key={storyboard.id}>
                    <span>{storyboard.name}</span>
                    <Button
                      size="sm"
                      disabled={!onRestore}
                      aria-label={`Restore ${storyboard.name}`}
                      onClick={() => {
                        if (onRestore?.(storyboard.id)) setFocusSavedHeading(true);
                      }}
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </section>
    </div>
  );
}
