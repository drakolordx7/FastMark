import assert from "node:assert/strict";
import { formatAiProviderError } from "./ai-errors";

assert.match(formatAiProviderError(new Error("timeout")), /timeout/);
assert.match(
  formatAiProviderError(Object.assign(new Error("bad gateway"), { status: 502 })),
  /HTTP 502/,
);

console.log("ai error formatting tests passed");
