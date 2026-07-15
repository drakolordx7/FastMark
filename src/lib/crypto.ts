import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

function getSecret() {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("ENCRYPTION_SECRET must be set (min 16 chars)");
  }
  return secret;
}

function deriveKey(secret: string) {
  return scryptSync(secret, "fastmark-key-v1", 32);
}

export function encryptSecret(plain: string): string {
  const key = deriveKey(getSecret());
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) return null;
  const key = deriveKey(getSecret());
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/** Deterministic 384-d embedding fallback when no embedding model is configured. */
export function localEmbedding(text: string): number[] {
  const dim = 384;
  const vec = new Array<number>(dim).fill(0);
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return vec;
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    const h = createHash("sha256").update(token).digest();
    for (let i = 0; i < dim; i++) {
      const byte = h[i % h.length]!;
      vec[i]! += ((byte / 255) * 2 - 1) / Math.sqrt(tokens.length);
    }
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
