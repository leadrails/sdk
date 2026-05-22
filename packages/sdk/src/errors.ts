/**
 * Base class for every error thrown by the LeadRails SDK.
 * Stringification redacts any substring matching the configured
 * signing secret, so secrets cannot leak into logs / stack traces
 * captured by upstream error handlers.
 */
export abstract class LeadRailsError extends Error {
  protected readonly _redactPattern: string | undefined;

  constructor(message: string, redactPattern?: string) {
    super(message);
    this.name = this.constructor.name;
    this._redactPattern = redactPattern;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  override toString(): string {
    const raw = super.toString();
    if (!this._redactPattern) return raw;
    return raw.split(this._redactPattern).join("[REDACTED]");
  }
}

/**
 * Thrown when the intake server returns a non-2xx response.
 * `.status`, `.errorCode`, and `.requestId` carry the structured
 * detail. Use `errorCode` for stable programmatic branching
 * (`"auth_failed"`, `"replayed_nonce"`, `"schema_validation_failed"`,
 * `"idempotency_key_collision"`, etc.).
 */
export class LeadRailsApiError extends LeadRailsError {
  readonly status: number;
  readonly errorCode: string;
  readonly requestId: string | null;
  readonly body: unknown;

  constructor(args: {
    status: number;
    errorCode: string;
    requestId: string | null;
    body: unknown;
    message?: string;
    redactPattern?: string;
  }) {
    super(args.message ?? `LeadRails API error (${args.status} ${args.errorCode})`, args.redactPattern);
    this.status = args.status;
    this.errorCode = args.errorCode;
    this.requestId = args.requestId;
    this.body = args.body;
  }
}

/**
 * Subclass of LeadRailsApiError specifically for 401 responses.
 * Useful for `catch (e) { if (e instanceof LeadRailsAuthError) ... }`
 * when handling credential-rotation flows.
 */
export class LeadRailsAuthError extends LeadRailsApiError {
  constructor(args: ConstructorParameters<typeof LeadRailsApiError>[0]) {
    super(args);
  }
}

/**
 * Thrown when the SDK refuses to send a payload because of a
 * configuration problem on the consumer's side (e.g. secret
 * appeared to be loaded from a NEXT_PUBLIC_* env var).
 */
export class LeadRailsConfigError extends LeadRailsError {
  constructor(message: string) {
    super(message);
  }
}
