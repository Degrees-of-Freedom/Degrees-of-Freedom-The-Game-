/** Native controls and their descendants own their keys, including Enter on a
 * disclosure and printable keys in an editor. This also covers SVG buttons. */
export function controlOwnsKey(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    "button, input, select, textarea, summary, a[href], [role=button], [contenteditable]:not([contenteditable=false])",
  ));
}
