/**
 * Rewrite the filesystem provider's host→process path mapping so a member's
 * uploaded attachment resolves to its workspace mirror instead of the fenced
 * attachment store. DSH's LLM service writes this mapped path into the prompt
 * (``saved at "…"``), so the member's read tool — sandboxed to the conversation
 * workspace — opens the mirror directly.
 *
 * The host path is content-addressed (sha256) and therefore globally unique, so
 * the lookup needs no principal: the path alone identifies the grant.
 *
 * @module carrier/file-mapping
 */

const originalOf = value => value[Symbol.for('cordis.original')] ?? value;

/**
 * Wrap one filesystem provider's `processPathFromHostPath` so attachment store
 * paths resolve to their recorded workspace mirror. Paths with no recorded
 * mirror (owner uploads, legacy attachments) fall through to the original
 * mapping unchanged.
 * @param receiver - the `fs` service (or its cordis proxy).
 * @param attachmentAccess - a started {@link MemberAttachmentAccess}.
 * @returns a disposer that restores the original method.
 */
export function installMemberFileMapping(receiver, { attachmentAccess }) {
  const service = originalOf(receiver);
  const name = 'processPathFromHostPath';
  const original = service?.[name];
  if (typeof original !== 'function') return () => {};
  if (typeof attachmentAccess?.mirrorOf !== 'function') return () => {};
  const descriptor = Object.getOwnPropertyDescriptor(service, name);
  const wrapped = function (hostPath) {
    const mirror = typeof hostPath === 'string' ? attachmentAccess.mirrorOf(hostPath) : undefined;
    if (mirror !== undefined) return mirror;
    return original.call(this, hostPath);
  };
  service[name] = wrapped;
  return () => { if (service[name] === wrapped) { if (descriptor) Object.defineProperty(service, name, descriptor); else delete service[name]; } };
}
