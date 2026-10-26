import { useRef, useState } from 'react';
import { Diamond } from 'lucide-react';
import type { Cue } from '../core/model';
import { EDIT_FPS, timecode } from '../core/timeline';

type Props = {
  cue: Cue;
  droneId: number;
  start: number;
  pixelsPerSecond: number;
  bpm: number;
  snap: boolean;
  onSeek: (time: number) => void;
  onMove: (id: number, from: number, to: number) => void;
  onEditStart: () => void;
};
export function KeyframeLane({
  cue,
  droneId,
  start,
  pixelsPerSecond,
  bpm,
  snap,
  onSeek,
  onMove,
  onEditStart,
}: Props) {
  const keys = cue.droneEdits?.[droneId]?.keyframes || [];
  const gesture = useRef<{ from: number; to: number; x: number; moved: boolean } | null>(null);
  const [draft, setDraft] = useState<{ from: number; to: number } | null>(null);
  const clamp = (time: number, useSnap: boolean) => {
    const step = useSnap ? 60 / bpm : 1 / EDIT_FPS;
    return Math.max(
      0,
      Math.min(cue.duration, Number((Math.round((time + start) / step) * step - start).toFixed(6)))
    );
  };
  return (
    <div className="keyframe-lane" aria-label={`Animation keys for drone ${droneId}`}>
      <div
        className="keyframe-span"
        style={{ left: start * pixelsPerSecond, width: cue.duration * pixelsPerSecond }}
      />
      {!keys.length && (
        <span className="empty-key-lane" style={{ left: start * pixelsPerSecond + 10 }}>
          D{droneId} · add a key in the inspector
        </span>
      )}
      {keys
        .filter((key) => key.time <= cue.duration)
        .map((key) => (
          <button
            key={`${cue.id}:${droneId}:${key.time}`}
            className="keyframe-diamond"
            aria-label={`Drone ${droneId} keyframe at ${timecode(key.time)}`}
            title={`Scene time ${key.time.toFixed(3)}s · drag to retime`}
            style={{
              left: (start + (draft?.from === key.time ? draft.to : key.time)) * pixelsPerSecond,
            }}
            onPointerDown={(e) => {
              onEditStart();
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              gesture.current = { from: key.time, to: key.time, x: e.clientX, moved: false };
            }}
            onPointerMove={(e) => {
              const g = gesture.current;
              if (!g) return;
              if (Math.abs(e.clientX - g.x) > 3) g.moved = true;
              if (g.moved) {
                g.to = clamp(g.from + (e.clientX - g.x) / pixelsPerSecond, snap && !e.shiftKey);
                setDraft({ from: g.from, to: g.to });
              }
            }}
            onPointerUp={(e) => {
              const g = gesture.current;
              gesture.current = null;
              setDraft(null);
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
              if (g?.moved && g.to !== g.from) onMove(droneId, g.from, g.to);
              else onSeek(start + key.time);
            }}
            onPointerCancel={() => {
              gesture.current = null;
              setDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                onMove(
                  droneId,
                  key.time,
                  clamp(key.time + (e.key === 'ArrowRight' ? 1 : -1) / EDIT_FPS, false)
                );
              }
              if (e.key === 'Escape') {
                gesture.current = null;
                setDraft(null);
              }
            }}
            onClick={(e) => {
              if (e.detail === 0) onSeek(start + key.time);
            }}
          >
            <Diamond size={10} fill="currentColor" />
          </button>
        ))}
    </div>
  );
}
