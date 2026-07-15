import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getIndexQueue } from "@/lib/queue";
import { handleRouteError, jsonOk } from "@/lib/api";

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin();
    const queue = getIndexQueue();
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);
    return jsonOk({
      queue: {
        name: queue.name,
        waiting,
        active,
        completed,
        failed,
        delayed,
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
