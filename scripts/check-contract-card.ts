import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BatchContractCard } from '../src/components/batch/BatchContractCard';
(globalThis as any).React = React;
function render(monthsAgo: number) {
  const sign = new Date(); sign.setMonth(sign.getMonth() - monthsAgo);
  const maturity = new Date(sign); maturity.setFullYear(maturity.getFullYear() + 2);
  return renderToStaticMarkup(React.createElement(BatchContractCard, { signDate: sign, maturityDate: maturity }));
}
const locked = render(2);
assert.match(locked, /role="progressbar"/);
assert.match(locked, /aria-label="锁仓进度"/);
assert.match(locked, /距离解锁/);
for (const month of [6,9,12,15,18,21,24]) assert.ok(locked.includes(`第 ${month} 月`));
assert.match(locked, /仅超级管理员/);
assert.match(render(9), /aria-label="合约进度"/);
assert.match(render(30), /aria-valuenow="100"/);
assert.match(render(30), /已到期/);
assert.match(render(-2), /aria-valuenow="0"/);
console.log('PASS: visible lockup progress, all trading milestones, exit permissions and clamped future/matured dates');
