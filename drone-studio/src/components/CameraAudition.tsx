import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Camera, Pause, Play, RotateCcw, X } from 'lucide-react';
import type { ViewerBookmark } from '../core/viewer-bookmarks';
import './CameraAudition.css';

type AuditionInput = {
  fromId: string;
  toId: string;
  duration: number;
  easing: 'linear' | 'smooth';
};
type AuditionStatus = {
  playing: boolean;
  elapsed: number;
  duration: number;
  fromName: string;
  toName: string;
};
type Props = {
  bookmarks: ViewerBookmark[];
  status: AuditionStatus | null;
  error: string;
  onPrepare: (input: AuditionInput) => boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (seconds: number) => void;
  onClear: () => void;
  onClose: () => void;
  onInspect?: () => void;
};

/** Form drafts never alter a prepared move; transport is exclusively the private camera clock. */
export function CameraAudition({
  bookmarks,
  status,
  error,
  onPrepare,
  onPlay,
  onPause,
  onSeek,
  onClear,
  onClose,
  onInspect,
}: Props) {
  const headingId = useId();
  const formHelpId = useId();
  const errorId = useId();
  const [fromId, setFromId] = useState('current');
  const [toId, setToId] = useState(() => bookmarks[0]?.id ?? '');
  const [duration, setDuration] = useState('6');
  const [easing, setEasing] = useState<'linear' | 'smooth'>('smooth');
  const [inputError, setInputError] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const [revealRequest, setRevealRequest] = useState(0);
  const revealedRequest = useRef(0);
  const hasPlan = Boolean(status);
  useLayoutEffect(() => {
    if (!hasPlan || revealRequest === revealedRequest.current) return;
    revealedRequest.current = revealRequest;
    if (body.current) body.current.scrollTop = 0;
    playButton.current?.focus({ preventScroll: true });
  }, [hasPlan, revealRequest]);
  // Bookmarks may finish loading after the panel opens; only an untouched empty choice defaults.
  const destination = toId || bookmarks[0]?.id || '';
  const missingFrom = fromId !== 'current' && !bookmarks.some((view) => view.id === fromId);
  const missingTo = Boolean(destination) && !bookmarks.some((view) => view.id === destination);
  const shownError = inputError || error;
  const elapsed = status ? Math.max(0, Math.min(status.duration, status.elapsed)) : 0;
  const complete = Boolean(status && elapsed >= status.duration);
  const stateLabel = status?.playing
    ? 'Playing'
    : complete
      ? 'Complete'
      : elapsed > 0
        ? 'Paused'
        : 'Ready';

  return (
    <section
      className="camera-audition"
      role="region"
      aria-labelledby={headingId}
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // Keep native field keys here, while the enclosing modal retains Tab focus trapping.
        if (event.key === 'Tab') return;
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="camera-audition-heading">
        <Camera size={14} />
        <strong id={headingId}>Camera audition</strong>
        <button type="button" aria-label="Close camera audition" onClick={onClose}>
          <X size={13} />
        </button>
      </header>
      <div className="camera-audition-body" ref={body}>
        {status && (
          <div className="camera-audition-transport" aria-label="Prepared camera move">
            <div className="camera-audition-committed-heading">
              <span>Prepared move</span>
              <span className={status.playing ? 'is-playing' : ''}>{stateLabel}</span>
            </div>
            <div className="camera-audition-endpoints">
              <strong title={status.fromName}>{status.fromName}</strong>
              <ArrowRight size={12} />
              <strong title={status.toName}>{status.toName}</strong>
            </div>
            <div className="camera-audition-scrub-heading">
              <span aria-label="Camera audition elapsed time">{elapsed.toFixed(2)}s</span>
              <span>
                {status.duration.toLocaleString(undefined, { maximumFractionDigits: 3 })}s move
              </span>
            </div>
            <input
              type="range"
              aria-label="Camera audition playhead"
              aria-valuetext={`${elapsed.toFixed(2)} of ${status.duration} seconds`}
              min={0}
              max={status.duration}
              step={0.01}
              value={elapsed}
              onPointerDown={onPause}
              onChange={(event) => onSeek(Number(event.currentTarget.value))}
            />
            <div className="camera-audition-transport-actions">
              <button
                ref={playButton}
                type="button"
                className="camera-audition-play"
                onClick={status.playing ? onPause : onPlay}
              >
                {status.playing ? (
                  <Pause size={12} />
                ) : complete ? (
                  <RotateCcw size={12} />
                ) : (
                  <Play size={12} />
                )}
                {status.playing ? 'Pause' : complete ? 'Replay' : 'Play'}
              </button>
              <button
                type="button"
                aria-label="Return camera move to start"
                title="Return to start and pause"
                onClick={() => onSeek(0)}
              >
                <RotateCcw size={12} /> Start
              </button>
              <button type="button" className="camera-audition-clear" onClick={onClear}>
                Clear move
              </button>
            </div>
            {onInspect && (
              <div className="camera-audition-transport-actions" style={{ marginTop: 6 }}>
                <button type="button" onClick={onInspect}>
                  Analyze move
                </button>
              </div>
            )}
          </div>
        )}
        <p className="camera-audition-intro">
          Private camera rehearsal · show timing stays independent
        </p>
        <form
          className="camera-audition-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const seconds = duration.trim() ? Number(duration) : NaN;
            if (missingFrom || missingTo || !destination) {
              setInputError('Choose available saved views for the camera move.');
              return;
            }
            if (!Number.isFinite(seconds) || seconds < 1 || seconds > 30) {
              setInputError(
                'Enter a duration from 1 to 30 seconds. The prepared move is unchanged.'
              );
              return;
            }
            setInputError('');
            if (onPrepare({ fromId, toId: destination, duration: seconds, easing }))
              setRevealRequest((request) => request + 1);
          }}
        >
          {status && <div className="camera-audition-form-heading">Prepare another move</div>}
          <label>
            From
            <select
              aria-label="Camera move from"
              value={fromId}
              onChange={(event) => {
                setFromId(event.currentTarget.value);
                setInputError('');
              }}
            >
              <option value="current">Current view</option>
              {missingFrom && (
                <option value={fromId} disabled>
                  Saved view unavailable
                </option>
              )}
              {bookmarks.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            To
            <select
              aria-label="Camera move to"
              value={destination}
              disabled={!bookmarks.length}
              onChange={(event) => {
                setToId(event.currentTarget.value);
                setInputError('');
              }}
            >
              {!destination && <option value="">Choose a saved view</option>}
              {missingTo && (
                <option value={destination} disabled>
                  Saved view unavailable
                </option>
              )}
              {bookmarks.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
          </label>
          <div className="camera-audition-form-pair">
            <label>
              Duration · seconds
              <input
                type="number"
                aria-label="Camera move duration in seconds"
                min={1}
                max={30}
                step="any"
                value={duration}
                aria-describedby={shownError ? errorId : formHelpId}
                onChange={(event) => {
                  setDuration(event.currentTarget.value);
                  setInputError('');
                }}
              />
            </label>
            <label>
              Easing
              <select
                aria-label="Camera move easing"
                value={easing}
                onChange={(event) => {
                  setEasing(event.currentTarget.value as 'linear' | 'smooth');
                  setInputError('');
                }}
              >
                <option value="smooth">Smooth</option>
                <option value="linear">Linear</option>
              </select>
            </label>
          </div>
          {!bookmarks.length && (
            <p className="camera-audition-empty">
              Save a destination in Venue & viewpoint → Saved views, then prepare a camera move
              here.
            </p>
          )}
          <button type="submit" className="camera-audition-prepare" disabled={!bookmarks.length}>
            Prepare camera move
          </button>
          <p className="camera-audition-form-help" id={formHelpId}>
            Prepare snapshots these endpoints. Form changes take effect only when you prepare again.
          </p>
        </form>
        {shownError && (
          <p className="camera-audition-error" id={errorId} role="alert">
            {shownError}
          </p>
        )}
        <p className="camera-audition-takeover">Looking around takes over the camera</p>
      </div>
    </section>
  );
}
