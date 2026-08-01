const { Queue } = require("bullmq");
const IORedis = require("ioredis");
const connection = new IORedis(process.env.REDIS_URL || "redis://redis:6379");
const errorQueue = new Queue("errorQueue", { connection });

async function enqueueError(payload) {
  await errorQueue.add("processError", payload);
}

module.exports = { enqueueError, errorQueue };
