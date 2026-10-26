import { mkdtemp, readFile, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchService } from './workbench-service';
import { validateTune, tuneToRtttl, motifs } from './music-model';
import { findTools, parameterLabel, toolGroups } from './catalog';
const roots: string[] = [];
const services: WorkbenchService[] = [];
async function fixture(canRun = () => true) {
  const root = await mkdtemp(join(tmpdir(), 'lucidity-workbench-test-'));
  roots.push(root);
  const service = new WorkbenchService(join(root, 'workspace'), canRun);
  services.push(service);
  return { root, service };
}
afterEach(async () => {
  services.splice(0).forEach((s) => s.dispose());
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('local code workspace boundaries', () => {
  it('saves and reads text only in its own directory', async () => {
    const { service } = await fixture();
    await service.save('test.mjs', "console.log('test');");
    expect(await service.files()).toEqual(['test.mjs']);
    expect((await service.read('test.mjs')).content).toContain("'test'");
    await expect(service.save('../escape.mjs', 'oops')).rejects.toThrow();
    await expect(service.read('.env')).rejects.toThrow();
    await expect(service.save('file.bin', 'text')).rejects.toThrow();
    await service.save('lights.ino', 'void setup() {} void loop() {}');
    expect((await service.read('lights.ino')).content).toContain('void setup');
  });
  it('refuses symlink files and preserves external content', async () => {
    const { root, service } = await fixture();
    await service.files();
    const target = join(root, 'external.txt');
    await writeFile(target, 'untouched');
    await symlink(target, join(root, 'workspace', 'test.txt'));
    await expect(service.save('test.txt', 'changed')).rejects.toThrow('regular');
    await expect(service.read('test.txt')).rejects.toThrow('regular');
    expect(await readFile(target, 'utf8')).toBe('untouched');
  });
  it('stages firmware under a hash and never executes it', async () => {
    const { service } = await fixture();
    const data = await service.firmware(Buffer.from([0xe9, 1, 2, 3]).toString('base64'));
    expect(data.sha256).toHaveLength(64);
    expect(data.bytes).toBe(4);
    expect(service.listJobs()).toEqual([]);
    expect((await readFile(join(service.root, data.name)))[0]).toBe(0xe9);
    await expect(service.esp('/tmp/invalid', 'identify')).rejects.toThrow('detected');
  });
  it('refuses a staged binary changed after its checksum was shown', async () => {
    const { service } = await fixture();
    const data = await service.firmware(Buffer.from([0xe9, 1, 2, 3]).toString('base64'));
    await writeFile(join(service.root, data.name), Buffer.from([0xe9, 9, 9, 9]));
    await expect(service.esp('/dev/cu.usbmodemTEST', 'flash', data.name, '0x0')).rejects.toThrow(
      'staged firmware changed'
    );
    expect(service.listJobs()).toEqual([]);
  });

  it('executes an explicit local command and captures bounded output and exit', async () => {
    const { service } = await fixture();
    const job = await service.run("printf 'lucidity-terminal-ok'");
    for (let i = 0; i < 50 && service.busy; i++) await new Promise((r) => setTimeout(r, 20));
    const result = service.listJobs().find((j) => j.id === job.id)!;
    expect(result.state).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('lucidity-terminal-ok');
  });
  it('reserves ownership during launch and refuses a connected-aircraft command', async () => {
    const { service } = await fixture(() => false);
    await expect(service.run('echo test')).rejects.toThrow('Disconnect');
    expect(service.busy).toBe(false);
    expect(service.listJobs()).toEqual([]);
  });
  it('allows only one process, stops its process group, and releases ownership', async () => {
    const { service } = await fixture();
    const job = await service.run('sleep 30');
    await expect(service.run('echo second')).rejects.toThrow('current process');
    service.stop(job.id);
    for (let i = 0; i < 100 && service.busy; i++) await new Promise((r) => setTimeout(r, 20));
    expect(service.busy).toBe(false);
    expect(service.listJobs()[0].state).toBe('stopped');
  });
});
describe('motor-melody artifacts', () => {
  it('exports pitches, rests and durations without any hardware command', () => {
    expect(
      tuneToRtttl({
        name: 'Test',
        bpm: 120,
        notes: [
          { midi: 60, beats: 1 },
          { midi: null, beats: 0.5 },
          { midi: 73, beats: 2 },
        ],
      })
    ).toBe('Test:d=4,o=5,b=120:4c4,8p,2c#5');
    for (const tune of motifs) expect(validateTune(tune)).toEqual(tune);
  });
  it('rejects malformed, out-of-range or unbounded tunes', () => {
    for (const input of [
      null,
      {},
      { ...motifs[0], bpm: 0 },
      { ...motifs[0], notes: [{ midi: 100, beats: 1 }] },
      { ...motifs[0], notes: Array(129).fill({ midi: 60, beats: 1 }) },
      { ...motifs[0], notes: [{ midi: 60, beats: 0.3 }] },
    ])
      expect(() => validateTune(input)).toThrow();
  });
});
describe('comprehensive tool discovery', () => {
  it('finds feature-level capabilities and distinguishes pending adapters', () => {
    expect(findTools('receiver').some((t) => t.id === 'receiver')).toBe(true);
    expect(findTools('PWM').map((t) => t.id)).toContain('esc');
    expect(toolGroups.find((t) => t.id === 'esc')?.action).toBe('esc');
    expect(new Set(toolGroups.map((t) => t.id)).size).toBe(19);
  });
  it('shows only known firmware values with raw names retained by the UI', () => {
    expect(parameterLabel('SERVO1_FUNCTION', 33)).toBe('Motor 1');
    expect(parameterLabel('FRAME_TYPE', 12)).toBe('BetaFlightX');
    expect(parameterLabel('FRAME_TYPE', 999)).toBeUndefined();
  });
});
