// Unit tests for the email queue's reconnect (src/config/rabbitmq.ts): a dropped
// broker connection used to stop every queued email until the server restarted.
// Runs against the compiled build:
//   npm run build && npm run test:unit
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const rabbit = require(path.resolve("dist/config/rabbitmq.js"));

test("reconnect waits back off from 5 s to a 60 s ceiling", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(rabbit.reconnectDelayMs), [5000, 10000, 20000, 40000, 60000, 60000]);
});

test("the broker URL gets a 30 s heartbeat unless it names one", () => {
  assert.equal(rabbit.brokerUrl("amqps://u:p@host/vhost"), "amqps://u:p@host/vhost?heartbeat=30");
  assert.equal(rabbit.brokerUrl("amqps://host/v?frameMax=0"), "amqps://host/v?frameMax=0&heartbeat=30");
  assert.equal(rabbit.brokerUrl("amqps://host/v?heartbeat=10"), "amqps://host/v?heartbeat=10");
});

test("while the broker is away, emails are held (up to 500), not dropped", () => {
  const before = rabbit.pendingCount();
  assert.equal(rabbit.sendOrHold("email_queue", Buffer.from("{}")), true);
  assert.equal(rabbit.pendingCount(), before + 1);
  while (rabbit.pendingCount() < 500) rabbit.sendOrHold("email_queue", Buffer.from("{}"));
  assert.equal(rabbit.sendOrHold("email_queue", Buffer.from("{}")), false, "a full hold says so");
  assert.equal(rabbit.pendingCount(), 500);
});

test("a broker that isn't there is retried, not given up on", async () => {
  process.env.RABBITMQ_URL = "amqp://127.0.0.1:1";
  const warnings = [];
  const warn = console.warn;
  console.warn = (m) => warnings.push(String(m));
  try {
    await assert.rejects(rabbit.connectRabbitMQ(() => {}));
  } finally {
    console.warn = warn;
  }
  assert.ok(warnings.some((w) => /reconnecting in 5s/.test(w)), warnings.join("\n"));
});
