import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ETA_DEFAULTS,
  NO_WAIT_LABEL,
  averageConsultationMinutes,
  estimateWait,
  formatRangeLabel,
} from "./eta.ts";

test("locks the documented defaults", () => {
  assert.equal(ETA_DEFAULTS.sampleSize, 5);
  assert.equal(ETA_DEFAULTS.fallbackMinutes, 12);
  assert.equal(ETA_DEFAULTS.maxEstimateMinutes, 240);
});

test("normal data: averages history and multiplies by people ahead", () => {
  const estimate = estimateWait({
    peopleAhead: 3,
    recentConsultationMinutes: [12, 10, 15, 11, 13],
  });

  // 12.2 min average * 3 ahead = 36.6 min -> reported as a band, not a promise.
  assert.equal(estimate.averageMinutes, 12.2);
  assert.equal(estimate.sampleCount, 5);
  assert.equal(estimate.usedFallback, false);
  assert.equal(estimate.peopleAhead, 3);
  assert.equal(estimate.minMinutes, 30);
  assert.equal(estimate.maxMinutes, 40);
  assert.equal(estimate.label, "30–40 min");
});

test("no historical data: falls back to the configurable default", () => {
  const estimate = estimateWait({
    peopleAhead: 3,
    recentConsultationMinutes: [],
  });

  assert.equal(estimate.usedFallback, true);
  assert.equal(estimate.sampleCount, 0);
  assert.equal(estimate.averageMinutes, ETA_DEFAULTS.fallbackMinutes);
  assert.equal(estimate.label, "30–40 min");
});

test("a custom fallback is honoured", () => {
  const estimate = estimateWait({
    peopleAhead: 1,
    recentConsultationMinutes: [],
    fallbackMinutes: 30,
  });

  assert.equal(estimate.usedFallback, true);
  assert.equal(estimate.averageMinutes, 30);
  assert.equal(estimate.label, "20–40 min");
});

test("zero people ahead means no wait", () => {
  const noHistory = estimateWait({
    peopleAhead: 0,
    recentConsultationMinutes: [],
  });
  assert.equal(noHistory.label, NO_WAIT_LABEL);
  assert.equal(noHistory.minMinutes, 0);
  assert.equal(noHistory.maxMinutes, 0);
  assert.equal(noHistory.peopleAhead, 0);

  // History must not change the fact that nobody is ahead.
  const withHistory = estimateWait({
    peopleAhead: 0,
    recentConsultationMinutes: [10, 12, 14],
  });
  assert.equal(withHistory.label, NO_WAIT_LABEL);
  assert.equal(withHistory.minMinutes, 0);
  assert.equal(withHistory.maxMinutes, 0);
});

test("a single historical consultation is usable", () => {
  const estimate = estimateWait({
    peopleAhead: 1,
    recentConsultationMinutes: [20],
  });

  assert.equal(estimate.usedFallback, false);
  assert.equal(estimate.sampleCount, 1);
  assert.equal(estimate.averageMinutes, 20);
  // 20 min estimate -> band widened so the UI still shows a range.
  assert.equal(estimate.label, "20–30 min");
});

test("invalid and negative durations are ignored", () => {
  const estimate = estimateWait({
    peopleAhead: 2,
    recentConsultationMinutes: [-5, 0, Number.NaN, Number.POSITIVE_INFINITY, 10],
  });

  assert.equal(estimate.sampleCount, 1);
  assert.equal(estimate.usedFallback, false);
  assert.equal(estimate.averageMinutes, 10);
  assert.equal(estimate.label, "20–30 min");

  // Entirely unusable history behaves like no history at all.
  const allBad = estimateWait({
    peopleAhead: 1,
    recentConsultationMinutes: [-1, 0, Number.NaN, Number.NEGATIVE_INFINITY],
  });
  assert.equal(allBad.usedFallback, true);
  assert.equal(allBad.sampleCount, 0);
  assert.equal(allBad.averageMinutes, ETA_DEFAULTS.fallbackMinutes);
});

test("very large queues report an open-ended ceiling instead of fake precision", () => {
  const estimate = estimateWait({
    peopleAhead: 1000,
    recentConsultationMinutes: [100000],
  });

  assert.equal(estimate.minMinutes, ETA_DEFAULTS.maxEstimateMinutes);
  assert.equal(estimate.maxMinutes, ETA_DEFAULTS.maxEstimateMinutes);
  assert.equal(estimate.label, "4 hr+");
  assert.ok(Number.isFinite(estimate.minMinutes));
  assert.ok(Number.isFinite(estimate.maxMinutes));
});

test("sampleSize only uses the most recent N samples", () => {
  // Most recent first: five 60-minute consultations, then older 1-minute ones.
  const durations = [60, 60, 60, 60, 60, 1, 1, 1, 1, 1];

  const recentFive = estimateWait({
    peopleAhead: 1,
    recentConsultationMinutes: durations,
  });
  assert.equal(recentFive.sampleCount, ETA_DEFAULTS.sampleSize);
  assert.equal(recentFive.averageMinutes, 60);
  assert.equal(recentFive.label, "50–70 min");

  const allTen = estimateWait({
    peopleAhead: 1,
    recentConsultationMinutes: durations,
    sampleSize: 10,
  });
  assert.equal(allTen.sampleCount, 10);
  assert.equal(allTen.averageMinutes, 30.5);
  assert.equal(allTen.label, "20–40 min");
});

test("never returns NaN or Infinity for hostile input", () => {
  const hostileInputs = [
    { peopleAhead: Number.NaN, recentConsultationMinutes: [] },
    { peopleAhead: Number.POSITIVE_INFINITY, recentConsultationMinutes: [] },
    { peopleAhead: Number.NEGATIVE_INFINITY, recentConsultationMinutes: [5] },
    { peopleAhead: -5, recentConsultationMinutes: [10] },
    { peopleAhead: 3, recentConsultationMinutes: [], fallbackMinutes: Number.NaN },
    { peopleAhead: 3, recentConsultationMinutes: [], fallbackMinutes: 0 },
    { peopleAhead: 3, recentConsultationMinutes: [], fallbackMinutes: -3 },
    { peopleAhead: 2, recentConsultationMinutes: [5], sampleSize: 0 },
    { peopleAhead: 0, recentConsultationMinutes: [Number.NaN] },
    { peopleAhead: 1e9, recentConsultationMinutes: [99999] },
    { peopleAhead: 2.7, recentConsultationMinutes: [7.5] },
    { peopleAhead: 4, recentConsultationMinutes: [1e12] },
  ];

  for (const input of hostileInputs) {
    const estimate = estimateWait(input);

    for (const [key, value] of Object.entries(estimate)) {
      if (typeof value === "number") {
        assert.ok(
          Number.isFinite(value),
          `${key} must be finite for ${JSON.stringify(input)}, got ${value}`,
        );
      }
    }

    assert.ok(estimate.minMinutes >= 0);
    assert.ok(estimate.maxMinutes >= estimate.minMinutes);
    assert.equal(typeof estimate.label, "string");
    assert.ok(estimate.label.length > 0);
    assert.ok(!estimate.label.includes("NaN"));
    assert.ok(!estimate.label.includes("Infinity"));
  }

  // A non-finite `peopleAhead` must degrade to "nobody ahead", never to NaN.
  assert.equal(
    estimateWait({ peopleAhead: Number.NaN, recentConsultationMinutes: [9] })
      .label,
    NO_WAIT_LABEL,
  );

  // An invalid fallback falls back to the default instead of producing nonsense.
  const badFallback = estimateWait({
    peopleAhead: 1,
    recentConsultationMinutes: [],
    fallbackMinutes: Number.NaN,
  });
  assert.equal(badFallback.averageMinutes, ETA_DEFAULTS.fallbackMinutes);
  assert.equal(badFallback.label, "10–15 min");
});

test("formatRangeLabel produces readable ranges", () => {
  assert.equal(formatRangeLabel(0, 0), NO_WAIT_LABEL);
  assert.equal(formatRangeLabel(30, 40), "30–40 min");
  assert.equal(formatRangeLabel(0, 5), "0–5 min");
  assert.equal(formatRangeLabel(180, 240), "3–4 hr");
  assert.equal(formatRangeLabel(150, 210), "2.5–3.5 hr");
  assert.equal(formatRangeLabel(-10, 10), "0–10 min");
  // Defensive: non-finite upper bounds saturate at the ceiling rather than
  // being misreported as "No wait".
  assert.equal(formatRangeLabel(Number.NaN, Number.NaN), "0–4 hr");
  assert.equal(
    formatRangeLabel(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
    "0–4 hr",
  );
});

test("averageConsultationMinutes reports null when history is unusable", () => {
  assert.equal(averageConsultationMinutes([]), null);
  assert.equal(
    averageConsultationMinutes([Number.NaN, -1, 0, Number.POSITIVE_INFINITY]),
    null,
  );
  assert.equal(averageConsultationMinutes([10, 20]), 15);
  assert.equal(averageConsultationMinutes([10, 20, 30], { sampleSize: 2 }), 15);
  assert.equal(averageConsultationMinutes([12, 10, 15, 11, 13]), 12.2);
});

