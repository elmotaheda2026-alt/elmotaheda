/**
 * Escapes untrusted text for safe HTML interpolation inside printouts and templates.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DANGEROUS_TAGS = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'applet',
  'meta',
  'base',
  'link',
  'form',
  'input',
  'textarea',
  'button',
  'select',
  'svg',
  'math',
]);

/**
 * Sanitizes authored HTML templates while preserving safe layout markup and inline styles.
 */
export function sanitizeTemplateHtml(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined') {
    return escapeHtml(html);
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (root: Element) => {
    const children = Array.from(root.children);
    for (const el of children) {
      const tag = el.tagName.toLowerCase();
      if (DANGEROUS_TAGS.has(tag)) {
        el.remove();
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const val = attr.value.trim().toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc') {
          el.removeAttribute(attr.name);
          continue;
        }
        if (
          (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action') &&
          (val.startsWith('javascript:') || val.startsWith('vbscript:') || val.startsWith('data:text/html'))
        ) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (name === 'style' && (val.includes('expression(') || val.includes('javascript:') || val.includes('url('))) {
          el.removeAttribute(attr.name);
        }
      }
      walk(el);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}
