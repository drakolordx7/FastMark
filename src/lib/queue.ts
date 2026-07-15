import { Queue, type ConnectionOptions } from "bullmq";

export const INDEX_QUEUE = "fastmark-index";

export type IndexJobData = {
  bookmarkId: string;
  userId: string;
  html?: string;
};

export function redisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password || undefined,
    maxRetriesPerRequest: null,
  };
}

let queue: Queue<IndexJobData> | null = null;

export function getIndexQueue() {
  if (!queue) {
    queue = new Queue<IndexJobData>(INDEX_QUEUE, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return queue;
}

export async function enqueueIndex(data: IndexJobData) {
  const q = getIndexQueue();
  await q.add("index", data, {
    jobId: data.html
      ? `${data.bookmarkId}-manual-${Date.now()}`
      : `${data.bookmarkId}-${Date.now()}`,
  });
}

export async function getQueueStats() {
  const q = getIndexQueue();
  const [waiting, active, completed, failed, delayed, paused] =
    await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getCompletedCount(),
      q.getFailedCount(),
      q.getDelayedCount(),
      q.isPaused(),
    ]);
  return {
    name: q.name,
    waiting,
    active,
    completed,
    failed,
    delayed,
    paused,
  };
}
