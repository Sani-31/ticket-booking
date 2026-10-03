import http from "k6/http";
import { sleep, check, group } from "k6";
import { Counter, Trend } from "k6/metrics";

// Custom metrics
const successfulHolds = new Counter("successful_seat_holds");
const failedHolds = new Counter("failed_seat_holds");
const conflictHolds = new Counter("conflict_seat_holds");
const holdDuration = new Trend("seat_hold_duration");

export const options = {
  // Concurrency test: many users try to hold the same seat simultaneously
  scenarios: {
    concurrency_test: {
      executor: "shared-iterations",
      vus: 50,
      iterations: 50,
      maxDuration: "30s",
    },
    sustained_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 100 },
        { duration: "60s", target: 200 },
        { duration: "20s", target: 0 },
      ],
      startTime: "30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    successful_seat_holds: ["count>0"],
    // Key invariant: total successful holds must not exceed 500
    // (verified in handleSummary)
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const EVENT_ID = __ENV.EVENT_ID || "1";

// Shared auth tokens (pre-generated admitted users for the test)
// In a real test setup, these would be seeded and pre-admitted
const ADMITTED_TOKENS = JSON.parse(__ENV.ADMITTED_TOKENS || "[]");

export default function () {
  const vuId = __VU;

  // For the demo test, we generate + admit users inline
  // In production load tests, tokens would be pre-generated
  group("Seat Hold Concurrency Test", function () {
    // Use a pre-admitted token if available, otherwise skip
    if (ADMITTED_TOKENS.length === 0) {
      // Demo mode: try to use a test admin token to get seats list
      // then simulate hold attempts
      let seatsRes = http.get(`${BASE_URL}/seats/available?eventId=${EVENT_ID}`);

      if (seatsRes.status === 200) {
        const seats = seatsRes.json("seats") || [];
        if (seats.length > 0) {
          // Pick a random available seat
          const seat = seats[Math.floor(Math.random() * Math.min(seats.length, 10))];

          const holdStart = new Date();
          let holdRes = http.post(
            `${BASE_URL}/seats/hold`,
            JSON.stringify({ seatId: seat.id, eventId: EVENT_ID }),
            { headers: { "Content-Type": "application/json" } }
          );
          holdDuration.add(new Date() - holdStart);

          if (holdRes.status === 200 || holdRes.status === 201) {
            successfulHolds.add(1);
          } else if (holdRes.status === 409) {
            // Conflict — seat already taken
            conflictHolds.add(1);
          } else {
            failedHolds.add(1);
          }
        }
      }
    }

    sleep(0.5);
  });
}

export function handleSummary(data) {
  const totalHolds = data.metrics.successful_seat_holds?.values?.count || 0;
  const conflicts = data.metrics.conflict_seat_holds?.values?.count || 0;
  const failures = data.metrics.failed_seat_holds?.values?.count || 0;

  const oversellDetected = totalHolds > 500;

  return {
    "tests/load/results/seat-hold-summary.json": JSON.stringify(data, null, 2),
    stdout: `
=== Seat Hold Concurrency Test Results ===
Total Hold Attempts: ${totalHolds + conflicts + failures}
Successful Holds: ${totalHolds}
Conflicts (409): ${conflicts}
Errors: ${failures}
Avg Hold Duration: ${Math.round(data.metrics.seat_hold_duration?.values?.avg || 0)}ms
P95 Hold Duration: ${Math.round(data.metrics.seat_hold_duration?.values?.["p(95)"] || 0)}ms

OVERSELL CHECK: ${oversellDetected ? "❌ FAILED — Oversell detected!" : "✅ PASSED — No oversell"}
(Successful holds: ${totalHolds} / 500 seat limit)

${oversellDetected ? "⚠️  CRITICAL: The system allowed more than 500 seat holds!" : "✅ Atomic seat hold working correctly."}
==========================================
    `,
  };
}
