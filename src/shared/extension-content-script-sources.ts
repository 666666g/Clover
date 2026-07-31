/**
 * Runs inside an extension's isolated world. The source is deliberately static:
 * binding identity is read from the frozen `kunHost` bridge instead of being
 * interpolated into executable JavaScript.
 */
export const EXTENSION_CONTENT_SCRIPT_DEACTIVATION_SOURCE = `(() => {
  'use strict';
  const api = globalThis.kunHost;
  if (!api || typeof api.getContext !== 'function') return;
  const context = api.getContext();
  if (!context || typeof context !== 'object') return;
  const { extensionId, contributionId, marker } = context;
  if (typeof extensionId !== 'string' || typeof contributionId !== 'string' || typeof marker !== 'string') return;
  const detail = Object.freeze({ extensionId, contributionId });
  window.dispatchEvent(new CustomEvent('kun-extension-deactivate', { detail }));
  document.querySelectorAll('[data-kun-extension-style], [data-kun-extension-root]').forEach((node) => {
    if (node.getAttribute('data-kun-extension-style') === marker || node.getAttribute('data-kun-extension-root') === marker) node.remove();
  });
})();`
