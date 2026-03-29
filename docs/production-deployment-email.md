# Production Deployment Guide — Email Notification System

Steps to follow after merging `feature/emailnotification` into `main` and deploying to EC2.

---

## 1. Install RabbitMQ on EC2

RabbitMQ must be running on the same EC2 instance (or accessible from it).

### Option A: Docker (Recommended)

```bash
# Pull and run RabbitMQ with management plugin
docker run -d \
  --hostname rabbit \
  --name rabbitmq \
  --restart unless-stopped \
  -p 5672:5672 \
  -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=your_username \
  -e RABBITMQ_DEFAULT_PASS=your_strong_password \
  rabbitmq:3-management
```

### Option B: Amazon MQ (Managed)

If you don't want to manage RabbitMQ yourself, use [Amazon MQ for RabbitMQ](https://aws.amazon.com/amazon-mq/). It handles clustering, backups, and scaling.

---

## 2. Set Environment Variables

Add these to your EC2 `.env` file (or PM2 ecosystem config):

```env
# RabbitMQ
RABBITMQ_URL=amqp://your_username:your_strong_password@localhost:5672

# Mailgun
MAILGUN_API_KEY=your-mailgun-api-key
MAILGUN_DOMAIN=mail.carbon-lens.com

# Admin alert email (receives failure notifications)
ADMIN_EMAIL=info@carbonlens.com
```

**Important:** Do NOT set `NODE_ENV=development` in production. Leave it as `production` or unset.

---

## 3. Open Required Ports (Security Group)

| Port | Service | Access |
|---|---|---|
| `5672` | RabbitMQ (AMQP) | Internal only (127.0.0.1) — no public access needed |
| `15672` | RabbitMQ Management UI | Optional — restrict to your IP only for debugging |

**Do NOT expose port 5672 or 15672 to the public internet.**

If using Amazon MQ, it handles networking via VPC endpoints.

---

## 4. Deploy the Backend

```bash
# SSH into EC2
ssh -i your-key.pem ec2-user@your-ec2-ip

# Navigate to project
cd /path/to/pavithra

# Pull latest code
git pull origin main

# Install dependencies
npm install

# Build TypeScript
npm run build

# Restart with PM2
pm2 restart pavithra
# OR if first time:
pm2 start dist/index.js --name pavithra
pm2 save
```

---

## 5. Verify Everything is Running

### Check backend logs
```bash
pm2 logs pavithra
```

You should see:
```
📦 Database connected
✅ RabbitMQ connected with retry queues
Email consumer running...
♻️ DLQ reprocessor running...
Deadline scheduler started (10th reminder, 15th escalation).
🚀 Server running on http://localhost:3000
```

### Check RabbitMQ queues
```bash
# If using Docker RabbitMQ
docker exec rabbitmq rabbitmqctl list_queues name messages consumers

# Or via Management UI
http://your-ec2-ip:15672 (if port is open to your IP)
```

Expected queues:
- `email_queue` — main queue (should have 1 consumer)
- `retry_5s`, `retry_30s`, `retry_60s` — retry queues (0 consumers, auto dead-letter)
- `dlq_queue` — dead letter queue (should have 1 consumer)
- `dlq_retry_60s` — DLQ retry (0 consumers, auto dead-letter)

---

## 6. Test Email Flow

After deployment, test by approving/rejecting an emission from the frontend:
1. Login as manager
2. Approve a pending emission
3. Check PM2 logs for: `Email sent via Mailgun to user@example.com (APPROVED)`
4. Verify the user received the email

---

## 7. Cron Jobs (Automatic)

The deadline scheduler starts automatically with the backend — no separate cron setup needed.

| Schedule | What happens |
|---|---|
| 10th of every month, 8:00 AM (server time) | Reminder email to users who haven't submitted data |
| 15th of every month, 8:00 AM (server time) | Escalation email to managers with list of pending users |

**Note:** Server timezone matters. If EC2 is in UTC but you want 8 AM IST, either:
- Set EC2 timezone: `sudo timedatectl set-timezone Asia/Kolkata`
- Or adjust the cron schedule in `deadlineScheduler.ts` (e.g., `"30 2 10 * *"` for 2:30 AM UTC = 8:00 AM IST)

---

## 8. Mailgun Setup

Make sure your Mailgun account is configured for production:

1. **Verify your sending domain** (`mail.carbon-lens.com`) in Mailgun dashboard
2. **Add DNS records** (SPF, DKIM, MX) to avoid emails going to spam
3. **Check your plan limits** — free tier allows ~100 emails/hour. For production with many users, upgrade to a paid plan
4. **Add authorized recipients** — on free tier, Mailgun only sends to verified email addresses. On paid plans, this restriction is removed

---

## 9. Monitoring & Troubleshooting

### If emails aren't sending
```bash
# Check PM2 logs for errors
pm2 logs pavithra --lines 50

# Check RabbitMQ queue status
docker exec rabbitmq rabbitmqctl list_queues name messages
```

- If `email_queue` has messages piling up → consumer might have crashed, restart PM2
- If `dlq_queue` has messages → Mailgun is rejecting emails, check API key and domain
- If `retry_60s` has messages → rate limited, wait for them to auto-retry

### If stuck messages in retry queues
```bash
# Purge a queue (careful — deletes all messages in it)
docker exec rabbitmq rabbitmqctl purge_queue retry_5s
docker exec rabbitmq rabbitmqctl purge_queue retry_30s
docker exec rabbitmq rabbitmqctl purge_queue retry_60s
```

### RabbitMQ memory/disk issues
```bash
# Check RabbitMQ status
docker exec rabbitmq rabbitmqctl status

# If RabbitMQ is using too much memory, restart it
docker restart rabbitmq
```

---

## 10. RabbitMQ Persistence

RabbitMQ messages are **persistent** (durable queues + persistent delivery). If EC2 restarts or RabbitMQ restarts, messages are not lost.

However, if using Docker without a volume, data is lost when the container is removed. For production, mount a volume:

```bash
docker run -d \
  --hostname rabbit \
  --name rabbitmq \
  --restart unless-stopped \
  -p 5672:5672 \
  -p 15672:15672 \
  -v rabbitmq_data:/var/lib/rabbitmq \
  -e RABBITMQ_DEFAULT_USER=your_username \
  -e RABBITMQ_DEFAULT_PASS=your_strong_password \
  rabbitmq:3-management
```

The `-v rabbitmq_data:/var/lib/rabbitmq` ensures messages survive container restarts.

---

## Checklist

- [ ] RabbitMQ running on EC2 (Docker or Amazon MQ)
- [ ] `RABBITMQ_URL` set with credentials in `.env`
- [ ] `MAILGUN_API_KEY` and `MAILGUN_DOMAIN` set in `.env`
- [ ] `ADMIN_EMAIL` set in `.env`
- [ ] Mailgun domain verified with DNS records (SPF, DKIM)
- [ ] Port 5672 not exposed publicly (security group)
- [ ] EC2 timezone set correctly for cron schedules
- [ ] PM2 running and backend logs show all services connected
- [ ] Tested approve/reject email flow from frontend
- [ ] RabbitMQ Docker volume mounted for persistence
