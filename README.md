# FairDrop 🎟️

**A fair, bot-resistant ticket allocation system** — distributing 500 seats fairly among up to 50,000 interested users.

---

## 🚀 What is FairDrop?

FairDrop solves the classic problem of ticket sales: when demand massively exceeds supply, who gets a ticket? FairDrop uses a **randomized waiting room** to give everyone an equal chance, combined with **atomic seat holds**, **payment confirmation**, and **bot resistance** to ensure the process is fair and oversell-proof.

### Core Guarantees
- ✅ **No overselling** — atomic PostgreSQL transactions prevent any seat from being sold twice
- ✅ **Fairness** — server-side Fisher-Yates shuffle randomizes queue order (no advantage to joining first)
- ✅ **Bot resistance** — rate limiting, CAPTCHA, purchase limits, risk flagging
- ✅ **Time-bounded holds** — seats release automatically after 10 minutes if not purchased
- ✅ **Idempotent payments** — duplicate webhook deliveries never create duplicate orders

---

## 🏗️ Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│                 │     │                  │     │                 │
│  Next.js 14     │────▶│  Express API     │────▶│  PostgreSQL 16  │
│  (Frontend)     │     │  (Backend)       │     │  (Primary DB)   │
│  :3000          │     │  :4000           │     │  :5432          │
│                 │     │                  │     │                 │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │                  │
                         │  Redis           │
                         │  (Queue + Cache  │
                         │   + Rate Limits) │
                         │  :6379           │
                         │                  │
                         └──────────────────┘
```

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, TypeScript, Tailwind CSS |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL 16 |
| Cache/Queue | Redis 7 |
| Auth | JWT (HS256) |
| Containerization | Docker Compose |

---

## 📋 Prerequisites

- **Node.js** 20+
- **Docker Desktop** with the Docker Compose plugin
- **npm** or **yarn**
- A Google OAuth Web client ID (optional; password login works without it)

---

## 🛠️ Quick Start

### 1. Clone & Navigate

```bash
git clone <repo-url>
cd fairdrop
```

### 2. Configure Google Sign-In (Optional)

In Google Cloud Console, create an OAuth client ID for a Web application and add `http://localhost:3000` as an authorized JavaScript origin. FairDrop uses the Google Identity Services popup flow, so no redirect URI or client secret is needed. Copy `.env.example` to `.env` in the project root and set `GOOGLE_CLIENT_ID` to the client ID.

### 3. Start FairDrop

```bash
start.bat
```

The script builds and starts PostgreSQL, Redis, the API, and the frontend. Database migrations and demo seeding run automatically when the API container starts. Google sign-in stays disabled until `GOOGLE_CLIENT_ID` is configured.

### 4. Open the App

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:4000
- **Admin Dashboard**: http://localhost:3000/admin

---

## 👤 Demo Accounts

After the first `start.bat` startup:

| Role | Email | Password |
|------|-------|----------|
| Test User | `user@fairdrop.com` | `user123` |
| Admin | `admin@fairdrop.com` | `admin123` |

---

## 🎬 Demo Script (Full User Journey)

1. **Register** — Go to `/auth/register`, create an account
2. **Verify** — Email verification is mocked; account is instantly verified
3. **Join Queue** — Go to `/waiting-room`, click "Join Queue"
4. **Get Admitted** — Admin shuffles the queue; the backend admits users in batches
5. **Select Seat** — Go to `/seats`, click an available seat (green)
6. **Hold Seat** — Click "Hold Seat" — you have 10 minutes
7. **Pay** — Go to `/checkout`, click "Pay Now" (mock payment)
8. **Confirmation** — See your ticket at `/confirmation`

### Admin Actions (login as admin):
- View live stats at `/admin`
- Trigger queue shuffle: `POST /admin/queue/shuffle` with admin token
- See risk flags, orders, queue totals

---

## 📡 Key API Endpoints

### Authentication
```
POST /auth/register        Register new user
POST /auth/login           Login, returns JWT
POST /auth/google          Verify Google ID token, returns JWT
POST /auth/verify-email    Mock verify (sets verified=true)
GET  /auth/me              Get current user
```

### Queue
```
POST /queue/join           Join the waiting room queue
GET  /queue/status         Poll queue position & status
POST /queue/shuffle        [Admin] Randomize queue order
```

### Seats
```
GET  /seats/available      List available seats (admitted users only)
POST /seats/hold           Atomically hold a seat (10 min)
DELETE /seats/hold/:id     Release a held seat
```

### Payments
```
POST /payments/create-intent   Create mock payment intent
POST /payments/mock-success    [Demo] Simulate successful payment
POST /payments/webhook         Webhook endpoint (idempotent)
```

### Admin
```
GET /admin/stats           Seat counts, queue totals
GET /admin/flags           Risk/suspicious activity flags
GET /admin/orders          Search reservations/orders
```

---

## 🔒 Fairness & Security Design

### Why Randomized Queue?
Joining early gives no advantage — at sale start, all waiting users are shuffled using a server-side Fisher-Yates algorithm. This eliminates any incentive to spam the join button or use multiple connections.

### Atomic Seat Holds
Seat holds use `SELECT ... FOR UPDATE` inside a PostgreSQL transaction. This means even under thousands of concurrent requests, a seat can only be held by one user at a time.

### Bot Resistance
- **Rate limiting** on all sensitive endpoints (Redis-backed)
- **Purchase cap**: max 2 tickets per user per event
- **Risk flags**: rapid repeated attempts, many accounts from one device
- **CAPTCHA**: Cloudflare Turnstile integration point (configurable)

### Idempotent Payments
Webhooks are deduplicated by `payment_intent_id` — replaying the same webhook multiple times never creates duplicate orders.

---

## 🧪 Testing

### Unit/Integration Tests
```bash
cd backend
npm test
```

### Load Testing (k6)
```bash
# Install k6: https://k6.io/docs/getting-started/installation/
k6 run tests/load/queue-join.js
k6 run tests/load/seat-hold.js
```

---

## 📊 Database Schema

```
users ──────────────── queue_entries
  │                         │
  │                    reservations ──── payments
  │                         │
events ──── seats ──────────┘
              │
         audit_logs
         risk_flags
```

---

## ⚙️ Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4000 | Backend server port |
| `DATABASE_URL` | postgresql://... | PostgreSQL connection string |
| `REDIS_URL` | redis://localhost:6379 | Redis connection string |
| `JWT_SECRET` | *required* | JWT signing secret |
| `SEAT_HOLD_MINUTES` | 10 | Seat hold expiry time |
| `ADMIN_SECRET` | *required* | Admin route protection |
| `GOOGLE_CLIENT_ID` | unset | Google OAuth Web client ID; shared with the frontend build |

---

## 🗺️ Development Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Planning & Setup | ✅ |
| 1 | Core Foundation (DB, Auth) | ✅ |
| 2 | Waiting Room & Fair Queue | ✅ |
| 3 | Seat Inventory & Atomic Reservations | ✅ |
| 4 | Payment & Confirmation | ✅ |
| 5 | Bot Resistance & Limits | ✅ |
| 6 | Admin Dashboard | ✅ |
| 7 | Testing & Load Simulation | ✅ |
| 8 | Demo & Documentation | ✅ |

---

## 🚨 Known Limitations (MVP)

- Payment is mocked (no real Stripe/Razorpay integration)
- Email verification is instant (no actual email sending)
- CAPTCHA is scaffolded but not enforced in demo mode
- Load tested for ~1,000 concurrent users; 50,000 requires horizontal scaling

## 🔮 Future Work

- Real Stripe/Razorpay integration
- SMS OTP verification
- Device fingerprinting (FingerprintJS Pro)
- Multi-region deployment with Redis Cluster
- Rich interactive seat map (SVG-based)
- Advanced fraud scoring (ML model)
- WebSocket real-time queue updates

---

## 📄 License

MIT © FairDrop Team
