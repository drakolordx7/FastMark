export function formatAiProviderError(err: unknown): string {
  if (!err) return "Unknown AI error";
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    const anyErr = err as Error & {
      status?: number;
      code?: string;
      error?: { message?: string };
    };
    const status = anyErr.status ? `HTTP ${anyErr.status}: ` : "";
    const detail =
      anyErr.error?.message || anyErr.message || "AI provider error";
    return `${status}${detail}`;
  }
  return "AI provider error";
}
