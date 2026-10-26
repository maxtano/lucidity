import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

export interface Job {
  id: string;
  label: string;
  state: 'running' | 'completed' | 'failed' | 'stopped';
  output: string;
  startedAt: number;
  exitCode: number | null;
}
/** Explicit local execution. This is a developer terminal, not a sandbox. No provider credentials are inherited. */
export class WorkbenchService {
  private jobs = new Map<string, Job>();
  private processes = new Map<string, ChildProcess>();
  private launching = false;
  get busy() {
    return this.launching || this.processes.size > 0;
  }
  constructor(
    readonly root: string,
    private canRun = () => true
  ) {}
  private async directory() {
    await mkdir(this.root, { recursive: true });
    if ((await lstat(this.root)).isSymbolicLink())
      throw new Error('The workbench directory cannot be a symlink.');
    return realpath(this.root);
  }
  private async file(name: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.(js|mjs|ts|tsx|py|c|cpp|h|hpp|ino|yaml|yml|toml|ini|sh|json|txt|md|bin)$/.test(name))
      throw new Error('Use a simple source, script, configuration, text or .bin filename.');
    const root = await this.directory();
    const path = resolve(root, name);
    if (dirname(path) !== root) throw new Error('Invalid workspace path.');
    const stat = await lstat(path).catch(() => null);
    if (stat && (!stat.isFile() || stat.isSymbolicLink()))
      throw new Error('Only regular workspace files are supported.');
    return path;
  }
  async files() {
    const root = await this.directory();
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isFile() && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.(js|mjs|ts|tsx|py|c|cpp|h|hpp|ino|yaml|yml|toml|ini|sh|json|txt|md)$/.test(e.name)
      )
      .map((e) => e.name)
      .slice(0, 100);
  }
  async read(name: string) {
    const path = await this.file(name);
    if ((await lstat(path)).size > 200000)
      throw new Error('This file is too large for the editor.');
    return { name, content: await readFile(path, 'utf8') };
  }
  async save(name: string, content: string) {
    if (Buffer.byteLength(content) > 200000 || name.endsWith('.bin'))
      throw new Error('Text files must be at most 200 KB.');
    await writeFile(await this.file(name), content, { flag: 'w' });
    return { name, saved: true };
  }
  async firmware(content: string) {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new Error('Invalid firmware encoding.');
    const buffer = Buffer.from(content, 'base64');
    if (!buffer.length || buffer.length > 16000000)
      throw new Error('Firmware must be between 1 byte and 16 MB.');
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const name = `firmware-${sha256.slice(0, 16)}.bin`;
    await writeFile(await this.file(name), buffer);
    return { name, sha256, bytes: buffer.length };
  }
  listJobs() {
    return structuredClone([...this.jobs.values()].reverse());
  }
  async run(command: string) {
    if (!command.trim() || command.length > 4000 || command.includes('\0'))
      throw new Error('Enter a command under 4,000 characters.');
    return this.start('/bin/zsh', ['-f', '-c', command], command, 120000);
  }
  async esp(port: string, action: 'identify' | 'flash', filename?: string, address?: string) {
    if (!/^\/dev\/cu\.usb(?:modem|serial)[A-Za-z0-9._-]{0,180}$/.test(port))
      throw new Error('Choose a detected USB port.');
    const args = ['-m', 'esptool', '--port', port];
    if (action === 'identify') args.push('flash-id');
    else {
      if (
        !filename ||
        !/^firmware-[a-f0-9]{16}\.bin$/.test(filename) ||
        !/^0x[0-9a-fA-F]{1,8}$/.test(address ?? '')
      )
        throw new Error('Select firmware and its documented hexadecimal flash address.');
      const path = await this.file(filename);
      const digest = createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
      if (filename !== `firmware-${digest.slice(0, 16)}.bin`)
        throw new Error('The staged firmware changed. Select the original binary again.');
      args.push('write-flash', address!, path);
    }
    return this.start('python3', args, `esptool ${action} · ${port}`, 180000);
  }
  private async start(executable: string, args: string[], label: string, timeout: number) {
    if (this.busy) throw new Error('Stop or finish the current process first.');
    this.launching = true;
    let cwd: string;
    try {
      cwd = await this.directory();
    } catch (error) {
      this.launching = false;
      throw error;
    }
    if (!this.canRun()) {
      this.launching = false;
      throw new Error('Disconnect the aircraft before starting a terminal or flashing process.');
    }
    const job: Job = {
      id: randomUUID(),
      label,
      state: 'running',
      output: '',
      startedAt: Date.now(),
      exitCode: null,
    };
    while (this.jobs.size >= 20) this.jobs.delete(this.jobs.keys().next().value!);
    this.jobs.set(job.id, job);
    const child = spawn(executable, args, {
      cwd,
      detached: true,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        LANG: 'en_US.UTF-8',
        PYTHONUNBUFFERED: '1',
        TERM: 'dumb',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.processes.set(job.id, child);
    this.launching = false;
    const append = (data: Buffer) => {
      job.output = (job.output + data.toString()).slice(-100000);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = setTimeout(() => {
      this.stop(job.id);
      job.output += '\nProcess time limit reached.';
    }, timeout);
    child.on('error', (error) => {
      job.output += `\n${error.message}`;
      job.state = 'failed';
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      job.exitCode = code;
      if (job.state === 'running') job.state = code === 0 ? 'completed' : 'failed';
      this.processes.delete(job.id);
    });
    return structuredClone(job);
  }
  stop(id: string) {
    const child = this.processes.get(id);
    if (!child) return;
    const job = this.jobs.get(id)!;
    job.state = 'stopped';
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    const timer = setTimeout(() => {
      if (!this.processes.has(id)) return;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, 1500);
    timer.unref();
  }
  dispose() {
    for (const id of this.processes.keys()) this.stop(id);
  }
}
export const defaultWorkbenchRoot = (projectRoot: string) => join(projectRoot, 'workbench-files');
