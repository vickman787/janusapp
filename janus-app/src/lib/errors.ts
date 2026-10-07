export function describeError(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "shortMessage" in error &&
    typeof error.shortMessage === "string") return error.shortMessage;
  return error instanceof Error ? error.message : fallback;
}
