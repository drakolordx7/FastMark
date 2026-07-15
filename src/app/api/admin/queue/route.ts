import { requireAdmin } from "@/lib/auth";
import { getQueueStats } from "@/lib/queue";
import { db } from "@/lib/db";
import { bookmarks, systemSettings } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { handleRouteError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    await requireAdmin();
    const queue = await getQueueStats();
    const [sys] = await db.select().from(systemSettings).limit(1);
    const statusCounts = await db
      .select({
        status: bookmarks.status,
        count: sql<number>`count(*)::int`,
      })
      .from(bookmarks)
      .groupBy(bookmarks.status);

    return jsonOk({
      queue,
      indexConcurrency: sys?.indexConcurrency ?? 4,
      bookmarkStatuses: Object.fromEntries(
        statusCounts.map((r) => [r.status, r.count]),
      ),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
