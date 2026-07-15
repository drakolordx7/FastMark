import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/lib/auth";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function handleRouteError(err: unknown) {
  if (err instanceof AuthError) {
    return jsonError(err.message, err.status);
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path?.length ? first.path.join(".") + ": " : "";
    return jsonError(`${path}${first?.message ?? "Invalid input"}`, 400);
  }
  console.error(err);
  const message = err instanceof Error ? err.message : "Server error";
  return jsonError(message, 500);
}
