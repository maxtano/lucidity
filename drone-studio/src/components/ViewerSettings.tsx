import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { BookmarkPlus, MapPin, Trash2, X } from 'lucide-react';
import type { VenuePlacement } from '../core/viewer';
import type { ViewerBookmark } from '../core/viewer-bookmarks';
import './Viewer.css';

type ViewerPosition = { east: number; north: number; eyeHeight: number; fov: number };
type Props = {
  viewer: ViewerPosition;
  venue: VenuePlacement;
  yaw: number;
  horizontalFov: number;
  onViewerChange: (viewer: ViewerPosition) => void;
  onVenueChange: (venue: VenuePlacement) => void;
  onClose: () => void;
  bookmarks: ViewerBookmark[];
  onSave: (name: string) => void;
  onRecall: (id: string) => void;
  onRemove: (id: string) => void;
  storageMessage: string;
};
type Marker = 'viewer' | 'stage';
type SettingsTab = 'plan' | 'views';
type Position = { east: number; north: number };
type Drag = {
  marker: Marker;
  pointerId: number;
  start: Position;
  offset: Position;
  span: number;
};

const PLAN_SIZE = 280;
const PLAN_CENTER = PLAN_SIZE / 2;
const PLAN_HALF = 112;
const PLAN_SPANS = [100, 250, 500] as const;
const clampPosition = (value: number) => Math.max(-500, Math.min(500, value));
const displayNumber = (value: number) => Number(value.toFixed(1)).toString();

function CoordinateField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      type="number"
      aria-label={label}
      value={draft}
      min={-500}
      max={500}
      step={1}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => {
        const number = draft.trim() ? Number(draft) : NaN;
        if (!cancelled.current && Number.isFinite(number)) {
          const bounded = clampPosition(number);
          setDraft(String(bounded));
          if (bounded !== value) onCommit(bounded);
        } else setDraft(String(value));
        cancelled.current = false;
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        cancelled.current = event.key === 'Escape';
        event.currentTarget.blur();
      }}
    />
  );
}

export function ViewerSettings({
  viewer,
  venue,
  yaw,
  horizontalFov,
  onViewerChange,
  onVenueChange,
  onClose,
  bookmarks,
  onSave,
  onRecall,
  onRemove,
  storageMessage,
}: Props) {
  const labelId = useId();
  const planHelpId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const tabButtons = useRef<Partial<Record<SettingsTab, HTMLButtonElement>>>({});
  const drag = useRef<Drag | null>(null);
  const [tab, setTab] = useState<SettingsTab>('plan');
  const [dragging, setDragging] = useState<Marker | null>(null);
  const [name, setName] = useState('');
  const extent = Math.max(
    Math.abs(viewer.east),
    Math.abs(viewer.north),
    Math.abs(venue.east),
    Math.abs(venue.north)
  );
  const requiredSpan = PLAN_SPANS.find((candidate) => candidate >= extent) ?? 500;
  const [span, setSpan] = useState<number>(requiredSpan);

  useEffect(() => {
    if (!dragging && span < requiredSpan) setSpan(requiredSpan);
  }, [dragging, requiredSpan, span]);

  const setPosition = (marker: Marker, position: Position) => {
    const bounded = { east: clampPosition(position.east), north: clampPosition(position.north) };
    if (marker === 'viewer') onViewerChange({ ...viewer, ...bounded });
    else onVenueChange({ ...venue, ...bounded });
  };

  // Account for SVG letterboxing, not just its CSS width. This also handles canvas resizing.
  const pointerPosition = (
    clientX: number,
    clientY: number,
    currentSpan: number
  ): Position | null => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const scale = Math.min(rect.width, rect.height) / PLAN_SIZE;
    const left = rect.left + (rect.width - PLAN_SIZE * scale) / 2;
    const top = rect.top + (rect.height - PLAN_SIZE * scale) / 2;
    return {
      east: (((clientX - left) / scale - PLAN_CENTER) / PLAN_HALF) * currentSpan,
      north: ((PLAN_CENTER - (clientY - top) / scale) / PLAN_HALF) * currentSpan,
    };
  };

  const startDrag = (marker: Marker, event: PointerEvent<SVGGElement>) => {
    if (event.button !== 0 || drag.current) return;
    const point = pointerPosition(event.clientX, event.clientY, span);
    if (!point || !svg.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    const start = marker === 'viewer' ? viewer : venue;
    drag.current = {
      marker,
      pointerId: event.pointerId,
      start: { east: start.east, north: start.north },
      offset: { east: start.east - point.east, north: start.north - point.north },
      span,
    };
    svg.current.setPointerCapture(event.pointerId);
    setDragging(marker);
  };

  const moveDrag = (event: PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointerPosition(event.clientX, event.clientY, current.span);
    if (!point) return;
    const snapped = (value: number) =>
      Math.round(Math.max(-current.span, Math.min(current.span, value)) * 10) / 10;
    setPosition(current.marker, {
      east: snapped(point.east + current.offset.east),
      north: snapped(point.north + current.offset.north),
    });
  };

  const finishDrag = (cancel: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setDragging(null);
    if (svg.current?.hasPointerCapture(current.pointerId))
      svg.current.releasePointerCapture(current.pointerId);
    if (cancel) setPosition(current.marker, current.start);
  };

  const changeTab = (next: SettingsTab) => {
    if (next === tab) return;
    finishDrag(true);
    setTab(next);
    if (body.current) body.current.scrollTop = 0;
  };

  const markerKeys = (marker: Marker, event: KeyboardEvent<SVGGElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const direction: Record<string, Position> = {
      ArrowUp: { east: 0, north: step },
      ArrowDown: { east: 0, north: -step },
      ArrowLeft: { east: -step, north: 0 },
      ArrowRight: { east: step, north: 0 },
    };
    const delta = direction[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    if (drag.current) return;
    const position = marker === 'viewer' ? viewer : venue;
    setPosition(marker, { east: position.east + delta.east, north: position.north + delta.north });
  };

  const point = (position: Position) => ({
    x: PLAN_CENTER + (position.east / span) * PLAN_HALF,
    y: PLAN_CENTER - (position.north / span) * PLAN_HALF,
  });
  const viewerPoint = point(viewer);
  const stagePoint = point(venue);
  const coneHalfAngle = (Math.max(1, Math.min(179, horizontalFov)) * Math.PI) / 360;
  const coneX = Math.sin(coneHalfAngle) * 30;
  const coneY = -Math.cos(coneHalfAngle) * 30;
  const stageWidth = Math.max(18, (32 / span) * PLAN_HALF);
  const stageDepth = Math.max(8, (12 / span) * PLAN_HALF);

  const coordinates = (marker: Marker) => {
    const position = marker === 'viewer' ? viewer : venue;
    return (
      <div className="viewer-position-coordinates">
        {(['east', 'north'] as const).map((axis) => (
          <label key={axis}>
            {axis === 'east' ? 'East / west' : 'North / south'}
            <span>
              <CoordinateField
                label={`${marker === 'viewer' ? 'Viewer' : 'Stage'} ${axis} position`}
                value={position[axis]}
                onCommit={(value) => setPosition(marker, { ...position, [axis]: value })}
              />
              m
            </span>
          </label>
        ))}
      </div>
    );
  };

  return (
    <div
      className="viewer-position-panel viewer-settings"
      role="region"
      aria-labelledby={labelId}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (drag.current) finishDrag(true);
        else onClose();
      }}
    >
      <div className="viewer-settings-header">
        <div className="viewer-position-title">
          <MapPin size={14} />
          <strong id={labelId}>Venue & viewpoint</strong>
          <button type="button" aria-label="Close viewer settings" onClick={onClose}>
            <X size={13} />
          </button>
        </div>
        <div className="viewer-settings-tabs" role="tablist" aria-label="Viewer settings sections">
          {(['plan', 'views'] as const).map((item) => (
            <button
              key={item}
              ref={(element) => {
                if (element) tabButtons.current[item] = element;
              }}
              type="button"
              role="tab"
              id={`${labelId}-${item}-tab`}
              aria-controls={`${labelId}-${item}-panel`}
              aria-selected={tab === item}
              tabIndex={tab === item ? 0 : -1}
              onClick={() => changeTab(item)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                const next =
                  event.key === 'Home'
                    ? 'plan'
                    : event.key === 'End'
                      ? 'views'
                      : item === 'plan'
                        ? 'views'
                        : 'plan';
                changeTab(next);
                tabButtons.current[next]?.focus();
              }}
            >
              {item === 'plan' ? 'Venue plan' : `Saved views (${bookmarks.length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="viewer-settings-body" ref={body}>
        {tab === 'plan' && (
          <section
            role="tabpanel"
            id={`${labelId}-plan-panel`}
            aria-labelledby={`${labelId}-plan-tab`}
          >
            <div className="viewer-plan-heading">
              <span>VENUE PLAN</span>
              <div className="viewer-plan-zoom" aria-label="Plan coordinate range">
                {PLAN_SPANS.map((option) => (
                  <button
                    type="button"
                    key={option}
                    aria-label={`Plan range plus or minus ${option} metres`}
                    aria-pressed={span === option}
                    disabled={requiredSpan > option || dragging !== null}
                    onClick={() => setSpan(option)}
                  >
                    ±{option} m
                  </button>
                ))}
              </div>
            </div>
            <svg
              ref={svg}
              className={`viewer-venue-plan${dragging ? ' is-dragging' : ''}`}
              viewBox={`0 0 ${PLAN_SIZE} ${PLAN_SIZE}`}
              preserveAspectRatio="xMidYMid meet"
              role="group"
              aria-label="Top-down venue placement plan"
              aria-describedby={planHelpId}
              onPointerMove={moveDrag}
              onPointerUp={(event) => {
                if (drag.current?.pointerId !== event.pointerId) return;
                moveDrag(event);
                finishDrag(false);
              }}
              onPointerCancel={(event) => {
                if (drag.current?.pointerId === event.pointerId) finishDrag(true);
              }}
              onLostPointerCapture={(event) => {
                if (drag.current?.pointerId === event.pointerId) finishDrag(true);
              }}
            >
              <rect className="venue-plan-ground" x="28" y="28" width="224" height="224" rx="4" />
              {[0.25, 0.5, 0.75].map((fraction) => (
                <circle
                  key={fraction}
                  className="venue-plan-ring"
                  cx="140"
                  cy="140"
                  r={PLAN_HALF * fraction}
                />
              ))}
              <path className="venue-plan-axis" d="M28 140H252 M140 28V252" />
              <circle className="venue-plan-origin" cx="140" cy="140" r="2" />
              <text className="venue-plan-axis-label" x="140" y="16" textAnchor="middle">
                N ↑
              </text>
              <text className="venue-plan-axis-label" x="262" y="143" textAnchor="middle">
                E
              </text>
              <text className="venue-plan-range-label" x="28" y="271">
                −{span}
              </text>
              <text className="venue-plan-range-label" x="252" y="271" textAnchor="end">
                +{span} m
              </text>
              <line
                className="venue-plan-sightline"
                x1={viewerPoint.x}
                y1={viewerPoint.y}
                x2={stagePoint.x}
                y2={stagePoint.y}
              />
              <g
                className="venue-plan-marker venue-plan-stage"
                transform={`translate(${stagePoint.x} ${stagePoint.y})`}
                tabIndex={0}
                role="button"
                aria-label={`Stage marker, east ${displayNumber(venue.east)}, north ${displayNumber(venue.north)} metres. Drag or use arrow keys to move.`}
                aria-describedby={planHelpId}
                onPointerDown={(event) => startDrag('stage', event)}
                onKeyDown={(event) => markerKeys('stage', event)}
              >
                <circle className="venue-plan-hit-area" r="22" />
                <circle className="venue-plan-focus-ring" r="23" />
                <g transform={`rotate(${venue.heading})`}>
                  <rect
                    className="venue-plan-stage-deck"
                    x={-stageWidth / 2}
                    y={-stageDepth / 2}
                    width={stageWidth}
                    height={stageDepth}
                    rx="2"
                  />
                  <path
                    className="venue-plan-stage-front"
                    d={`M${-stageWidth / 2 + 2} ${-stageDepth / 2}H${stageWidth / 2 - 2}`}
                  />
                  <path
                    className="venue-plan-stage-arrow"
                    d={`M-3 ${-stageDepth / 2 - 4}L0 ${-stageDepth / 2 - 9}L3 ${-stageDepth / 2 - 4}`}
                  />
                </g>
                <text
                  className="venue-plan-marker-label"
                  textAnchor="middle"
                  y={stagePoint.y > 225 ? -27 : 29}
                >
                  STAGE
                </text>
              </g>
              <g
                className="venue-plan-marker venue-plan-viewer"
                transform={`translate(${viewerPoint.x} ${viewerPoint.y})`}
                tabIndex={0}
                role="button"
                aria-label={`Viewer marker, east ${displayNumber(viewer.east)}, north ${displayNumber(viewer.north)} metres. Drag or use arrow keys to move.`}
                aria-describedby={planHelpId}
                onPointerDown={(event) => startDrag('viewer', event)}
                onKeyDown={(event) => markerKeys('viewer', event)}
              >
                <circle className="venue-plan-hit-area" r="20" />
                <circle className="venue-plan-focus-ring" r="21" />
                <g transform={`rotate(${yaw})`}>
                  <path
                    className="venue-plan-view-cone"
                    d={`M0 0L${-coneX} ${coneY}A30 30 0 0 1 ${coneX} ${coneY}Z`}
                  />
                  <path className="venue-plan-view-arrow" d="M0 -11L5 -2L0 -4L-5 -2Z" />
                </g>
                <circle className="venue-plan-viewer-dot" r="4" />
                <text
                  className="venue-plan-marker-label"
                  textAnchor="middle"
                  y={viewerPoint.y > 225 ? -24 : 25}
                >
                  YOU
                </text>
              </g>
            </svg>
            <p className="viewer-plan-help" id={planHelpId}>
              Drag either marker. Arrows move 1 m; Shift moves 10 m. Escape cancels a drag.
            </p>

            <div className="viewer-seat-presets" aria-label="Audience positions">
              {[
                { label: 'Center', east: 0, north: 0 },
                { label: 'Rear', east: 0, north: -35 },
                { label: 'Left', east: -30, north: 0 },
                { label: 'Right', east: 30, north: 0 },
              ].map((seat) => (
                <button
                  type="button"
                  key={seat.label}
                  aria-pressed={viewer.east === seat.east && viewer.north === seat.north}
                  onClick={() => onViewerChange({ ...viewer, east: seat.east, north: seat.north })}
                >
                  {seat.label}
                </button>
              ))}
            </div>

            <details className="viewer-precise-controls">
              <summary>
                Coordinates & lens <span>Metres · ENU</span>
              </summary>
              <h3>Your viewpoint</h3>
              {coordinates('viewer')}
              <label className="viewer-setting-slider">
                Eye height <output>{displayNumber(viewer.eyeHeight)} m</output>
                <input
                  aria-label="Viewer eye height"
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.1}
                  value={viewer.eyeHeight}
                  onChange={(event) =>
                    onViewerChange({ ...viewer, eyeHeight: Number(event.target.value) })
                  }
                />
              </label>
              <label className="viewer-setting-slider">
                Field of view <output>{displayNumber(viewer.fov)}°</output>
                <input
                  aria-label="Viewer field of view"
                  type="range"
                  min={45}
                  max={100}
                  step={1}
                  value={viewer.fov}
                  onChange={(event) =>
                    onViewerChange({ ...viewer, fov: Number(event.target.value) })
                  }
                />
              </label>
              <h3>Stage placement</h3>
              {coordinates('stage')}
              <label className="viewer-setting-slider">
                Front faces <output>{Math.round(venue.heading)}°</output>
                <input
                  aria-label="Stage front heading"
                  type="range"
                  min={0}
                  max={359}
                  step={1}
                  value={venue.heading}
                  onChange={(event) =>
                    onVenueChange({ ...venue, heading: Number(event.target.value) })
                  }
                />
                <span className="viewer-heading-guide">
                  0° North · 90° East · 180° South · 270° West
                </span>
              </label>
            </details>
            <p className="viewer-reference-note">
              Reference venue only. The cone marks horizontal heading, not drone coverage. View and
              stage placement leave choreography unchanged; markers are symbolic.
            </p>
          </section>
        )}

        {tab === 'views' && (
          <section
            className="viewer-bookmarks"
            role="tabpanel"
            id={`${labelId}-views-panel`}
            aria-labelledby={`${labelId}-views-tab`}
          >
            <div className="viewer-bookmark-heading">
              <strong>Saved views</strong>
              <span>{bookmarks.length} / 12</span>
            </div>
            <form
              className="viewer-bookmark-save"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim() && bookmarks.length < 12) onSave(name.trim());
              }}
            >
              <input
                aria-label="View name"
                placeholder="Name this view…"
                value={name}
                maxLength={48}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                type="submit"
                disabled={!name.trim() || bookmarks.length >= 12}
                title={
                  bookmarks.length >= 12
                    ? 'Remove a saved view to make room'
                    : 'Save current viewpoint and stage placement'
                }
              >
                <BookmarkPlus size={13} />
                Save
              </button>
            </form>
            {bookmarks.length > 0 && (
              <ul className="viewer-bookmark-list">
                {bookmarks.map((bookmark) => (
                  <li key={bookmark.id}>
                    <button
                      type="button"
                      className="viewer-bookmark-recall"
                      onClick={() => onRecall(bookmark.id)}
                      title={`Recall ${bookmark.name}`}
                    >
                      <span>{bookmark.name}</span>
                      <small>
                        E {displayNumber(bookmark.snapshot.pose.east)} · N{' '}
                        {displayNumber(bookmark.snapshot.pose.north)} ·{' '}
                        {displayNumber(bookmark.snapshot.pose.fov)}°
                      </small>
                    </button>
                    <button
                      type="button"
                      className="viewer-bookmark-remove"
                      aria-label={`Remove saved view ${bookmark.name}`}
                      onClick={() => onRemove(bookmark.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {storageMessage && (
              <p className="viewer-storage-message" role="status">
                {storageMessage}
              </p>
            )}
            <p className="viewer-reference-note">
              Save the current viewpoint, lens and stage placement to return to it later.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
