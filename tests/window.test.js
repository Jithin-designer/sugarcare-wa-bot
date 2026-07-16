/**
 * window.test.js — the 24h WhatsApp customer-service window used by the admin
 * reply guard. Open at 23h59m since last inbound, closed at 24h01m, and OPEN at
 * exactly 24h (inclusive boundary, matching the bot's isWithinSessionWindow).
 */

import { describe, it, expect } from 'vitest';

const { windowInfo, TWENTY_FOUR_HOURS_MS } = await import('../admin/util.js');
const { isWithinSessionWindow } = await import('../src/whatsapp.js');

const now = 1_700_000_000_000;
const MIN = 60 * 1000;

describe('windowInfo (admin reply guard)', () => {
  it('is OPEN at 23h59m since last inbound', () => {
    const lastInbound = now - (TWENTY_FOUR_HOURS_MS - MIN);
    expect(windowInfo(lastInbound, now).open).toBe(true);
  });

  it('is CLOSED at 24h01m since last inbound', () => {
    const lastInbound = now - (TWENTY_FOUR_HOURS_MS + MIN);
    expect(windowInfo(lastInbound, now).open).toBe(false);
  });

  it('is OPEN at exactly 24h (inclusive edge)', () => {
    const lastInbound = now - TWENTY_FOUR_HOURS_MS;
    expect(windowInfo(lastInbound, now).open).toBe(true);
  });

  it('is CLOSED when there is no inbound at all (patient must message first)', () => {
    expect(windowInfo(null, now).open).toBe(false);
  });
});

describe('isWithinSessionWindow (bot) agrees on the boundary', () => {
  it('open just under, at, and just over 24h', () => {
    expect(isWithinSessionWindow(now - (TWENTY_FOUR_HOURS_MS - MIN), now)).toBe(true);
    expect(isWithinSessionWindow(now - TWENTY_FOUR_HOURS_MS, now)).toBe(true);
    expect(isWithinSessionWindow(now - (TWENTY_FOUR_HOURS_MS + MIN), now)).toBe(false);
  });
});
