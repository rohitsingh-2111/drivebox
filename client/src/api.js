export class ApiError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, options = {}) {
  const { body, ...rest } = options;
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...rest,
      credentials: 'include',
      headers: { ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Unable to reach Drivebox. Check your connection and try again.', 0, 'NETWORK_ERROR');
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('drivebox:session-expired'));
    throw new ApiError(data?.error?.message || 'Something went wrong. Please try again.', response.status, data?.error?.code, data?.error?.details);
  }
  return data;
}

export async function downloadFile(item, versionId) {
  const suffix = versionId ? `?versionId=${encodeURIComponent(versionId)}` : '';
  const response = await fetch(`/api/files/${encodeURIComponent(item.id)}/download${suffix}`, { credentials: 'include' });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(data?.error?.message || 'Unable to download this file.', response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = item.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function formatBytes(value) {
  const size = Number(value) || 0;
  if (size === 0) return '0 B';
  const unit = Math.min(Math.floor(Math.log(size) / Math.log(1024)), 4);
  return `${(size / 1024 ** unit).toFixed(unit === 0 ? 0 : 1).replace(/\.0$/, '')} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}

export function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}
