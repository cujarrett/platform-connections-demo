const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

const span = (cls: string, text: string): string =>
  text ? `<span class="${cls}">${escapeHtml(text)}</span>` : ""

/**
 * Colours the small slice of YAML these cards use. A full highlighter is a large
 * dependency for five short snippets, and since every snippet is block style there
 * is at most one key per line, which keeps this honest rather than approximate.
 */
export function highlightYaml(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      // No snippet contains a `#` inside a value, so the first one starts the comment.
      const hash = line.indexOf("#")
      const code = hash >= 0 ? line.slice(0, hash) : line
      const comment = hash >= 0 ? span("y-c", line.slice(hash)) : ""

      // indent, optional list dash, key, colon, value
      const keyed = code.match(/^(\s*)(-\s+)?([A-Za-z_][\w.-]*)(:)(\s*)(.*)$/)
      if (keyed) {
        const [, indent, dash, key, colon, gap, value] = keyed
        return (
          indent +
          (dash ? span("y-p", dash) : "") +
          span("y-key", key) +
          span("y-p", colon) +
          gap +
          span("y-val", value) +
          comment
        )
      }

      // a bare list item, e.g. `- "…/sa/authorized-api"`
      const item = code.match(/^(\s*)(-\s+)(.*)$/)
      if (item) {
        const [, indent, dash, value] = item
        return indent + span("y-p", dash) + span("y-val", value) + comment
      }

      return escapeHtml(code) + comment
    })
    .join("\n")
}
