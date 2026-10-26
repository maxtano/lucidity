import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowLeftRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Repeat2,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { draftPreviewTiming, type DraftPreviewDocument } from '../agent/draft-preview';
import { draftAuditionPresets } from '../agent/draft-preview-audition';
import { describeDraftTargetSceneFrame } from '../agent/draft-preview-targets';
import { DRAFT_PREVIEW_SPEEDS, type DraftAuditionRange } from '../agent/draft-preview-playback';
import {
  buildDraftPreviewNavigation,
  type DraftPreviewNavigation,
} from '../agent/draft-preview-navigation';
import { frameAt, totalDuration } from '../core/model';
import { timecode } from '../core/timeline';
import type { ViewerSnapshot } from '../core/viewer';
import { Stage } from './Stage';
import { AgentReviewMoments } from './AgentReviewMoments';
import { useDraftPreviewPlayback } from './useDraftPreviewPlayback';
import './AgentDraftPreview.css';

type Version = 'base' | 'draft';
const noAction = () => {};
const noSelection: number[] = [];
const propertyLabel = (property: string) =>
  ({
    name: 'Name',
    duration: 'Duration',
    transition: 'Transition',
    transitionEasing: 'Transition easing',
    order: 'Scene order',
    droneEdits: 'Drone edits',
    metadata: 'Scene notes',
    scene_added: 'Added scene',
    scene_removed: 'Removed scene',
    shape: 'Shape',
    palette: 'Palette',
    scale: 'Scale',
    altitude: 'Altitude',
  })[property] ?? property.replace(/([a-z])([A-Z])/g, '$1 $2');
const changeLabel = (change: DraftPreviewNavigation['changes'][number]) => {
  const name =
    change.nameBefore && change.nameAfter && change.nameBefore !== change.nameAfter
      ? `${change.nameBefore} → ${change.nameAfter}`
      : (change.nameAfter ?? change.nameBefore ?? change.id);
  return change.status === 'added'
    ? `Added · ${name}`
    : change.status === 'removed'
      ? `Removed · ${name}`
      : name;
};

/** One mounted renderer and one show clock; switching documents leaves the camera alone. */
export function AgentDraftPreview({ comparison }: { comparison: DraftPreviewDocument }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const expansionButtonRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [reviewControlsOpen, setReviewControlsOpen] = useState(false);
  const reviewControlsId = useId();
  const [version, setVersion] = useState<Version>('draft');
  // Enabling markers belongs to this exact owned proposal, never a later replacement.
  const [markedComparison, setMarkedComparison] = useState<DraftPreviewDocument | null>(null);
  const targetMarkersEnabled = markedComparison === comparison;
  const [targetSceneSelection, setTargetSceneSelection] = useState<{
    comparison: DraftPreviewDocument;
    cueId: string;
  } | null>(null);
  const targetScene = useMemo(
    () =>
      targetSceneSelection?.comparison === comparison
        ? comparison.droneTargets?.scenes.find(
            (scene) => scene.cueId === targetSceneSelection.cueId
          )
        : undefined,
    [comparison, targetSceneSelection]
  );
  const targetScope = targetScene ?? comparison.droneTargets;
  const baseDuration = totalDuration(comparison.base);
  const draftDuration = totalDuration(comparison.draft);
  const playback = useDraftPreviewPlayback(
    comparison.initialTime,
    Math.max(baseDuration, draftDuration)
  );
  const { time, playing, range, loopEnabled, speed } = playback;
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeInput, setRangeInput] = useState(() => ({
    start: String(range.start),
    end: String(range.end),
  }));
  const [rangeError, setRangeError] = useState('');
  const rangeEditorId = useId();
  const rangeErrorId = useId();
  const recallViewer = useRef<((snapshot: ViewerSnapshot) => void) | null>(null);
  const [capturedReviewAspect, setCapturedReviewAspect] = useState<number>();
  const [selectedScene, setSelectedScene] = useState('');
  // Authored data is scanned once for this owned comparison, never on animation frames.
  const navigation = useMemo(
    () => buildDraftPreviewNavigation(comparison.base, comparison.draft),
    [comparison]
  );
  const changedScene = useMemo(
    () => navigation.changes.find((change) => change.id === selectedScene) ?? navigation.changes[0],
    [navigation, selectedScene]
  );
  const auditionPresets = useMemo(
    () => draftAuditionPresets(comparison.base, comparison.draft, changedScene?.id ?? ''),
    [comparison, changedScene?.id]
  );
  const sceneOptions = useMemo(
    () =>
      navigation.changes.map((change) => (
        <option key={change.id} value={change.id}>
          {changeLabel(change)}
        </option>
      )),
    [navigation]
  );
  const changedProperties = changedScene?.properties.map(propertyLabel).join(' · ') ?? '';
  const timing = draftPreviewTiming(comparison.base, comparison.draft, time);
  const active = version === 'base' ? comparison.base : comparison.draft;
  const activeTime = version === 'base' ? timing.baseTime : timing.draftTime;
  const held = version === 'base' ? timing.baseEnded : timing.draftEnded;
  const label = version === 'base' ? 'Before' : 'Draft';
  const targetSceneFrame = targetScene
    ? describeDraftTargetSceneFrame(active, activeTime, targetScene.cueId)
    : null;
  const baseFrame = frameAt(comparison.base, timing.baseTime);
  const draftFrame = frameAt(comparison.draft, timing.draftTime);
  const outsideLoop = loopEnabled && !playing && (time < range.start || time >= range.end);
  const loopStatus = loopEnabled
    ? `${timecode(range.start)} → ${timecode(range.end)}${outsideLoop ? ' · Play returns to In' : ' · repeats'}`
    : 'Full show · saved range inactive';
  const seek = playback.seek;
  const commitRangeInput = (input: typeof rangeInput) => {
    const value = (text: string) => (text.trim() ? Number(text) : NaN);
    const next = { start: value(input.start), end: value(input.end) };
    try {
      playback.setRange(next);
      setRangeInput({ start: String(next.start), end: String(next.end) });
      setRangeError('');
    } catch (error) {
      setRangeError(error instanceof Error ? error.message : 'Enter a valid loop range.');
    }
  };
  const setBoundFromPlayhead = (bound: 'start' | 'end') => {
    const settled = playback.pause();
    const next = { ...rangeInput, [bound]: String(settled) };
    setRangeInput(next);
    commitRangeInput(next);
  };
  const usePreset = (next: DraftAuditionRange) => {
    playback.setRange(next);
    setRangeInput({ start: String(next.start), end: String(next.end) });
    setRangeError('');
    playback.setLoopEnabled(true);
    seek(next.start);
  };

  useEffect(() => {
    if (!expanded) return;
    const restoreOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const owner = previewRef.current?.closest('[role="dialog"][aria-modal="true"]');
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      // The owning Modal's heading/Close button is outside this preview. A nested modal
      // must still own Escape, wherever its portal lives in the document.
      if (!owner || dialogs[dialogs.length - 1] !== owner) return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
      expansionButtonRef.current?.focus();
    };
    window.addEventListener('keydown', restoreOnEscape, true);
    return () => window.removeEventListener('keydown', restoreOnEscape, true);
  }, [expanded]);

  const shortcuts = (event: KeyboardEvent<HTMLDivElement>) => {
    // A nested dialog owns its shortcuts, even when fullscreen portals it inside this Stage.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    if (
      !(event.target instanceof Element) ||
      event.target.closest('[role="dialog"]') !== event.currentTarget.closest('[role="dialog"]')
    )
      return;
    // Let the modal keep Escape/focus trapping; Stage's native canvas handler owns arrow look.
    if (event.key === 'Escape' || event.key === 'Tab') return;
    event.stopPropagation();
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.isContentEditable || target?.closest('input, textarea, select, [role="textbox"]'))
      return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (target instanceof HTMLCanvasElement && ['i', 'o', 'l'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      if (event.key.toLowerCase() === 'l') playback.toggleLoop();
      else setBoundFromPlayhead(event.key.toLowerCase() === 'i' ? 'start' : 'end');
    } else if (event.key === '\\') {
      event.preventDefault();
      setVersion((current) => (current === 'base' ? 'draft' : 'base'));
    } else if (event.code === 'Space' || event.key === ' ') {
      // Space still activates focused buttons/links normally.
      if (target?.closest('button, a, [role="button"]')) return;
      event.preventDefault();
      playback.togglePlaying();
    }
  };

  return (
    <div
      ref={previewRef}
      className={`agent-draft-preview${changedScene ? ' has-scene-navigation' : ''}${expanded ? ' is-expanded' : ''}`}
      onKeyDown={shortcuts}
    >
      <div className="agent-draft-comparison-header">
        <div className="agent-draft-version-switch" role="group" aria-label="Preview version">
          {(
            [
              { id: 'base', label: 'Before', project: comparison.base, duration: baseDuration },
              { id: 'draft', label: 'Draft', project: comparison.draft, duration: draftDuration },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={version === item.id}
              onClick={() => setVersion(item.id)}
            >
              <strong>{item.label}</strong>
              <span>
                {item.project.droneCount.toLocaleString()} drones <i /> {timecode(item.duration)}
              </span>
            </button>
          ))}
        </div>
        <div className="agent-draft-layout-actions">
          <p>
            <ArrowLeftRight size={13} /> Same camera · shared clock
          </p>
          <button
            ref={expansionButtonRef}
            type="button"
            aria-label={expanded ? 'Restore comparison' : 'Expand comparison'}
            aria-pressed={expanded}
            title={
              expanded ? 'Restore comparison · Escape' : 'Expand comparison to fill the window'
            }
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            <span>{expanded ? 'Restore' : 'Expand'}</span>
          </button>
        </div>
      </div>
      <div className="agent-draft-current-frame">
        {(
          [
            {
              id: 'base',
              label: 'Before',
              frame: baseFrame,
              time: timing.baseTime,
              ended: timing.baseEnded,
            },
            {
              id: 'draft',
              label: 'Draft',
              frame: draftFrame,
              time: timing.draftTime,
              ended: timing.draftEnded,
            },
          ] as const
        ).map((item) => (
          <div
            key={item.id}
            className={`agent-draft-scene-clock${version === item.id ? ' is-active' : ''}`}
            role="group"
            aria-label={`${item.label} current scene`}
          >
            <span className={item.id === 'draft' ? 'is-draft' : ''}>{item.label}</span>
            <strong title={item.frame.cue.name}>{item.frame.cue.name}</strong>
            <output aria-label={`${item.label} scene-local time`}>
              Scene + {timecode(item.time - item.frame.start)}
            </output>
            {item.ended && <em className="agent-draft-held">End frame held</em>}
          </div>
        ))}
      </div>
      <Stage
        project={active}
        time={activeTime}
        playing={playing && !held}
        focused={false}
        onFocus={noAction}
        selection={noSelection}
        onPick={noAction}
        onTransform={noAction}
        onEditStart={playback.pause}
        onSeek={seek}
        initialViewerSnapshot={comparison.viewer}
        recallViewerRef={recallViewer}
        audienceFrameAspect={capturedReviewAspect}
        comparisonExpansion={{ expanded, onToggle: () => setExpanded((value) => !value) }}
        reviewCapture={{ version, sharedTime: time, pause: playback.pause }}
        proposalTargets={
          comparison.droneTargets && targetScope
            ? {
                target: targetScope[version],
                totalCount: targetScope.ids.length,
                overallCount: comparison.droneTargets.ids.length,
                perDroneOperations: targetScope.perDroneOperations,
                otherOperations: comparison.droneTargets.otherOperations,
                versionLabel: label,
                enabled: targetMarkersEnabled,
                onToggle: () =>
                  setMarkedComparison((current) => (current === comparison ? null : comparison)),
                sceneScope: {
                  cueId: targetScene?.cueId ?? null,
                  scenes: comparison.droneTargets.scenes,
                  frame: targetSceneFrame,
                  onChange: (cueId) =>
                    setTargetSceneSelection(cueId === null ? null : { comparison, cueId }),
                },
              }
            : undefined
        }
        readOnly
      />
      {comparison.droneTargets && comparison.droneTargets.ids.length === 0 && (
        <p className="agent-draft-global-changes">
          No explicit per-drone targets to mark. Scene and show changes remain visible in the
          comparison.
        </p>
      )}
      <div className="agent-draft-transport">
        <button
          type="button"
          className="agent-draft-restart"
          aria-label="Restart comparison preview"
          onClick={playback.restart}
          title={loopEnabled ? 'Restart at loop In' : 'Restart at show start'}
        >
          <RotateCcw size={14} />
        </button>
        <button
          type="button"
          className="agent-draft-play"
          aria-label={playing ? 'Pause comparison preview' : 'Play comparison preview'}
          onClick={playback.togglePlaying}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <output aria-label="Shared comparison timecode">{timecode(timing.time)}</output>
        <input
          type="range"
          aria-label="Comparison playhead"
          aria-valuetext={`Shared show time ${timing.time.toFixed(3)} seconds${held ? `; ${label} end frame held` : ''}`}
          min={0}
          max={timing.duration}
          step={1 / 30}
          value={timing.time}
          onPointerDown={playback.pause}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span>{timecode(timing.duration)}</span>
      </div>
      <div className="agent-draft-review-bar" hidden={!expanded}>
        <span>
          {speed}× playback · {loopEnabled ? 'Loop on' : 'Full show'}
          <i /> Escape restores
        </span>
        <button
          type="button"
          aria-expanded={reviewControlsOpen}
          aria-controls={reviewControlsId}
          onClick={() => setReviewControlsOpen((open) => !open)}
        >
          <SlidersHorizontal size={12} /> Review controls
          <span aria-hidden="true">{reviewControlsOpen ? '−' : '+'}</span>
        </button>
      </div>
      <div
        id={reviewControlsId}
        className="agent-draft-review-controls"
        hidden={expanded && !reviewControlsOpen}
        role="region"
        aria-label="Comparison review controls"
      >
        <section className="agent-draft-audition" aria-label="Private audition controls">
          <div className="agent-draft-audition-toolbar">
            <button
              type="button"
              aria-label="Loop preview range"
              aria-pressed={loopEnabled}
              title="Repeat the saved In/Out range · L on canvas"
              onClick={playback.toggleLoop}
            >
              <Repeat2 size={12} /> Loop <span>{loopEnabled ? 'On' : 'Off'}</span>
            </button>
            <span className="agent-draft-audition-status" title={loopStatus}>
              {loopStatus}
            </span>
            <label className="agent-draft-speed">
              Speed
              <select
                aria-label="Preview playback speed"
                value={speed}
                onChange={(event) => playback.setSpeed(Number(event.target.value))}
              >
                {DRAFT_PREVIEW_SPEEDS.map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-expanded={rangeOpen}
              aria-controls={rangeEditorId}
              onClick={() => setRangeOpen((open) => !open)}
            >
              In / Out <span>{rangeOpen ? '−' : '+'}</span>
            </button>
          </div>
          {rangeOpen && (
            <form
              id={rangeEditorId}
              className="agent-draft-range-editor"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                commitRangeInput(rangeInput);
              }}
            >
              <div className="agent-draft-range-fields">
                {(
                  [
                    { bound: 'start', label: 'In' },
                    { bound: 'end', label: 'Out' },
                  ] as const
                ).map(({ bound, label }) => (
                  <label key={bound}>
                    {label} · show seconds
                    <span>
                      <input
                        type="number"
                        aria-label={`Loop ${label.toLowerCase()} in show seconds`}
                        aria-invalid={Boolean(rangeError)}
                        aria-describedby={rangeError ? rangeErrorId : undefined}
                        min={0}
                        max={timing.duration}
                        step="any"
                        value={rangeInput[bound]}
                        onChange={(event) => {
                          playback.pause();
                          setRangeInput((input) => ({ ...input, [bound]: event.target.value }));
                          setRangeError('');
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setBoundFromPlayhead(bound)}
                        title={`Set ${label} from the playhead`}
                      >
                        Set {label}
                      </button>
                    </span>
                  </label>
                ))}
                <button type="submit">Set range</button>
              </div>
              <div className="agent-draft-range-presets">
                <span>Selected changed scene</span>
                <button
                  type="button"
                  disabled={!auditionPresets.scene}
                  title="Encloses both scene timings"
                  onClick={() => auditionPresets.scene && usePreset(auditionPresets.scene)}
                >
                  Loop scene
                </button>
                <button
                  type="button"
                  disabled={!auditionPresets.transition}
                  title="Encloses existing incoming blends"
                  onClick={() =>
                    auditionPresets.transition && usePreset(auditionPresets.transition)
                  }
                >
                  Loop transition
                </button>
              </div>
              <p>
                Loop repeats [In, Out). When off, playback uses the full show. Canvas: I sets In, O
                sets Out, L toggles loop.
              </p>
            </form>
          )}
          {rangeError && (
            <p className="agent-draft-range-error" id={rangeErrorId} role="alert">
              {rangeError} Previous range kept: {range.start}–{range.end} seconds.
            </p>
          )}
        </section>
        {changedScene ? (
          <section
            className="agent-draft-navigation"
            aria-label="Changed scene navigation"
            title="Editing landmarks; interpolation may change the image before a key."
          >
            <div className="agent-draft-navigation-heading">
              <label>
                Changed scene <span>{navigation.changes.length}</span>
                <select
                  aria-label="Changed scene"
                  value={changedScene.id}
                  title={changeLabel(changedScene)}
                  onChange={(event) => setSelectedScene(event.target.value)}
                >
                  {sceneOptions}
                </select>
              </label>
              <span className="agent-draft-navigation-properties" title={changedProperties}>
                {changedProperties ||
                  (changedScene.status === 'added'
                    ? 'Added scene'
                    : changedScene.status === 'removed'
                      ? 'Removed scene'
                      : 'Authored changes')}
              </span>
            </div>
            {(
              [
                { version: 'base', label: 'Before', side: changedScene.before },
                { version: 'draft', label: 'Draft', side: changedScene.draft },
              ] as const
            ).map((item) => (
              <div
                key={item.version}
                className={`agent-draft-jump-row${item.version === 'draft' ? ' is-draft' : ''}`}
              >
                <strong>{item.label}</strong>
                {item.side ? (
                  <div>
                    {item.side.points.map((point) => (
                      <button
                        key={point.time}
                        type="button"
                        aria-label={`${item.label}: ${point.label} at ${point.time} seconds show time`}
                        title={`${item.label} · ${changeLabel(changedScene)} · Show ${timecode(point.time)} · Scene + ${timecode(point.localTime)}`}
                        onClick={() => {
                          setVersion(item.version);
                          seek(point.time);
                        }}
                      >
                        {point.label}
                        <span>{timecode(point.time)}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <span>Not in {item.label}</span>
                )}
              </div>
            ))}
            {navigation.globalChanges.length > 0 && (
              <p className="agent-draft-navigation-note">{navigation.globalChanges.join(' · ')}</p>
            )}
          </section>
        ) : (
          <p className="agent-draft-global-changes">
            {navigation.globalChanges.length > 0
              ? navigation.globalChanges.join(' · ')
              : 'No authored scene changes to navigate.'}
          </p>
        )}
        {comparison.reviewMoments?.length ? (
          <AgentReviewMoments
            moments={comparison.reviewMoments}
            onOpen={(moment) => {
              playback.pause();
              setVersion(moment.version);
              setCapturedReviewAspect(moment.aspect);
              seek(moment.time);
              recallViewer.current?.(moment.snapshot);
            }}
          />
        ) : null}
        <div className="agent-draft-preview-help">
          <p>
            Landmarks use each version’s global show time. Switching versions keeps the shared
            clock. Shorter shows hold their final frame; music stays paused.
          </p>
          <span>
            Canvas <i />
            <kbd>\</kbd> Switch <i /> <kbd>Space</kbd> Play / pause
          </span>
        </div>
      </div>
    </div>
  );
}
