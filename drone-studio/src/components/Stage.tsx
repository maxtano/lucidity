import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  Aperture,
  Box,
  Expand,
  Focus,
  Grid2X2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Sun,
  MousePointer2,
  Move3D,
  Scan,
  RotateCw,
  Scaling,
  Compass,
  MapPin,
  Ratio,
  Clapperboard,
  X,
} from 'lucide-react';
import { ShowEvaluator } from '../core/animation';
import { frameAt, totalDuration, type Project, type Vector3Tuple } from '../core/model';
import { lightIntensity } from '../core/export';
import { timecode } from '../core/timeline';
import {
  DEFAULT_VIEWER_POSE,
  DEFAULT_VENUE_PLACEMENT,
  headingToPoint,
  normalizeViewerSnapshot,
  type ViewerSnapshot,
  normalizeViewerPose,
  viewerDirection,
  viewDirectionLabel,
} from '../core/viewer';
import { createViewerVenue } from './viewerVenue';
import { ViewerSettings } from './ViewerSettings';
import { CameraAudition } from './CameraAudition';
import { CameraMoveInspection } from './CameraMoveInspection';
import {
  createCameraAuditionPlan,
  sampleCameraAudition,
  sampleCameraAuditionClock,
  type CameraAuditionPlan,
  type CameraAuditionClock,
} from '../core/camera-audition';
import { useViewerBookmarks } from './useViewerBookmarks';
import { loadViewerBookmarks } from '../core/viewer-bookmarks';
import { audienceFrame, isAudienceFrameAspect, type AudienceFrame } from '../core/viewer-frame';
import {
  buildCaptureMetadata,
  encodeAudiencePng,
  type CapturedAudienceFrame,
} from '../core/frame-capture';
import { ReviewFrameCapture } from './ReviewFrameCapture';
import { reviewFrameReadiness, type ReviewFrameIntent } from './review-frame-request';
import type { AgentViewerContext } from '../agent/types';
import { AudienceComparison } from './AudienceComparison';
import { AudienceSelection } from './AudienceSelection';
import { AudienceHighlightControls } from './AudienceHighlightControls';
import { ProposalTargetControls, type ProposalTargetControlsProps } from './ProposalTargetControls';
import {
  createAudienceHighlight,
  audienceHighlightIsCurrent,
  writeAudienceHighlightPositions,
  type AudienceHighlight,
  type AudienceHighlightTarget,
} from '../core/audience-highlight';
import { Modal } from './Modal';
import './Viewer.css';

type CameraView = 'Orbit' | 'Front' | 'Top';
const INITIAL_LOOK = {
  mode: 'audience' as 'audience' | 'design',
  glow: 0.85,
  exposure: 1.15,
  grid: true,
};

type Props = {
  project: Project;
  time: number;
  playing: boolean;
  focused: boolean;
  onFocus: () => void;
  selection: number[];
  onPick: (ids: number[], additive: boolean) => void;
  onTransform: (updates: { id: number; position: Vector3Tuple }[]) => void;
  onEditStart: () => void;
  readOnly?: boolean;
  /** Captured once when this stage mounts; later prop/project changes preserve the live camera. */
  initialViewerSnapshot?: ViewerSnapshot;
  captureViewerRef?: RefObject<(() => AgentViewerContext | undefined) | null>;
  /** Explicit display-only command; recalling also enters Viewer mode on this mounted renderer. */
  recallViewerRef?: RefObject<((snapshot: ViewerSnapshot) => void) | null>;
  /** Available after explicit evidence recall; framing is opt-in and display-only. */
  audienceFrameAspect?: number;
  /** Private proposal context; the pause command returns its settled shared show time. */
  reviewCapture?: { version: 'base' | 'draft'; sharedTime: number; pause: () => number };
  /** Optional exact per-drone command targets, used only by private read-only previews. */
  proposalTargets?: ProposalTargetControlsProps;
  /** Keep private comparison controls visible when expanding this same mounted Stage. */
  comparisonExpansion?: { expanded: boolean; onToggle: () => void };
  onOpenStudy?: () => void;
  onSeek?: (time: number) => void;
};
type EditTool = 'select' | 'box' | 'translate' | 'rotate' | 'scale';
type CameraMoveStatus = {
  playing: boolean;
  elapsed: number;
  duration: number;
  fromName: string;
  toName: string;
};
export function Stage({
  project,
  time,
  playing,
  focused,
  onFocus,
  selection,
  onPick,
  onTransform,
  onEditStart,
  readOnly = false,
  initialViewerSnapshot,
  captureViewerRef,
  recallViewerRef,
  audienceFrameAspect,
  reviewCapture,
  proposalTargets,
  comparisonExpansion,
  onOpenStudy,
  onSeek,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  // Normalization creates owned nested objects; callers may keep or replace their capture.
  const [initialViewer] = useState(() =>
    normalizeViewerSnapshot(
      initialViewerSnapshot ?? { pose: DEFAULT_VIEWER_POSE, venue: DEFAULT_VENUE_PLACEMENT }
    )
  );
  const [tool, setTool] = useState<EditTool>('select');
  const [selectionRect, setSelectionRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const state = useRef({
    project,
    time,
    playing,
    selection,
    tool,
    onPick,
    onTransform,
    onEditStart,
    readOnly,
    reviewCapture,
    proposalTargets,
  });
  const api = useRef<{
    fit: (view?: CameraView) => void;
    lookToward: (direction: 'stage' | 'left' | 'right' | 'back' | 'sky') => void;
    snapshot: () => ViewerSnapshot;
    recall: (snapshot: ViewerSnapshot) => void;
    captureContext: () => AgentViewerContext | undefined;
    captureFrame: (signal: AbortSignal) => Promise<CapturedAudienceFrame>;
    prepareAudition: (
      from: ViewerSnapshot | undefined,
      to: ViewerSnapshot,
      duration: number,
      easing: 'linear' | 'smooth',
      fromName: string,
      toName: string
    ) => void;
    playAudition: () => void;
    pauseAudition: () => void;
    seekAudition: (seconds: number) => void;
    clearAudition: () => void;
    captureAudition: () =>
      | { plan: CameraAuditionPlan; aspect: number; fromName: string; toName: string }
      | undefined;
  } | null>(null);
  const [error, setError] = useState(''),
    [view, setView] = useState<CameraView>('Orbit');
  const [look, setLook] = useState(INITIAL_LOOK),
    [lookOpen, setLookOpen] = useState(false),
    [fps, setFps] = useState(0);
  const [viewer, setViewer] = useState(() => ({
    east: initialViewer.pose.east,
    north: initialViewer.pose.north,
    eyeHeight: initialViewer.pose.eyeHeight,
    fov: initialViewer.pose.fov,
  }));
  const [venuePlacement, setVenuePlacement] = useState(() => ({ ...initialViewer.venue }));
  const venueSettings = useRef(venuePlacement);
  const savedViews = useViewerBookmarks(project.id);
  const [viewerSettingsOpen, setViewerSettingsOpen] = useState(false);
  const [auditionOpen, setAuditionOpen] = useState(false);
  const [auditionStatus, setAuditionStatus] = useState<CameraMoveStatus | null>(null);
  const [auditionError, setAuditionError] = useState('');
  const [capturedFrameEnabled, setCapturedFrameEnabled] = useState(false);
  const capturedAspect = isAudienceFrameAspect(audienceFrameAspect) ? audienceFrameAspect : null;
  const frameSettings = useRef<number | null>(null);
  frameSettings.current = capturedFrameEnabled ? capturedAspect : null;
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [cameraReportOpen, setCameraReportOpen] = useState(false);
  const [audienceSelectionOpen, setAudienceSelectionOpen] = useState(false);
  const [audienceHighlight, setAudienceHighlight] = useState<AudienceHighlight | null>(null);
  const [highlightEnabled, setHighlightEnabled] = useState(true);
  const audienceHighlightRef = useRef<{ target: AudienceHighlight | null; enabled: boolean }>({
    target: null,
    enabled: false,
  });
  const currentHighlight =
    !readOnly && audienceHighlight && audienceHighlightIsCurrent(audienceHighlight, project)
      ? audienceHighlight
      : null;
  audienceHighlightRef.current = { target: currentHighlight, enabled: highlightEnabled && !error };
  useEffect(() => {
    setAudienceHighlight(null);
  }, [project.id, project.revision, project.droneCount, readOnly]);
  const selectMatches = (ids: readonly number[], additive: boolean) => {
    // Pointer multi-select toggles IDs; explicit Add is a true union.
    const next = additive ? [...new Set([...selection, ...ids])].sort((a, b) => a - b) : [...ids];
    onPick(next, false);
  };
  const [heading, setHeading] = useState(() => ({
    yaw: initialViewer.pose.yaw,
    pitch: initialViewer.pose.pitch,
    stage: headingToPoint(
      initialViewer.pose.east,
      initialViewer.pose.north,
      initialViewer.venue.east,
      initialViewer.venue.north
    ),
    fov: initialViewer.pose.fov,
  }));
  const viewerSettings = useRef(viewer);
  const updateViewer = (next: typeof viewer) => {
    api.current?.clearAudition?.();
    viewerSettings.current = next;
    setViewer(next);
  };
  const updateVenue = (next: typeof venuePlacement) => {
    api.current?.clearAudition?.();
    venueSettings.current = next;
    setVenuePlacement(next);
  };
  const appearance = useRef(look);
  state.current = {
    project,
    time,
    playing,
    selection,
    tool,
    onPick,
    onTransform,
    onEditStart,
    readOnly,
    reviewCapture,
    proposalTargets,
  };
  appearance.current = look;

  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch {
      setError('The 3D preview needs WebGL. Your show can still be edited and exported.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      'Interactive 3D drone show preview. Drag to orbit, right-drag to pan, and scroll to zoom.'
    );
    renderer.domElement.tabIndex = 0;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080b12);
    scene.fog = new THREE.FogExp2(0x080b12, 0.0025);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    camera.position.set(78, 88, 165);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 64, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.085;
    controls.minDistance = 4;
    controls.maxDistance = 2000;
    controls.maxPolarAngle = Math.PI * 0.97;

    // A world-space sky gradient makes the horizon respond naturally to the camera.
    const skyGeometry = new THREE.SphereGeometry(2300, 24, 16);
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader:
        'varying vec3 direction; void main(){ direction=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader:
        'varying vec3 direction; void main(){ float h=normalize(direction).y; float horizon=exp(-abs(h)*8.); vec3 sky=mix(vec3(.0025,.004,.009),vec3(.016,.024,.044),horizon); gl_FragColor=vec4(sky,1.); }',
    });
    scene.add(new THREE.Mesh(skyGeometry, skyMaterial));
    const grid = new THREE.GridHelper(600, 60, 0x627489, 0x3a485b);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.42;
    scene.add(grid);
    const ringGeometry = new THREE.BufferGeometry().setFromPoints(
      Array.from(
        { length: 193 },
        (_, i) =>
          new THREE.Vector3(
            Math.cos((i / 192) * Math.PI * 2),
            0.001,
            Math.sin((i / 192) * Math.PI * 2)
          )
      )
    );
    const ringMaterial = new THREE.LineDashedMaterial({
      color: 0xa5b389,
      dashSize: 2,
      gapSize: 2,
      transparent: true,
      opacity: 0.4,
    });
    const perimeter = new THREE.Line(ringGeometry, ringMaterial);
    scene.add(perimeter);
    const venue = createViewerVenue();
    scene.add(venue.group);

    let geometry = new THREE.BufferGeometry();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        blend: { value: 1 },
        intensity: { value: 1 },
        size: { value: 8 },
        height: { value: 400 },
      },
      vertexShader: `attribute vec3 destination; attribute vec3 shade; attribute vec3 nextShade;
        uniform float blend; uniform float size; uniform float height; varying vec3 vColor; varying float coverage;
        void main(){ vec3 p=mix(position,destination,blend); vec4 mv=modelViewMatrix*vec4(p.x,p.z,-p.y,1.); gl_Position=projectionMatrix*mv;
          float pixels=size*height*.42/max(.1,-mv.z); coverage=min(1.,pixels*pixels);
          gl_PointSize=clamp(pixels,1.,22.); vColor=mix(shade,nextShade,blend); }`,
      fragmentShader: `uniform float intensity; varying vec3 vColor; varying float coverage;
        void main(){ float r=length(gl_PointCoord-vec2(.5)); if(r>.5)discard;
          float halo=exp(-r*r*23.); float core=1.-smoothstep(.035,.16,r);
          float power=max(vColor.r,max(vColor.g,vColor.b)); vec3 light=pow(vColor,vec3(2.2))*1.65+vec3(core*.65*power);
          gl_FragColor=vec4(light*intensity,coverage*halo*(1.-smoothstep(.38,.5,r))); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    const bloom = new UnrealBloomPass(new THREE.Vector2(800, 500), 0.85, 0.5, 0.7);
    const output = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloom);
    composer.addPass(output);

    // Display-only rings render after postprocessing, so neither the authored light
    // buffers nor bloom/exposure receive highlighting colors.
    const audienceOverlay = new THREE.Scene();
    let audienceRingGeometry = new THREE.BufferGeometry();
    let audienceRingPositions = new Float32Array(0);
    const audienceRingMaterial = new THREE.ShaderMaterial({
      uniforms: { size: { value: 12 * renderer.getPixelRatio() } },
      vertexShader:
        'uniform float size; void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size;}',
      fragmentShader: `void main(){
        float r=length(gl_PointCoord-vec2(.5));
        float alpha=smoothstep(.32,.39,r)*(1.-smoothstep(.43,.49,r));
        if(alpha<=0.)discard;
        vec3 color=mix(vec3(.92,1.,1.),vec3(.42,.84,1.),smoothstep(.37,.45,r));
        gl_FragColor=vec4(color,alpha*.9);
      }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const audienceRings = new THREE.Points(audienceRingGeometry, audienceRingMaterial);
    audienceRings.frustumCulled = false;
    audienceRings.visible = false;
    audienceOverlay.add(audienceRings);
    let lastAudienceTarget: AudienceHighlightTarget | null = null;
    let lastAudienceProject: Project | null = null;
    let lastAudienceTime = NaN;
    let lastAudienceVisible = false;
    let audienceRingReady = false;

    let cachedProject: Project | null = null,
      cachedIndex = -1;
    let evaluator = new ShowEvaluator(state.current.project);
    let position: Float32Array = new Float32Array(0),
      destination: Float32Array = new Float32Array(0);
    let request = 0,
      dirty = true,
      firstFrame = true;
    let lastTime = -1,
      lastLook = appearance.current,
      frames = 0,
      measuredAt = performance.now();
    let cameraView: CameraView = 'Orbit';
    let cameraMode: 'audience' | 'design' = 'design';
    let viewerYaw = initialViewer.pose.yaw,
      viewerPitch = initialViewer.pose.pitch;
    let orbitPose: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
    let lastViewer = viewerSettings.current;
    let lastVenue = venueSettings.current;
    let headingUpdatedAt = 0;
    const direction = new THREE.Vector3();
    const applyViewerCamera = () => {
      const settings = viewerSettings.current;
      const pose = normalizeViewerPose({ ...settings, yaw: viewerYaw, pitch: viewerPitch });
      viewerYaw = pose.yaw;
      viewerPitch = pose.pitch;
      camera.position.set(pose.east, pose.eyeHeight, -pose.north);
      direction.fromArray(viewerDirection(pose.yaw, pose.pitch));
      camera.up.set(0, 1, 0);
      camera.lookAt(direction.add(camera.position));
      if (camera.fov !== pose.fov) {
        camera.fov = pose.fov;
        camera.updateProjectionMatrix();
      }
      dirty = true;
    };
    const lookToward = (side: 'stage' | 'left' | 'right' | 'back' | 'sky') => {
      if (appearance.current.mode !== 'audience') return;
      clearAudition();
      synchronizeViewer();
      const settings = viewerSettings.current;
      const stage = venueSettings.current;
      const bearing = headingToPoint(settings.east, settings.north, stage.east, stage.north);
      if (side !== 'sky') viewerYaw = bearing + { stage: 0, left: -90, right: 90, back: 180 }[side];
      viewerPitch = side === 'sky' ? 85 : DEFAULT_VIEWER_POSE.pitch;
      applyViewerCamera();
    };
    let tween: {
      start: number;
      from: THREE.Vector3;
      to: THREE.Vector3;
      fromTarget: THREE.Vector3;
      toTarget: THREE.Vector3;
    } | null = null;
    const fit = (nextView = cameraView, animate = true) => {
      cameraView = nextView;
      const frame = frameAt(state.current.project, state.current.time);
      const min = new THREE.Vector3(Infinity, Infinity, Infinity),
        max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      const point = new THREE.Vector3();
      for (let i = 0; i < position.length; i += 3) {
        point.set(
          THREE.MathUtils.lerp(position[i], destination[i], frame.progress),
          THREE.MathUtils.lerp(position[i + 2], destination[i + 2], frame.progress),
          -THREE.MathUtils.lerp(position[i + 1], destination[i + 1], frame.progress)
        );
        min.min(point);
        max.max(point);
      }
      if (!position.length) return;
      const center = min.clone().add(max).multiplyScalar(0.5);
      const radius = Math.max(10, min.distanceTo(max) * 0.5);
      const distance =
        ((radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.06) /
        Math.min(1, camera.aspect);
      const direction =
        nextView === 'Top'
          ? new THREE.Vector3(0, 1, 0.0001)
          : nextView === 'Front'
            ? new THREE.Vector3(0, 0, 1)
            : new THREE.Vector3(0.42, 0.13, 1).normalize();
      const to = center.clone().addScaledVector(direction, distance);
      if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        tween = {
          start: performance.now(),
          from: camera.position.clone(),
          to,
          fromTarget: controls.target.clone(),
          toTarget: center,
        };
      } else {
        tween = null;
        camera.position.copy(to);
        controls.target.copy(center);
        controls.update();
      }
      dirty = true;
    };
    controls.addEventListener('start', () => {
      tween = null;
    });
    controls.addEventListener('change', () => {
      dirty = true;
    });
    let renderedFrame: AudienceFrame | null = null;
    let renderedAspect: number | null = null;
    let frameAvailable = false;
    const requestedAspect = () =>
      appearance.current.mode === 'audience' ? frameSettings.current : null;
    const resize = () => {
      const { width, height } = element.getBoundingClientRect();
      const aspect = requestedAspect();
      const frame = audienceFrame(width, height, aspect);
      renderedAspect = aspect;
      if (!frame) {
        frameAvailable = false;
        renderer.domElement.style.visibility = 'hidden';
        return;
      }
      if (!frameAvailable) {
        frameAvailable = true;
        renderer.domElement.style.visibility = '';
        dirty = true;
      }
      if (
        renderedFrame &&
        frame.x === renderedFrame.x &&
        frame.y === renderedFrame.y &&
        frame.width === renderedFrame.width &&
        frame.height === renderedFrame.height &&
        frame.aspect === renderedFrame.aspect
      )
        return;
      renderedFrame = frame;
      // Keep the CSS/projection frame exact, even when a tiny frame needs one raster pixel.
      const renderWidth = Math.max(1, frame.width),
        renderHeight = Math.max(1, frame.height);
      renderer.setSize(renderWidth, renderHeight, false);
      composer.setSize(renderWidth, renderHeight);
      Object.assign(renderer.domElement.style, {
        position: 'absolute',
        left: `${frame.x}px`,
        top: `${frame.y}px`,
        width: `${frame.width}px`,
        height: `${frame.height}px`,
      });
      camera.aspect = frame.aspect;
      camera.updateProjectionMatrix();
      material.uniforms.height.value = renderHeight * renderer.getPixelRatio();
      dirty = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const synchronizeViewer = () => {
      const next = viewerSettings.current;
      const stage = venueSettings.current;
      if (next === lastViewer && stage === lastVenue) return;
      if (
        next.east !== lastViewer.east ||
        next.north !== lastViewer.north ||
        stage.east !== lastVenue.east ||
        stage.north !== lastVenue.north
      ) {
        viewerYaw = headingToPoint(next.east, next.north, stage.east, stage.north);
        viewerPitch = DEFAULT_VIEWER_POSE.pitch;
      }
      lastViewer = next;
      lastVenue = stage;
      if (cameraMode === 'audience') applyViewerCamera();
      dirty = true;
    };
    const focusAndLook = (side: Parameters<typeof lookToward>[0]) => {
      lookToward(side);
      renderer.domElement.focus({ preventScroll: true });
    };
    let audition: {
      plan: CameraAuditionPlan;
      clock: CameraAuditionClock;
      projectId: string;
      fromName: string;
      toName: string;
    } | null = null;
    let auditionPublishedAt = 0;
    const publishAudition = () => {
      setViewer(viewerSettings.current);
      setAuditionStatus(
        audition
          ? {
              playing: audition.clock.startedAt !== null,
              elapsed: audition.clock.elapsed,
              duration: audition.plan.duration,
              fromName: audition.fromName,
              toName: audition.toName,
            }
          : null
      );
    };
    function installAudienceSnapshot(snapshot: ViewerSnapshot, publish: boolean) {
      const next = normalizeViewerSnapshot(snapshot);
      viewerYaw = next.pose.yaw;
      viewerPitch = next.pose.pitch;
      const { east, north, eyeHeight, fov } = next.pose;
      // Atomic baselines prevent synchronizeViewer from re-aiming a translated camera.
      viewerSettings.current = lastViewer = { east, north, eyeHeight, fov };
      venueSettings.current = lastVenue = next.venue;
      if (publish) {
        setViewer(viewerSettings.current);
        setVenuePlacement(next.venue);
      }
      tween = null;
      if (cameraMode === 'audience') applyViewerCamera();
      dirty = true;
    }
    function advanceAudition(now: number, publish = false) {
      if (!audition) return;
      if (
        audition.projectId !== state.current.project.id ||
        appearance.current.mode !== 'audience'
      ) {
        clearAudition(false);
        return;
      }
      if (audition.clock.startedAt === null) return;
      const sampled = sampleCameraAuditionClock(audition.plan, audition.clock, now);
      // Rebase every sample so pause, capture and delayed frames share the exact settled clock.
      audition.clock = {
        elapsed: sampled.elapsed,
        startedAt: sampled.playing ? Math.max(now, audition.clock.startedAt) : null,
      };
      installAudienceSnapshot(sampled.snapshot, false);
      if (publish || !sampled.playing || now - auditionPublishedAt >= 100) {
        auditionPublishedAt = now;
        publishAudition();
      }
    }
    function pauseAudition() {
      advanceAudition(performance.now(), true);
      if (!audition) return;
      audition.clock.startedAt = null;
      publishAudition();
    }
    function clearAudition(settle = true) {
      if (!audition) return;
      if (settle) advanceAudition(performance.now());
      audition = null;
      publishAudition();
    }
    type CaptureJob = ReviewFrameIntent & {
      phase: 'queued' | 'encoding';
      signal: AbortSignal;
      resolve: (frame: CapturedAudienceFrame) => void;
      reject: (error: Error) => void;
    };
    let captureJob: CaptureJob | null = null;
    let contextLost = false;
    const captureFrame = (signal: AbortSignal): Promise<CapturedAudienceFrame> => {
      if (signal.aborted)
        return Promise.reject(new DOMException('Capture cancelled.', 'AbortError'));
      if (captureJob) return Promise.reject(new Error('A frame capture is already running.'));
      const source = state.current;
      const context = source.reviewCapture;
      if (!source.readOnly || !context || appearance.current.mode !== 'audience' || contextLost)
        return Promise.reject(new Error('Open the audience preview to capture a frame.'));
      pauseAudition();
      const sharedTime = context.pause();
      const sampledTime = Math.min(sharedTime, totalDuration(source.project));
      resize();
      const viewer = api.current?.snapshot();
      if (!frameAvailable || !viewer || !Number.isFinite(sampledTime))
        return Promise.reject(new Error('The audience frame is unavailable.'));
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        let settled = false;
        const finish = (error?: Error, frame?: CapturedAudienceFrame) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          if (captureJob === job) captureJob = null;
          if (error) {
            controller.abort();
            reject(error);
          } else resolve(frame!);
        };
        const abort = () => finish(new DOMException('Capture cancelled.', 'AbortError'));
        const timer = window.setTimeout(
          () => finish(new Error('Frame capture timed out. Try again.')),
          10_000
        );
        const job: CaptureJob = {
          project: source.project,
          version: context.version,
          sharedTime,
          sampledTime,
          initialSharedTime: context.sharedTime,
          initialSampledTime: source.time,
          viewer,
          aspect: camera.aspect,
          framing: requestedAspect() === null ? 'viewport' : 'captured',
          appearance: { glow: appearance.current.glow, exposure: appearance.current.exposure },
          phase: 'queued',
          signal: controller.signal,
          resolve: (frame) => finish(undefined, frame),
          reject: (error) => finish(error),
        };
        captureJob = job;
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        dirty = true;
      });
    };
    api.current = {
      fit: (v) => (appearance.current.mode === 'audience' ? focusAndLook('stage') : fit(v)),
      lookToward: focusAndLook,
      snapshot: () => {
        advanceAudition(performance.now());
        synchronizeViewer();
        return normalizeViewerSnapshot({
          pose: { ...viewerSettings.current, yaw: viewerYaw, pitch: viewerPitch },
          venue: venueSettings.current,
        });
      },
      recall: (snapshot) => {
        clearAudition();
        if (lookPointer && renderer.domElement.hasPointerCapture(lookPointer.id))
          renderer.domElement.releasePointerCapture(lookPointer.id);
        lookPointer = null;
        renderer.domElement.style.cursor = cameraMode === 'audience' ? 'grab' : '';
        installAudienceSnapshot(snapshot, true);
      },
      captureContext: () => {
        // An inspection may happen before the next RAF/ResizeObserver after a mode/frame change.
        resize();
        if (!frameAvailable) return;
        const snapshot = api.current?.snapshot();
        if (!snapshot) return;
        let savedViews: AgentViewerContext['savedViews'] = [];
        try {
          savedViews = loadViewerBookmarks(localStorage, state.current.project.id);
        } catch {
          /* A damaged local archive cannot prevent inspection of the current view. */
        }
        return { current: { snapshot, aspect: camera.aspect }, savedViews };
      },
      captureFrame,
      prepareAudition: (from, to, duration, easing, fromName, toName) => {
        if (contextLost || appearance.current.mode !== 'audience')
          throw new Error('Open Viewer 360° to prepare a camera move.');
        const origin = from ?? api.current!.snapshot();
        const plan = createCameraAuditionPlan(origin, to, duration, easing);
        // Keep the real stage fixed even when both bookmarks belong to another layout.
        const stage = venueSettings.current;
        if (
          plan.from.venue.east !== stage.east ||
          plan.from.venue.north !== stage.north ||
          plan.from.venue.heading !== stage.heading
        )
          throw new Error(
            'These views use a different stage layout. Recall the starting view before preparing this move.'
          );
        pauseAudition();
        audition = {
          plan,
          clock: { elapsed: 0, startedAt: null },
          projectId: state.current.project.id,
          fromName,
          toName,
        };
        publishAudition();
      },
      playAudition: () => {
        if (!audition || contextLost || appearance.current.mode !== 'audience') return;
        if (audition.projectId !== state.current.project.id) {
          clearAudition(false);
          return;
        }
        if (audition.clock.startedAt !== null) return;
        if (audition.clock.elapsed >= audition.plan.duration) audition.clock.elapsed = 0;
        if (lookPointer && renderer.domElement.hasPointerCapture(lookPointer.id))
          renderer.domElement.releasePointerCapture(lookPointer.id);
        lookPointer = null;
        renderer.domElement.style.cursor = 'grab';
        installAudienceSnapshot(sampleCameraAudition(audition.plan, audition.clock.elapsed), true);
        audition.clock.startedAt = performance.now();
        publishAudition();
      },
      pauseAudition,
      seekAudition: (seconds) => {
        if (!audition || !Number.isFinite(seconds)) return;
        if (
          audition.projectId !== state.current.project.id ||
          appearance.current.mode !== 'audience'
        ) {
          clearAudition(false);
          return;
        }
        const elapsed = Math.max(0, Math.min(audition.plan.duration, seconds));
        audition.clock = { elapsed, startedAt: null };
        installAudienceSnapshot(sampleCameraAudition(audition.plan, elapsed), true);
        publishAudition();
      },
      clearAudition,
      captureAudition: () => {
        // Reading the prepared path does not alter either clock or publish React state.
        // The explicit Analyze action pauses before mounting its report dialog.
        if (
          !audition ||
          audition.projectId !== state.current.project.id ||
          contextLost ||
          appearance.current.mode !== 'audience'
        )
          return;
        resize();
        if (!frameAvailable) return;
        return {
          plan: createCameraAuditionPlan(
            audition.plan.from,
            audition.plan.to,
            audition.plan.duration,
            audition.plan.easing
          ),
          aspect: camera.aspect,
          fromName: audition.fromName,
          toName: audition.toName,
        };
      },
    };
    if (captureViewerRef) captureViewerRef.current = () => api.current?.captureContext();
    if (recallViewerRef)
      recallViewerRef.current = (snapshot) => {
        if (!api.current) return;
        api.current.recall(snapshot);
        const nextLook = { ...appearance.current, mode: 'audience' as const };
        appearance.current = nextLook;
        setLook(nextLook);
        setViewerSettingsOpen(false);
        setAuditionOpen(false);
        setLookOpen(false);
        renderer.domElement.focus({ preventScroll: true });
      };
    const lost = () => {
      contextLost = true;
      audienceRings.visible = false;
      cancelAnimationFrame(request);
      request = 0;
      clearAudition(false);
      captureJob?.reject(new Error('The graphics context was interrupted during capture.'));
      setError('The graphics context was interrupted. Reload the studio to restore the preview.');
    };
    renderer.domElement.addEventListener('webglcontextlost', lost);

    const proxy = new THREE.Object3D();
    scene.add(proxy);
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.72);
    scene.add(transform.getHelper());
    let markerGeometry = new THREE.BufferGeometry();
    let previousSelection: number[] | null = null,
      selectedIds: number[] = [];
    let evaluated: ReturnType<ShowEvaluator['frame']> | null = null;
    const markerMaterial = new THREE.ShaderMaterial({
      uniforms: { size: { value: 16 * renderer.getPixelRatio() } },
      vertexShader:
        'uniform float size; void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size;}',
      fragmentShader:
        'void main(){float r=length(gl_PointCoord-vec2(.5));if(r>.49||r<.38)discard;gl_FragColor=vec4(.72,1.,.42,.92);}',
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const markers = new THREE.Points(markerGeometry, markerMaterial);
    markers.frustumCulled = false;
    markers.renderOrder = 999;
    scene.add(markers);
    let dragUpdates: { id: number; position: Vector3Tuple }[] | null = null;
    let transformStart: {
      inverse: THREE.Matrix4;
      points: { id: number; world: THREE.Vector3; previous: Vector3Tuple }[];
      progress: number;
    } | null = null;
    const worldPoint = (id: number, progress: number, target = new THREE.Vector3()) => {
      const i = (id - 1) * 3;
      return target.set(
        position[i] + (destination[i] - position[i]) * progress,
        position[i + 2] + (destination[i + 2] - position[i + 2]) * progress,
        -(position[i + 1] + (destination[i + 1] - position[i + 1]) * progress)
      );
    };
    transform.addEventListener('mouseDown', () => {
      state.current.onEditStart();
      controls.enabled = false;
      proxy.updateMatrixWorld();
      const progress = frameAt(state.current.project, state.current.time).progress;
      transformStart = {
        inverse: proxy.matrixWorld.clone().invert(),
        progress,
        points: state.current.selection.map((id) => ({
          id,
          world: worldPoint(id, progress),
          previous: Array.from(position.subarray((id - 1) * 3, (id - 1) * 3 + 3)) as Vector3Tuple,
        })),
      };
    });
    transform.addEventListener('objectChange', () => {
      if (!transformStart) return;
      proxy.updateMatrixWorld();
      const matrix = proxy.matrixWorld.clone().multiply(transformStart.inverse),
        weight = transformStart.progress;
      dragUpdates = transformStart.points.map(({ id, world, previous }) => {
        const p = world.clone().applyMatrix4(matrix),
          enu = [p.x, -p.z, p.y];
        return {
          id,
          position: enu.map((v, i) => (v - previous[i] * (1 - weight)) / weight) as Vector3Tuple,
        };
      });
      dirty = true;
    });
    transform.addEventListener('mouseUp', () => {
      if (dragUpdates) state.current.onTransform(dragUpdates);
      dragUpdates = null;
      transformStart = null;
      cachedProject = null;
      controls.enabled = true;
      dirty = true;
    });
    transform.addEventListener('change', () => {
      dirty = true;
    });
    let pointer: { x: number; y: number; box: boolean; additive: boolean } | null = null;
    const projected = (id: number, progress: number) => worldPoint(id, progress).project(camera);
    const pointerDown = (event: globalThis.PointerEvent) => {
      if (
        state.current.readOnly ||
        event.button !== 0 ||
        transform.axis ||
        appearance.current.mode !== 'design'
      )
        return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        box: state.current.tool === 'box',
        additive: event.shiftKey,
      };
      if (pointer.box) {
        controls.enabled = false;
        renderer.domElement.setPointerCapture(event.pointerId);
        setSelectionRect({ x: pointer.x, y: pointer.y, width: 0, height: 0 });
      }
    };
    const pointerMove = (event: globalThis.PointerEvent) => {
      if (!pointer?.box) return;
      const bounds = renderer.domElement.getBoundingClientRect(),
        x = event.clientX - bounds.left,
        y = event.clientY - bounds.top;
      setSelectionRect({
        x: Math.min(pointer.x, x),
        y: Math.min(pointer.y, y),
        width: Math.abs(x - pointer.x),
        height: Math.abs(y - pointer.y),
      });
    };
    const pointerUp = (event: globalThis.PointerEvent) => {
      if (!pointer) return;
      const start = pointer;
      pointer = null;
      setSelectionRect(null);
      if (transform.dragging || transform.axis) return;
      const bounds = renderer.domElement.getBoundingClientRect(),
        x = event.clientX - bounds.left,
        y = event.clientY - bounds.top;
      if (!start.box && Math.hypot(x - start.x, y - start.y) > 5) return;
      let nearest = 0,
        distance = 100;
      const found: number[] = [],
        progress = frameAt(state.current.project, state.current.time).progress;
      for (let id = 1; id <= state.current.project.droneCount; id++) {
        const point = projected(id, progress);
        if (point.z < -1 || point.z > 1) continue;
        const px = ((point.x + 1) * bounds.width) / 2,
          py = ((1 - point.y) * bounds.height) / 2;
        if (start.box) {
          if (
            px >= Math.min(x, start.x) &&
            px <= Math.max(x, start.x) &&
            py >= Math.min(y, start.y) &&
            py <= Math.max(y, start.y)
          )
            found.push(id);
        } else {
          const d = (px - x) ** 2 + (py - y) ** 2;
          if (d < distance) {
            distance = d;
            nearest = id;
          }
        }
      }
      state.current.onPick(start.box ? found : nearest ? [nearest] : [], start.additive);
      dirty = true;
    };
    const cancelPointer = () => {
      pointer = null;
      setSelectionRect(null);
    };
    const cancelEdit = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !transformStart) return;
      transform.reset();
      transformStart = null;
      dragUpdates = null;
      cachedProject = null;
      previousSelection = null;
      dirty = true;
      event.preventDefault();
      event.stopPropagation();
    };
    let lookPointer: { id: number; x: number; y: number } | null = null;
    const lookDown = (event: PointerEvent) => {
      if (appearance.current.mode !== 'audience' || event.button !== 0) return;
      clearAudition();
      synchronizeViewer();
      lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      renderer.domElement.focus({ preventScroll: true });
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
      event.preventDefault();
    };
    const lookMove = (event: PointerEvent) => {
      if (
        !lookPointer ||
        event.pointerId !== lookPointer.id ||
        appearance.current.mode !== 'audience'
      )
        return;
      const sensitivity =
        viewerSettings.current.fov / Math.max(240, renderedFrame?.height ?? element.clientHeight);
      viewerYaw += (event.clientX - lookPointer.x) * sensitivity;
      viewerPitch -= (event.clientY - lookPointer.y) * sensitivity;
      lookPointer.x = event.clientX;
      lookPointer.y = event.clientY;
      applyViewerCamera();
    };
    const lookEnd = (event: PointerEvent) => {
      if (lookPointer?.id !== event.pointerId) return;
      lookPointer = null;
      if (renderer.domElement.hasPointerCapture(event.pointerId))
        renderer.domElement.releasePointerCapture(event.pointerId);
      renderer.domElement.style.cursor = appearance.current.mode === 'audience' ? 'grab' : '';
    };
    const lookKeys = (event: KeyboardEvent) => {
      if (appearance.current.mode !== 'audience' || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (!['Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      clearAudition();
      synchronizeViewer();
      const step = event.shiftKey ? 15 : 5;
      if (event.key === 'Home') lookToward('stage');
      else if (event.key === 'ArrowLeft') viewerYaw -= step;
      else if (event.key === 'ArrowRight') viewerYaw += step;
      else if (event.key === 'ArrowUp') viewerPitch += step;
      else if (event.key === 'ArrowDown') viewerPitch -= step;
      else return;
      event.preventDefault();
      event.stopPropagation();
      applyViewerCamera();
    };
    const lookWheel = (event: WheelEvent) => {
      if (appearance.current.mode !== 'audience') return;
      event.preventDefault();
      clearAudition();
      const change = Math.sign(event.deltaY) * 2;
      const current = viewerSettings.current;
      updateViewer({
        ...current,
        fov: Math.max(45, Math.min(100, current.fov + change)),
      });
    };
    window.addEventListener('keydown', cancelEdit, true);
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', cancelPointer);
    renderer.domElement.addEventListener('pointerdown', lookDown);
    renderer.domElement.addEventListener('pointermove', lookMove);
    renderer.domElement.addEventListener('pointerup', lookEnd);
    renderer.domElement.addEventListener('pointercancel', lookEnd);
    renderer.domElement.addEventListener('keydown', lookKeys);
    renderer.domElement.addEventListener('wheel', lookWheel, { passive: false });
    const render = (now: number) => {
      if (contextLost) return;
      if (requestedAspect() !== renderedAspect) resize();
      const { project: p, time: t, playing: isPlaying } = state.current;
      const changed = p !== cachedProject;
      // A/B previews replace project data in this same stage. Refresh the frame, not the camera.
      if (changed) evaluator = new ShowEvaluator(p);
      if (changed || t !== lastTime || !evaluated) evaluated = evaluator.frame(t);
      const frame = evaluated,
        look = appearance.current;
      position = frame.a.positions;
      destination = frame.b.positions;
      if (dragUpdates)
        for (const update of dragUpdates) destination.set(update.position, (update.id - 1) * 3);
      if (
        changed ||
        frame.index !== cachedIndex ||
        (evaluator.dynamic && t !== lastTime) ||
        dragUpdates
      ) {
        const attributes: Record<string, Float32Array> = {
          position,
          destination,
          shade: frame.a.shades,
          nextShade: frame.b.shades,
        };
        if (geometry.getAttribute('position')?.count !== p.droneCount) {
          geometry.dispose();
          geometry = new THREE.BufferGeometry();
          points.geometry = geometry;
        }
        for (const [name, array] of Object.entries(attributes)) {
          const attribute = geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
          if (attribute) {
            (attribute.array as Float32Array).set(array);
            attribute.needsUpdate = true;
          } else
            geometry.setAttribute(
              name,
              new THREE.BufferAttribute(array.slice(), 3).setUsage(THREE.DynamicDrawUsage)
            );
        }
        geometry.setDrawRange(0, p.droneCount);
        // Keep dense formations legible without changing their authored light values.
        material.uniforms.size.value = 5.2 * Math.min(1, Math.sqrt(800 / p.droneCount));
        perimeter.scale.setScalar(p.limits.radius);
        perimeter.computeLineDistances();
        cachedProject = p;
        cachedIndex = frame.index;
        dirty = true;
      }
      const audienceHighlight = audienceHighlightRef.current;
      const proposalHighlight = state.current.proposalTargets;
      const audienceTarget = state.current.readOnly
        ? proposalHighlight?.target ?? null
        : audienceHighlight.target;
      const audienceEnabled = state.current.readOnly
        ? Boolean(proposalHighlight?.enabled)
        : audienceHighlight.enabled;
      const audienceVisible = Boolean(
        frameAvailable &&
          look.mode === 'audience' &&
          audienceEnabled &&
          audienceTarget &&
          audienceHighlightIsCurrent(audienceTarget, p) &&
          audienceTarget.ids.length
      );
      const audienceChanged =
        audienceTarget !== lastAudienceTarget ||
        p !== lastAudienceProject ||
        t !== lastAudienceTime ||
        audienceVisible !== lastAudienceVisible;
      if (audienceChanged) {
        // Hidden targets retain membership but do no position writes or GPU uploads.
        if (audienceVisible && audienceTarget) {
          try {
            const required = audienceTarget.ids.length * 3;
            if (audienceRingPositions.length < required) {
              audienceRingGeometry.dispose();
              audienceRingGeometry = new THREE.BufferGeometry();
              audienceRingPositions = new Float32Array(required);
              audienceRingGeometry.setAttribute(
                'position',
                new THREE.BufferAttribute(audienceRingPositions, 3).setUsage(THREE.DynamicDrawUsage)
              );
              audienceRings.geometry = audienceRingGeometry;
            }
            writeAudienceHighlightPositions(
              audienceTarget.ids,
              position,
              destination,
              frame.progress,
              audienceRingPositions
            );
            audienceRingGeometry.setDrawRange(0, audienceTarget.ids.length);
            const attribute = audienceRingGeometry.getAttribute(
              'position'
            ) as THREE.BufferAttribute;
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(0, required);
            attribute.needsUpdate = true;
            audienceRingReady = true;
          } catch {
            // Invalid numerical geometry must not stop the show renderer or publish
            // partially written markers. Retry only when the target or frame changes.
            audienceRingReady = false;
            audienceRingGeometry.setDrawRange(0, 0);
          }
        }
        lastAudienceTarget = audienceTarget;
        lastAudienceProject = p;
        lastAudienceTime = t;
        lastAudienceVisible = audienceVisible;
        dirty = true;
      }
      audienceRings.visible = audienceVisible && audienceRingReady;
      const selectionChanged = state.current.selection !== previousSelection || changed;
      if (selectionChanged) {
        selectedIds = state.current.selection.filter((id) => id <= p.droneCount);
        previousSelection = state.current.selection;
      }
      const ids = selectedIds;
      if (
        look.mode === 'design' &&
        (selectionChanged || t !== lastTime || dragUpdates || cameraMode !== 'design')
      ) {
        if (markerGeometry.getAttribute('position')?.count !== ids.length) {
          markerGeometry.dispose();
          markerGeometry = new THREE.BufferGeometry();
          markerGeometry.setAttribute(
            'position',
            new THREE.BufferAttribute(new Float32Array(ids.length * 3), 3)
          );
          markers.geometry = markerGeometry;
        }
        const attribute = markerGeometry.getAttribute('position') as THREE.BufferAttribute;
        const marked = attribute.array as Float32Array,
          center = new THREE.Vector3(),
          point = new THREE.Vector3();
        for (let i = 0; i < ids.length; i++) {
          worldPoint(ids[i], frame.progress, point);
          marked.set([point.x, point.y, point.z], i * 3);
          center.add(point);
        }
        attribute.needsUpdate = true;
        if (ids.length && !transform.dragging) {
          proxy.position.copy(center.multiplyScalar(1 / ids.length));
          proxy.rotation.set(0, 0, 0);
          proxy.scale.set(1, 1, 1);
          proxy.updateMatrixWorld();
        }
        dirty = true;
      }
      markers.visible = look.mode === 'design';
      const canTransform =
        !state.current.readOnly &&
        look.mode === 'design' &&
        ids.length > 0 &&
        !isPlaying &&
        frame.progress > 0.001 &&
        ['translate', 'rotate', 'scale'].includes(state.current.tool);
      if (canTransform) {
        transform.setMode(state.current.tool as 'translate' | 'rotate' | 'scale');
        if (!transform.object) transform.attach(proxy);
      } else if (transform.object) transform.detach();
      if (firstFrame) {
        // Seed the alternate Design camera; the audience pose is applied below before rendering.
        fit('Orbit', false);
        firstFrame = false;
      }
      if (look.mode !== cameraMode) {
        if (look.mode === 'design') clearAudition(false);
        tween = null;
        pointer = null;
        lookPointer = null;
        setSelectionRect(null);
        if (look.mode === 'audience') {
          orbitPose = { position: camera.position.clone(), target: controls.target.clone() };
          // Drain OrbitControls' queued damping/pan deltas without changing the saved view.
          controls.enableDamping = false;
          controls.update();
          camera.position.copy(orbitPose.position);
          controls.target.copy(orbitPose.target);
          controls.update();
          controls.enableDamping = true;
          controls.enabled = false;
          applyViewerCamera();
        } else {
          camera.fov = 40;
          camera.updateProjectionMatrix();
          if (orbitPose) {
            camera.position.copy(orbitPose.position);
            controls.target.copy(orbitPose.target);
          }
          controls.update();
        }
        cameraMode = look.mode;
        renderer.domElement.style.cursor = cameraMode === 'audience' ? 'grab' : '';
        renderer.domElement.setAttribute(
          'aria-label',
          cameraMode === 'audience'
            ? 'Immersive 360 degree audience preview. Drag or use arrow keys to look around from a fixed eye-level position. Home faces the stage. Scroll changes the field of view.'
            : 'Interactive 3D drone show preview. Drag to orbit, right-drag to pan, and scroll to zoom.'
        );
        dirty = true;
      }
      advanceAudition(now);
      synchronizeViewer();
      controls.enabled =
        cameraMode === 'design' &&
        !transform.dragging &&
        (state.current.readOnly || state.current.tool !== 'box');
      venue.group.visible = cameraMode === 'audience';
      venue.stage.position.set(venueSettings.current.east, 0, -venueSettings.current.north);
      venue.stage.rotation.y = THREE.MathUtils.degToRad(180 - venueSettings.current.heading);
      if (cameraMode === 'audience' && now - headingUpdatedAt > 100) {
        headingUpdatedAt = now;
        const stage = headingToPoint(
          viewerSettings.current.east,
          viewerSettings.current.north,
          venueSettings.current.east,
          venueSettings.current.north
        );
        const fov =
          (Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) * 360) / Math.PI;
        setHeading((previous) =>
          previous.yaw === viewerYaw &&
          previous.pitch === viewerPitch &&
          previous.stage === stage &&
          previous.fov === fov
            ? previous
            : { yaw: viewerYaw, pitch: viewerPitch, stage, fov }
        );
      }
      if (look !== lastLook) dirty = true;
      lastLook = look;
      grid.visible = look.mode === 'design' && look.grid;
      perimeter.visible = grid.visible;
      bloom.enabled = look.mode === 'audience' && look.glow > 0;
      bloom.strength = look.glow;
      renderer.toneMappingExposure = look.exposure;
      material.uniforms.blend.value = frame.progress;
      material.uniforms.intensity.value = lightIntensity(t, p.bpm);
      if (t !== lastTime) dirty = true;
      lastTime = t;
      if (tween) {
        const progress = Math.min(1, (now - tween.start) / 420),
          eased = 1 - Math.pow(1 - progress, 3);
        camera.position.lerpVectors(tween.from, tween.to, eased);
        controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
        dirty = true;
        if (progress === 1) tween = null;
      }
      if (cameraMode === 'design') controls.update();
      let readyCapture: CaptureJob | null = null;
      const job = captureJob;
      if (job?.phase === 'queued') {
        // React may not yet have published pause's settled time. Only that original pair may wait.
        resize();
        const current = state.current;
        const readiness = reviewFrameReadiness(job, {
          project: current.project,
          version: current.reviewCapture?.version,
          sharedTime: current.reviewCapture?.sharedTime,
          sampledTime: current.time,
          playing: isPlaying,
          viewer: api.current?.snapshot(),
          aspect: camera.aspect,
          framing: requestedAspect() === null ? 'viewport' : 'captured',
          mode:
            cameraMode === 'audience' && appearance.current.mode === 'audience'
              ? 'audience'
              : 'design',
          available: frameAvailable,
          appearance: look,
        });
        if (readiness === 'changed')
          job.reject(new Error('The preview changed before capture. Capture the new view again.'));
        else if (readiness === 'ready') readyCapture = job;
      }
      if (frameAvailable && !contextLost && (dirty || isPlaying || readyCapture)) {
        composer.render();
        if (audienceRings.visible && !readyCapture) {
          const autoClear = renderer.autoClear;
          renderer.autoClear = false;
          try {
            renderer.render(audienceOverlay, camera);
          } finally {
            renderer.autoClear = autoClear;
          }
        }
        frames++;
        // The capture frame omits overlays. Repaint them on the next RAF even when
        // paused; toBlob has already copied the unmarked bitmap before that frame.
        dirty = Boolean(readyCapture && audienceRings.visible);
        if (readyCapture) {
          const pending = readyCapture;
          pending.phase = 'encoding';
          try {
            const metadata = buildCaptureMetadata({
              project: pending.project,
              version: pending.version,
              sharedTime: pending.sharedTime,
              sampledTime: pending.sampledTime,
              viewer: pending.viewer,
              aspect: pending.aspect,
              framing: pending.framing,
              raster: { width: renderer.domElement.width, height: renderer.domElement.height },
              appearance: pending.appearance,
            });
            // WebGL's default buffer can be discarded after this task: initiate the bitmap copy now.
            void encodeAudiencePng(renderer.domElement, { signal: pending.signal }).then(
              (blob) => pending.resolve({ blob, metadata }),
              (error: unknown) =>
                pending.reject(error instanceof Error ? error : new Error('Frame capture failed.'))
            );
          } catch (error) {
            pending.reject(error instanceof Error ? error : new Error('Frame capture failed.'));
          }
        }
      }
      if (now - measuredAt > 1000) {
        if (isPlaying) setFps(Math.round((frames * 1000) / (now - measuredAt)));
        frames = 0;
        measuredAt = now;
      }
      request = requestAnimationFrame(render);
    };
    // Reuse recall's atomic ref baselines so initial seat/venue placement cannot reset yaw/pitch.
    // This runs once per renderer setup, after lookPointer initialization and before any frame.
    api.current.recall(initialViewer);
    request = requestAnimationFrame(render);
    return () => {
      audition = null;
      captureJob?.reject(new DOMException('Preview closed.', 'AbortError'));
      cancelAnimationFrame(request);
      observer.disconnect();
      controls.dispose();
      window.removeEventListener('keydown', cancelEdit, true);
      transform.dispose();
      markerGeometry.dispose();
      markerMaterial.dispose();
      audienceRingGeometry.dispose();
      audienceRingMaterial.dispose();
      audienceOverlay.clear();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', cancelPointer);
      renderer.domElement.removeEventListener('pointerdown', lookDown);
      renderer.domElement.removeEventListener('pointermove', lookMove);
      renderer.domElement.removeEventListener('pointerup', lookEnd);
      renderer.domElement.removeEventListener('pointercancel', lookEnd);
      renderer.domElement.removeEventListener('keydown', lookKeys);
      renderer.domElement.removeEventListener('wheel', lookWheel);
      venue.dispose();
      geometry.dispose();
      material.dispose();
      skyGeometry.dispose();
      skyMaterial.dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      ringGeometry.dispose();
      ringMaterial.dispose();
      bloom.dispose();
      output.dispose();
      renderPass.dispose();
      composer.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      renderer.dispose();
      renderer.domElement.remove();
      api.current = null;
      if (captureViewerRef) captureViewerRef.current = null;
      if (recallViewerRef) recallViewerRef.current = null;
    };
  }, []);
  const frame = frameAt(project, time);
  return (
    <section
      className={`stage pro-stage ${look.mode}${look.mode === 'audience' && capturedFrameEnabled && capturedAspect !== null ? ' captured-audience-frame' : ''}`}
      aria-label="Show preview"
    >
      <div className="stage-canvas" ref={host} />
      {selectionRect && (
        <div
          className="selection-marquee"
          style={{
            left: selectionRect.x,
            top: selectionRect.y,
            width: selectionRect.width,
            height: selectionRect.height,
          }}
        />
      )}
      {error && (
        <div className="stage-error" role="alert">
          {error}
        </div>
      )}
      <div className="viewer-top">
        <div className="viewer-modes" aria-label="Preview mode">
          <button
            aria-pressed={look.mode === 'audience'}
            onClick={() => {
              setLook({ ...look, mode: 'audience' });
              host.current?.querySelector('canvas')?.focus({ preventScroll: true });
            }}
          >
            <Aperture size={13} />
            Viewer <span className="viewer-360-tag">360°</span>
          </button>
          <button
            aria-pressed={look.mode === 'design'}
            onClick={() => {
              api.current?.clearAudition?.();
              setLook({ ...look, mode: 'design' });
            }}
          >
            <Box size={13} />
            Design
          </button>
        </div>
        <div className="viewer-actions">
          <ReviewFrameCapture
            available={look.mode === 'audience'}
            capture={
              reviewCapture && !error
                ? (signal) =>
                    api.current?.captureFrame?.(signal) ??
                    Promise.reject(new Error('The preview is not ready. Reopen it and try again.'))
                : undefined
            }
          />
          {look.mode === 'audience' && capturedAspect !== null && (
            <button
              className="viewer-frame-button"
              aria-label="Use captured audience frame"
              aria-pressed={capturedFrameEnabled}
              title={`Captured aspect ${capturedAspect}:1. Match the recorded projection; camera and show time remain movable.`}
              onClick={() => setCapturedFrameEnabled((value) => !value)}
            >
              <Ratio size={13} />
              <span>Captured frame</span>
              <small>
                {capturedAspect.toLocaleString(undefined, { maximumSignificantDigits: 4 })}:1
              </small>
            </button>
          )}
          {look.mode === 'audience' && (
            <button
              aria-label="Audience camera audition"
              title="Rehearse a camera move between audience views"
              aria-expanded={auditionOpen}
              className={auditionOpen ? 'active' : ''}
              disabled={!!error}
              onClick={() => {
                api.current?.pauseAudition?.();
                setAuditionOpen(!auditionOpen);
                setViewerSettingsOpen(false);
                setLookOpen(false);
              }}
            >
              <Clapperboard size={14} />
            </button>
          )}
          {look.mode === 'audience' && (
            <button
              className="viewer-compare-button"
              aria-label="Compare audience views"
              title="Compare audience views over time"
              onClick={() => {
                api.current?.pauseAudition?.();
                onEditStart();
                setComparisonOpen(true);
              }}
            >
              <Grid2X2 size={13} />
              <span>Compare views</span>
            </button>
          )}
          {!readOnly && look.mode === 'audience' && (
            <button
              className="viewer-compare-button"
              aria-label="Select drones from audience view"
              title="Find drones by camera frame, stage direction, and light state"
              disabled={!!error}
              onClick={() => {
                api.current?.pauseAudition?.();
                onEditStart();
                setAudienceSelectionOpen(true);
              }}
            >
              <Scan size={13} />
              <span>Select from view</span>
            </button>
          )}
          {onOpenStudy && (
            <button
              className="viewer-study-button"
              onClick={onOpenStudy}
              aria-label="Explore a 360 degree study"
              title="Preview a surrounding show"
            >
              <Compass size={13} />
              <span>360° study</span>
            </button>
          )}
          {look.mode === 'design' && (
            <select
              aria-label="Camera view"
              value={view}
              onChange={(e) => {
                const next = e.target.value as CameraView;
                setView(next);
                api.current?.fit(next);
              }}
            >
              <option value="Orbit">Orbit camera</option>
              <option value="Front">Front camera</option>
              <option value="Top">Top camera</option>
            </select>
          )}
          <button
            aria-label={look.mode === 'audience' ? 'Face the stage' : 'Fit formation in view'}
            title={look.mode === 'audience' ? 'Face the stage · Home' : 'Fit formation'}
            onClick={() => api.current?.fit(view)}
          >
            <Focus size={15} />
          </button>
          {look.mode === 'audience' && (
            <button
              aria-label="Viewer position and lens"
              aria-expanded={viewerSettingsOpen}
              title="Viewer position and lens"
              className={viewerSettingsOpen ? 'active' : ''}
              onClick={() => {
                api.current?.pauseAudition?.();
                setAuditionOpen(false);
                setViewerSettingsOpen(!viewerSettingsOpen);
                setLookOpen(false);
              }}
            >
              <MapPin size={14} />
            </button>
          )}
          <button
            aria-label="Preview appearance"
            aria-expanded={lookOpen}
            title="Preview appearance"
            className={lookOpen ? 'active' : ''}
            onClick={() => {
              api.current?.pauseAudition?.();
              setAuditionOpen(false);
              setLookOpen(!lookOpen);
              setViewerSettingsOpen(false);
            }}
          >
            <Sun size={15} />
          </button>
          {!readOnly && (
            <button
              aria-label={focused ? 'Exit focused viewer' : 'Focus viewer'}
              aria-pressed={focused}
              title="Focus viewer · F"
              onClick={onFocus}
            >
              {focused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          )}
        </div>
      </div>
      {look.mode === 'audience' && (
        <>
          <div className="immersive-view-badge">
            <span /> INSIDE THE SHOW <i /> Eye level · {viewer.eyeHeight.toFixed(1)} m
          </div>
          <div className="immersive-orientation" aria-label="Audience orientation">
            <div className="immersive-heading">
              <Compass size={13} />
              <span>
                {heading.pitch > 70 ? 'Overhead' : viewDirectionLabel(heading.yaw, heading.stage)}
              </span>
              <b>{Math.round(heading.yaw) % 360}°</b>
            </div>
            <div className="immersive-compass" aria-hidden="true">
              <svg viewBox="0 0 88 88">
                <circle cx="44" cy="44" r="34" className="compass-ring" />
                <path d="M44 7v5M81 44h-5M44 81v-5M7 44h5" className="compass-ticks" />
                <g transform={`rotate(${heading.stage} 44 44)`}>
                  <rect x="36" y="6" width="16" height="3" rx="1" className="compass-stage" />
                </g>
                <g transform={`rotate(${heading.yaw} 44 44)`}>
                  <path
                    d={`M44 44 L${44 - Math.sin((heading.fov * Math.PI) / 360) * 30} ${44 - Math.cos((heading.fov * Math.PI) / 360) * 30} A30 30 0 0 1 ${44 + Math.sin((heading.fov * Math.PI) / 360) * 30} ${44 - Math.cos((heading.fov * Math.PI) / 360) * 30} Z`}
                    className="compass-cone"
                  />
                  <path d="M44 34l4 13-4-2-4 2z" className="compass-arrow" />
                </g>
              </svg>
              <span>STAGE</span>
            </div>
            <div className="immersive-look-controls" aria-label="Look directions">
              <button
                onClick={() => api.current?.lookToward('left')}
                aria-label="Look left of the stage"
              >
                Left
              </button>
              <button
                onClick={() => api.current?.lookToward('stage')}
                aria-label="Look toward the stage"
              >
                Stage
              </button>
              <button
                onClick={() => api.current?.lookToward('right')}
                aria-label="Look right of the stage"
              >
                Right
              </button>
              <button
                onClick={() => api.current?.lookToward('back')}
                aria-label="Look behind the audience"
              >
                Behind
              </button>
              <button onClick={() => api.current?.lookToward('sky')} aria-label="Look overhead">
                Sky ↑
              </button>
            </div>
          </div>
        </>
      )}
      {look.mode === 'audience' && auditionOpen && (
        <CameraAudition
          bookmarks={savedViews.bookmarks}
          status={auditionStatus}
          error={auditionError}
          onPrepare={({ fromId, toId, duration, easing }) => {
            try {
              const from =
                fromId === 'current'
                  ? undefined
                  : savedViews.bookmarks.find((item) => item.id === fromId);
              const to = savedViews.bookmarks.find((item) => item.id === toId);
              if (!to || (fromId !== 'current' && !from))
                throw new Error('Choose available saved views for this camera move.');
              if (!api.current?.prepareAudition)
                throw new Error('The preview is not ready. Reopen it and try again.');
              api.current.prepareAudition(
                from?.snapshot,
                to.snapshot,
                duration,
                easing,
                from?.name ?? 'Current view',
                to.name
              );
              setAuditionError('');
              return true;
            } catch (cause) {
              setAuditionError(
                cause instanceof Error ? cause.message : 'The camera move could not be prepared.'
              );
              return false;
            }
          }}
          onPlay={() => api.current?.playAudition?.()}
          onPause={() => api.current?.pauseAudition?.()}
          onSeek={(seconds) => api.current?.seekAudition?.(seconds)}
          onInspect={() => {
            api.current?.pauseAudition?.();
            onEditStart();
            setCameraReportOpen(true);
          }}
          onClear={() => {
            api.current?.clearAudition?.();
            setAuditionError('');
          }}
          onClose={() => {
            api.current?.pauseAudition?.();
            setAuditionOpen(false);
            host.current?.querySelector('canvas')?.focus({ preventScroll: true });
          }}
        />
      )}
      {look.mode === 'audience' && viewerSettingsOpen && (
        <ViewerSettings
          viewer={viewer}
          venue={venuePlacement}
          yaw={heading.yaw}
          horizontalFov={heading.fov}
          onViewerChange={updateViewer}
          onVenueChange={updateVenue}
          onClose={() => {
            setViewerSettingsOpen(false);
            host.current?.querySelector('canvas')?.focus({ preventScroll: true });
          }}
          bookmarks={savedViews.bookmarks}
          storageMessage={savedViews.message}
          onSave={(name) => {
            const snapshot = api.current?.snapshot();
            if (snapshot) savedViews.save(name, snapshot);
          }}
          onRecall={(id) => {
            const snapshot = savedViews.recall(id);
            if (snapshot) api.current?.recall(snapshot);
          }}
          onRemove={savedViews.remove}
        />
      )}
      {!readOnly && look.mode === 'design' && (
        <div className="viewport-edit-tools" aria-label="Viewport tools">
          {(
            [
              { id: 'select', label: 'Select drones', Icon: MousePointer2 },
              { id: 'box', label: 'Box select drones', Icon: Scan },
              { id: 'translate', label: 'Move selected drones', Icon: Move3D },
              { id: 'rotate', label: 'Rotate selected drones', Icon: RotateCw },
              { id: 'scale', label: 'Scale selected drones', Icon: Scaling },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              aria-label={label}
              title={label}
              aria-pressed={tool === id}
              onClick={() => setTool(id)}
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      )}
      {!readOnly && selection.length > 0 && (
        <div className="viewer-selection">
          <span>
            {selection.length === 1
              ? `Drone ${selection[0]}`
              : `${selection.length.toLocaleString()} selected`}
          </span>
          <button aria-label="Clear drone selection" onClick={() => onPick([], false)}>
            <X size={12} />
          </button>
        </div>
      )}
      {currentHighlight && look.mode === 'audience' && !error && (
        <AudienceHighlightControls
          target={currentHighlight}
          time={time}
          enabled={highlightEnabled}
          onToggle={() => setHighlightEnabled((value) => !value)}
          onClear={() => setAudienceHighlight(null)}
          onSelect={(additive) => {
            if (!audienceHighlightIsCurrent(currentHighlight, state.current.project)) return;
            selectMatches(currentHighlight.ids, additive);
          }}
          onRecall={
            onSeek
              ? () => {
                  if (!audienceHighlightIsCurrent(currentHighlight, state.current.project)) return;
                  onEditStart();
                  api.current?.recall(currentHighlight.request.snapshot);
                  onSeek(currentHighlight.request.time);
                }
              : undefined
          }
        />
      )}
      {readOnly && proposalTargets && (proposalTargets.overallCount ?? proposalTargets.totalCount) > 0 &&
        look.mode === 'audience' && !error &&
        audienceHighlightIsCurrent(proposalTargets.target, project) && (
          <ProposalTargetControls {...proposalTargets} />
        )}
      {lookOpen && (
        <div className="look-panel">
          <div>
            <strong>Viewer appearance</strong>
            <button
              aria-label="Reset preview appearance"
              title="Reset appearance"
              onClick={() => setLook(INITIAL_LOOK)}
            >
              <RotateCcw size={12} />
            </button>
          </div>
          <label>
            Exposure <output>{look.exposure.toFixed(2)}</output>
            <input
              aria-label="Preview exposure"
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={look.exposure}
              onChange={(e) => setLook({ ...look, exposure: Number(e.target.value) })}
            />
          </label>
          <label>
            Glow <output>{look.glow.toFixed(2)}</output>
            <input
              aria-label="Preview glow"
              type="range"
              min={0}
              max={1.8}
              step={0.05}
              disabled={look.mode === 'design'}
              value={look.glow}
              onChange={(e) => setLook({ ...look, glow: Number(e.target.value) })}
            />
          </label>
          <p>Display only. Exported light values stay unchanged.</p>
        </div>
      )}
      {look.mode === 'design' && (
        <button
          className={`viewer-grid ${look.grid ? 'active' : ''}`}
          aria-label="Toggle ground grid"
          aria-pressed={look.grid}
          onClick={() => setLook({ ...look, grid: !look.grid })}
        >
          <Grid2X2 size={14} />
          10 m grid
        </button>
      )}
      <div className="viewer-caption">
        <span className="viewer-scene-index">{String(frame.index + 1).padStart(2, '0')}</span>
        <div>
          <h1>{frame.cue.name}</h1>
          <span>
            {frame.progress < 1 ? 'Transition' : 'Formation'}
            <i />
            {project.droneCount.toLocaleString()} lights
          </span>
        </div>
      </div>
      <div className="viewer-bottom">
        <span className="viewer-clock">
          {timecode(time)}
          <span>{playing ? `${fps || '—'} fps` : 'PAUSED'}</span>
        </span>
        <span className="viewer-help">
          {!readOnly && look.mode === 'design'
            ? 'Click a light to select · Shift adds · drag to orbit'
            : look.mode === 'audience'
              ? 'Drag to look 360° · ↑ ↓ ← → look · Home faces stage'
              : 'Drag to orbit · scroll to zoom'}
        </span>
        <button
          aria-label={
            readOnly && comparisonExpansion
              ? comparisonExpansion.expanded
                ? 'Restore comparison viewer'
                : 'Expand comparison viewer'
              : 'Fullscreen preview'
          }
          title={
            readOnly && comparisonExpansion
              ? comparisonExpansion.expanded
                ? 'Restore comparison viewer · Escape'
                : 'Expand comparison viewer'
              : 'Fullscreen preview'
          }
          aria-pressed={readOnly && comparisonExpansion ? comparisonExpansion.expanded : undefined}
          onClick={() => {
            if (readOnly && comparisonExpansion) {
              comparisonExpansion.onToggle();
              return;
            }
            if (document.fullscreenElement) void document.exitFullscreen();
            else
              void host.current?.parentElement
                ?.requestFullscreen()
                .catch(() => setError('Fullscreen is unavailable in this browser.'));
          }}
        >
          {readOnly && comparisonExpansion?.expanded ? <Minimize2 size={14} /> : <Expand size={14} />}
        </button>
      </div>
      {cameraReportOpen && (
        <Modal title="Camera move analysis" onClose={() => setCameraReportOpen(false)}>
          <CameraMoveInspection
            project={project}
            time={time}
            capture={() => api.current?.captureAudition?.()}
            onClose={() => setCameraReportOpen(false)}
            onInspect={
              onSeek
                ? (next, snapshot) => {
                    api.current?.recall(snapshot);
                    onSeek(next);
                    setCameraReportOpen(false);
                  }
                : undefined
            }
          />
        </Modal>
      )}
      {audienceSelectionOpen && !readOnly && (
        <Modal title="Select from audience view" onClose={() => setAudienceSelectionOpen(false)}>
          <AudienceSelection
            project={project}
            time={time}
            selection={selection}
            capture={() => api.current?.captureContext()?.current}
            onClose={() => setAudienceSelectionOpen(false)}
            onPreview={(report) => {
              const target = createAudienceHighlight(state.current.project, report);
              onEditStart();
              api.current?.pauseAudition?.();
              setAudienceHighlight(target);
              setHighlightEnabled(true);
              setAudienceSelectionOpen(false);
            }}
            onSelect={(ids, additive) => {
              selectMatches(ids, additive);
              setAudienceSelectionOpen(false);
            }}
          />
        </Modal>
      )}
      {comparisonOpen && (
        <Modal title="Audience comparison" onClose={() => setComparisonOpen(false)}>
          <AudienceComparison
            project={project}
            time={time}
            capture={() => api.current?.captureContext()}
            onClose={() => setComparisonOpen(false)}
            onInspect={
              onSeek
                ? (next, snapshot) => {
                    api.current?.recall(snapshot);
                    onSeek(next);
                    setComparisonOpen(false);
                  }
                : undefined
            }
          />
        </Modal>
      )}
    </section>
  );
}
