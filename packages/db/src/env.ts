import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root: the nearest ancestor containing pnpm-workspace.yaml. */
export function repoRoot(from = dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('repo root (pnpm-workspace.yaml) not found');
    dir = parent;
  }
  return dir;
}

/**
 * Loads the root .env into process.env without overriding variables that are already set
 * (so the shell and test setup win). Safe to call more than once.
 */
export function loadRootEnv(): void {
  const file = join(repoRoot(), '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export const DEFAULT_DATABASE_URL = 'postgres://ipp:ipp@127.0.0.1:5432/ipp';

export function databaseUrl(): string {
  loadRootEnv();
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === 'production')
    throw new Error('DATABASE_URL is required in production');
  return DEFAULT_DATABASE_URL;
}
