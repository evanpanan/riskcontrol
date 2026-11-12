export class NotificationTransportError extends Error {
  constructor(
    message: string,
    public readonly outcome: "failed" | "unknown",
  ) {
    super(message);
    this.name = "NotificationTransportError";
  }
}
export function unknownNotificationOutcome(error: unknown): boolean {
  return (
    error instanceof NotificationTransportError && error.outcome === "unknown"
  );
}
