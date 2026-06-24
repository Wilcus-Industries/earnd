/**
 * Renders one or more schema.org objects as a JSON-LD <script> block.
 *
 * `<script type="application/ld+json">` is a data block, not executable JS, so it
 * is not governed by the CSP `script-src` nonce policy — no nonce needed. The
 * content is server-controlled (never user input), so dangerouslySetInnerHTML is
 * safe here; we still guard against `</script>` breakout via a `<` escape.
 */
export function JsonLd({ data }: { data: object | object[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
