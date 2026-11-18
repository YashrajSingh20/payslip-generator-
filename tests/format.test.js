import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { money, moneyCompact, periodLabel, calendarDate, toCsv, initials } from '../app/lib/format.js';

describe('client formatting', () => {
  it('formats paise as rupees', () => {
    assert.equal(money(12345678), '₹1,23,456.78');
    assert.equal(money(12345678, { whole: true }), '₹1,23,457');
    assert.equal(money(null), '—');
  });

  it('compacts headline amounts into lakh and crore', () => {
    assert.equal(moneyCompact(37760200), '₹3.78 L');
    assert.equal(moneyCompact(4235000000), '₹4.24 Cr');
    assert.equal(moneyCompact(5000000), '₹50,000');
  });

  it('formats periods and calendar dates without timezone shifts', () => {
    assert.equal(periodLabel('2026-07'), 'July 2026');
    assert.equal(calendarDate('2026-07-01'), '01 Jul 2026');
  });

  it('writes Excel-safe CSV', () => {
    assert.equal(toCsv([['a', 'b,c'], ['say "hi"', 'x\ny']]), '﻿a,"b,c"\r\n"say ""hi""","x\ny"');
  });

  it('derives initials', () => {
    assert.equal(initials('Aarav Admin'), 'AA');
    assert.equal(initials(''), '?');
  });
});
