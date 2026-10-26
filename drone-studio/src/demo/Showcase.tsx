import { lazy, Suspense, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bot, Check, CheckCheck, ChevronRight, CircleDot, Code2, Cpu, FileCheck2, Github, Layers3, Play, RotateCcw, Settings2, ShieldCheck, Sparkles, Terminal, Wrench } from 'lucide-react';
import { LucidityMark } from '../platform/Visuals';
import './showcase.css';

const ShowDemo = lazy(() => import('./Demo').then(module => ({ default: module.Demo })));
const repo = 'https://github.com/maxtano/lucidity';
const sections = [
  { id: 'setup', label: 'Setup & inspect', icon: Wrench },
  { id: 'configure', label: 'Configuration', icon: Settings2 },
  { id: 'firmware', label: 'Firmware & ESCs', icon: Cpu },
  { id: 'code', label: 'Code & tools', icon: Code2 },
  { id: 'analyze', label: 'Logs & evidence', icon: FileCheck2 },
  { id: 'shows', label: 'Show design', icon: Layers3 },
] as const;
type Section = typeof sections[number]['id'];
const initialParameters = [
  { key: 'FRAME_CLASS', label: 'Frame class', value: 1, unit: 'Quad' },
  { key: 'BATT_CAPACITY', label: 'Battery capacity', value: 1500, unit: 'mAh' },
  { key: 'BATT_MONITOR', label: 'Battery monitor', value: 4, unit: 'Voltage & current' },
  { key: 'SERIAL1_BAUD', label: 'Telemetry baud rate', value: 115, unit: '115200 baud' },
  { key: 'LOG_DISARMED', label: 'Log while disarmed', value: 0, unit: 'Off / On' },
];

function AircraftDiagram() {
  return <svg className="showcase-aircraft" viewBox="0 0 480 260" role="img" aria-label="Illustration of a quadcopter with its flight controller, ESCs, receiver and battery connected">
    <defs><pattern id="workbench-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="currentColor" opacity=".18" /></pattern></defs>
    <rect width="480" height="260" fill="url(#workbench-grid)" />
    <g stroke="currentColor" fill="none"><path d="M160 56 320 216 M320 56 160 216" strokeWidth="13" opacity=".18"/><path d="M160 56 320 216 M320 56 160 216" strokeWidth="1" opacity=".6"/>
      {[[160,56],[320,56],[160,216],[320,216]].map(([x,y],i)=><g key={i}><circle cx={x} cy={y} r="32" strokeDasharray="3 4" opacity=".45"/><ellipse cx={x} cy={y} rx="27" ry="7" transform={`rotate(${i%2?45:-45} ${x} ${y})`} opacity=".7"/><circle cx={x} cy={y} r="6"/></g>)}
      <rect x="214" y="107" width="52" height="58" rx="9" fill="var(--ds-surface)"/><rect x="224" y="119" width="32" height="32" rx="4"/>
      <path d="M228 107V79h-8V44 M266 133h83 M214 133H113 M240 165v53" strokeDasharray="3 3" opacity=".6"/>
    </g>
    <g fill="currentColor" fontSize="9" fontFamily="monospace"><text x="226" y="139">FC</text><text x="198" y="33">RECEIVER</text><text x="355" y="137">ESC × 4</text><text x="56" y="137">4S POWER</text><text x="222" y="243">TELEMETRY</text></g>
  </svg>;
}

export function Showcase() {
  const [section, setSection] = useState<Section>('configure');
  const [parameters, setParameters] = useState(initialParameters);
  const [draft, setDraft] = useState(1800);
  const [before, setBefore] = useState(1500);
  const [phase, setPhase] = useState<'ready'|'review'|'verified'>('ready');
  const [checks, setChecks] = useState<string[]>(['Controller identified', 'Configuration loaded']);
  const [firmwareInspected, setFirmwareInspected] = useState(false);
  const [show, setShow] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const capacity = parameters.find(parameter=>parameter.key==='BATT_CAPACITY')!.value;
  const changed = draft !== capacity;
  const prepare = () => { setSection('configure'); setDraft(capacity===1800?1500:1800); setPhase('review'); setAnnouncement('A simulated configuration change is ready to review.'); };
  const apply = () => {
    if (!changed) return;
    setBefore(capacity);
    setParameters(items=>items.map(item=>item.key==='BATT_CAPACITY'?{...item,value:draft}:item));
    setPhase('verified');
    setAnnouncement('Demo change applied and simulated readback matched. No aircraft was contacted.');
  };
  const reset = () => { setParameters(initialParameters); setBefore(1500); setDraft(1800); setPhase('ready'); setChecks(['Controller identified','Configuration loaded']); setFirmwareInspected(false); setAnnouncement('Preview reset.'); };
  if(show) return <><button className="showcase-return" onClick={()=>setShow(false)}><ArrowLeft size={14}/>Back to the workspace</button><Suspense fallback={<p className="showcase-loading">Loading show design…</p>}><ShowDemo /></Suspense></>;
  return <div className="showcase">
    <a className="demo-skip" href="#workspace">Skip to workspace</a>
    <header className="showcase-header"><a className="showcase-brand" href="./"><LucidityMark/><strong>lucidity</strong></a><span className="showcase-header-caption">THE AGENT-FIRST DRONE WORKSPACE</span><nav aria-label="Project links"><a href={`${repo}#the-vision`}>The vision</a><a href={repo}><Github size={15}/>GitHub<ArrowUpRight size={13}/></a></nav></header>
    <section className="showcase-intro"><div><span className="showcase-eyebrow">BUILD WITH CONTEXT. CHANGE WITH CONFIDENCE.</span><h1>Every part of your drone.<br/><em>One intelligent workspace.</em></h1><p>An agent-first home for drone setup, configuration, firmware, and code.<br className="showcase-desktop-break"/>Give people and agents the same tools—and keep the evidence with the build.</p></div><a className="showcase-explore" href="#workspace">Explore the workspace <ArrowRight size={17}/></a></section>
    <div className="showcase-preview-label"><span><CircleDot size={12}/>INTERACTIVE PRODUCT PREVIEW</span><span>Synthetic aircraft · Scripted agent walkthrough · Runs in your browser</span></div>
    <main className="showcase-workbench" id="workspace" tabIndex={-1}>
      <aside className="showcase-sidebar" aria-label="Workspace navigation"><div className="showcase-project"><span className="showcase-project-icon"><Cpu size={19}/></span><div><strong>Demo quad</strong><small>ArduPilot · 4S · Quad X</small></div></div><span className="showcase-nav-label">WORKSPACE</span><nav>{sections.map(item=><button key={item.id} aria-current={section===item.id?'page':undefined} onClick={()=>setSection(item.id)}><item.icon size={16}/>{item.label}{section===item.id&&<ChevronRight size={13}/>}</button>)}</nav><div className="showcase-local"><ShieldCheck size={16}/><span>Your tools. Your machine.<small>Hardware connections stay local.</small></span></div><button className="showcase-reset" onClick={reset}><RotateCcw size={12}/>Reset preview</button></aside>
      <section className="showcase-panel" aria-label="Selected workspace">
        <div className="showcase-panel-top"><span>Demo quad <ChevronRight size={11}/> {sections.find(item=>item.id===section)?.label}</span><span className="showcase-chip"><i/>SIMULATED</span></div>
        {section==='configure'&&<><div className="showcase-panel-title"><div><span className="showcase-eyebrow">INSPECT → PROPOSE → VERIFY</span><h2>Know exactly what changes.</h2><p>One configuration. Shared by you and your agent.</p></div><Settings2 size={24}/></div><div className="showcase-stats"><div><small>FLIGHT STACK</small><strong>ArduCopter <span>4.7.1</span></strong></div><div><small>PARAMETERS SHOWN</small><strong>05 <span>demo subset</span></strong></div><div><small>LAST READBACK</small><strong>{phase==='verified'?'Matched':'Loaded'} <span>simulated</span></strong></div></div>
          <div className="showcase-table-wrap"><table><caption>Aircraft parameters · synthetic snapshot</caption><thead><tr><th>Parameter</th><th>Value</th><th>Meaning</th></tr></thead><tbody>{parameters.map(parameter=><tr key={parameter.key} className={parameter.key==='BATT_CAPACITY'?'showcase-selected-row':''}><td><code>{parameter.key}</code><small>{parameter.label}</small></td><td>{parameter.value}</td><td>{parameter.unit}</td></tr>)}</tbody></table></div>
          <div className={`showcase-change ${phase==='verified'?'is-verified':''}`}><div className="showcase-change-title"><span>{phase==='verified'?<CheckCheck size={16}/>:<FileCheck2 size={16}/>} {phase==='verified'?'Change verified in the demo':'Review a precise change'}</span><small>{phase==='verified'?'READBACK MATCHED':'ONE PARAMETER'}</small></div><div className="showcase-diff"><div><code>BATT_CAPACITY</code><small>Battery capacity · mAh</small></div><span>{phase==='verified'?before:capacity}</span><ArrowRight size={14}/><label><span className="showcase-sr-only">Proposed battery capacity</span><select value={draft} onChange={event=>{setDraft(Number(event.target.value));setPhase('review');}}><option value="1500">1500</option><option value="1800">1800</option><option value="2200">2200</option></select></label></div><div className="showcase-change-footer"><small>{phase==='verified'?'The simulated value was written, read back, and recorded.':'Review the value before applying it to this synthetic aircraft.'}</small><button onClick={apply} disabled={!changed}>{phase==='verified'&&!changed?<><Check size={13}/>Verified</>:<>Apply demo change<ArrowRight size={13}/></>}</button></div></div>
        </>}
        {section==='setup'&&<><div className="showcase-panel-title"><div><span className="showcase-eyebrow">START WITH THE AIRCRAFT</span><h2>Bring the whole build into view.</h2><p>Components, connection state, and setup checks in one place.</p></div></div><AircraftDiagram/><div className="showcase-checks">{['Controller identified','Configuration loaded','Power system reviewed','Radio mapping reviewed'].map(label=><button key={label} aria-pressed={checks.includes(label)} onClick={()=>setChecks(items=>items.includes(label)?items.filter(item=>item!==label):[...items,label])}><span className={checks.includes(label)?'complete':''}>{checks.includes(label)?<Check size={13}/>:<CircleDot size={13}/>}</span>{label}<small>{checks.includes(label)?'Reviewed':'Mark reviewed'}</small></button>)}</div><p className="showcase-note">Illustrative setup checklist. These controls change only the local preview.</p></>}
        {section==='firmware'&&<><div className="showcase-panel-title"><div><span className="showcase-eyebrow">CONTROLLER TO MOTOR</span><h2>Keep every layer in context.</h2><p>Inspect versions, targets, and settings before changing firmware.</p></div></div><AircraftDiagram/><div className="showcase-inventory"><div><Cpu size={20}/><span><strong>Flight controller</strong><small>ArduCopter 4.7.1 · demo target</small></span><span className="showcase-tag">Identified</span></div><div><Layers3 size={20}/><span><strong>4-in-1 ESC</strong><small>Bluejay 0.21.0 · demo inventory</small></span><span className="showcase-tag">4 channels</span></div></div><button className="showcase-action" onClick={()=>setFirmwareInspected(true)}><FileCheck2 size={14}/>{firmwareInspected?'Inspection complete':'Inspect demo firmware'}</button>{firmwareInspected&&<p className="showcase-result"><Check size={14}/>Demo inventory matches the selected targets. The local app provides supported firmware and ESC workflows; this page does not flash hardware.</p>}</>}
        {section==='code'&&<><div className="showcase-panel-title"><div><span className="showcase-eyebrow">THE SAME PRIMITIVES</span><h2>Built for people. Addressable by agents.</h2><p>Structured operations keep intent, edits, and results inspectable.</p></div></div><div className="showcase-code"><div><Terminal size={14}/>A real show-editing CLI command</div><pre><code>{`npm run --silent agent -- \\\n  --command '{"type":"set_fleet","count":1200}' \\\n  --validate`}</code></pre></div><div className="showcase-principles"><p><strong>One command model</strong>Human and agent show edits use the same atomic operations.</p><p><strong>Explicit revisions</strong>Target an expected project revision and inspect structured results.</p><p><strong>Editable by design</strong>Keep source, configuration, and exported designs available for inspection.</p></div><a className="showcase-text-link" href={`${repo}/blob/main/drone-studio/docs/agent-tools.json`}>Read the existing tool contract <ArrowUpRight size={14}/></a><p className="showcase-note">General agent orchestration across hardware workspaces is the product direction. The current app has no integrated AI chat.</p></>}
        {section==='analyze'&&<><div className="showcase-panel-title"><div><span className="showcase-eyebrow">CLOSE THE LOOP</span><h2>A result you can inspect.</h2><p>Keep the proposed change and the observed state together.</p></div></div><div className="showcase-evidence"><FileCheck2 size={26}/><span className="showcase-tag">SYNTHETIC RECEIPT</span><h3>{phase==='verified'?'Configuration readback matched.':'Run a change to see its evidence.'}</h3><dl><dt>Target</dt><dd>Demo quad</dd><dt>Operation</dt><dd>BATT_CAPACITY</dd><dt>Observed value</dt><dd>{capacity} mAh</dd><dt>Verification</dt><dd>{phase==='verified'?'Matched in browser simulation':'Awaiting demo change'}</dd><dt>Hardware commands</dt><dd>None</dd></dl></div><p className="showcase-note">The local prototype also includes DataFlash log analysis. This preview shows the inspectable-change workflow using generated data.</p><button className="showcase-action" onClick={prepare}>Try a configuration change<ArrowRight size={14}/></button></>}
        {section==='shows'&&<><div className="showcase-panel-title"><div><span className="showcase-eyebrow">ONE WORKSPACE, MANY APPLICATIONS</span><h2>From configuration to choreography.</h2><p>Design motion and light with the real Lucidity show engine.</p></div></div><div className="showcase-show-art" aria-hidden="true">{Array.from({length:80},(_,i)=><i key={i} style={{left:`${50+Math.cos(i*.31)*(18+i*.19)}%`,top:`${50+Math.sin(i*.31)*(12+i*.22)}%`,opacity:.35+(i%7)/10}}/>)}</div><div className="showcase-show-caption"><h3>Make something move you.</h3><p>Six scenes, editable formations, light palettes, and a 3D audience preview.</p><button className="showcase-action" onClick={()=>setShow(true)}><Play size={14}/>Open interactive show design</button></div></>}
      </section>
      <aside className="showcase-agent" aria-label="Agent workflow preview"><div className="showcase-agent-heading"><span><Sparkles size={16}/>Agent workspace</span><span className="showcase-tag">CONCEPT</span></div><p className="showcase-agent-intro">Describe the outcome.<br/>Inspect every step.</p><div className="showcase-human-message">I’ve changed the battery. Update this build’s capacity and verify the result.</div><div className="showcase-agent-message"><Bot size={18}/><div><strong>{phase==='verified'?'The demo readback matches.':'Let’s make one exact change.'}</strong><p>{phase==='verified'?'The new value is recorded with its target and verification result. You can inspect it in Logs & evidence.':'I’ll inspect the current value, propose an update, and show you the difference before applying it.'}</p></div></div><ol className="showcase-agent-steps">{[['Inspect','Read the selected aircraft’s state'],['Propose','Prepare a single-parameter diff'],['Review','Keep you in control of the change'],['Verify','Read back and record the result']].map(([title,description],index)=><li key={title} className={phase==='verified'||index<(phase==='review'?2:1)?'done':''}><span>{phase==='verified'||index<(phase==='review'?2:1)?<Check size={12}/>:index+1}</span><div><strong>{title}</strong><small>{description}</small></div></li>)}</ol><button className="showcase-agent-button" onClick={phase==='verified'?()=>setSection('analyze'):prepare}>{phase==='verified'?'Inspect the receipt':'Walk through the change'}<ArrowRight size={14}/></button><p className="showcase-agent-disclosure">Scripted interaction showing the agent-first vision. No model is connected and no commands reach an aircraft.</p></aside>
    </main>
    <section className="showcase-bottom"><div><span className="showcase-eyebrow">EXPERT CAPABILITY. AGENT ACCESS.</span><h2>The tools should share the context.</h2></div><p>Lucidity is being built around a simple idea: setup, firmware, configuration, code, and evidence belong to the same aircraft. Precise tools make the workspace useful today. Shared context makes deeper agent collaboration possible.</p></section>
    <footer className="showcase-footer"><span>Early prototype · Local hardware tooling + browser preview</span><a href={`${repo}/blob/main/drone-studio/docs/PRODUCT_BRIEF.md`}>Explore the product vision<ArrowUpRight size={12}/></a></footer><p className="showcase-sr-only" role="status">{announcement}</p>
  </div>;
}
