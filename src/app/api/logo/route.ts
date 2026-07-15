import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { requireUser, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { systemSettings, userSettings } from "@/lib/db/schema";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const form = await req.formData();
    const file = form.get("file");
    const scope = String(form.get("scope") || "user");

    if (!file || typeof file === "string") {
      return jsonError("file required");
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.byteLength > 2_000_000) {
      return jsonError("Logo must be under 2MB");
    }

    const name = (file.name || "logo.png").toLowerCase();
    const ext = name.endsWith(".svg")
      ? ".svg"
      : name.endsWith(".webp")
        ? ".webp"
        : name.endsWith(".jpg") || name.endsWith(".jpeg")
          ? ".jpg"
          : ".png";

    if (scope === "system") {
      await requireAdmin();
    }

    const dir = path.join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    const filename =
      scope === "system"
        ? `system-logo${ext}`
        : `user-${user.id}${ext}`;
    await writeFile(path.join(dir, filename), bytes);
    const logoUrl = `/uploads/${filename}?t=${Date.now()}`;

    if (scope === "system") {
      await db
        .update(systemSettings)
        .set({ logoUrl, updatedAt: new Date() })
        .where(eq(systemSettings.id, 1));
    } else {
      await db
        .update(userSettings)
        .set({ logoUrl, updatedAt: new Date() })
        .where(eq(userSettings.userId, user.id));
    }

    return jsonOk({ logoUrl });
  } catch (err) {
    return handleRouteError(err);
  }
}
