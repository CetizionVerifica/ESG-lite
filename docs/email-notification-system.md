# Email Notification System

Emails are sent **asynchronously** when a manager approves or rejects emission submissions. The controller pushes a job to RabbitMQ; a background worker picks it up and sends via Mailgun.

---

## Flow

```
emission.controller.ts
  └─ approveEmission / rejectEmission / bulkApproveEmissions / bulkRejectEmissions
        │ sendToQueue(job)
        ▼
queues/emailProducer.ts  →  RabbitMQ: email_queue
        │
        ▼
workers/emailConsumer.ts
  ├─ picks HTML template from templates/emailTemplates.ts
  ├─ sends via services/emailService.ts → Mailgun
  ├─ on failure → retry_5s → retry_30s → retry_60s (auto dead-letter back)
  └─ after 3 retries → dlq_queue → config/dlqConsumer.ts (3 more DLQ retries)
```

---

## Key Files

| File | Purpose |
|---|---|
| `controllers/emission.controller.ts` | Approve/reject logic; calls `sendToQueue()` |
| `queues/emailProducer.ts` | Publishes `EmailJob` to `email_queue` (persistent) |
| `types/email.ts` | TypeScript types for job payloads |
| `workers/emailConsumer.ts` | Consumes queue, renders template, sends email, handles retries |
| `templates/emailTemplates.ts` | HTML templates (approved / rejected / bulk variants / failure) |
| `services/emailService.ts` | Thin Mailgun wrapper — `sendEmailForApprove()` |
| `config/rabbitmq.ts` | Connects to RabbitMQ; declares all queues |
| `config/dlqConsumer.ts` | Re-queues permanently failed messages (max 3 DLQ retries) |

---

## Job Types (`types/email.ts`)

```ts
// Single record
{ type: "APPROVED" | "REJECTED"; email; name; retryCount; categoryName?; siteName?; comment? }

// Bulk
{ type: "BULK_APPROVED" | "BULK_REJECTED"; email; name; retryCount; totalCount; categories: { categoryName; count }[]; comment? }
```

> For **bulk** actions, emissions are **grouped by submitter** — one email per user with a per-category breakdown table.

---

## Controller Behaviour

| Function | Status set | Comment required | Job type |
|---|---|---|---|
| `approveEmission` | `APPROVED` | No | `APPROVED` |
| `rejectEmission` | `REJECTED` | **Yes** | `REJECTED` |
| `bulkApproveEmissions` | `APPROVED` | No | `BULK_APPROVED` (per user) |
| `bulkRejectEmissions` | `REJECTED` | **Yes** | `BULK_REJECTED` (per user) |

Only `PENDING` emissions are updated. Non-pending records are silently skipped in bulk operations.

---

## Retry Strategy

| Attempt | Queue | Delay |
|---|---|---|
| 1st failure | `retry_5s` | 5 s |
| 2nd failure | `retry_30s` | 30 s |
| 3rd failure | `retry_60s` | 60 s |
| Max retries hit | `dlq_queue` | — |
| DLQ retries (×3) | `dlq_retry_60s` | 60 s each |

After all DLQ retries are exhausted, the message is dropped and an **admin failure alert** email is sent to `ADMIN_EMAIL`.

---

## Startup Order (`index.ts`)

```ts
await connectRabbitMQ();    // declare all queues
await startEmailConsumer(); // listen on email_queue
await startDLQConsumer();   // listen on dlq_queue
app.listen(3000);
```

---

## Required Environment Variables

| Variable | Description |
|---|---|
| `RABBITMQ_URL` | e.g. `amqp://localhost` |
| `MAILGUN_DOMAIN` | Your Mailgun sending domain |
| `MAILGUN_API_KEY` | Mailgun private key |
| `ADMIN_EMAIL` | Receives failure alerts |

<!-- to start rabbitmq -->
docker run -d --hostname rabbit --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management