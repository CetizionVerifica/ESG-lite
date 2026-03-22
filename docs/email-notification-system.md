# Email Notification System

Emails are sent **asynchronously** via RabbitMQ + Mailgun. Controllers push jobs to the queue; a background worker picks them up, renders HTML templates, and sends via Mailgun.

---

## Flow

```
Controller (emission / productionData)
  └─ approve / reject / bulk approve / bulk reject
        │ sendToQueue(job)
        ▼
queues/emailProducer.ts  →  RabbitMQ: email_queue
        │
        ▼
workers/emailConsumer.ts
  ├─ picks HTML template from templates/emailTemplates.ts
  ├─ sends via services/emailService.ts → Mailgun
  ├─ throttles 1 email/sec to avoid Mailgun rate limits
  ├─ on rate limit (429) → retry_60s (longer backoff)
  ├─ on other failure → retry_5s → retry_30s → retry_60s
  └─ after 3 retries → dlq_queue → config/dlqConsumer.ts (3 more DLQ retries)
```

---

## Email Types

### Emission Notifications
| Trigger | Email Type | Recipients |
|---|---|---|
| Manager approves emission | `APPROVED` | Entry submitter |
| Manager rejects emission | `REJECTED` | Entry submitter |
| Manager bulk approves | `BULK_APPROVED` | Each unique entry submitter (one email per submitter) |
| Manager bulk rejects | `BULK_REJECTED` | Each unique entry submitter (one email per submitter) |

### Production Data Notifications
| Trigger | Email Type | Recipients |
|---|---|---|
| Manager approves production data | `PRODUCTION_APPROVED` | Entry submitter |
| Manager rejects production data | `PRODUCTION_REJECTED` | Entry submitter |
| Manager bulk approves | `BULK_PRODUCTION_APPROVED` | Each unique entry submitter (one email per submitter) |
| Manager bulk rejects | `BULK_PRODUCTION_REJECTED` | Each unique entry submitter (one email per submitter) |

### Deadline Notifications (Cron-based)
| Schedule | Email Type | Recipients |
|---|---|---|
| 10th of every month, 8:00 AM | `DEADLINE_REMINDER` | Users who haven't submitted data |
| 15th of every month, 8:00 AM | `DEADLINE_ESCALATION` | Managers (with list of pending users) |

### Email Content Includes
- **Who submitted** the data (submitter name & email)
- **Who approved/rejected** (manager name, email & role)
- **Rejection comment** (for rejection emails)
- **Pending user details** including name, email, role, site (for escalation emails)

---

## Key Files

| File | Purpose |
|---|---|
| `controllers/emission.controller.ts` | Approve/reject logic; fetches all site users; calls `sendToQueue()` |
| `controllers/productionData.controller.ts` | Same as above for production data |
| `queues/emailProducer.ts` | Publishes `EmailJob` to `email_queue` (persistent) |
| `types/email.ts` | TypeScript types for job payloads |
| `workers/emailConsumer.ts` | Consumes queue, renders template, sends email, handles retries with rate-limit awareness |
| `workers/deadlineScheduler.ts` | Cron jobs for 10th (user reminder) and 15th (manager escalation) |
| `templates/emailTemplates.ts` | HTML templates for all email types |
| `services/emailService.ts` | Thin Mailgun wrapper — `sendEmailForApprove()` |
| `config/rabbitmq.ts` | Connects to RabbitMQ; declares all queues |
| `config/dlqConsumer.ts` | Re-queues permanently failed messages (max 3 DLQ retries) |

---

## Retry Strategy

| Scenario | Queue | Delay |
|---|---|---|
| 1st failure (non-429) | `retry_5s` | 5 s |
| 2nd failure (non-429) | `retry_30s` | 30 s |
| 3rd failure (non-429) | `retry_60s` | 60 s |
| **Rate limit (429)** | **`retry_60s`** | **60 s** (always longest delay) |
| Max retries hit | `dlq_queue` | — |
| DLQ retries (×3) | `dlq_retry_60s` | 60 s each |

**Rate limit protection:**
- Consumer processes **1 email at a time** (`prefetch(1)`)
- **1 second delay** between each successful send
- **429 errors** always route to `retry_60s` (not `retry_5s`) to let Mailgun cool down
- After all DLQ retries exhausted → message dropped + admin failure alert sent to `ADMIN_EMAIL`

---

## Controller Behaviour

| Function | Status set | Comment required | Job type |
|---|---|---|---|
| `approveEmission` | `APPROVED` | No | `APPROVED` |
| `rejectEmission` | `REJECTED` | **Yes** | `REJECTED` |
| `bulkApproveEmissions` | `APPROVED` | No | `BULK_APPROVED` (per user) |
| `bulkRejectEmissions` | `REJECTED` | **Yes** | `BULK_REJECTED` (per user) |
| `approveProductionData` | `APPROVED` | No | `PRODUCTION_APPROVED` |
| `rejectProductionData` | `REJECTED` | **Yes** | `PRODUCTION_REJECTED` |
| `bulkApproveProductionData` | `APPROVED` | No | `BULK_PRODUCTION_APPROVED` |
| `bulkRejectProductionData` | `REJECTED` | **Yes** | `BULK_PRODUCTION_REJECTED` |

Only `PENDING` records are updated. Non-pending records are silently skipped in bulk operations.

---

## Startup Order (`index.ts`)

```ts
await connectRabbitMQ();      // declare all queues
await startEmailConsumer();   // listen on email_queue
await startDLQConsumer();     // listen on dlq_queue
startDeadlineScheduler();     // cron: 10th reminder, 15th escalation
app.listen(3000);
```

---

## Required Environment Variables

| Variable | Description |
|---|---|
| `RABBITMQ_URL` | e.g. `amqp://localhost` |
| `MAILGUN_DOMAIN` | Your Mailgun sending domain |
| `MAILGUN_API_KEY` | Mailgun private key |
| `ADMIN_EMAIL` | Receives failure alerts (default: `info@carbonlens.com`) |
| `FRONTEND_URL` | Used in password reset emails |
| `CORS_ORIGIN` | Frontend origin for CORS |

---

## Logging

All approve/reject actions log with prefixes for easy filtering:
- `[Emission]` — emission approve/reject/bulk operations
- `[ProductionData]` — production data approve/reject/bulk operations
- `[EmailConsumer]` — email send success/failure/retry

Example:
```
[Emission] APPROVE emission #42 by manager userId=5
[Emission] Emailing 3 site users for APPROVED
Email sent via Mailgun to user@example.com (APPROVED)
```

---

## Local Development

```bash
# Start RabbitMQ (Docker)
docker run -d --hostname rabbit --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management

# RabbitMQ Management UI
http://localhost:15672 (guest/guest)
```
