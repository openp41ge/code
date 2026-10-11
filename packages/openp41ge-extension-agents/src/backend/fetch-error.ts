/**
 * describeFetchError — a readable message for a failed `fetch`.
 *
 * Node's `fetch` (undici) rejects every network failure with the same
 * "fetch failed" TypeError and puts the real reason in `cause`: a socket error
 * with a `code` (EHOSTUNREACH, ECONNREFUSED, ENOTFOUND, …) and the address it
 * tried, or an AggregateError of those when several addresses were tried.
 * This appends that reason, e.g. "fetch failed (EHOSTUNREACH 192.168.1.238:8000)".
 */

interface SocketErrorLike {
  code?: unknown;
  address?: unknown;
  port?: unknown;
  message?: unknown;
}

function describeCause(cause: SocketErrorLike): string | undefined {
  if (typeof cause.code === "string") {
    if (typeof cause.address !== "string") return cause.code;
    const port = typeof cause.port === "number" ? `:${cause.port}` : "";
    return `${cause.code} ${cause.address}${port}`;
  }
  return typeof cause.message === "string" && cause.message ? cause.message : undefined;
}

export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  let cause = err.cause as SocketErrorLike | undefined;
  if (!cause || typeof cause !== "object") return err.message;
  // Several addresses tried (e.g. IPv6 then IPv4): report the first failure.
  if (typeof cause.code !== "string" && cause instanceof AggregateError && cause.errors.length) {
    cause = cause.errors[0] as SocketErrorLike;
  }
  const reason = describeCause(cause);
  return reason ? `${err.message} (${reason})` : err.message;
}
