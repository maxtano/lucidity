import { useEffect, useRef, useState } from 'react';
import { Camera, Download, Eye, FolderOpen, LoaderCircle, Package, X } from 'lucide-react';
import type { CapturedAudienceFrame } from '../core/frame-capture';
import {
  MAX_FRAME_ARTIFACT_BYTES,
  parseFrameArtifact,
  serializeFrameArtifact,
} from '../core/frame-artifact';
import { timecode } from '../core/timeline';
import { Modal } from './Modal';
import './ReviewFrameCapture.css';

type RetainedFrame = {
  blob: Blob;
  metadata: CapturedAudienceFrame['metadata'];
  pngUrl: string;
  jsonUrl: string;
  bundleUrl?: string;
  imported: boolean;
};
type JobKind = 'capture' | 'import' | 'export';
const jobLabel: Record<JobKind, string> = {
  capture: 'Capturing audience frame',
  import: 'Opening review file',
  export: 'Preparing review file',
};

function release(frame: RetainedFrame | null) {
  if (!frame) return;
  URL.revokeObjectURL(frame.pngUrl);
  URL.revokeObjectURL(frame.jsonUrl);
  if (frame.bundleUrl) URL.revokeObjectURL(frame.bundleUrl);
}

/** Structural validation precedes this bounded browser decode; the temporary URL is never retained. */
async function verifyDecodedFrame(frame: CapturedAudienceFrame, signal: AbortSignal) {
  if (signal.aborted)
    throw new DOMException('Opening the review file was cancelled.', 'AbortError');
  const image = new Image();
  const url = URL.createObjectURL(frame.blob);
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', aborted);
        image.removeAttribute('src');
        if (error) reject(error);
        else resolve();
      };
      const aborted = () =>
        finish(new DOMException('Opening the review file was cancelled.', 'AbortError'));
      const timer = setTimeout(
        () => finish(new Error('The review image took too long to decode.')),
        10_000
      );
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) {
        aborted();
        return;
      }
      image.src = url;
      try {
        void image.decode().then(
          () => {
            if (settled) return;
            if (
              image.naturalWidth !== frame.metadata.raster.width ||
              image.naturalHeight !== frame.metadata.raster.height
            )
              finish(new Error('The decoded image dimensions do not match the review metadata.'));
            else finish();
          },
          () => finish(new Error('The review file does not contain a decodable PNG image.'))
        );
      } catch {
        finish(new Error('The review image could not be decoded in this browser.'));
      }
    });
  } finally {
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

function download(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });

/** One local still, retained until a successful replacement or this preview closes. */
export function ReviewFrameCapture({
  capture,
  available = true,
}: {
  capture?: (signal: AbortSignal) => Promise<CapturedAudienceFrame>;
  /** Only capture depends on the renderer. Import and review work in every display mode. */
  available?: boolean;
}) {
  const [frame, setFrame] = useState<RetainedFrame | null>(null);
  const [pending, setPending] = useState<JobKind | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const captureRef = useRef(capture);
  const availableRef = useRef(available);
  const retained = useRef<RetainedFrame | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  captureRef.current = capture;
  availableRef.current = available;

  const cancel = (announce = true) => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setPending(null);
    if (announce) setStatus('Frame operation cancelled.');
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      controller.current?.abort();
      controller.current = null;
      release(retained.current);
      retained.current = null;
    };
  }, []);

  const beginJob = (kind: JobKind) => {
    cancel(false);
    const id = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setPending(kind);
    setError('');
    setStatus(`${jobLabel[kind]}.`);
    const current = () => mounted.current && generation.current === id && !abort.signal.aborted;
    return { id, abort, current };
  };
  const finishJob = (job: ReturnType<typeof beginJob>) => {
    if (mounted.current && generation.current === job.id) {
      controller.current = null;
      setPending(null);
    }
  };
  const failJob = (job: ReturnType<typeof beginJob>, cause: unknown) => {
    if (!job.current()) return;
    setError(
      cause instanceof Error ? cause.message : 'The frame operation could not be completed.'
    );
    setStatus('Frame operation failed.');
  };
  const retainFrame = (captured: CapturedAudienceFrame, imported: boolean) => {
    let pngUrl: string | undefined;
    let jsonUrl: string | undefined;
    try {
      // Own the sidecar before constructing URLs; later callers cannot rewrite a saved still.
      const metadata = structuredClone(captured.metadata);
      pngUrl = URL.createObjectURL(captured.blob);
      jsonUrl = URL.createObjectURL(
        new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' })
      );
      const next = { blob: captured.blob, metadata, pngUrl, jsonUrl, imported };
      const previous = retained.current;
      retained.current = next;
      setFrame(next);
      pngUrl = undefined;
      jsonUrl = undefined;
      release(previous);
      setStatus(
        imported ? 'Review file opened and integrity checked.' : 'Audience frame captured.'
      );
      setOpen(imported || availableRef.current);
    } finally {
      if (pngUrl) URL.revokeObjectURL(pngUrl);
      if (jsonUrl) URL.revokeObjectURL(jsonUrl);
    }
  };

  const begin = async () => {
    const captureFrame = captureRef.current;
    if (!availableRef.current || !captureFrame) return;
    const job = beginJob('capture');
    try {
      const captured = await captureFrame(job.abort.signal);
      if (job.current()) retainFrame(captured, false);
    } catch (cause) {
      failJob(job, cause);
    } finally {
      finishJob(job);
    }
  };

  const openFile = async (file: Blob) => {
    const job = beginJob('import');
    try {
      if (file.size > MAX_FRAME_ARTIFACT_BYTES)
        throw new Error(
          `Review files must be no larger than ${number(MAX_FRAME_ARTIFACT_BYTES / 1_048_576)} MiB.`
        );
      const imported = await parseFrameArtifact(file, job.abort.signal);
      if (!job.current()) return;
      await verifyDecodedFrame(imported, job.abort.signal);
      if (job.current()) retainFrame(imported, true);
    } catch (cause) {
      failJob(job, cause);
    } finally {
      finishJob(job);
    }
  };

  const prepareFile = async () => {
    const source = retained.current;
    if (!source) return;
    const job = beginJob('export');
    let url: string | undefined;
    try {
      const blob = await serializeFrameArtifact(
        { blob: source.blob, metadata: source.metadata },
        job.abort.signal
      );
      if (!job.current() || retained.current !== source) return;
      url = URL.createObjectURL(blob);
      const next = { ...source, bundleUrl: url };
      retained.current = next;
      setFrame(next);
      url = undefined;
      if (source.bundleUrl) URL.revokeObjectURL(source.bundleUrl);
      setStatus('Review file ready to download.');
    } catch (cause) {
      failJob(job, cause);
    } finally {
      if (url) URL.revokeObjectURL(url);
      finishJob(job);
    }
  };

  const metadata = frame?.metadata;
  const version = metadata?.version === 'base' ? 'Before' : 'Draft';
  const filename = metadata
    ? `lucidity-audience-${metadata.version}-${metadata.sampledTime.toFixed(3)}s-${metadata.createdAt.replace(/\D/g, '')}`
    : 'lucidity-audience-frame';
  const cancelLabel =
    pending === 'capture'
      ? 'Cancel frame capture'
      : pending === 'import'
        ? 'Cancel opening review file'
        : 'Cancel preparing review file';
  const errorNotice = error ? (
    <div className={open ? 'review-frame-dialog-error' : 'review-frame-error'} role="alert">
      <span>
        {error}
        {frame ? ' Your previous frame is retained.' : ''}
      </span>
      <button type="button" aria-label="Dismiss frame error" onClick={() => setError('')}>
        <X size={12} />
      </button>
    </div>
  ) : null;

  return (
    <div className="review-frame-capture">
      {capture && available && (
        <button
          type="button"
          aria-label="Capture audience frame"
          title={
            pending === 'capture' ? 'Capturing audience frame…' : 'Capture this audience frame'
          }
          disabled={Boolean(pending)}
          onClick={() => void begin()}
        >
          {pending === 'capture' ? (
            <LoaderCircle size={13} className="review-frame-pending" />
          ) : (
            <Camera size={13} />
          )}
        </button>
      )}
      <button
        type="button"
        aria-label="Open review file"
        title="Open a .lucid-frame review file"
        disabled={Boolean(pending)}
        onClick={() => fileInput.current?.click()}
      >
        {pending === 'import' ? (
          <LoaderCircle size={13} className="review-frame-pending" />
        ) : (
          <FolderOpen size={13} />
        )}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".lucid-frame"
        aria-label="Review file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void openFile(file);
        }}
      />
      {pending && (
        <button type="button" aria-label={cancelLabel} title={cancelLabel} onClick={() => cancel()}>
          <X size={12} />
        </button>
      )}
      {frame && (
        <button
          type="button"
          className="review-frame-open"
          aria-label="Review captured frame"
          title="Review the last captured frame"
          onClick={() => setOpen(true)}
        >
          <Eye size={13} />
        </button>
      )}
      <span className="review-frame-visually-hidden" role="status">
        {status}
      </span>
      {!open && errorNotice}
      {open && frame && metadata && (
        <Modal title="Captured audience frame" onClose={() => setOpen(false)}>
          <div
            className="review-frame-dialog"
            onKeyDown={(event) => {
              if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
            }}
          >
            <div className="review-frame-summary">
              <span className={metadata.version === 'draft' ? 'is-draft' : ''}>{version}</span>
              <strong>{metadata.scene.name}</strong>
              <span>Show {timecode(metadata.sampledTime)}</span>
              {metadata.held && <span>End frame held</span>}
            </div>
            {frame.imported && (
              <p className="review-frame-imported">
                Imported review · integrity checked
                <small>
                  Checksums verify the file’s consistency, not who created it. This is a saved image
                  and metadata review.
                </small>
              </p>
            )}
            <div className="review-frame-image">
              <img
                src={frame.pngUrl}
                alt={`${version} audience frame for ${metadata.scene.name} at ${metadata.sampledTime} seconds`}
                width={metadata.raster.width}
                height={metadata.raster.height}
              />
            </div>
            <dl className="review-frame-metadata">
              <div>
                <dt>Show timing</dt>
                <dd>
                  Shared {number(metadata.sharedTime)}s · sampled {number(metadata.sampledTime)}s
                  <small>Scene + {number(metadata.scene.localTime)}s</small>
                </dd>
              </div>
              <div>
                <dt>Audience position</dt>
                <dd>
                  E {number(metadata.viewer.pose.east)}m · N {number(metadata.viewer.pose.north)}m
                  <small>Eye height {number(metadata.viewer.pose.eyeHeight)}m</small>
                </dd>
              </div>
              <div>
                <dt>Camera</dt>
                <dd>
                  Yaw {number(metadata.viewer.pose.yaw)}° · pitch{' '}
                  {number(metadata.viewer.pose.pitch)}°
                  <small>Vertical field of view {number(metadata.viewer.pose.fov)}°</small>
                </dd>
              </div>
              <div>
                <dt>Image & framing</dt>
                <dd>
                  {metadata.raster.width.toLocaleString()} ×{' '}
                  {metadata.raster.height.toLocaleString()} px
                  <small>
                    {number(metadata.aspect)}:1 ·{' '}
                    {metadata.framing === 'captured' ? 'Captured frame' : 'Viewport frame'}
                  </small>
                </dd>
              </div>
              <div>
                <dt>Display appearance</dt>
                <dd>
                  Glow {number(metadata.appearance.glow)} · exposure{' '}
                  {number(metadata.appearance.exposure)}
                  <small>{metadata.droneCount.toLocaleString()} drones</small>
                </dd>
              </div>
              <div>
                <dt>Project at capture</dt>
                <dd>
                  {metadata.project.name} · r{metadata.project.revision}
                  <small>{new Date(metadata.createdAt).toLocaleString()}</small>
                </dd>
              </div>
            </dl>
            {errorNotice}
            <div className="review-frame-footer">
              <p>
                One frame is kept in memory. Review files bundle the PNG and its camera, timing, and
                display settings.
              </p>
              <div className="review-frame-downloads">
                {frame.bundleUrl ? (
                  <a
                    className="review-frame-bundle"
                    href={frame.bundleUrl}
                    download={`${filename}.lucid-frame`}
                  >
                    <Package size={12} /> Download review file
                  </a>
                ) : (
                  <button
                    type="button"
                    className="review-frame-bundle"
                    disabled={Boolean(pending)}
                    onClick={() => void prepareFile()}
                  >
                    <Package size={12} /> Prepare review file
                  </button>
                )}
                <button type="button" onClick={() => download(frame.pngUrl, `${filename}.png`)}>
                  <Download size={12} /> Download PNG
                </button>
                <button type="button" onClick={() => download(frame.jsonUrl, `${filename}.json`)}>
                  <Download size={12} /> Download JSON
                </button>
                {pending && (
                  <>
                    <button
                      type="button"
                      className="review-frame-cancel"
                      aria-label={cancelLabel}
                      onClick={() => cancel()}
                    >
                      <X size={12} /> Cancel
                    </button>
                    <span className="review-frame-job-status">
                      <LoaderCircle size={11} className="review-frame-pending" />
                      {jobLabel[pending]}…
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
