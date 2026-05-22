// HMAC-SHA-256 signing helpers. Web Crypto — available on every
// target runtime (Node ≥18, Bun, Deno, Cloudflare Workers, Vercel
// Edge). No external deps.

const subtle = globalThis.crypto?.subtle;

if (!subtle) {
  // This should be unreachable on supported runtimes; surface a
  // clear error if it does fire.
  throw new Error(
    "@leadrails/sdk: globalThis.crypto.subtle is unavailable. " +
      "This SDK requires Web Crypto (Node ≥18, Bun, Deno, Cloudflare Workers, Vercel Edge).",
  );
}

/** Lowercase-hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await subtle.digest("SHA-256", data);
  return bufferToHex(buf);
}

/** Base64 of HMAC-SHA-256(secret, message). */
export async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const keyData = new TextEncoder().encode(secret);
  const msgData = new TextEncoder().encode(message);
  const key = await subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign("HMAC", key, msgData);
  return bufferToBase64(sig);
}

/**
 * Build the canonical signature base string per the LeadRails
 * intake contract:
 *
 *   {timestamp}.{nonce}.{idempotency_key}.{method_lower}.{url_path}.{sha256_hex_of_body}
 *
 * See https://leadrails.dev/docs (or the intake worker auth.ts) for
 * the canonical specification.
 */
export function buildSignatureBaseString(args: {
  timestamp: string;
  nonce: string;
  idempotencyKey: string;
  method: string;
  pathname: string;
  bodySha256Hex: string;
}): string {
  return [
    args.timestamp,
    args.nonce,
    args.idempotencyKey,
    args.method.toLowerCase(),
    args.pathname,
    args.bodySha256Hex,
  ].join(".");
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const hex = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === undefined) continue;
    hex[i] = b.toString(16).padStart(2, "0");
  }
  return hex.join("");
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === undefined) continue;
    binary += String.fromCharCode(b);
  }
  if (typeof btoa === "function") return btoa(binary);
  // Node ≥16 always has Buffer, but verbatimModuleSyntax prevents
  // require/import dance here — fall back via globalThis lookup.
  const g = globalThis as unknown as { Buffer?: { from(s: string, enc: string): { toString(enc: string): string } } };
  if (g.Buffer) return g.Buffer.from(binary, "binary").toString("base64");
  throw new Error("@leadrails/sdk: no base64 encoder available (need btoa or Buffer)");
}
