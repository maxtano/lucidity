export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    cache: 'no-store',
    signal,
    ...(body !== undefined
      ? {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Lucidity-Aircraft': '1',
            'X-Lucidity-Workbench': '1',
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const content = await response.json().catch(() => null);
  if (!response.ok || content == null)
    throw new Error(
      content?.error ??
        'The local Lucidity service is unavailable. Start the local server and try again.'
    );
  return content as T;
}
export function downloadFile(name: string, contents: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong.';
