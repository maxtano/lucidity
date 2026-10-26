import { Check, Eye, EyeOff, Plus, RotateCcw, X } from 'lucide-react';
import type { AudienceHighlight } from '../core/audience-highlight';
import './AudienceHighlightControls.css';

const regionLabels = {
  in_frame: 'Camera frame',
  front: 'Front',
  right: 'Right',
  rear: 'Behind',
  left: 'Left',
  overhead: 'Overhead',
};
const lightLabels = { any: 'any light state', on: 'lights on', off: 'lights off' };
const seconds = (value: number) => Number(value.toPrecision(8)).toString();

/** Captured membership, current positions. These controls only affect display and selection. */
export function AudienceHighlightControls({
  target,
  time,
  enabled,
  onToggle,
  onClear,
  onSelect,
  onRecall,
}: {
  target: AudienceHighlight;
  time: number;
  enabled: boolean;
  onToggle: () => void;
  onClear: () => void;
  onSelect: (additive: boolean) => void;
  onRecall?: () => void;
}) {
  return (
    <section
      className="audience-highlight-controls"
      aria-label="Audience match preview"
      onKeyDown={(event) => {
        if (event.key !== 'Tab' && event.key !== 'Escape') event.stopPropagation();
      }}
    >
      <div className="audience-highlight-heading">
        <strong>
          <i aria-hidden="true" />
          {target.ids.length.toLocaleString()} matched drones
        </strong>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear audience match preview"
          title="Clear preview"
        >
          <X size={13} />
        </button>
      </div>
      <p>
        {regionLabels[target.request.region]} · {lightLabels[target.request.lights]} ·{' '}
        {target.request.scopeIds === undefined ? 'active fleet' : 'captured selection'}
      </p>
      <p className="audience-highlight-clock">
        Matched at {seconds(target.request.time)}s · positions at {seconds(time)}s
      </p>
      <div className="audience-highlight-actions">
        <button
          type="button"
          onClick={onToggle}
          aria-label="Show audience match markers"
          aria-pressed={enabled}
        >
          {enabled ? <Eye size={12} /> : <EyeOff size={12} />}
          {enabled ? 'Hide marks' : 'Show marks'}
        </button>
        <button
          type="button"
          onClick={() => onSelect(false)}
          title="Replace selection with every captured match"
        >
          <Check size={12} />
          Replace
        </button>
        <button
          type="button"
          onClick={() => onSelect(true)}
          title="Add every captured match to the current selection"
        >
          <Plus size={12} />
          Add
        </button>
      </div>
      <details>
        <summary>Captured result</summary>
        <p>
          Fixed IDs from revision {target.revision}. Marks follow their current positions, including
          lights that are off. The query does not update as the show or camera moves.
        </p>
        <p>Markers ignore venue occlusion. They are an editing aid and do not change the lights.</p>
        <p>
          Captured aspect {seconds(target.request.aspect)}:1. The current viewport controls framing.
        </p>
        {onRecall && (
          <button type="button" onClick={onRecall}>
            <RotateCcw size={12} />
            Recall query view and time
          </button>
        )}
      </details>
    </section>
  );
}
