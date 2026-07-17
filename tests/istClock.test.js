/**
 * istClock.test.js — admin timestamps render in IST (Asia/Kolkata, UTC+5:30)
 * regardless of the server's timezone.
 *
 * Regression guard: clock() previously used Date.prototype.getHours(), which is
 * host-TZ-relative — correct on a dev Mac set to IST, 5h30m behind on Railway
 * (UTC). The fix pins the formatter to Asia/Kolkata; these tests fail if that
 * pin is ever dropped, even when the process TZ is not India.
 */

import { describe, it, expect } from 'vitest';

const { clock } = await import('../admin/util.js');

// 2023-11-14T22:13:20.000Z — chosen so IST (add 5h30m) rolls past midnight into
// the NEXT day at 03:43, proving the offset is applied (a naive UTC read gives 22:13).
const CROSS_MIDNIGHT_UTC = Date.UTC(2023, 10, 14, 22, 13, 20);

// 2023-11-14T06:00:00.000Z → 11:30 IST — a clean +5:30 within the same day.
const NOON_ISH_UTC = Date.UTC(2023, 10, 14, 6, 0, 0);

describe('clock() renders HH:MM in IST', () => {
  it('applies the +5:30 offset (06:00 UTC → 11:30 IST)', () => {
    expect(clock(NOON_ISH_UTC)).toBe('11:30');
  });

  it('rolls into the next IST day (22:13 UTC → 03:43 IST)', () => {
    expect(clock(CROSS_MIDNIGHT_UTC)).toBe('03:43');
  });

  it('is independent of process.env.TZ (set to a non-IST zone)', () => {
    const saved = process.env.TZ;
    try {
      // Even if the host clock were in Los Angeles, output must stay IST.
      process.env.TZ = 'America/Los_Angeles';
      expect(clock(NOON_ISH_UTC)).toBe('11:30');
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it('returns empty string for a falsy timestamp', () => {
    expect(clock(0)).toBe('');
    expect(clock(null)).toBe('');
    expect(clock(undefined)).toBe('');
  });
});
