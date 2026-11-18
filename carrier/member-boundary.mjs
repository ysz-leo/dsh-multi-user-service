import { appendFileSync, accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveHostPackage } from './host-package.mjs';
import { resolveSharedDirectories } from './file-ranges.mjs';

const DEBUG_LOG = process.env.DSH_LAN_DEBUG_LOG;
const trace = (stage, detail) => { if (!DEBUG_LOG) return; try { appendFileSync(DEBUG_LOG, JSON.stringify({ stage, time: new Date().toISOString(), ...(typeof detail === 'function' ? detail() : detail) }) + '\n'); } catch { /* diagnostics never affect execution */ } };
const originalOf = value => value[Symbol.for('cordis.original')] ?? value;
const inside = (root, value) => value === root || value.startsWith(root + '/');
const failure = (code, message) => { throw Object.assign(new Error(message), { code, status: 403 }); };
const PUBLIC_RUNTIME = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc/ld.so.cache', '/etc/ssl/certs', '/etc/ssl/openssl.cnf', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/gai.conf', '/dev/urandom', '/dev/random', '/dev/zero'];
const PUBLIC_ENV = /^(?:PATH|LANG|LANGUAGE|LC_[A-Z_]+|TZ|TERM|COLORTERM|SHELL|USER|LOGNAME|HOSTNAME|DSH_SESSION_ID|DSH_PTC_RUNTIME_NODE|ELECTRON_RUN_AS_NODE)$/;
const SCOPED_NATIVE_TOOLS = new Set(['bash', 'pwsh', 'fs', 'fs-search', 'working-directory', 'terminal', 'ask-user', 'subagent', 'subagent-control', 'todo', 'web', 'goal', 'jobs', 'schedule', 'workflow', 'skill'].map(name => '@deepseek-ai/dsh-tool-' + name));
SCOPED_NATIVE_TOOLS.add('@deepseek-ai/dsh-ptc-runtime-node');
// The account plugin exposes read-only status. The independent browser keeps
// its own mount/PID namespace and pipe-only debugger transport.
SCOPED_NATIVE_TOOLS.add('@ysz-leo/dsh-multi-user-service');
SCOPED_NATIVE_TOOLS.add('@ysz-leo/dsh-multi-user-service');
SCOPED_NATIVE_TOOLS.add('dsh-browser');

// Shared MCP processes and arbitrary plugin implementations can bypass the
// scoped native filesystem/subprocess services. A grant is not proof of isolation.
export const memberSourceIsolated = source => Boolean(source && !source.mcpServer && SCOPED_NATIVE_TOOLS.has(source.plugin));

/** Minimal stand-in for @deepseek-ai/node-addon-system: the launcher CLI
 * contract (flags, probe report, failure exit) is stable and versioned
 * together, so a plugin-only install still gets a probed boundary.
 */
function launcherContract(defaultLauncher) {
  return {
    launcherPath: () => defaultLauncher,
    grantArgs: ({ readOnly = [], readWrite = [] } = {}) => [
      ...readOnly.flatMap(root => ['--ro', root]),
      ...readWrite.flatMap(root => ['--rw', root]),
    ],
    probe: (candidate, { timeoutMs = 2000 } = {}) => {
      const result = spawnSync(candidate, ['--probe'], { timeout: timeoutMs, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return result.status !== 0 ? 'unusable' : /partially enforced/.test(result.stdout) ? 'partial' : 'full';
    },
    LAUNCHER_FAILURE_EXIT: 125,
  };
}

/** Data grants, not a second executor. Reuse the launcher bundled with DSH;
 * native subprocess handles, control pipes, PTYs and cancellation stay intact.
 * Neither a full-access preset nor a direct terminal launch may omit the grant.
 */
export async function createMemberBoundary({ runtimePaths = [], native, platform = process.platform, launchers: extraLaunchers = [] } = {}) {
  // The launcher may live in the Host's prebuilt platform package, in this
  // plugin's bundled native directory, or be built locally for this kernel.
  // Every candidate is accepted only after the functional probe verifies it.
  const LAUNCHER_FALLBACK = '/home/dsh/native/landlock-run';
  const bundled = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'native', 'landlock-run');
  let sdk = native, available = false, enforcement = 'unusable', launcher;
  try {
    if (sdk === undefined) {
      for (const spec of [
        () => pathToFileURL(resolveHostPackage('@deepseek-ai/node-addon-system/landlock-run')).href,
        () => pathToFileURL('/app/native/system/packages/entry/lib/index.js').href,
        () => '@deepseek-ai/node-addon-system/landlock-run',
      ]) {
        try { sdk = await import(spec()); break; } catch { /* try the next installation */ }
      }
    }
    const launchers = [];
    for (const candidate of [...extraLaunchers, bundled, LAUNCHER_FALLBACK]) {
      if (typeof candidate !== 'string' || !existsSync(candidate) || launchers.includes(candidate)) continue;
      // A copy made through a filesystem without mode bits may not be
      // executable; the functional probe below is the only availability gate.
      try { accessSync(candidate, constants.X_OK); } catch { try { chmodSync(candidate, 0o755); } catch { /* probe reports it unusable */ } }
      launchers.push(candidate);
    }
    if (sdk === undefined && launchers.length > 0) sdk = launcherContract(launchers[0]);
    if (sdk !== undefined) {
      try {
        const resolved = sdk.launcherPath();
        if (typeof resolved === 'string' && existsSync(resolved) && !launchers.includes(resolved)) launchers.push(resolved);
      } catch { /* the locally built launcher still counts */ }
      for (const candidate of launchers) {
        const verdict = platform === 'linux' ? sdk.probe(candidate, { timeoutMs: 2000 }) : 'unusable';
        // Landlock ABI 4 enforces the file access this boundary grants and
        // denies; only newer device access is missing, so partial confinement
        // still backs the member directory contract.
        if (verdict === 'full' || verdict === 'partial') { launcher = candidate; enforcement = verdict; break; }
        enforcement = verdict;
      }
      available = platform === 'linux' && launcher !== undefined;
    }
  } catch { /* Missing or incomplete native enforcement never enables execution. */ }
  trace('member-boundary', { verdict: enforcement, launcher, available });
  const prepared = new WeakMap();
  const canonical = value => realpathSync(value);
  const runtimeRoots = [...new Set([...PUBLIC_RUNTIME, process.execPath, ...runtimePaths].flatMap(value => {
    try { return [canonical(value)]; } catch { return []; }
  }))];
  const assertAvailable = () => {
    if (!available) failure('MEMBER_BOUNDARY_UNAVAILABLE', 'Member execution requires a working native directory boundary; execution is disabled on this host.');
  };
  const grantsFor = binding => {
    assertAvailable();
    const home = binding.home;
    if (typeof home !== 'string' || !home.startsWith('/') || canonical(home) !== home || !lstatSync(home).isDirectory()) failure('MEMBER_BOUNDARY_DENIED', 'A canonical private member home is required.');
    const info = lstatSync(home);
    if ((info.mode & 0o777) !== 0o700 || typeof process.getuid === 'function' && info.uid !== process.getuid()) failure('MEMBER_BOUNDARY_DENIED', 'The member home must remain private.');
    // Runtime directories must never contain member data or server secrets.
    if (runtimeRoots.some(root => inside(root, home) || inside(home, root))) failure('MEMBER_BOUNDARY_DENIED', 'Member data overlaps executable runtime files.');
    if (runtimeRoots.some(root => (binding.protectedRoots ?? []).some(secret => inside(root, secret)))) failure('MEMBER_BOUNDARY_DENIED', 'Protected server data overlaps a runtime read grant.');
    const shared = resolveSharedDirectories(binding.sharedDirectories ?? [], { protectedRoots: [home, ...(binding.protectedRoots ?? [])], readonlyRoots: runtimeRoots, strict: true });
    if (shared.some(parent => parent.mode === 'read-write' && shared.some(child => child.mode === 'read-only' && inside(parent.path, child.path)))) failure('MEMBER_BOUNDARY_DENIED', 'A read-only directory cannot be nested in a writable execution grant. Use separate shared directories.');
    const temp = join(home, '.tmp');
    try { mkdirSync(temp, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!lstatSync(temp).isDirectory() || lstatSync(temp).isSymbolicLink() || canonical(temp) !== temp) failure('MEMBER_BOUNDARY_DENIED', 'The private temporary directory is unsafe.');
    const cli = (binding.cli?.readOnlyPaths ?? []).map(canonical);
    const managedCli = binding.cli?.bin ? canonical(dirname(binding.cli.bin)) : undefined;
    if (cli.some(root => (binding.protectedRoots ?? []).some(protectedRoot => (inside(root, protectedRoot) || inside(protectedRoot, root))
      && !(managedCli && inside(managedCli, root))))) failure('MEMBER_BOUNDARY_DENIED', 'CLI runtimes cannot expose server state or another account directory.');
    if (cli.some(root => inside(home, root) || inside(root, home))) failure('MEMBER_BOUNDARY_DENIED', 'CLI programs must remain outside writable member directories.');
    if (cli.some(root => shared.some(row => row.mode === 'read-write' && (inside(root, row.path) || inside(row.path, root))))) failure('MEMBER_BOUNDARY_DENIED', 'CLI programs must remain outside writable shared directories.');
    return { home, temp, shared, cli };
  };
  const confine = (argv, binding, mode = 'workspace-write') => {
    const roots = grantsFor(binding);
    const minimal = values => [...new Set(values)].filter(value => !values.some(parent => parent !== value && inside(parent, value)));
    // A redundant child grant under a writable parent could be swapped for a
    // symlink between validation and launcher startup. Grant only stable roots.
    const readWrite = minimal(['/dev/null', ...(mode === 'read-only' ? [] : [roots.home, ...roots.shared.filter(row => row.mode === 'read-write').map(row => row.path)])]);
    const readOnly = minimal([...runtimeRoots, ...roots.cli, roots.home, ...roots.shared.map(row => row.path)]).filter(path => !readWrite.some(parent => inside(parent, path)));
    const wrapped = [launcher, ...sdk.grantArgs({ readOnly, readWrite }), '--', ...argv];
    prepared.set(wrapped, { userId: binding.userId, home: roots.home, shared: JSON.stringify(roots.shared), cli: JSON.stringify(roots.cli), mode });
    return { argv: wrapped, enforcement: 'full', denialSignatures: ['permission denied', 'operation not permitted'], runnerFailureRules: [{ allowedExitCodes: [sdk.LAUNCHER_FAILURE_EXIT], fatalSignatures: ['landlock-run:'] }] };
  };
  const prepare = (spec, binding, terminal = false) => {
    const roots = grantsFor(binding);
    const cwd = canonical(spec.cwd);
    if (!inside(roots.home, cwd) && !roots.shared.some(row => inside(row.path, cwd))) failure('MEMBER_BOUNDARY_DENIED', 'Execution is outside the personal and authorized shared directories.');
    const saved = prepared.get(spec.argv);
    const reuse = saved?.userId === binding.userId && saved.home === roots.home && saved.shared === JSON.stringify(roots.shared) && saved.cli === JSON.stringify(roots.cli);
    const env = Object.fromEntries(Object.keys(process.env).filter(key => !PUBLIC_ENV.test(key)).map(key => [key, undefined]));
    for (const [key, value] of Object.entries(spec.env ?? {})) {
      if (PUBLIC_ENV.test(key) || key === 'NODE_OPTIONS' && /^--max-old-space-size=\d+$/.test(value ?? '')) env[key] = value;
    }
    Object.assign(env, { HOME: roots.home, DSH_HOME: join(roots.home, '.dsh'), TMPDIR: roots.temp, TMP: roots.temp, TEMP: roots.temp, PWD: cwd,
      XDG_CONFIG_HOME: join(roots.home, '.config'), XDG_CACHE_HOME: join(roots.home, '.cache'), XDG_DATA_HOME: join(roots.home, '.local/share'), XDG_STATE_HOME: join(roots.home, '.local/state'),
      PATH: [binding.cli?.bin, join(roots.home, '.local/bin'), dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':') });
    return { ...spec, cwd, argv: reuse ? spec.argv : confine(spec.argv, binding).argv, env, ...(terminal ? { shellActivity: false } : {}) };
  };
  return { assertAvailable, confine, prepare, snapshot: () => ({ enforced: true, available, backend: 'dsh-native-landlock', sharedHostToolsBlocked: true, launcher, verdict: enforcement }) };
}

/** Wrap every native instance, including Agent-preset-local providers. Calls on
 * the trusted owner path keep the exact native argv, environment and handles.
 */
export function installMemberBoundary(receiver, { boundary, bindingForPolicy, bindingForExecution, prepareBinding, preparedBinding, kind, trusted = true }) {
  const service = originalOf(receiver), restores = [];
  const methods = kind === 'sandbox' ? ['confine'] : ['spawn', 'spawnTerminal'];
  for (const name of methods) {
    const original = service[name], descriptor = Object.getOwnPropertyDescriptor(service, name);
    if (typeof original !== 'function') failure('MEMBER_BOUNDARY_UNAVAILABLE', 'The native execution boundary cannot be installed.');
    const wrapped = kind === 'sandbox' ? function(argv, policy, signal) {
      const binding = bindingForPolicy(policy);
      if (!binding) return original.call(this, argv, policy, signal);
      if (!trusted) failure('MEMBER_BOUNDARY_UNAVAILABLE', 'This sandbox provider has no verified member directory boundary.');
      signal?.throwIfAborted();
      return Promise.resolve(prepareBinding ? prepareBinding(binding) : binding).then(value => {
        signal?.throwIfAborted();
        return boundary.confine(argv, value, policy.mode);
      });
    } : function(spec) {
      const binding = bindingForExecution(spec);
      if (binding && !trusted) failure('MEMBER_BOUNDARY_UNAVAILABLE', 'This subprocess provider has no verified member directory boundary.');
      if (!binding) return original.call(this, spec);
      // DSH spawn returns its handle synchronously; only terminal allocation
      // may await preparation. Never turn native handles into Promises.
      if (name === 'spawn') return original.call(this, boundary.prepare(spec, preparedBinding ? preparedBinding(binding) : binding));
      if (!prepareBinding) return original.call(this, boundary.prepare(spec, binding, name === 'spawnTerminal'));
      return Promise.resolve(prepareBinding(binding)).then(value => original.call(this, boundary.prepare(spec, value, name === 'spawnTerminal')));
    };
    service[name] = wrapped;
    restores.push(() => { if (service[name] === wrapped) { if (descriptor) Object.defineProperty(service, name, descriptor); else delete service[name]; } });
  }
  return () => { for (const restore of restores.reverse()) restore(); };
}

export function memberHome(binding) {
  const segment = '/' + binding.userId;
  const at = binding.cwd.indexOf(segment + '/');
  const home = at >= 0 ? binding.cwd.slice(0, at + segment.length) : binding.cwd.endsWith(segment) ? binding.cwd : undefined;
  if (!/^usr_[0-9a-f]{32}$/.test(binding.userId) || !home) failure('MEMBER_BOUNDARY_DENIED', 'Member execution has no private account home.');
  return resolve(home);
}
