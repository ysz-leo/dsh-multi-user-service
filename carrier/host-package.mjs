import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function resolveHostPackage(specifier) {
  const entry = process.argv[1], bases = [];
  if (entry) {
    try { bases.push(realpathSync(entry)); } catch { /* missing entry only drops this base */ }
    bases.push(entry);
  }
  bases.push(import.meta.url);
  for (const base of bases) {
    try { return createRequire(base).resolve(specifier); } catch { /* try the next base */ }
  }
  throw new Error(`Host package ${specifier} is unavailable`);
}

/**
 * Absolute candidates for a repository-relative module, found by walking up
 * from the Host entry script. A source-tree Host (tsx) loads packages from
 * `packages/*\/src`, which a createRequire lookup can never resolve; these
 * candidates let the caller import the exact file the Host itself loaded.
 * @param relative - path below the repository root, e.g. `packages/core/tools/src/index.ts`.
 * @returns candidate absolute paths, nearest ancestor first; existence is left to the import attempt.
 */
export function hostSourceCandidates(relative) {
  const entry = process.argv[1], candidates = [];
  if (!entry) return candidates;
  let directory;
  try { directory = dirname(realpathSync(entry)); } catch { directory = dirname(resolve(entry)); }
  for (let depth = 0; depth < 8; depth += 1) {
    candidates.push(join(directory, relative));
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return candidates;
}
