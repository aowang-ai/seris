/**
 * weekend-fade — flat over the weekend, long only on weekdays.
 *
 * Hypothesis: weekend price action is lower-quality (less institutional
 * participation, wider spreads, more retail noise). The strategy goes flat
 * on Friday evening and re-enters on Monday morning, capturing only
 * weekday moves.
 *
 * This is a pure calendar strategy — no price signal, no indicator. The
 * edge (if any) comes entirely from avoiding weekend chop.
 *
 * Parameters:
 *   - fridayExitHour: UTC hour on Friday to exit (0-23)
 *   - mondayEntryHour: UTC hour on Monday to re-enter (0-23)
 *   - sizeFraction: fraction of cash to allocate
 */

import type { Candle, Strategy } from '../../../src/strategy/types.js';

const DAY_MS = 86_400_000;

function utcDayOfWeek(timeMs: number): number {
  return new Date(timeMs).getUTCDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
}

function utcHour(timeMs: number): number {
  return new Date(timeMs).getUTCHours();
}

export const strategy: Strategy = {
  name: 'weekend-fade',
  description: 'Flat over weekends, long only on weekdays. Pure calendar strategy — no price signal.',
  timeframe: '4h',
  params: {
    fridayExitHour: { type: 'int', default: 20, min: 12, max: 23, description: 'UTC hour on Friday to exit (0-23)' },
    mondayEntryHour: { type: 'int', default: 4, min: 0, max: 12, description: 'UTC hour on Monday to re-enter (0-23)' },
    sizeFraction: { type: 'float', default: 0.95, min: 0.1, max: 1.0 },
  },
  warmup: () => 2,
  onCandle(candles: Candle[], ctx, p) {
    const fridayExitHour = Number(p.fridayExitHour);
    const mondayEntryHour = Number(p.mondayEntryHour);
    const sizeFraction = Number(p.sizeFraction);

    const bar = candles[candles.length - 1];
    const dow = utcDayOfWeek(bar.time);
    const hour = utcHour(bar.time);

    // Exit on Friday evening
    if (ctx.position && dow === 5 && hour >= fridayExitHour) {
      return { kind: 'exit', reason: `Friday ${hour}:00 UTC — exiting for weekend` };
    }

    // Enter on Monday morning
    if (!ctx.position && dow === 1 && hour >= mondayEntryHour) {
      const notional = ctx.cash * sizeFraction;
      if (notional > 0) {
        return { kind: 'enter-long', notional, reason: `Monday ${hour}:00 UTC — re-entering` };
      }
    }

    // Also exit if we somehow hold through Saturday/Sunday (safety)
    if (ctx.position && (dow === 6 || dow === 0)) {
      return { kind: 'exit', reason: 'Weekend safety exit' };
    }

    return { kind: 'hold' };
  },
};
