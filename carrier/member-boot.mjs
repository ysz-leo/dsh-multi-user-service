/**
 * Member index boot rows.
 *
 * The owner index is assembled by two Host packages a plugin cannot import:
 * `@deepseek-ai/dsh-client-modules` publishes the module boot rows through
 * `bootInjections(graph)`, and `@deepseek-ai/dsh-host-webserver` renders the
 * whole row table through `renderIndexInjections(html, rows)` plus the
 * `READY_MARKUP` tail. Both are pure functions over plain data, so this module
 * reproduces them for the member document. The graph comes from
 * `ctx.clientModules.graph()` at request time, with owner-only features omitted,
 * and every URL is relative to the member origin prefix `/lan/`.
 */

/** Package id whose client bundle supplies the module-system implementation. */
export const CLIENT_MODULES_ID = '@deepseek-ai/dsh-client-modules';

/** Global carrying the composed boot graph. */
export const MEMBER_BOOT_GLOBAL = '__DSH_BOOT__';

/**
 * Inline registration queue. Byte-identical to the stock row: it queues
 * registrations until the modules bundle materializes the module system.
 */
export const MEMBER_QUEUE_SCRIPT = `(()=>{
const pendingQueue=[]
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){
    if(this.mode!=="queue")throw new Error("client-modules: window.__ModuleLoader__.create called after module-system boot")
    const index=pendingQueue.findIndex(registration=>registration.id===${JSON.stringify(CLIENT_MODULES_ID)})
    const registration=pendingQueue[index]
    if(registration===undefined)throw new Error("client-modules: HTML did not preload ${CLIENT_MODULES_ID}/client.js")
    pendingQueue.splice(index,1)
    const exports=registration.factory(specifier=>{
      throw new Error('client-modules: ${CLIENT_MODULES_ID}/client.js requested external "'+specifier+'" before the module system existed')
    })
    if(typeof exports!=="object"||exports===null||typeof exports.createClientModuleSystem!=="function"||typeof exports.apply!=="function"){
      throw new Error("client-modules: ${CLIENT_MODULES_ID}/client.js did not export the bootstrap module face")
    }
    return exports.createClientModuleSystem(this,{id:registration.id,exports},options)
  }
}
})()`;

/** Tail script settling the boot-readiness deferred. */
export const MEMBER_READY_MARKUP = '<script>(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()<\/script>';

/** Prefix a document-relative or root-absolute asset URL with the member origin. */
export function memberUrl(src) {
  if (typeof src !== 'string' || src === '') return src;
  if (src.startsWith('/lan/')) return src;
  if (src.startsWith('/')) return `/lan${src}`;
  return src;
}

/**
 * Client modules whose member bundle is replaced by an empty one.
 *
 * The directory picker is the owner's folder chooser. A member gets its projects
 * from the Host and a new conversation folder appears by itself, so the chooser —
 * and the "add workspace" entry it enables — is not part of the member UI. The
 * module still loads (the boot manifest names it), it just registers nothing.
 */
export const NEUTRAL_CLIENT_MODULES = Object.freeze([
  '@deepseek-ai/dsh-client-ui-directory-picker-native',
  '@deepseek-ai/dsh-client-ui-directory-picker-browse',
]);

/** The no-op module body served in place of a hidden client bundle. */
export function neutralClientModule(id) {
  return `export const name = ${JSON.stringify(id)};\nexport const inject = [];\nexport function apply() {}\nexport default { name: ${JSON.stringify(id)}, inject: [], apply };\n`;
}

const OWNER_CLIENT_MODULES = new Set([
  '@deepseek-ai/dsh-client-ui-open-in-app',
  'dsh-better-sidebar',
]);

/** Plugins that only make sense next to the owner's better-sidebar. On the
 * `/lan/` member document they must be dropped together with better-sidebar,
 * because their client bundle declares an `inject: ["betterSidebar"]` symbol
 * that pulls `dsh-better-sidebar/client.js` into the composed combo URL even
 * though better-sidebar is never a top-level graph entry. */
const BETTER_SIDEBAR_DEPENDENTS = new Set([
  'dsh-bilingual-reader',
  'dsh-video-preview',
  '@huanlin/dsh-plugin-better-sidebar-plugin-audio',
]);

/**
 * Strip owner-only modules out of a composed combo URL. The client-modules
 * system inlines a module's transitive `inject` dependencies straight into the
 * batch `url` (e.g. `dsh-bilingual-reader` -> `dsh-better-sidebar/client.js`),
 * so filtering `graph.entries` alone leaves those bundles behind. Removing the
 * corresponding `/client.js` segments keeps the combo valid.
 */
function stripComboModules(url, ids) {
  if (typeof url !== 'string' || url === '' || ids.size === 0) return url;
  // The combo URL is `plugins/??<module>/client.js,<module>/client.js,...&rev=<hash>`.
  // The literal `??` is part of the loader prefix, and the `&rev=` revision is
  // attached with `&` (no standalone `?`), so split on the LAST `&`, never on `?`.
  const amp = url.lastIndexOf('&');
  const path = amp === -1 ? url : url.slice(0, amp);
  const query = amp === -1 ? '' : url.slice(amp);
  if (!path.includes(',')) return url;
  const segments = path.split(',');
  const kept = segments.filter(segment => {
    const module = segment.split('/').pop(); // "dsh-better-sidebar/client.js" -> "client.js"
    const id = segment.slice(0, segment.length - module.length - 1); // strip trailing "/client.js"
    return !ids.has(id);
  });
  return kept.length === segments.length ? url : `${kept.join(',')}${query}`;
}

/** Omit features that manage Host applications or execute Host plugins.
 * Combo bundles can still register their factories, but the member Loader must
 * not mount them. Keep the Host graph unchanged for the owner's document.
 *
 * `dsh-better-sidebar` (and plugins that only attach to it) is always omitted
 * on the `/lan/` member document — even for an administrator. Its file tree
 * calls `/sidebar/api/*`, which is routed through the owner's native fence
 * (expects the owner `dsh-auth-*` cookie, not the member `dsh_lan_member`
 * cookie), so loading it under `/lan/` makes every file read fail with a CSRF
 * rejection. Members (and admins browsing through `/lan/`) get the native
 * `sidebar-files` tree, which drives the standard `/lan/api/workspaceFiles/*`
 * channel. The full better-sidebar remains available on the owner entry
 * (`127.0.0.1:PORT`), where the native fence and cookie are present.
 */
export function memberClientGraph(graph, administrator = false) {
  // An administrator still omits better-sidebar on the member document; every
  // other owner-only module (e.g. the open-in-app desktop entry) is preserved
  // so Host management keeps working.
  const omitted = id => id === 'dsh-better-sidebar'
    || BETTER_SIDEBAR_DEPENDENTS.has(id)
    || (!administrator && OWNER_CLIENT_MODULES.has(id));
  const stripped = new Set([...OWNER_CLIENT_MODULES, ...BETTER_SIDEBAR_DEPENDENTS]);
  return {
    ...graph,
    entries: graph.entries.filter(entry => !omitted(entry.id)),
    batches: graph.batches.map(batch => ({
      ...batch,
      entries: batch.entries.filter(id => !omitted(id)),
      ...(batch.url ? { url: stripComboModules(batch.url, stripped) } : {}),
    })).filter(batch => batch.entries.length > 0),
  };
}

/**
 * Boot rows for one composed graph: registration queue, application preloads,
 * blocking bootstrap scripts, then the graph global — the stock order.
 * @param graph - the graph returned by `ctx.clientModules.graph()`.
 * @returns head/global injection rows.
 */
export function memberBootRows(graph) {
  const batches = Array.isArray(graph?.batches) ? graph.batches : [];
  const rows = [{ kind: 'script', placement: 'head', text: MEMBER_QUEUE_SCRIPT }];
  for (const batch of batches) if (batch.phase === 'application') rows.push({ kind: 'script-preload', src: memberUrl(batch.url) });
  for (const batch of batches) if (batch.phase === 'bootstrap') rows.push({ kind: 'script-src', placement: 'head', src: memberUrl(batch.url) });
  rows.push({ kind: 'global', name: MEMBER_BOOT_GLOBAL, value: graph });
  return rows;
}

/** True for a row that belongs to the owner module boot and must be replaced. */
export function isBootRow(row) {
  if (row === null || typeof row !== 'object') return false;
  if (row.kind === 'global') return row.name === MEMBER_BOOT_GLOBAL;
  if (row.kind === 'script') return typeof row.text === 'string' && row.text.includes('window.__ModuleLoader__');
  if (row.kind === 'script-src' || row.kind === 'script-preload') return typeof row.src === 'string' && /^(?:\/lan)?\/?plugins\/\?\?/.test(row.src);
  return false;
}

const escapeHtmlAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Render one row to markup with its placement (stock `renderRow`). */
function renderRow(row) {
  switch (row.kind) {
    case 'global': return { placement: 'head', markup: `<script>globalThis[${JSON.stringify(row.name).replaceAll('<', '\\u003c')}] = ${row.value === undefined ? 'undefined' : JSON.stringify(row.value).replaceAll('<', '\\u003c')}<\/script>` };
    case 'script': return { placement: row.placement, markup: `<script>${row.text}<\/script>` };
    case 'script-src': return { placement: row.placement, markup: `<script src="${escapeHtmlAttribute(row.src)}"><\/script>` };
    case 'script-preload': return { placement: 'head', markup: `<link rel="preload" as="script" href="${escapeHtmlAttribute(row.src)}">` };
    case 'style': return { placement: 'head', markup: `<style>${row.text}</style>` };
    case 'html': return { placement: row.placement, markup: row.html };
    default: throw new Error(`member boot: unknown index injection row ${JSON.stringify(row)}`);
  }
}

/**
 * Render rows into a document: head rows after the opening head tag, body rows
 * after the opening body tag, then the boot-readiness tail (stock
 * `renderIndexInjections`).
 * @param html - the frontend index.html.
 * @param rows - the injection table.
 * @returns the document with every row rendered.
 */
export function renderMemberIndexInjections(html, rows) {
  let head = '';
  let body = '';
  for (const row of rows) {
    const rendered = renderRow(row);
    if (rendered.placement === 'head') head += rendered.markup;
    else body += rendered.markup;
  }
  body += MEMBER_READY_MARKUP;
  let out = html;
  if (head !== '') {
    const open = /<head(?:\s[^>]*)?>/i.exec(out);
    out = open === null ? `${head}${out}` : `${out.slice(0, open.index + open[0].length)}${head}${out.slice(open.index + open[0].length)}`;
  }
  if (body !== '') {
    const open = /<body(?:\s[^>]*)?>/i.exec(out);
    out = open === null ? `${out}${body}` : `${out.slice(0, open.index + open[0].length)}${body}${out.slice(open.index + open[0].length)}`;
  }
  return out;
}
