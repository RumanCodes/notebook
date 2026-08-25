import type { WorkspaceSnapshot } from '../types';

export interface CloudUser {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface CloudWorkspaceResponse {
  workspace: WorkspaceSnapshot | null;
  revision: number | null;
  updatedAt: number | null;
}

export class CloudApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CloudApiError';
    this.status = status;
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json', 'X-Notebook-Request': '1' } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new CloudApiError('Cloud request timed out. Please try again.', 0);
    }
    throw new CloudApiError('Cloud service is unavailable. Please try again.', 0);
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : 'Cloud request failed.';
    throw new CloudApiError(message, response.status);
  }

  return payload as T;
}

export function isCloudConfigured(): boolean {
  return GOOGLE_CLIENT_ID.trim().length > 0;
}

export async function getSession(): Promise<{ authenticated: boolean; user: CloudUser | null }> {
  return apiFetch('/me.php');
}

export async function loginWithGoogle(credential: string): Promise<{ user: CloudUser }> {
  return apiFetch('/google-login.php', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  });
}

export async function logoutFromCloud(): Promise<void> {
  await apiFetch('/logout.php', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function deleteCloudAccount(): Promise<void> {
  await apiFetch('/delete-account.php', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function loadCloudWorkspace(): Promise<CloudWorkspaceResponse> {
  return apiFetch('/workspace.php');
}

export async function saveCloudWorkspace(workspace: WorkspaceSnapshot, baseRevision: number | null): Promise<{ revision: number; updatedAt: number }> {
  return apiFetch('/workspace.php', {
    method: 'PUT',
    body: JSON.stringify({ workspace, baseRevision }),
  });
}

export async function saveAndVerifyCloudWorkspace(workspace: WorkspaceSnapshot, baseRevision: number | null): Promise<{ revision: number; updatedAt: number }> {
  const saved = await saveCloudWorkspace(workspace, baseRevision);
  const verified = await loadCloudWorkspace();
  if (verified.revision !== saved.revision || !verified.workspace || JSON.stringify(verified.workspace) !== JSON.stringify(workspace)) {
    throw new CloudApiError('Cloud workspace could not be verified after saving.', 0);
  }
  return saved;
}
