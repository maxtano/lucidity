import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
  Headphones,
  Layers3,
  Magnet,
  Maximize2,
  Minus,
  MousePointer2,
  Music2,
  Pause,
  Play,
  Plus,
  SkipBack,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cueStart, formatTime, paletteColors, totalDuration, type Project } from '../core/model';
import { EDIT_FPS, insertionAt, rulerInterval, timecode, trimDuration } from '../core/timeline';
import { KeyframeLane } from './KeyframeLane';
import { FormationThumb } from './FormationThumb';
import type { TrackInfo } from '../audio/engine';

type Props = {
  project: Project;
  time: number;
  playing: boolean;
  muted: boolean;
  track: TrackInfo | null;
  selected: string;
  onSeek: (t: number) => void;
  onPlay: () => void;
  onMute: () => void;
  onSelect: (id: string) => void;
  onAudio: () => void;
  onAdd: () => void;
  onEditStart: () => void;
  onTrim: (id: string, duration: number) => void;
  onMove: (id: string, index: number) => void;
  droneSelection: number[];
  onKeyMove: (id: number, from: number, to: number) => void;
};

type Gesture = {
  kind: 'move' | 'trim';
  id: string;
  startX: number;
  scroll: number;
  duration: number;
  moved: boolean;
  index: number;
  revision: number;
};

export function Timeline({
  project,
  time,
  playing,
  muted,
  track,
  selected,
  onSeek,
  onPlay,
  onMute,
  onSelect,
  onAudio,
  onAdd,
  onEditStart,
  onTrim,
  onMove,
  droneSelection,
  onKeyMove,
}: Props) {
  const duration = totalDuration(project);
  const selectedCue = project.cues.find((cue) => cue.id === selected)!;
  const showKeys = droneSelection.length > 0;
  const rail = useRef<HTMLDivElement>(null),
    scroll = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null),
    resizeStart = useRef({ y: 0, height: 230 });
  const [zoom, setZoom] = useState(1),
    [viewport, setViewport] = useState(800);
  const [snap, setSnap] = useState(true),
    [height, setHeight] = useState(230);
  const [draft, setDraft] = useState<{ id: string; duration: number } | null>(null);
  const [drop, setDrop] = useState<{ id: string; index: number } | null>(null);
  const [message, setMessage] = useState('');
  const timeRef = useRef(time);
  timeRef.current = time;
  const pixelsPerSecond = (viewport * zoom) / duration;
  const displayDuration =
    duration + (draft ? draft.duration - project.cues.find((c) => c.id === draft.id)!.duration : 0);
  const contentWidth = Math.max(viewport, displayDuration * pixelsPerSecond);
  const interval = rulerInterval(pixelsPerSecond);
  const beatWidth = (60 / project.bpm) * pixelsPerSecond;
  const gridWidth = beatWidth * Math.max(1, Math.ceil(8 / beatWidth));
  const peaks = useMemo(
    () =>
      Array.from({ length: 384 }, (_, i) => {
        if (!track) return 0;
        const t = (i / 384) * displayDuration;
        if (track.kind === 'file' && t >= track.duration) return 0;
        return (
          track.peaks[Math.min(255, Math.floor(((t % track.duration) / track.duration) * 256))] || 0
        );
      }),
    [track, displayDuration]
  );

  useEffect(() => {
    const element = scroll.current!;
    const observer = new ResizeObserver(() => setViewport(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    gesture.current = null;
    setDraft(null);
    setDrop(null);
  }, [project.revision]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gesture.current) {
        gesture.current = null;
        setDraft(null);
        setDrop(null);
        setMessage('Edit cancelled');
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
  useEffect(() => {
    const element = scroll.current!;
    element.scrollLeft = Math.max(0, timeRef.current * pixelsPerSecond - viewport * 0.4);
  }, [zoom, viewport]); // Keep the playhead in view when changing the timeline scale.
  useEffect(() => {
    if (!playing) return;
    const element = scroll.current!,
      x = time * pixelsPerSecond;
    if (x > element.scrollLeft + viewport - 30 || x < element.scrollLeft) {
      element.scrollLeft = Math.max(0, x - viewport * 0.2);
    }
  }, [time, playing, pixelsPerSecond, viewport]);

  const seekAt = (clientX: number) => {
    const bounds = rail.current!.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(duration, (clientX - bounds.left) / pixelsPerSecond)));
  };
  const startGesture = (e: PointerEvent<HTMLElement>, id: string, kind: Gesture['kind']) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onEditStart();
    onSelect(id);
    const cue = project.cues.find((c) => c.id === id)!;
    gesture.current = {
      kind,
      id,
      startX: e.clientX,
      scroll: scroll.current!.scrollLeft,
      duration: cue.duration,
      moved: false,
      index: project.cues.indexOf(cue),
      revision: project.revision,
    };
  };
  const moveGesture = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.revision !== project.revision) return;
    if (Math.abs(e.clientX - g.startX) < 4 && !g.moved) return;
    g.moved = true;
    const bounds = scroll.current!.getBoundingClientRect();
    if (e.clientX < bounds.left + 24) scroll.current!.scrollLeft -= 12;
    if (e.clientX > bounds.right - 24) scroll.current!.scrollLeft += 12;
    if (g.kind === 'trim') {
      const original = project.cues.find((c) => c.id === g.id)!;
      g.duration = trimDuration(
        project,
        g.id,
        original.duration +
          (e.clientX - g.startX + scroll.current!.scrollLeft - g.scroll) / pixelsPerSecond,
        snap && !e.shiftKey
      ).duration;
      setDraft({ id: g.id, duration: g.duration });
    } else {
      const seconds = (e.clientX - rail.current!.getBoundingClientRect().left) / pixelsPerSecond;
      g.index = insertionAt(project, g.id, seconds);
      setDrop({ id: g.id, index: g.index });
    }
  };
  const endGesture = (e: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    gesture.current = null;
    setDraft(null);
    setDrop(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (!g || g.revision !== project.revision) return;
    if (g.moved) {
      if (g.kind === 'trim') {
        onTrim(g.id, g.duration);
        setMessage(`Scene trimmed to ${g.duration.toFixed(2)} seconds`);
      } else {
        onMove(g.id, g.index);
        setMessage(`Scene moved to position ${g.index + 1}`);
      }
    } else if (g.kind === 'move') {
      const cue = project.cues.find((c) => c.id === g.id)!;
      onSeek(cueStart(project, g.id) + Math.min(cue.transition + 0.1, cue.duration - 0.1));
    }
  };
  const cancelGesture = () => {
    gesture.current = null;
    setDraft(null);
    setDrop(null);
  };
  const scrubKeys = (e: React.KeyboardEvent) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Home') onSeek(0);
      else if (e.key === 'End') onSeek(duration);
      else onSeek(time + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / EDIT_FPS));
    }
  };
  const dropBoundary = drop
    ? project.cues.findIndex((c) => c.id === drop.id) < drop.index
      ? drop.index + 1
      : drop.index
    : 0;
  const dropLeft =
    project.cues.slice(0, dropBoundary).reduce((sum, c) => sum + c.duration, 0) * pixelsPerSecond;

  return (
    <section
      className="timeline pro-timeline"
      aria-label="Show timeline"
      style={{ height: height + (showKeys ? 28 : 0) }}
    >
      <div
        className="timeline-resizer"
        role="separator"
        aria-label="Timeline height"
        aria-orientation="horizontal"
        aria-valuemin={190}
        aria-valuemax={Math.max(230, window.innerHeight - 310)}
        aria-valuenow={height}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          resizeStart.current = { y: e.clientY, height };
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId))
            setHeight(
              Math.max(
                190,
                Math.min(
                  window.innerHeight - 310,
                  resizeStart.current.height + resizeStart.current.y - e.clientY
                )
              )
            );
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            setHeight((h) =>
              Math.max(
                190,
                Math.min(window.innerHeight - 310, h + (e.key === 'ArrowUp' ? 20 : -20))
              )
            );
          }
        }}
      >
        <span />
      </div>
      <div className="transport">
        <div className="timeline-title">
          <Layers3 size={14} />
          <strong>Sequence</strong>
          <span>{project.cues.length} scenes</span>
        </div>
        <div className="play-controls">
          <button aria-label="Restart show" title="Go to start" onClick={() => onSeek(0)}>
            <SkipBack size={14} />
          </button>
          <button
            className="play-button"
            onClick={onPlay}
            aria-label={playing ? 'Pause show' : 'Play show'}
          >
            {playing ? (
              <Pause size={14} fill="currentColor" />
            ) : (
              <Play size={14} fill="currentColor" />
            )}
          </button>
          <output className="time-display" aria-label="Current timecode">
            {timecode(time)}
          </output>
        </div>
        <div className="timeline-tools">
          <button
            className={snap ? 'active' : ''}
            aria-label="Snap edits to beats"
            aria-pressed={snap}
            title="Snap edits to beats · Shift bypasses"
            onClick={() => setSnap(!snap)}
          >
            <Magnet size={14} />
          </button>
          <span className="toolbar-divider" />
          <button
            aria-label="Zoom timeline out"
            disabled={zoom <= 1}
            onClick={() => setZoom(Math.max(1, zoom / 1.5))}
          >
            <Minus size={13} />
          </button>
          <input
            aria-label="Timeline zoom"
            type="range"
            min={1}
            max={8}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <button
            aria-label="Zoom timeline in"
            disabled={zoom >= 8}
            onClick={() => setZoom(Math.min(8, zoom * 1.5))}
          >
            <Plus size={13} />
          </button>
          <button
            aria-label="Fit entire timeline"
            title="Fit entire sequence"
            onClick={() => setZoom(1)}
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      <div className="timeline-body">
        <div className="track-labels">
          <div className="ruler-label">
            <MousePointer2 size={11} />
            <span>SELECT</span>
          </div>
          <div className="formation-track-label">
            <span>
              <Layers3 size={14} />
              <span>
                {project.cues.some((cue) => cue.benchCue) ? 'Motor cues' : 'Formations'}<small>{project.droneCount.toLocaleString()} {project.droneCount === 1 ? 'drone' : 'drones'}</small>
              </span>
            </span>
            <button aria-label="Add formation" onClick={onAdd}>
              <Plus size={13} />
            </button>
          </div>
          {showKeys && (
            <div className="key-track-label">
              <span>◇ D{droneSelection[0]} keys</span>
            </div>
          )}
          <div className="soundtrack-label">
            <span>
              <Music2 size={14} />
              Audio
            </span>
            <button onClick={onMute} aria-label={muted ? 'Unmute soundtrack' : 'Mute soundtrack'}>
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
        </div>
        <div className="timeline-scroll" ref={scroll}>
          <div className="tracks" ref={rail} style={{ width: contentWidth }}>
            <div className="beat-grid" style={{ backgroundSize: `${gridWidth}px 100%` }} />
            <div
              className="ruler"
              role="slider"
              aria-label="Show playhead"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={time}
              aria-valuetext={timecode(time)}
              tabIndex={0}
              onKeyDown={scrubKeys}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                seekAt(e.clientX);
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId))
                  seekAt(e.clientX);
              }}
            >
              {Array.from({ length: Math.floor(displayDuration / interval) + 1 }, (_, i) => (
                <span key={i} style={{ left: i * interval * pixelsPerSecond }}>
                  {formatTime(interval * i, interval < 1)}
                </span>
              ))}
            </div>
            <div className="cue-track">
              {project.cues.map((cue, index) => {
                const cueDuration = draft?.id === cue.id ? draft.duration : cue.duration;
                return (
                  <div
                    key={cue.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Scene ${index + 1}: ${cue.name}, ${cueDuration.toFixed(1)} seconds`}
                    aria-pressed={selected === cue.id}
                    className={`timeline-cue ${selected === cue.id ? 'selected' : ''} ${drop?.id === cue.id ? 'dragging' : ''} ${draft?.id === cue.id ? 'trimming' : ''}`}
                    style={
                      {
                        width: cueDuration * pixelsPerSecond,
                        '--cue-color': paletteColors[cue.palette][0],
                      } as CSSProperties
                    }
                    onPointerDown={(e) => startGesture(e, cue.id, 'move')}
                    onPointerMove={moveGesture}
                    onPointerUp={endGesture}
                    onPointerCancel={cancelGesture}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                        e.preventDefault();
                        e.stopPropagation();
                        onMove(
                          cue.id,
                          Math.max(
                            0,
                            Math.min(
                              project.cues.length - 1,
                              index + (e.key === 'ArrowRight' ? 1 : -1)
                            )
                          )
                        );
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        onSelect(cue.id);
                        onSeek(
                          cueStart(project, cue.id) +
                            Math.min(cue.transition + 0.1, cue.duration - 0.1)
                        );
                      }
                    }}
                  >
                    <div className="clip-heading">
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>{cue.name}</strong>
                    </div>
                    {cue.benchCue ? <div className="clip-motor-cue" style={{ left: `${Math.min(95, cue.benchCue.offset / cueDuration * 100)}%` }} title={`Motor ${String.fromCharCode(64 + cue.benchCue.motor)} at +${cue.benchCue.offset}s`}>◆ {String.fromCharCode(64 + cue.benchCue.motor)} · +{cue.benchCue.offset}s</div> : <div className="clip-art">
                      <FormationThumb cue={cue} />
                      <FormationThumb cue={cue} />
                      <FormationThumb cue={cue} />
                    </div>}
                    {index > 0 && cue.transition > 0 && (
                      <div
                        className="clip-transition"
                        style={{ width: `${Math.min(100, (cue.transition / cueDuration) * 100)}%` }}
                      >
                        <span>{Math.min(cue.transition, cueDuration)}s transition</span>
                      </div>
                    )}
                    <span className="clip-duration">{Number(cueDuration.toFixed(2))}s</span>
                    <div
                      className="trim-handle"
                      role="slider"
                      tabIndex={0}
                      aria-label={`Trim ${cue.name}`}
                      aria-valuemin={1 / EDIT_FPS}
                      aria-valuemax={1800}
                      aria-valuenow={cueDuration}
                      aria-valuetext={`${cueDuration.toFixed(2)} seconds`}
                      title="Drag to ripple trim · Shift for frame precision"
                      onPointerDown={(e) => startGesture(e, cue.id, 'trim')}
                      onPointerMove={(e) => {
                        e.stopPropagation();
                        moveGesture(e);
                      }}
                      onPointerUp={(e) => {
                        e.stopPropagation();
                        endGesture(e);
                      }}
                      onPointerCancel={cancelGesture}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                          e.preventDefault();
                          e.stopPropagation();
                          const step = snap && !e.shiftKey ? 60 / project.bpm : 1 / EDIT_FPS;
                          const next = trimDuration(
                            project,
                            cue.id,
                            cue.duration + (e.key === 'ArrowRight' ? step : -step),
                            snap && !e.shiftKey
                          );
                          onTrim(cue.id, next.duration);
                        }
                      }}
                    >
                      <span />
                    </div>
                  </div>
                );
              })}
            </div>
            {showKeys && (
              <KeyframeLane
                cue={selectedCue}
                droneId={droneSelection[0]}
                start={cueStart(project, selected)}
                pixelsPerSecond={pixelsPerSecond}
                bpm={project.bpm}
                snap={snap}
                onSeek={onSeek}
                onMove={onKeyMove}
                onEditStart={onEditStart}
              />
            )}
            <button
              className={`audio-track ${muted ? 'muted' : ''}`}
              onClick={onAudio}
              aria-label="Replace soundtrack"
              style={{ width: displayDuration * pixelsPerSecond }}
            >
              <span className="waveform">
                {peaks.map((value, i) => (
                  <i key={i} style={{ height: `${Math.max(4, value * 96)}%` }} />
                ))}
              </span>
              <span className="track-name">
                <Headphones size={11} />
                {track?.name || 'Drift'}
                <span>
                  · {track?.kind === 'file' ? 'Imported audio' : 'Studio original'} · {project.bpm}{' '}
                  BPM
                </span>
              </span>
            </button>
            {drop && <div className="drop-indicator" style={{ left: dropLeft }} />}
            <div
              className="playhead"
              style={{ left: Math.min(contentWidth - 1, time * pixelsPerSecond) }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                seekAt(e.clientX);
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId))
                  seekAt(e.clientX);
              }}
            >
              <span />
            </div>
          </div>
        </div>
      </div>
      <div className="timeline-footer">
        <span>
          <span className="keyboard-key">space</span> play <span className="keyboard-key">← →</span>{' '}
          frame <span className="keyboard-key">⇧</span> bypass snap
        </span>
        <span>
          {draft
            ? `Ripple trim · ${draft.duration.toFixed(2)}s`
            : drop
              ? `Move to scene ${drop.index + 1}`
              : 'Drag scenes to reorder · drag the right edge to trim'}
        </span>
        <span>
          {formatTime(displayDuration)} <b>30 FPS</b>
        </span>
      </div>
      <span className="sr-only" role="status">
        {message}
      </span>
    </section>
  );
}
