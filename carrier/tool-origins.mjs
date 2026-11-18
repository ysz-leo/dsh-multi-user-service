import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { appendFileSync } from 'node:fs';
import { hostSourceCandidates, resolveHostPackage } from './host-package.mjs';

const DEBUG_LOG = process.env.DSH_LAN_DEBUG_LOG;
const trace = (stage, detail) => { if (!DEBUG_LOG) return; try { appendFileSync(DEBUG_LOG, JSON.stringify({ stage, time: new Date().toISOString(), ...(typeof detail === 'function' ? detail() : detail) }) + '\n'); } catch { /* diagnostics never affect registration */ } };

/** Read only Loader identity, never provider configuration or credentials. */
export function pluginOrigin(context) {
  const seen = new Set();
  for (let fiber = context?.fiber; fiber && !seen.has(fiber); fiber = fiber.parent?.fiber) {
    seen.add(fiber);
    const entry = fiber.entry;
    if (!entry?.options?.name || entry.options.group) continue;
    const plugin = entry.options.name;
    const server = plugin === '@deepseek-ai/dsh-mcp-client' ? entry.fiber?.config?.serverName : undefined;
    return { plugin, ...(typeof server === 'string' ? { mcpServer: server } : {}) };
  }
  return undefined;
}

/** Patch one ToolRuntime copy, writing every definition into the shared table. */
export function patchRuntime(ToolRuntime, origins) {
  const original = ToolRuntime.prototype.register;
  if (typeof original !== 'function') return undefined;
  const wrapper = function(definition) {
    const origin = pluginOrigin(this.ctx), dispose = original.call(this, definition);
    if (origin) origins.set(definition, Object.freeze(origin));
    return dispose;
  };
  ToolRuntime.prototype.register = wrapper;
  return () => { if (ToolRuntime.prototype.register === wrapper) ToolRuntime.prototype.register = original; };
}

/** Standalone single-copy install, retained for tests and manual hosts. */
export function recordToolOrigins(ToolRuntime) {
  const origins = new WeakMap();
  const dispose = patchRuntime(ToolRuntime, origins);
  if (dispose === undefined) throw new TypeError('Tool runtime does not expose register()');
  return {
    get: definition => origins.get(definition),
    service: receiver => pluginOrigin((receiver?.[Symbol.for('cordis.original')] ?? receiver)?.ctx),
    dispose,
  };
}

// The tools entry requires this service. Registration provenance is therefore
// installed before the native ToolRuntime and its contributing plugins start.
// A source-tree Host (tsx) and a createRequire lookup can load different module
// copies of @deepseek-ai/dsh-tools; scope/registration state is module-private,
// so every reachable copy is patched into ONE origins table and the live
// runtime's own class is patched last as the authoritative one.
export const name = 'multi-user-tool-origins';
export async function apply(ctx) {
  const origins = new WeakMap(), disposers = [], patched = [], seen = new Set();
  const register = (ToolRuntime, label) => {
    if (typeof ToolRuntime !== 'function' || seen.has(ToolRuntime)) return;
    const dispose = patchRuntime(ToolRuntime, origins);
    if (dispose === undefined) return;
    seen.add(ToolRuntime);
    disposers.push(dispose);
    patched.push(label);
  };
  let entry;
  try { entry = resolveHostPackage('@deepseek-ai/dsh-tools'); } catch { /* fall back to source candidates below */ }
  const specs = [];
  if (entry !== undefined) {
    specs.push([pathToFileURL(entry).href, entry]);
    const source = resolve(dirname(entry), '..', 'src', 'index.ts');
    specs.push([pathToFileURL(source).href, source]);
  }
  for (const file of hostSourceCandidates('packages/core/tools/src/index.ts')) specs.push([pathToFileURL(file).href, file]);
  specs.push(['@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-tools']);
  for (const [spec, label] of specs) {
    try {
      const loaded = await import(spec);
      register(loaded.ToolRuntime ?? loaded.default?.ToolRuntime, label);
    } catch { /* another copy may still carry the registration */ }
  }
  // The runtime the Host already created is authoritative: every member-side
  // registration goes through this very object's class.
  try {
    const service = ctx.get('tools');
    const runtime = service?.[Symbol.for('cordis.original')] ?? service;
    if (runtime !== undefined) register(Object.getPrototypeOf(runtime)?.constructor, 'live runtime');
  } catch { /* the imported copies above may already cover it */ }
  if (patched.length === 0) throw new Error('Host tool runtime is unavailable');
  trace('tool-origins', { patched });
  ctx.effect(() => () => { for (const dispose of disposers) dispose(); });
  ctx.provide('lanToolOrigins', {
    get: definition => origins.get(definition),
    service: receiver => pluginOrigin((receiver?.[Symbol.for('cordis.original')] ?? receiver)?.ctx),
  });
}
