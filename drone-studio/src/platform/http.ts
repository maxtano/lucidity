import type { IncomingMessage } from 'node:http';
export function readWorkbenchBody(req: IncomingMessage, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const length = req.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) {
      req.resume();
      reject(new Error('Request is too large.'));
      return;
    }
    let size = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      clearTimeout(timer);
      req.removeListener('data', data);
      req.removeListener('end', end);
      req.removeListener('error', fail);
      req.removeListener('aborted', aborted);
    };
    const fail = (error: Error) => {
      cleanup();
      req.resume();
      reject(error);
    };
    const aborted = () => fail(new Error('Request was cancelled.'));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) fail(new Error('Request is too large.'));
      else chunks.push(Buffer.from(chunk));
    };
    const end = () => {
      cleanup();
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON request.'));
      }
    };
    const timer = setTimeout(() => fail(new Error('Request body timed out.')), 15000);
    req.on('data', data);
    req.on('end', end);
    req.on('error', fail);
    req.on('aborted', aborted);
  });
}
