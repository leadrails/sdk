import type { LeadEventV1 } from "./types";
import { LeadRailsApiError, LeadRailsAuthError } from "./errors";
import { sha256Hex, hmacSha256Base64, buildSignatureBaseString } from "./sign";

export interface SendLeadEventConfig {
  clientId: string;
  sourceId: string;
  keyId: string;
  signingSecret: string;
  apiUrl?: string;
  /**
   * Override the X-LR-Idempotency-Key. Default is
   * `sha256(body + floor(now / window)).slice(0, 36)`. Same body
   * within the same window deduplicates on the intake side.
   */
  idempotencyKey?: string;
  /** Window in ms used to derive the default idempotency key. */
  idempotencyWindowMs?: number;
  /** Override fetch — useful for tests. */
  fetch?: typeof fetch;
  /** Override `now()` — useful for tests + clock-skew adjustments. */
  now?: () => Date;
  /** Optional observability hook fired on every request. */
  onRequest?: (info: {
    url: string;
    method: "POST";
    durationMs: number;
    status: number;
    errorCode?: string;
    requestId: string | null;
  }) => void;
  /** Optional observability hook fired on every thrown error. */
  onError?: (err: Error) => void;
}

export interface SendLeadEventResult {
  event_id: string;
  status: "accepted" | "already_accepted";
  delivery_job_count: number;
  workflow: string;
  /** The X-Request-Id echoed by intake (when present). */
  requestId: string | null;
}

const DEFAULT_API_URL = "https://intake.leadrails.dev";
const DEFAULT_IDEM_WINDOW_MS = 60_000;
const INTAKE_PATH = "/v1/lead-events";

/**
 * Sign a LeadEventV1 and POST it to the LeadRails intake endpoint.
 *
 * Throws:
 *   - LeadRailsAuthError if the server returns 401
 *   - LeadRailsApiError for any other non-2xx response
 *   - The underlying error if fetch itself throws after one retry
 */
export async function sendLeadEvent(
  event: LeadEventV1,
  config: SendLeadEventConfig,
): Promise<SendLeadEventResult> {
  const startedAt = Date.now();
  const onRequest = config.onRequest;
  const onError = config.onError;
  const f = config.fetch ?? fetch;
  const apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  const url = `${apiUrl}${INTAKE_PATH}`;
  const now = config.now ?? (() => new Date());

  const body = JSON.stringify(event);
  const bodySha = await sha256Hex(body);
  const timestamp = now().toISOString();
  const nonce = crypto.randomUUID().replace(/-/g, "");

  const idempotencyKey =
    config.idempotencyKey ??
    (await defaultIdempotencyKey(body, now(), config.idempotencyWindowMs ?? DEFAULT_IDEM_WINDOW_MS));

  const baseString = buildSignatureBaseString({
    timestamp,
    nonce,
    idempotencyKey,
    method: "POST",
    pathname: INTAKE_PATH,
    bodySha256Hex: bodySha,
  });
  const signature = await hmacSha256Base64(config.signingSecret, baseString);

  const headers = {
    "Content-Type": "application/json",
    "X-LR-Client-Id": config.clientId,
    "X-LR-Source-Id": config.sourceId,
    "X-LR-Key-Id": config.keyId,
    "X-LR-Timestamp": timestamp,
    "X-LR-Nonce": nonce,
    "X-LR-Idempotency-Key": idempotencyKey,
    "X-LR-Signature": `v1=${signature}`,
  };

  let response: Response;
  try {
    response = await fetchWithOneRetry(f, url, { method: "POST", headers, body });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    onError?.(e);
    throw e;
  }

  const requestId = response.headers.get("X-Request-Id");
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const errorCode = typeof parsed?.error === "string" ? parsed.error : `http_${response.status}`;
    const message =
      typeof parsed?.reason === "string"
        ? `LeadRails ${response.status} ${errorCode}: ${parsed.reason}`
        : `LeadRails ${response.status} ${errorCode}`;

    const ErrorClass = response.status === 401 ? LeadRailsAuthError : LeadRailsApiError;
    const apiErr = new ErrorClass({
      status: response.status,
      errorCode,
      requestId,
      body: parsed,
      message,
      redactPattern: config.signingSecret,
    });

    onRequest?.({
      url,
      method: "POST",
      durationMs: Date.now() - startedAt,
      status: response.status,
      errorCode,
      requestId,
    });
    onError?.(apiErr);
    throw apiErr;
  }

  onRequest?.({
    url,
    method: "POST",
    durationMs: Date.now() - startedAt,
    status: response.status,
    requestId,
  });

  return {
    event_id: String(parsed?.event_id ?? ""),
    status: (parsed?.status === "already_accepted" ? "already_accepted" : "accepted"),
    delivery_job_count: typeof parsed?.delivery_job_count === "number" ? parsed.delivery_job_count : 0,
    workflow: typeof parsed?.workflow === "string" ? parsed.workflow : "default",
    requestId,
  };
}

async function defaultIdempotencyKey(body: string, now: Date, windowMs: number): Promise<string> {
  const bucket = Math.floor(now.getTime() / windowMs);
  return (await sha256Hex(`${body}.${bucket}`)).slice(0, 36);
}

async function fetchWithOneRetry(
  f: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await f(url, init);
  } catch (err) {
    // One retry on transient network errors. Use the SAME signature
    // + idempotency key (caller has already set them in init.headers
    // and init.body) so the retry is byte-identical.
    if (isTransientNetworkError(err)) {
      return await f(url, init);
    }
    throw err;
  }
}

function isTransientNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Heuristic — fetch implementations vary. Common transient
  // signatures include TypeError ("fetch failed", "network error")
  // and AbortError. We deliberately don't retry on AbortError if
  // the consumer triggered the abort.
  if (err.name === "AbortError") return false;
  if (err.name === "TypeError") return true;
  return false;
}
