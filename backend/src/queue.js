const { Queue } = require("bullmq");
const IORedis = require("ioredis");
const { createErrorQueueService } = require("./services/errorQueueService");

const connection = new IORedis(process.env.REDIS_URL || "redis://redis:6379");
const errorQueue = new Queue("errorQueue", { connection });
const queueService = createErrorQueueService(errorQueue, {
  attempts: process.env.JOB_ATTEMPTS,
  backoffMs: process.env.JOB_BACKOFF_MS,
});

module.exports = {
  ...queueService,
  errorQueue,
};
