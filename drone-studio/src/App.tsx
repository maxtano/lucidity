import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Copy,
  Download,
  Ellipsis,
  FileJson,
  FolderOpen,
  Home,
  Layers3,
  LayoutGrid,
  LoaderCircle,
  Plus,
  PanelLeft,
  PanelRight,
  Radio,
  Redo2,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { AudioEngine, type TrackInfo } from './audio/engine';
import { applyOperations, type Operation } from './core/commands';
import { parseProjectFile, projectBundle } from './core/export';
import {
  cueStart,
  defaultProject,
  formatTime,
  frameAt,
  paletteColors,
  palettes,
  shapeNames,
  shapes,
  totalDuration,
  type Cue,
  type Project,
  type Shape,
  type DroneEdit,
  type DroneKeyframe,
  type Vector3Tuple,
} from './core/model';
import type { ValidationReport } from './core/validation';
import { FormationThumb } from './components/FormationThumb';
import { Modal } from './components/Modal';
import { Stage } from './components/Stage';
import { Timeline } from './components/Timeline';
import { EDIT_FPS, reorderOperations } from './core/timeline';
import { DroneInspector, SelectionPicker } from './components/DroneInspector';
import { SceneSource } from './components/SceneSource';
import { TransitionInspector } from './components/TransitionInspector';
import { ImmersiveStudy } from './components/ImmersiveStudy';
import { AircraftPanel } from './components/AircraftPanel';
import { compileStoryboardBenchPlan, createBenchStoryboard } from './core/bench-storyboard';
import { createZorroStopStoryboard, isZorroStopStoryboard } from './core/zorro-test';
import { StoryboardMotorPreview } from './components/StoryboardMotorPreview';
import { ZorroStopPreview } from './components/ZorroStopPreview';
import { isOneFootHoverStoryboard } from './components/first-flight-preview';
import { createFirstLiveHoverStoryboard, isFirstLiveHoverStoryboard } from './core/first-live-show';
import { StudioHome } from './components/StudioHome';
import { WorkspaceNavigation, useWorkspaceNavigation } from './platform/WorkspaceNavigation';
import {
  createStoryboard,
  deleteStoryboard,
  loadDeletedStoryboards,
  loadStoryboards,
  resolveInitialStoryboard,
  restoreStoryboard,
  saveStoryboard,
  shouldPersistInitialStoryboard,
  type StoredStoryboard,
} from './core/storyboards';

const STORAGE_KEY = 'lucidity.studio.project.v1';
function initialProject(storage: Storage): Project {
  return resolveInitialStoryboard(storage, STORAGE_KEY, defaultProject);
}
function download(name: string, contents: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export default function App({
  active = true,
  onPlatformHome,
  storage = localStorage,
}: {
  storage?: Storage;
  active?: boolean;
  onPlatformHome?: () => void;
}) {
  const navigation = useWorkspaceNavigation();
  const WorkspaceElement = navigation ? 'div' : 'main';
  const [homeOpen, setHomeOpen] = useState(true);
  const [storyboards, setStoryboards] = useState<StoredStoryboard[]>(() => {
    try {
      return loadStoryboards(storage);
    } catch {
      return [];
    }
  });
  const [libraryError, setLibraryError] = useState('');
  const [deletedStoryboards, setDeletedStoryboards] = useState<StoredStoryboard[]>(() => {
    try { return loadDeletedStoryboards(storage); }
    catch { return []; }
  });
  // An intentionally empty library must stay empty after deleting the last show.
  const [autosaveEnabled, setAutosaveEnabled] = useState(() =>
    shouldPersistInitialStoryboard(storage, STORAGE_KEY)
  );
  const [project, setProject] = useState(() => initialProject(storage)),
    [history, setHistory] = useState<Project[]>([]),
    [future, setFuture] = useState<Project[]>([]);
  const projectRef = useRef(project);
  projectRef.current = project;
  const importEpoch = useRef(0);
  const audioImportEpoch = useRef(0);
  const playbackEpoch = useRef(0);
  const playbackPending = useRef(false);
  const audioProjectId = useRef(project.id);
  const [browserOpen, setBrowserOpen] = useState(true),
    [panelOpen, setPanelOpen] = useState(true),
    [focused, setFocused] = useState(false);
  const [selected, setSelected] = useState(
    () => project.cues[Math.min(1, project.cues.length - 1)].id
  );
  const [time, setTime] = useState(34),
    [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(false);
  const [tab, setTab] = useState<'inspector' | 'review'>('inspector');
  const [modal, setModal] = useState<
    'library' | 'export' | 'project' | 'source' | 'study' | 'aircraft' | 'new-storyboard' | null
  >(null);
  const [droneSelection, setDroneSelection] = useState<number[]>([]),
    [autoKey, setAutoKey] = useState(true);
  const [report, setReport] = useState<ValidationReport | null>(null),
    [checking, setChecking] = useState(true),
    [checkError, setCheckError] = useState('');
  const [track, setTrack] = useState<TrackInfo | null>(null),
    [toast, setToast] = useState(''),
    [saved, setSaved] = useState(true),
    [exporting, setExporting] = useState(false);
  const audio = useRef(new AudioEngine()),
    playingRef = useRef(false),
    timeRef = useRef(time),
    durationRef = useRef(totalDuration(project));
  const soundtrackInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    exportWorker = useRef<Worker | null>(null);
  const cue = project.cues.find((c) => c.id === selected) || project.cues[0],
    activeFrame = frameAt(project, time),
    duration = totalDuration(project);
  const hasMotorCues = project.cues.some((scene) => scene.benchCue);
  const runActionLabel = hasMotorCues || isZorroStopStoryboard(project) ? 'Run storyboard' : 'Flight readiness';
  const motorPlan = useMemo(() => {
    try { return { plan: compileStoryboardBenchPlan(project), error: '' }; }
    catch (error) { return { plan: undefined, error: errorMessage(error) }; }
  }, [project]);
  timeRef.current = time;
  durationRef.current = duration;
  useEffect(
    () => setDroneSelection((ids) => ids.filter((id) => id <= project.droneCount)),
    [project.droneCount]
  );
  useEffect(() => {
    if (droneSelection.length) setSelected(activeFrame.cue.id);
  }, [activeFrame.cue.id, droneSelection]);
  useEffect(() => {
    if (!autosaveEnabled) return;
    try {
      const library = saveStoryboard(storage, project);
      storage.setItem(STORAGE_KEY, JSON.stringify(project));
      setStoryboards(library);
      setLibraryError('');
      setSaved(true);
    } catch (error) {
      setSaved(false);
      setLibraryError(
        `Could not save this storyboard. ${errorMessage(error)} Your open work remains in memory; export it before closing.`
      );
    }
  }, [project, autosaveEnabled, storage]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4400);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    try {
      setTrack(audio.current.loadDemo());
    } catch {
      setToast('Audio is unavailable in this browser. You can still preview the choreography.');
    }
    return () => {
      ++audioImportEpoch.current;
      ++playbackEpoch.current;
      playbackPending.current = false;
      audio.current.dispose();
      exportWorker.current?.terminate();
    };
  }, []);
  useEffect(() => {
    if (audioProjectId.current === project.id) return;
    audioProjectId.current = project.id;
    audio.current.dispose();
    audio.current = new AudioEngine();
    audio.current.setMuted(muted);
    setTrack(null);
    try {
      setTrack(audio.current.loadDemo());
    } catch {
      setToast('Audio is unavailable. You can still preview the choreography.');
    }
  }, [project.id, muted]);
  useEffect(() => {
    setReport(null);
    setChecking(true);
    setCheckError('');
    const worker = new Worker(new URL('./core/review.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event) => {
      if (event.data.error) setCheckError(event.data.error);
      else setReport(event.data.result);
      setChecking(false);
      worker.terminate();
    };
    worker.onerror = () => {
      setCheckError('Design review could not finish. Try editing a scene to run it again.');
      setChecking(false);
      worker.terminate();
    };
    const timer = setTimeout(
      () => worker.postMessage({ requestId: project.revision, type: 'validate', project }),
      300
    );
    return () => {
      clearTimeout(timer);
      worker.terminate();
    };
  }, [project]);
  const pause = useCallback(() => {
    ++playbackEpoch.current;
    playbackPending.current = false;
    audio.current.pause();
    playingRef.current = false;
    setPlaying(false);
  }, []);
  const resumeAt = useCallback(
    async (start: number) => {
      pause();
      const engine = audio.current;
      const sourceId = projectRef.current.id;
      const epoch = ++playbackEpoch.current;
      playbackPending.current = true;
      const current = () =>
        epoch === playbackEpoch.current &&
        engine === audio.current &&
        sourceId === projectRef.current.id;
      try {
        const started = await engine.play(start);
        if (!started || !current()) return;
        timeRef.current = start;
        setTime(start);
        playingRef.current = true;
        setPlaying(true);
      } catch (error) {
        if (current()) setToast(`Could not play audio: ${errorMessage(error)}`);
      } finally {
        if (current()) playbackPending.current = false;
      }
    },
    [pause]
  );
  const seek = useCallback(
    (value: number) => {
      const next = Math.max(0, Math.min(durationRef.current, value));
      setTime(next);
      timeRef.current = next;
      if (playingRef.current || playbackPending.current) void resumeAt(next);
    },
    [resumeAt]
  );
  const play = useCallback(async () => {
    if (playingRef.current || playbackPending.current) {
      pause();
      return;
    }
    const start = timeRef.current >= durationRef.current ? 0 : timeRef.current;
    await resumeAt(start);
  }, [pause, resumeAt]);
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const tick = () => {
      const t = audio.current.time();
      if (t >= durationRef.current) {
        setTime(durationRef.current);
        pause();
        return;
      }
      setTime(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, pause]);
  useEffect(() => {
    setTime((t) => Math.min(t, duration));
    if (playingRef.current || playbackPending.current) pause();
  }, [project, duration, pause]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.defaultPrevented ||
        target.closest(
          'input,textarea,select,[contenteditable="true"],#workspace-sidebar,.shell-mobile-bar'
        ) ||
        document.querySelector('[role="dialog"]') ||
        !active ||
        homeOpen ||
        modal
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setFocused((value) => !value);
      }
      if (e.key === 'Escape') setFocused(false);
      if (e.code === 'Space') {
        e.preventDefault();
        void play();
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seek(timeRef.current - (e.shiftKey ? 1 : 1 / EDIT_FPS));
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        seek(timeRef.current + (e.shiftKey ? 1 : 1 / EDIT_FPS));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, homeOpen, modal, play, seek, project, history, future]);
  useEffect(() => {
    if (!active) {
      pause();
      setModal(null);
    }
  }, [active, pause]);

  function commit(operations: Operation[], revision = project.revision) {
    if (!operations.length) return false;
    try {
      const next = applyOperations(project, operations, revision);
      setHistory((h) => [...h.slice(-29), project]);
      setFuture([]);
      setProject(next);
      return true;
    } catch (error) {
      setToast(errorMessage(error));
      return false;
    }
  }
  function updateCue(patch: Partial<Cue>) {
    commit([{ type: 'update_cue', id: cue.id, patch }]);
  }
  function pickDrones(ids: number[], additive = false) {
    pause();
    setSelected(activeFrame.cue.id);
    setDroneSelection((current) =>
      additive
        ? [
            ...current.filter((id) => !ids.includes(id)),
            ...ids.filter((id) => !current.includes(id)),
          ]
        : ids
    );
    setTab('inspector');
    setPanelOpen(true);
  }
  function editDrones(patch: DroneEdit) {
    const localTime = Math.max(0, Math.min(cue.duration, time - cueStart(project, cue.id)));
    if (autoKey)
      commit([
        {
          type: 'set_keyframe',
          cueId: cue.id,
          ids: droneSelection,
          keyframe: { ...patch, time: localTime },
        },
      ]);
    else commit([{ type: 'edit_drones', cueId: cue.id, ids: droneSelection, patch }]);
  }
  function moveDrones(updates: { id: number; position: Vector3Tuple }[], targetCue = cue) {
    const localTime = Math.max(
      0,
      Math.min(targetCue.duration, time - cueStart(project, targetCue.id))
    );
    commit(
      updates.map(({ id, position }) =>
        autoKey
          ? {
              type: 'set_keyframe',
              cueId: targetCue.id,
              ids: [id],
              keyframe: { time: localTime, position, easing: 'smooth' },
            }
          : { type: 'edit_drones', cueId: targetCue.id, ids: [id], patch: { position } }
      )
    );
  }
  function keyDrones(updates: { id: number; keyframe: DroneKeyframe }[]) {
    commit(
      updates.map(({ id, keyframe }) => ({
        type: 'set_keyframe',
        cueId: cue.id,
        ids: [id],
        keyframe,
      }))
    );
  }
  function openSource() {
    pause();
    setModal('source');
  }
  async function openExpertStudy() {
    const epoch = ++importEpoch.current;
    try {
      const response = await fetch('/examples/prismatic-study.lucid.json');
      if (!response.ok) throw new Error('The example could not be loaded.');
      const next = parseProjectFile(await response.text());
      if (epoch !== importEpoch.current) return;
      if (autosaveEnabled) saveStoryboard(storage, projectRef.current);
      const imported = { ...next, id: crypto.randomUUID(), revision: 0 };
      activateStoryboard(imported, saveStoryboard(storage, imported));
      setTab('inspector');
      setToast('Expert study opened as a new storyboard. Your previous work is saved on Home.');
    } catch (error) {
      if (epoch === importEpoch.current) setToast(errorMessage(error));
    }
  }
  function chooseCue(id: string) {
    setSelected(id);
    const c = project.cues.find((item) => item.id === id)!;
    seek(cueStart(project, id) + Math.min(c.transition + 0.1, c.duration - 0.1));
  }
  function addShape(shape: Shape) {
    const added: Cue = {
      id: crypto.randomUUID(),
      name: shapeNames[shape],
      shape,
      palette: 'aurora',
      duration: 16,
      transition: 12,
      scale: 72,
      altitude: 64,
    };
    if (commit([{ type: 'add_cue', cue: added }])) {
      setSelected(added.id);
      setModal(null);
      setTab('inspector');
      setTime(duration + Math.min(added.transition + 0.1, added.duration - 0.1));
      setToast(`${shapeNames[shape]} added to your storyboard`);
    }
  }
  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [...items, project]);
    setProject({ ...previous, revision: project.revision + 1 });
    setHistory((h) => h.slice(0, -1));
    setToast('Last edit undone');
  }
  function redo() {
    const next = future.at(-1);
    if (!next) return;
    setHistory((items) => [...items.slice(-29), project]);
    setFuture((items) => items.slice(0, -1));
    setProject({ ...next, revision: project.revision + 1 });
    setToast('Edit restored');
  }
  function openPanel(next: typeof tab) {
    setTab(next);
    setPanelOpen(true);
    setFocused(false);
  }
  async function importAudio(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    pause();
    const epoch = ++audioImportEpoch.current;
    const engine = audio.current;
    const sourceId = projectRef.current.id;
    try {
      setToast('Preparing your soundtrack…');
      const nextTrack = await engine.loadFile(file);
      if (
        !nextTrack ||
        epoch !== audioImportEpoch.current ||
        engine !== audio.current ||
        sourceId !== projectRef.current.id
      )
        return;
      setTrack(nextTrack);
      seek(0);
      setToast('Soundtrack ready. Set its BPM in Show settings to align the light pulse.');
    } catch (error) {
      if (
        epoch === audioImportEpoch.current &&
        engine === audio.current &&
        sourceId === projectRef.current.id
      )
        setToast(errorMessage(error));
    }
  }
  async function importProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const epoch = ++importEpoch.current;
    try {
      if (file.size > 32_000_000) throw new Error('Project files must be smaller than 32 MB.');
      const next = parseProjectFile(await file.text());
      if (epoch !== importEpoch.current) return;
      if (autosaveEnabled) saveStoryboard(storage, projectRef.current);
      const imported = { ...next, id: crypto.randomUUID(), revision: 0 };
      activateStoryboard(imported, saveStoryboard(storage, imported));
      setToast('Storyboard imported as a new copy. Attach its soundtrack separately.');
    } catch (error) {
      if (epoch === importEpoch.current) setToast(`Could not open project. ${errorMessage(error)}`);
    }
  }
  function exportCsv() {
    setExporting(true);
    const worker = new Worker(new URL('./core/review.worker.ts', import.meta.url), {
      type: 'module',
    });
    exportWorker.current = worker;
    worker.onmessage = (event) => {
      setExporting(false);
      if (event.data.error) setToast(event.data.error);
      else {
        download(`${project.name}.preview.csv`, event.data.result, 'text/csv');
        setToast('Simulation trajectories exported');
      }
      worker.terminate();
      exportWorker.current = null;
    };
    worker.onerror = () => {
      setExporting(false);
      setToast('The trajectory export could not finish. Try a smaller fleet.');
      worker.terminate();
    };
    worker.postMessage({ type: 'csv', project });
  }
  const issues = report?.checks.filter((c) => c.status === 'fail').length || 0;

  function showHome() {
    pause();
    setModal(null);
    setHomeOpen(true);
  }

  function openStoryboard(id: string) {
    try {
      const library = autosaveEnabled ? saveStoryboard(storage, project) : loadStoryboards(storage);
      const entry = library.find((item) => item.project.id === id);
      if (!entry) throw new Error('This storyboard is no longer in local storage.');
      activateStoryboard(entry.project, library);
    } catch (error) {
      setLibraryError(`Could not open storyboard. ${errorMessage(error)}`);
    }
  }

  function activateStoryboard(next: Project, library: StoredStoryboard[]) {
    ++importEpoch.current;
    pause();
    setStoryboards(library);
    setAutosaveEnabled(true);
    if (!autosaveEnabled || next.id !== project.id) {
      setHistory([]);
      setFuture([]);
      setProject(structuredClone(next));
      setSelected(next.cues[0].id);
      setDroneSelection([]);
      setTime(0);
      setFocused(false);
      setToast(next.cues.some((scene) => scene.benchCue) ? 'Storyboard opened. Preview the sequence, then Run storyboard.' : 'Storyboard opened. Attach its soundtrack separately if needed.');
    }
    setModal(null);
    setHomeOpen(false);
    setLibraryError('');
  }

  function newStoryboard(kind: 'blank' | 'motor' | 'zorro-stop' | 'flight-hover' = 'blank') {
    try {
      const library = autosaveEnabled ? saveStoryboard(storage, project) : loadStoryboards(storage);
      const next = kind === 'motor' ? createBenchStoryboard('First drone test')
        : kind === 'zorro-stop' ? createZorroStopStoryboard()
          : kind === 'flight-hover' ? createFirstLiveHoverStoryboard()
          : createStoryboard(`Untitled storyboard ${library.length + 1}`);
      activateStoryboard(next, saveStoryboard(storage, next));
      setToast(kind === 'motor' ? 'First drone test saved. Preview the timeline, then Run storyboard.'
        : kind === 'zorro-stop' ? 'Props-off idle storyboard saved. Assign a drone in Run storyboard.'
          : kind === 'flight-hover' ? 'First live hover saved as a design candidate. Preview and check flight readiness.'
          : 'New storyboard created. Click its title to name your show.');
    } catch (error) {
      setLibraryError(
        `Could not create a storyboard. ${errorMessage(error)} Your current storyboard is unchanged.`
      );
    }
  }

  function openStarterStoryboard() {
    const existing = storyboards.find(({ project: item }) => item.name === 'First drone test' && item.cues.some((scene) => scene.benchCue));
    if (existing) openStoryboard(existing.project.id);
    else newStoryboard('motor');
  }

  function removeStoryboard(id: string): boolean {
    try {
      // Do not discard a newer in-memory revision after an earlier autosave failure.
      if (autosaveEnabled && id === projectRef.current.id)
        saveStoryboard(storage, projectRef.current);
      const library = deleteStoryboard(storage, id);
      setStoryboards(library);
      setDeletedStoryboards(loadDeletedStoryboards(storage));
      if (id === project.id) {
        const next = library.reduce<StoredStoryboard | undefined>(
          (latest, item) => !latest || item.updatedAt > latest.updatedAt ? item : latest,
          undefined
        );
        if (next) activateStoryboard(next.project, library);
        else {
          ++importEpoch.current;
          pause();
          setAutosaveEnabled(false);
          setProject(createStoryboard());
          setHistory([]);
          setFuture([]);
          setDroneSelection([]);
          setTime(0);
          setModal(null);
        }
        setHomeOpen(true);
      }
      setLibraryError('');
      setToast('Storyboard moved to Recently deleted.');
      return true;
    } catch (error) {
      setLibraryError(`Could not delete storyboard. ${errorMessage(error)}`);
      return false;
    }
  }

  function recoverStoryboard(id: string): boolean {
    try {
      const library = restoreStoryboard(storage, id);
      setStoryboards(library);
      setDeletedStoryboards(loadDeletedStoryboards(storage));
      const restored = library.find((item) => item.project.id === id);
      if (!autosaveEnabled && restored) {
        activateStoryboard(restored.project, library);
        setHomeOpen(true);
      }
      setLibraryError('');
      setToast('Storyboard restored.');
      return true;
    } catch (error) {
      setLibraryError(`Could not restore storyboard. ${errorMessage(error)}`);
      return false;
    }
  }

  const entries = !autosaveEnabled || storyboards.some((entry) => entry.project.id === project.id)
    ? storyboards
    : [...storyboards, { project, updatedAt: 0 }];
  const home = homeOpen ? (
    <>
      <StudioHome
        embedded={!!navigation}
        storyboards={entries.map(({ project: item, updatedAt }) => ({
          id: item.id,
          name: item.name,
          droneCount: item.droneCount,
          sceneCount: item.cues.length,
          duration: totalDuration(item),
          updatedAt,
          bench: item.cues.some((scene) => !!scene.benchCue) || isZorroStopStoryboard(item),
          flightStudy: isOneFootHoverStoryboard(item),
          flightCandidate: isFirstLiveHoverStoryboard(item),
        }))}
        activeId={project.id}
        deletedStoryboards={deletedStoryboards.map(({ project: item, updatedAt }) => ({
          id: item.id,
          name: item.name,
          droneCount: item.droneCount,
          sceneCount: item.cues.length,
          duration: totalDuration(item),
          updatedAt,
        }))}
        onOpen={openStoryboard}
        onDelete={removeStoryboard}
        onRestore={recoverStoryboard}
        onCreate={() => { setHomeOpen(false); setModal('new-storyboard'); }}
        onOpenStarter={openStarterStoryboard}
        onImport={() => projectInput.current?.click()}
      />
      {libraryError && (
        <div className="home-storage-error" role="alert">
          {libraryError}
          {autosaveEnabled && <button onClick={() => setHomeOpen(false)}>Return to open storyboard</button>}
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  ) : null;

  return (
    <>
      {navigation && homeOpen && (
        <WorkspaceNavigation active={active}>
          <nav
            className="app-local-navigation show-library-navigation"
            aria-label="Drone Show navigation"
          >
            <div className="navigation-current">
              <FolderOpen size={15} />
              Storyboards<span className="navigation-count">{entries.length}</span>
            </div>
            {autosaveEnabled && <>
            <h2 className="navigation-section-title">Open storyboard</h2>
            <button
              className="navigation-project"
              onClick={() => {
                setHomeOpen(false);
                navigation.dismiss();
              }}
            >
              <Layers3 size={16} />
              <span>
                <strong>{project.name}</strong>
                <small>
                  {project.cues.length} {project.cues.length === 1 ? 'scene' : 'scenes'} · Resume
                  editing
                </small>
              </span>
              <ArrowRight size={13} />
            </button>
            </>}
            <h2 className="navigation-section-title">Create</h2>
            <button
              onClick={() => {
                setHomeOpen(false);
                setModal('new-storyboard');
                navigation.dismiss();
              }}
            >
              <Plus size={15} />
              New storyboard
            </button>
            <button onClick={() => projectInput.current?.click()}>
              <Upload size={15} />
              Import a show
            </button>
          </nav>
        </WorkspaceNavigation>
      )}
      {home}
      <div
        style={{ display: homeOpen ? 'none' : undefined }}
        className={`app-shell pro-editor ${!browserOpen || focused ? 'browser-hidden' : ''} ${!panelOpen || focused ? 'panel-hidden' : ''} ${focused ? 'viewer-focused' : ''}`}
      >
        {!navigation && (
          <header className="app-header">
            <a
              className="brand"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                if (onPlatformHome) {
                  pause();
                  onPlatformHome();
                } else showHome();
              }}
              aria-label="Lucidity home"
            >
              <span className="brand-symbol">✳</span>
              <span>
                lucidity<span className="brand-period">.</span>
              </span>
            </a>
            <span className="header-slash">/</span>
            <span className="product-label">Drone Show</span>
            <span className="beta-badge">PREVIEW</span>
            <div className="header-center">
              <button onClick={showHome}>
                <Home size={14} /> Storyboards
              </button>
              <button
                className={tab !== 'review' ? 'active' : ''}
                onClick={() => openPanel('inspector')}
              >
                Studio
              </button>
              <button
                className={tab === 'review' ? 'active' : ''}
                onClick={() => openPanel('review')}
              >
                Review {issues > 0 && <span className="tiny-indicator" />}
              </button>
              <button
                onClick={() => {
                  pause();
                  setModal('aircraft');
                }}
              >
                <Radio size={14} /> {runActionLabel}
              </button>
            </div>
            <div className="header-actions">
              <span className="saved-label">
                {saved ? <Check size={13} /> : <Circle size={11} />}
                {saved ? 'Saved locally' : 'Export to save'}
              </span>
              <button className="export-button" onClick={() => setModal('export')}>
                Export show <ArrowUpRight size={15} />
              </button>
              <button
                className="avatar"
                title="Project settings"
                aria-label="Project settings"
                onClick={() => setModal('project')}
              >
                L
              </button>
            </div>
          </header>
        )}
        {modal === 'aircraft' && <AircraftPanel project={project} saved={saved} onClose={() => setModal(null)} />}
        <div className="workspace">
          <WorkspaceNavigation active={active && !homeOpen}>
            <aside
              className={navigation ? 'show-app-navigation' : 'sidebar'}
              onClick={() => navigation?.dismiss()}
            >
              {navigation && (
                <nav className="app-local-navigation" aria-label="Drone Show navigation">
                  <button
                    onClick={() => {
                      showHome();
                      navigation.dismiss();
                    }}
                  >
                    <FolderOpen size={15} />
                    All storyboards
                  </button>
                </nav>
              )}
              <button className="project-switcher" onClick={() => setModal('project')}>
                <span className="project-icon">
                  <AudioLines size={18} />
                </span>
                <span>
                  <strong>{project.name}</strong>
                  <small>
                    {project.cues.length} scenes · {formatTime(duration)}
                  </small>
                </span>
                <ChevronDown size={14} />
              </button>
              <div className="sidebar-nav">
                <button
                  className={tab !== 'review' ? 'active' : ''}
                  onClick={() => {
                    openPanel('inspector');
                    navigation?.dismiss();
                  }}
                >
                  <Layers3 size={16} />
                  Storyboard <span>{project.cues.length}</span>
                </button>
                {navigation && (
                  <>
                    <button
                      className={tab === 'review' ? 'active' : ''}
                      onClick={() => {
                        openPanel('review');
                        navigation.dismiss();
                      }}
                    >
                      <ShieldCheck size={16} />
                      Design checks<span>{issues}</span>
                    </button>
                    <button
                      onClick={() => {
                        pause();
                        setModal('aircraft');
                        navigation.dismiss();
                      }}
                    >
                      <Radio size={16} />
                      {runActionLabel}
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    setModal('library');
                    navigation?.dismiss();
                  }}
                >
                  <LayoutGrid size={16} />
                  Formation library <ArrowUpRight size={13} />
                </button>
                <button onClick={() => soundtrackInput.current?.click()}>
                  <MusicIcon />
                  Music & audio <Plus size={13} />
                </button>
              </div>
              <div className="sidebar-section-title">
                <span>SCENE BROWSER</span>
                <button
                  className="icon-button"
                  aria-label="Add scene"
                  onClick={() => setModal('library')}
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className="scene-list">
                {project.cues.map((item, index) => (
                  <button
                    key={item.id}
                    className={`scene-card ${cue.id === item.id ? 'selected' : ''}`}
                    onClick={() => {
                      chooseCue(item.id);
                      navigation?.dismiss();
                    }}
                  >
                    <div className="scene-thumbnail">
                      <FormationThumb cue={item} />
                      <span>{String(index + 1).padStart(2, '0')}</span>
                    </div>
                    <div className="scene-card-info">
                      <strong>{item.name}</strong>
                      <span>
                        {formatTime(item.duration)} <i /> {hasMotorCues ? (item.benchCue ? `Motor ${String.fromCharCode(64 + item.benchCue.motor)} · +${item.benchCue.offset}s` : 'Wait') : shapeNames[item.shape]}
                      </span>
                    </div>
                    {cue.id === item.id && <span className="scene-active-dot" />}
                  </button>
                ))}
              </div>
              <button className="add-scene" onClick={() => setModal('library')}>
                <Plus size={14} />
                Add a scene
              </button>
              <div className="sidebar-bottom">
                <div className="fleet-summary">
                  <span className="fleet-icon">
                    <Radio size={17} />
                  </span>
                  <div>
                    <strong>{project.droneCount.toLocaleString()} drones</strong>
                    <small>Virtual fleet</small>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Configure fleet"
                    onClick={() => setModal('project')}
                  >
                    <Settings2 size={15} />
                  </button>
                </div>
                <button
                  className="sidebar-bottom-link"
                  onClick={() => {
                    setModal('project');
                  }}
                >
                  <BookOpen size={14} />
                  Project & creative brief <ArrowUpRight size={13} />
                </button>
                <div className="studio-version">
                  <span className="live-dot" />
                  SIMULATION<span>v0.4</span>
                </div>
              </div>
            </aside>
          </WorkspaceNavigation>
          <WorkspaceElement className="main-workspace">
            <div className="workspace-toolbar">
              <div className="breadcrumbs">
                <button
                  className="icon-button"
                  aria-label="Toggle scene browser"
                  title="Scene browser"
                  aria-pressed={navigation ? navigation.expanded : browserOpen && !focused}
                  onClick={() => {
                    if (navigation) {
                      navigation.toggle();
                      return;
                    }
                    if (focused) {
                      setFocused(false);
                      setBrowserOpen(true);
                    } else setBrowserOpen(!browserOpen);
                  }}
                >
                  <PanelLeft size={15} />
                </button>
                <strong>{project.name}</strong>
                <span className="draft-pill">Draft</span>
              </div>
              <div className="workspace-toolbar-actions">
                {navigation && <button className="show-export-button" onClick={() => { pause(); setModal('aircraft'); }}><Radio size={14} />{runActionLabel}</button>}
                {navigation && (
                  <button className="show-export-button" onClick={() => setModal('export')}>
                    Export
                    <ArrowUpRight size={13} />
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label="Undo last edit"
                  disabled={!history.length}
                  onClick={undo}
                >
                  <Undo2 size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Redo last edit"
                  title="Redo · ⇧⌘Z"
                  disabled={!future.length}
                  onClick={redo}
                >
                  <Redo2 size={15} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Scene source"
                  title="Scene source"
                  onClick={openSource}
                >
                  <Code2 size={15} />
                </button>
                <span className="toolbar-divider" />
                <button
                  className={tab === 'inspector' ? 'small-button active' : 'small-button'}
                  onClick={() => openPanel('inspector')}
                >
                  <SlidersHorizontal size={14} />
                  Inspector
                </button>
                <button
                  className="icon-button"
                  aria-label="Show settings"
                  onClick={() => setModal('project')}
                >
                  <Ellipsis size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Toggle editing panel"
                  title="Editing panel"
                  aria-pressed={panelOpen && !focused}
                  onClick={() => {
                    if (focused) {
                      setFocused(false);
                      setPanelOpen(true);
                    } else setPanelOpen(!panelOpen);
                  }}
                >
                  <PanelRight size={15} />
                </button>
              </div>
            </div>
            <div className="design-area">
              {isZorroStopStoryboard(project) ? <ZorroStopPreview project={project} /> : hasMotorCues ? (
                <div className="storyboard-motor-stage">
                  {motorPlan.plan ? <StoryboardMotorPreview plan={motorPlan.plan} time={time} onSeek={seek} /> : <div className="motor-plan-error" role="alert"><h2>Check motor timing</h2><p>{motorPlan.error}</p><p>Edit the scene’s motor cue or duration to continue.</p></div>}
                </div>
              ) : <Stage
                project={project}
                time={time}
                playing={playing}
                focused={focused}
                onFocus={() => setFocused(!focused)}
                selection={droneSelection}
                onPick={pickDrones}
                onTransform={(updates) => moveDrones(updates, activeFrame.cue)}
                onEditStart={pause}
                onSeek={seek}
                onOpenStudy={() => {
                  pause();
                  setModal('study');
                }}
              />}
              <aside className="right-panel">
                <div className="panel-tabs">
                  <button
                    className={tab === 'inspector' ? 'active' : ''}
                    onClick={() => setTab('inspector')}
                  >
                    <SlidersHorizontal size={13} />
                    Inspector
                  </button>
                  <button
                    className={tab === 'review' ? 'active icon-tab' : 'icon-tab'}
                    aria-label="Design checks"
                    onClick={() => setTab('review')}
                  >
                    <ShieldCheck size={16} />
                  </button>
                </div>
                {tab === 'inspector' && (
                  <div className="inspector-panel">
                    {!hasMotorCues && <SelectionPicker
                      count={project.droneCount}
                      selection={droneSelection}
                      onSelect={pickDrones}
                    />}
                    {droneSelection.length > 0 ? (
                      <DroneInspector
                        project={project}
                        cue={cue}
                        time={time}
                        selection={droneSelection}
                        autoKey={autoKey}
                        onAutoKey={() => setAutoKey(!autoKey)}
                        onChange={editDrones}
                        onMove={moveDrones}
                        onKeyframe={keyDrones}
                        onRemoveKey={(keyTime) =>
                          commit([
                            {
                              type: 'remove_keyframe',
                              cueId: cue.id,
                              ids: droneSelection,
                              time: keyTime,
                            },
                          ])
                        }
                        onSeek={seek}
                        onReset={() =>
                          commit([{ type: 'reset_drones', cueId: cue.id, ids: droneSelection }])
                        }
                        onSource={openSource}
                      />
                    ) : (
                      <>
                        {!hasMotorCues && <div className="inspector-preview">
                          <FormationThumb cue={cue} large />
                          <span>{shapeNames[cue.shape]}</span>
                        </div>}
                        <div className="inspector-heading">
                          <span className="eyebrow">
                            SCENE {String(project.cues.indexOf(cue) + 1).padStart(2, '0')}
                          </span>
                          <div>
                            <button
                              className="icon-button"
                              title="Move scene earlier"
                              aria-label="Move scene earlier"
                              disabled={project.cues[0].id === cue.id}
                              onClick={() =>
                                commit([{ type: 'move_cue', id: cue.id, direction: 'up' }])
                              }
                            >
                              <ArrowUp size={13} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label="Move scene later"
                              disabled={project.cues.at(-1)?.id === cue.id}
                              onClick={() =>
                                commit([{ type: 'move_cue', id: cue.id, direction: 'down' }])
                              }
                            >
                              <ArrowDown size={13} />
                            </button>
                          </div>
                        </div>
                        <label className="field">
                          Scene name
                          <input
                            key={`${cue.id}-name-${project.revision}`}
                            defaultValue={cue.name}
                            onBlur={(e) => {
                              if (e.target.value !== cue.name && e.target.value.trim())
                                updateCue({ name: e.target.value });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                          />
                        </label>
                        {!hasMotorCues && !isZorroStopStoryboard(project) && <label className="field">
                          Seed generator
                          <select
                            value={cue.shape}
                            onChange={(e) => updateCue({ shape: e.target.value as Shape })}
                          >
                            {shapes.map((s) => (
                              <option key={s} value={s}>
                                {shapeNames[s]}
                              </option>
                            ))}
                          </select>
                        </label>}
                        {isZorroStopStoryboard(project) ? <div className="field"><span>Duration</span><strong>20 s · fixed</strong></div> : <div className="field-row">
                          <NumericField
                            label="Duration"
                            value={cue.duration}
                            suffix="s"
                            min={1 / EDIT_FPS}
                            max={1800}
                            onChange={(value) =>
                              updateCue({
                                duration: value,
                                transition: Math.min(value, cue.transition),
                              })
                            }
                          />
                        </div>}
                        {!isZorroStopStoryboard(project) && <div className="storyboard-motor-controls">
                          <label className="field">Motor cue · props off
                            <select aria-label="Motor cue" value={cue.benchCue?.motor ?? ''} onChange={(event) => updateCue({ benchCue: event.target.value ? { motor: Number(event.target.value) as 1 | 2 | 3 | 4, offset: cue.benchCue?.offset ?? 3 } : null })}>
                              <option value="">None</option>
                              {[1, 2, 3, 4].map((motor) => <option key={motor} value={motor}>Motor {String.fromCharCode(64 + motor)}</option>)}
                            </select>
                          </label>
                          {cue.benchCue && <><NumericField label="Pulse offset" value={cue.benchCue.offset} suffix="s" min={0} max={1800} onChange={(offset) => updateCue({ benchCue: { ...cue.benchCue!, offset } })} /><p>One second at 5%. Keep at least six seconds between pulses.</p></>}
                        </div>}
                        {!hasMotorCues && !isZorroStopStoryboard(project) && <TransitionInspector project={project} cue={cue} onApply={commit} />}
                        <div className="inspector-divider" />
                        {isZorroStopStoryboard(project) ? <p className="motor-scene-note">Run requests normal arm for 20 seconds of four-motor idle, then disarm. Propellers off; no throttle or flight path.</p> : hasMotorCues ? <p className="motor-scene-note">This scene holds the aircraft still. Edit its duration and motor cue, then preview the timeline before assigning a physical drone.</p> : cue.shape === 'custom' ? (
                          <div className="custom-geometry-note">
                            <Code2 size={16} />
                            <strong>Explicit point geometry</strong>
                            <p>
                              Select lights to transform, color, or animate them. This scene’s
                              authored points override the seed generator.
                            </p>
                            <button
                              className="secondary-button"
                              onClick={() =>
                                pickDrones(
                                  Array.from({ length: project.droneCount }, (_, i) => i + 1)
                                )
                              }
                            >
                              Edit all {project.droneCount.toLocaleString()} drones
                            </button>
                            <button className="text-button" onClick={openSource}>
                              Open scene source
                            </button>
                          </div>
                        ) : (
                          <>
                            <label className="range-field">
                              <span>
                                Formation width <b>{cue.scale} m</b>
                              </span>
                              <input
                                aria-label="Formation width"
                                type="range"
                                min={10}
                                max={240}
                                value={cue.scale}
                                onChange={(e) => updateCue({ scale: Number(e.target.value) })}
                              />
                            </label>
                            <label className="range-field">
                              <span>
                                Center altitude <b>{cue.altitude} m</b>
                              </span>
                              <input
                                aria-label="Center altitude"
                                type="range"
                                min={10}
                                max={300}
                                value={cue.altitude}
                                onChange={(e) => updateCue({ altitude: Number(e.target.value) })}
                              />
                            </label>
                            <div className="inspector-divider" />
                            <span className="field-label">Light palette</span>
                            <div className="palette-list">
                              {palettes.map((p) => (
                                <button
                                  key={p}
                                  aria-pressed={cue.palette === p}
                                  className={cue.palette === p ? 'selected' : ''}
                                  onClick={() => updateCue({ palette: p })}
                                >
                                  <span className="palette-swatches">
                                    {paletteColors[p].map((color) => (
                                      <i key={color} style={{ background: color }} />
                                    ))}
                                  </span>
                                  <span>{p}</span>
                                  {p === cue.palette && <Check size={13} />}
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                        {!isZorroStopStoryboard(project) && <div className="cue-actions">
                          <button
                            className="secondary-button"
                            onClick={() => {
                              const copy = {
                                ...cue,
                                id: crypto.randomUUID(),
                                name: `${cue.name.slice(0, 54)} copy`,
                              };
                              if (commit([{ type: 'add_cue', cue: copy }])) setSelected(copy.id);
                            }}
                          >
                            <Copy size={13} />
                            Duplicate
                          </button>
                          <button
                            className="danger-icon"
                            aria-label="Delete selected scene"
                            disabled={project.cues.length === 1}
                            onClick={() => {
                              if (commit([{ type: 'remove_cue', id: cue.id }]))
                                setSelected(project.cues.find((c) => c.id !== cue.id)!.id);
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>}
                      </>
                    )}
                  </div>
                )}
                {tab === 'review' && (
                  <div className="review-panel">
                    <span className="review-emblem">
                      <ShieldCheck size={25} strokeWidth={1.5} />
                    </span>
                    <span className="eyebrow">DESIGN REVIEW</span>
                    <h2>Room to refine.</h2>
                    <p>
                      Check the choreography before the next step. A good show starts with a
                      thoughtful design.
                    </p>
                    <div className="review-summary">
                      {checking ? (
                        <>
                          <LoaderCircle className="spin" size={17} />
                          Reviewing your show…
                        </>
                      ) : checkError ? (
                        <>{checkError}</>
                      ) : (
                        <>
                          <span className={issues ? 'amber-dot' : 'live-dot'} />
                          {issues
                            ? `${issues} ${issues === 1 ? 'check needs' : 'checks need'} attention`
                            : 'Design review has incomplete checks'}
                        </>
                      )}
                    </div>
                    {report?.checks.map((check) => (
                      <div className={`check-item ${check.status}`} key={check.name}>
                        <span>
                          {check.status === 'pass' ? (
                            <CheckCircle2 size={15} />
                          ) : check.status === 'fail' ? (
                            <Circle size={15} />
                          ) : (
                            <Ellipsis size={16} />
                          )}
                        </span>
                        <div>
                          <strong>{check.name}</strong>
                          <p>{check.detail}</p>
                        </div>
                      </div>
                    ))}
                    {report && report.conflicts.length > 0 && (
                      <button
                        className="secondary-button conflict-jump"
                        onClick={() => seek(report.conflicts[0].time)}
                      >
                        Preview first spacing conflict
                        <ArrowRight size={13} />
                      </button>
                    )}
                    <div className="review-note">
                      <Radio size={15} />
                      <p>
                        This is a design preview. An operator will need to plan and validate flight
                        paths, takeoff, and landing before flying.
                      </p>
                    </div>
                  </div>
                )}
              </aside>
            </div>
            <Timeline
              project={project}
              time={time}
              playing={playing}
              muted={muted}
              track={track}
              selected={cue.id}
              droneSelection={droneSelection}
              onKeyMove={(droneId, from, to) =>
                commit([{ type: 'move_keyframe', cueId: cue.id, droneId, from, to }])
              }
              onSeek={seek}
              onPlay={() => void play()}
              onMute={() => {
                audio.current.setMuted(!muted);
                setMuted(!muted);
              }}
              onSelect={setSelected}
              onAudio={() => soundtrackInput.current?.click()}
              onAdd={() => setModal('library')}
              onEditStart={pause}
              onTrim={(id, value) => {
                const current = project.cues.find((item) => item.id === id);
                if (current && current.duration !== value)
                  commit([
                    {
                      type: 'update_cue',
                      id,
                      patch: { duration: value, transition: Math.min(current.transition, value) },
                    },
                  ]);
              }}
              onMove={(id, index) => commit(reorderOperations(project, id, index))}
            />
          </WorkspaceElement>
        </div>
        <footer className="status-bar">
          <span>
            <span className="live-dot" />
            Simulation workspace
          </span>
          <span>
            Scene {activeFrame.index + 1} of {project.cues.length}
            <i />
            {project.droneCount.toLocaleString()} drones
          </span>
          <button onClick={() => openPanel('review')}>
            <ShieldCheck size={12} />
            {checking
              ? 'Checking design'
              : issues
                ? `${issues} design checks to review`
                : 'View design checks'}
            <ChevronRight size={11} />
          </button>
        </footer>
        <input
          className="hidden-input"
          ref={soundtrackInput}
          type="file"
          accept="audio/*"
          onChange={(e) => void importAudio(e)}
        />
        <input
          className="hidden-input"
          ref={projectInput}
          type="file"
          accept=".json,.lucid"
          onChange={(e) => void importProject(e)}
        />
        {modal === 'study' && (
          <Modal title="All around you" onClose={() => setModal(null)}>
            <ImmersiveStudy />
          </Modal>
        )}
        {modal === 'library' && (
          <Modal title="A shape for every idea." onClose={() => setModal(null)}>
            <p className="modal-intro">Choose a starting point. Make it yours in the inspector.</p>
            <div className="formation-library">
              {shapes.map((shape) => (
                <button key={shape} onClick={() => addShape(shape)}>
                  <FormationThumb cue={{ ...cue, shape }} large />
                  <strong>{shapeNames[shape]}</strong>
                  <span>
                    Add to storyboard <Plus size={13} />
                  </span>
                </button>
              ))}
            </div>
          </Modal>
        )}
        {modal === 'source' && (
          <Modal title="Scene source" onClose={() => setModal(null)}>
            <SceneSource
              cue={cue}
              revision={project.revision}
              onApply={(next, revision) => {
                const applied = commit(
                  [
                    {
                      type: 'replace_cues',
                      cues: project.cues.map((item) => (item.id === cue.id ? next : item)),
                    },
                  ],
                  revision
                );
                if (applied) {
                  setSelected(next.id);
                  setModal(null);
                  setToast('Scene source applied');
                }
                return applied;
              }}
            />
          </Modal>
        )}
        {modal === 'new-storyboard' && (
          <Modal title="New storyboard" onClose={() => setModal(null)}>
            <button className="export-option" onClick={() => newStoryboard('blank')}><Layers3 size={22} /><span><strong>Blank storyboard</strong><small>Start a new design with one drone.</small></span><ArrowRight size={18} /></button>
            <button className="export-option" onClick={() => newStoryboard('flight-hover')}><ShieldCheck size={22} /><span><strong>First live hover</strong><small>One-drone flight candidate · rise, hold, land. Mission testing required.</small></span><ArrowRight size={18} /></button>
            <button className="export-option" onClick={() => newStoryboard('motor')}><Radio size={22} /><span><strong>Props-off motor sequence</strong><small>Four editable scenes. Preview, assign a drone, then run.</small></span><ArrowRight size={18} /></button>
            <button className="export-option" onClick={() => newStoryboard('zorro-stop')}><ShieldCheck size={22} /><span><strong>Props-off idle</strong><small>One drone · low-speed motor idle · 20 seconds.</small></span><ArrowRight size={18} /></button>
          </Modal>
        )}
        {modal === 'export' && (
          <Modal title="Ready for the next chapter." onClose={() => setModal(null)}>
            <p className="modal-intro">
              {isZorroStopStoryboard(project) ? 'Save an editable copy of this props-off storyboard. Run it in Lucidity; the export is not an aircraft mission.' : hasMotorCues ? 'Save an editable copy with its motor cues. To run this storyboard here, use Run storyboard; no export is needed.' : 'Take your design with you, or hand it to an operator to develop into a flight-ready show.'}
            </p>
            <div className="export-project-summary">
              <span className="project-icon">
                <AudioLines size={22} />
              </span>
              <div>
                <strong>{project.name}</strong>
                <p>
                  {project.droneCount.toLocaleString()} drones · {project.cues.length} scenes ·{' '}
                  {formatTime(duration)}
                </p>
              </div>
              <span className="draft-pill">DESIGN</span>
            </div>
            <button
              className="export-option"
              onClick={() => {
                download(
                  `${project.name}.lucid.json`,
                  JSON.stringify(projectBundle(project, report), null, 2)
                );
                setToast('Design bundle exported');
              }}
            >
              <FileJson size={22} />
              <span>
                <strong>Portable design bundle</strong>
                <small>{isZorroStopStoryboard(project) ? 'Editable 20-second props-off idle storyboard.' : hasMotorCues ? 'Editable scenes, timing, and props-off motor cues.' : 'Editable choreography, light palettes, timing, and design checks.'}</small>
              </span>
              <Download size={17} />
            </button>
            {!hasMotorCues && !isZorroStopStoryboard(project) && <button className="export-option" disabled={exporting} onClick={exportCsv}>
              <Layers3 size={22} />
              <span>
                <strong>{exporting ? 'Preparing trajectories…' : 'Sampled trajectories'}</strong>
                <small>CSV · positions and RGB per drone · 2 Hz · up to 350,000 rows.</small>
              </span>
              {exporting ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />}
            </button>}
            <div className="export-note">
              <ShieldCheck size={16} />
              <p>
                {isZorroStopStoryboard(project) ? 'Import this bundle into Lucidity to edit or rerun the props-off idle show. It is not a flight mission.' : hasMotorCues ? 'Import this bundle back into Lucidity to edit or run it. Motor cues are for props-off rehearsal only; this is not a flight mission.' : 'Simulation and creative handoff only. Audio is supplied separately; an operator must compile and validate the aircraft missions.'}
              </p>
            </div>
          </Modal>
        )}
        {modal === 'project' && (
          <Modal title="Your show, your direction." onClose={() => setModal(null)}>
            <button className="expert-study-button" onClick={() => void openExpertStudy()}>
              <Code2 size={17} />
              <span>
                <strong>Open the expert study</strong>
                <small>800 custom points · animated geometry · per-drone color and flashing</small>
              </span>
              <ArrowUpRight size={14} />
            </button>
            <p className="modal-intro">A creative workspace for one drone or a sky full of them.</p>
            <label className="field">
              Show title
              <input
                key={`title-${project.revision}`}
                aria-label="Show title"
                defaultValue={project.name}
                maxLength={80}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== project.name)
                    commit([{ type: 'rename', name: e.target.value }]);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            </label>
            <div className="field-row">
              <NumericField
                label="Virtual fleet"
                value={project.droneCount}
                min={1}
                max={100000}
                suffix="drones"
                onChange={(count) => commit([{ type: 'set_fleet', count }])}
              />
              <NumericField
                label="Tempo"
                value={project.bpm}
                min={40}
                max={220}
                suffix="BPM"
                onChange={(bpm) => commit([{ type: 'set_tempo', bpm }])}
              />
            </div>
            <p className="field-help">
              Full-fleet visualization supports up to 100,000 points. Separation checks cover up to
              2,000 drones. Imported audio keeps its original tempo; match the BPM here by ear.
            </p>
            <div className="project-modal-actions">
              <button className="secondary-button" onClick={() => projectInput.current?.click()}>
                <FolderOpen size={15} />
                Open project
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  soundtrackInput.current?.click();
                }}
              >
                <Upload size={15} />
                Import music
              </button>
              <button
                className="secondary-button"
                onClick={() => {
                  setModal('export');
                }}
              >
                <ArrowDownToLine size={15} />
                Save a copy
              </button>
            </div>
            <div className="documentation-links">
              <a href="/docs/PRODUCT.md" target="_blank" rel="noreferrer">
                <BookOpen size={14} />
                Product document
                <ArrowUpRight size={12} />
              </a>
              <a href="/docs/TECHNICAL.md" target="_blank" rel="noreferrer">
                <BookOpen size={14} />
                Technical design
                <ArrowUpRight size={12} />
              </a>
            </div>
          </Modal>
        )}
        {toast && (
          <div className="toast" role="status">
            <CheckCircle2 size={16} />
            <span>{toast}</span>
            <button aria-label="Dismiss notification" onClick={() => setToast('')}>
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function MusicIcon() {
  return <AudioLines size={16} />;
}
function NumericField({
  label,
  value,
  suffix,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="field">
      {label}
      <span className="numeric-field">
        <input
          type="number"
          aria-label={label}
          min={min}
          max={max}
          step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number(draft);
            if (draft.trim() && Number.isFinite(n) && n >= min && n <= max) {
              if (n !== value) onChange(n);
            } else setDraft(String(value));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <span>{suffix}</span>
      </span>
    </label>
  );
}
