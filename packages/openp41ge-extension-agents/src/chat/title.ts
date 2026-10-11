/**
 * Default title for a newly-created chat: a human-friendly date + time stamp,
 * e.g. "Sep 4, 2026, 1:23 PM". Used instead of a generic "New chat".
 */
export function defaultChatTitle(now: number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(now));
  } catch {
    return new Date(now).toLocaleString();
  }
}
