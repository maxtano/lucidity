import { useEffect, useState } from 'react';
import { ArrowUpRight, Download, Github, Layers3, Pause, Play, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import { Stage } from '../components/Stage';
import { FormationThumb } from '../components/FormationThumb';
import { Modal } from '../components/Modal';
import { defaultProject, cueStart, frameAt, formatTime, palettes, paletteColors, shapeNames, shapes, totalDuration, type Cue, type Palette, type Shape } from '../core/model';
import { projectBundle } from '../core/export';
import { LucidityMark } from '../platform/Visuals';

const repository = 'https://github.com/maxtano/lucidity';
const demoView = { pose: { east: 0, north: -140, eyeHeight: 1.7, yaw: 0, pitch: 25, fov: 70 }, venue: { east: 0, north: 70, heading: 180 } };
const initial = () => ({ ...structuredClone(defaultProject), id: 'lucidity-public-demo', name: 'A little light, everywhere' });

export function Demo() {
  const [project, setProject] = useState(initial);
  const [time, setTime] = useState(36);
  const [playing, setPlaying] = useState(false);
  const [vision, setVision] = useState(false);
  const [tip, setTip] = useState(true);
  const [status, setStatus] = useState('');
  const duration = totalDuration(project);
  const current = frameAt(project, time).cue;
  useEffect(() => {
    if (!playing) return;
    let frame = 0, previous = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      setTime(value => (value + elapsed) % duration);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);
  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, []);
  const updateCue = (patch: Partial<Cue>) => {
    setPlaying(false);
    // Show the edited formation after its blend, so each control has an immediate result.
    setTime(cueStart(project, current.id) + current.duration - 0.01);
    setProject(value => ({ ...value, revision: value.revision + 1, cues: value.cues.map(cue => cue.id === current.id ? { ...cue, ...patch } : cue) }));
  };
  const select = (cue: Cue) => { setPlaying(false); setTime(cueStart(project, cue.id) + cue.duration - 0.01); };
  const reset = () => { setPlaying(false); setProject(initial()); setTime(36); setStatus('Demo reset.'); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(projectBundle(project, null), null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'lucidity-demo.lucid.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Design exported. Open it in the local Studio to continue editing.');
  };
  return <div className="demo-shell">
    <a className="demo-skip" href="#demo-workspace">Skip to demo</a>
    <header className="demo-header">
      <a className="demo-brand" href="./" aria-label="Lucidity demo home"><LucidityMark /><strong>lucidity</strong></a>
      <span className="demo-divider" />
      <span className="demo-product">Drone engineering, in one workspace.</span>
      <nav aria-label="Product links"><button onClick={() => setVision(true)}>The vision</button><a href={repository} target="_blank" rel="noreferrer"><Github size={15} />View source<ArrowUpRight size={13} /></a></nav>
    </header>
    <div className="demo-intro">
      <div><span className="demo-eyebrow">INTERACTIVE PREVIEW / DRONE SHOW</span><h1>Make something move you.</h1><p>Explore one part of Lucidity: choreograph light in three dimensions.</p></div>
      <span className="demo-status"><i />Browser simulation</span>
    </div>
    <main className="demo-workspace" id="demo-workspace" tabIndex={-1}>
      <aside className="demo-scenes" aria-label="Show scenes">
        <div className="demo-section-label"><Layers3 size={14} />STORYBOARD<span>06</span></div>
        <h2>A little light,<br />everywhere.</h2>
        <p className="demo-scene-description">Six scenes. One continuous sky.<br />Choose a moment to make it yours.</p>
        <div className="demo-scene-list">{project.cues.map((cue, index) => <button key={cue.id} aria-pressed={cue.id === current.id} onClick={() => select(cue)}>
          <FormationThumb cue={cue} /><span><small>0{index + 1} / {cue.duration}s</small><strong>{cue.name}</strong></span>
        </button>)}</div>
        <button className="demo-reset" onClick={reset}><RotateCcw size={13} />Reset demo</button>
      </aside>
      <div className="demo-center">
        <div className="demo-stage-wrap"><Stage project={project} time={time} playing={playing} focused={false} onFocus={() => {}} selection={[]} onPick={() => {}} onTransform={() => {}} onEditStart={() => setPlaying(false)} readOnly initialViewerSnapshot={demoView} onSeek={value => { setPlaying(false); setTime(value); }} /></div>
        <div className="demo-transport">
          <button className="demo-play" aria-label={playing ? 'Pause show' : 'Play show'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
          <span className="demo-time">{formatTime(time)}<small> / {formatTime(duration)}</small></span>
          <input type="range" aria-label="Show playhead" min="0" max={duration - 0.01} step="0.1" value={time} onChange={event => { setPlaying(false); setTime(Number(event.target.value)); }} />
          <span className="demo-tempo">120 BPM</span>
        </div>
        <div className="demo-timeline" aria-label="Scene timeline">{project.cues.map(cue => <button key={cue.id} style={{ flex: cue.duration }} aria-label={`Jump to ${cue.name}`} aria-current={cue.id === current.id ? 'step' : undefined} onClick={() => select(cue)}><span style={{ background: paletteColors[cue.palette][1] }} />{cue.name}</button>)}</div>
      </div>
      <aside className="demo-inspector" aria-label="Formation controls">
        <div className="demo-section-label"><SlidersHorizontal size={14} />MAKE IT YOURS</div>
        <h2>{current.name}</h2><p>Changes appear in the preview.</p>
        <label>Formation<select value={current.shape} onChange={event => updateCue({ shape: event.target.value as Shape })}>{shapes.filter(shape => shape !== 'custom').map(shape => <option key={shape} value={shape}>{shapeNames[shape]}</option>)}</select></label>
        <fieldset><legend>Light palette</legend><div className="demo-palettes">{palettes.map(palette => <button key={palette} aria-label={`${palette} palette`} title={palette} aria-pressed={palette === current.palette} onClick={() => updateCue({ palette: palette as Palette })}>{paletteColors[palette].map((color, i) => <i key={i} style={{ background: color }} />)}</button>)}</div></fieldset>
        <label><span>Lights<output>{project.droneCount.toLocaleString()}</output></span><input type="range" aria-label="Lights" min="100" max="2000" step="100" value={project.droneCount} onChange={event => { const droneCount = Number(event.target.value); setProject(value => ({ ...value, droneCount, revision: value.revision + 1 })); }} /></label>
        <label><span>Formation scale<output>{current.scale} m</output></span><input type="range" aria-label="Formation scale" min="30" max="100" step="1" value={current.scale} onChange={event => updateCue({ scale: Number(event.target.value) })} /></label>
        <label><span>Altitude<output>{current.altitude} m</output></span><input type="range" aria-label="Altitude" min="35" max="100" step="1" value={current.altitude} onChange={event => updateCue({ altitude: Number(event.target.value) })} /></label>
        <div className="demo-inspector-bottom"><button className="demo-export" onClick={download}><Download size={14} />Export design</button><p>Editable design file.<br />Flight planning is a separate step.</p></div>
      </aside>
    </main>
    <footer className="demo-footer"><span>Built with Lucidity’s actual choreography engine.</span><span>Local to this tab · No account · No aircraft connection</span></footer>
    <p className="demo-announcement" role="status">{status}</p>
    {tip && <div className="demo-tip"><span><strong>Start here</strong> Press play, try another palette, or switch to Design to orbit the formation.</span><button aria-label="Dismiss demo tip" onClick={() => setTip(false)}><X size={16} /></button></div>}
    {vision && <Modal title="One workspace. Every part of the build." onClose={() => setVision(false)}><div className="demo-vision">
      <span className="demo-eyebrow">THE LUCIDITY VISION</span><h2>From the first component<br />to the next experiment.</h2>
      <p>Building a drone means moving between parts lists, firmware tools, configuration screens, code, and flight logs. Lucidity aims to connect that work around the aircraft you are actually building.</p>
      <div className="demo-vision-steps"><p><strong>Build & configure</strong>Keep hardware, firmware and exact settings together.</p><p><strong>Program & test</strong>Make changes, inspect readback, and preserve what happened.</p><p><strong>Understand & iterate</strong>Connect results to the build that produced them.</p></div>
      <p>The long-term goal is a workspace where people and AI agents use the same precise, inspectable tools. Today’s prototype includes a 3D show editor, local ArduPilot integration, ESC workflows and log analysis. Cross-build orchestration and deeper agent workflows are still in development.</p>
      <a href={repository} target="_blank" rel="noreferrer">Explore the project on GitHub <ArrowUpRight size={15} /></a>
    </div></Modal>}
  </div>;
}
