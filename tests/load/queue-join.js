import http from "k6/http";
import { sleep, check, group } from "k6";
import { Counter, Trend } from "k6/metrics";

// Custom metrics
const successfulJoins = new Counter("successful_queue_joins");
const joinDuration = new Trend("queue_join_duration");
const failedJoins = new Counter("failed_queue_joins");

export const options = {
  stages: [
    { duration: "30s", target: 100 }, // Ramp up to 100 VUs in 30s
    { duration: "60s", target: 500 }, // Ramp up to 500 VUs
    { duration: "60s", target: 1000 }, // Peak: 1000 VUs
    { duration: "30s", target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000"], // 95% of requests under 2s
    http_req_failed: ["rate<0.05"], // Less than 5% error rate
    successful_queue_joins: ["count>100"], // At least 100 successful joins
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const EVENT_ID = __ENV.EVENT_ID || "1";

// Pre-generated test users (in real test, these would be seeded)
function generateUser(vuId) {
  return {
    email: `loadtest_user_${vuId}_${Date.now()}@test.com`,
    password: "testpassword123",
    name: `Load Test User ${vuId}`,
  };
}

export default function () {
  const vuId = __VU;

  group("User Registration & Queue Join Flow", function () {
    // Step 1: Register user
    const user = generateUser(vuId);
    let registerRes = http.post(
      `${BASE_URL}/auth/register`,
      JSON.stringify(user),
      { headers: { "Content-Type": "application/json" } }
    );

    if (
      !check(registerRes, {
        "registration succeeded": (r) => r.status === 201 || r.status === 200,
      })
    ) {
      failedJoins.add(1);
      return;
    }

    // Step 2: Login
    let loginRes = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({ email: user.email, password: user.password }),
      { headers: { "Content-Type": "application/json" } }
    );

    check(loginRes, {
      "login succeeded": (r) => r.status === 200,
    });

    if (loginRes.status !== 200) {
      failedJoins.add(1);
      return;
    }

    const token = loginRes.json("token");

    // Step 3: Join queue
    const joinStart = new Date();
    let joinRes = http.post(
      `${BASE_URL}/queue/join`,
      JSON.stringify({ eventId: EVENT_ID }),
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );

    joinDuration.add(new Date() - joinStart);

    if (
      check(joinRes, {
        "queue join succeeded": (r) => r.status === 201 || r.status === 200,
        "response has position": (r) =>
          r.json("position") !== undefined || r.json("message") !== undefined,
      })
    ) {
      successfulJoins.add(1);
    } else {
      failedJoins.add(1);
    }

    sleep(1);

    // Step 4: Poll queue status a few times
    for (let i = 0; i < 3; i++) {
      let statusRes = http.get(
        `${BASE_URL}/queue/status?eventId=${EVENT_ID}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      check(statusRes, {
        "status poll succeeded": (r) => r.status === 200,
      });

      sleep(2);
    }
  });
}

export function handleSummary(data) {
  return {
    "tests/load/results/queue-join-summary.json": JSON.stringify(data, null, 2),
    stdout: `
=== Queue Join Load Test Results ===
Total Requests: ${data.metrics.http_reqs.values.count}
Successful Joins: ${data.metrics.successful_queue_joins?.values?.count || 0}
Failed Joins: ${data.metrics.failed_queue_joins?.values?.count || 0}
Avg Response Time: ${Math.round(data.metrics.http_req_duration.values.avg)}ms
P95 Response Time: ${Math.round(data.metrics.http_req_duration.values["p(95)"])}ms
Error Rate: ${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%
=====================================
    `,
  };
}
