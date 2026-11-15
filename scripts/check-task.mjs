// The repo gates, reported only for the paths one plan owns, so a half-written file in a sibling
// task cannot fail yours.   npm run check:task -- T05
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { findPlan, ownedGlobs, ownsMatcher, readPlans } from './lib/plans.mjs';

const task = process.argv[2];
if (!task) {
  console.error('usage: npm run check:task -- T05');
  process.exit(2);
}
const plan = findPlan(readPlans(), task);
if (!plan) {
  console.error(`no plan found for ${task}`);
  process.exit(2);
}
const owned = ownsMatcher(plan);
const run = (cmd) => spawnSync(cmd, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
let failed = false;

// 1. Types: the whole program is checked, and only errors in owned files count.
for (const project of ['tsconfig.json', 'tsconfig.node.json']) {
  const res = run(`npx tsc --noEmit --pretty false -p ${project}`);
  const lines = (res.stdout + res.stderr).split(/\r?\n/).filter((l) => /\(\d+,\d+\): error TS/.test(l));
  const mine = lines.filter((l) => owned(l.slice(0, l.indexOf('('))));
  console.log(`typecheck ${project}: ${mine.length} error(s) in ${plan.id}, ${lines.length - mine.length} elsewhere`);
  for (const l of mine) console.log('  ' + l);
  if (mine.length > 0) failed = true;
}

// 2. Lint: only owned folders and files that exist.
const roots = [...new Set(ownedGlobs(plan).map((g) => g.replace(/\/\*\*$/, '')))]
  .filter((p) => !p.includes('*') && existsSync(p) && (/\.(ts|js|mjs)$/.test(p) || !/\.[a-z]+$/i.test(p)));
if (roots.length > 0) {
  const res = run(`npx eslint ${roots.map((r) => `"${r}"`).join(' ')} --max-warnings 0 --no-warn-ignored`);
  console.log(`lint: ${res.status === 0 ? 'ok' : 'FAILED'} (${roots.join(', ')})`);
  if (res.status !== 0) {
    console.log((res.stdout + res.stderr).trim());
    failed = true;
  }
} else console.log('lint: nothing to lint yet');

// 3. Tests: only owned test folders that exist.
const testRoots = roots.filter((r) => r.startsWith('tests/'));
if (testRoots.length > 0) {
  const res = run(`npx vitest run ${testRoots.map((r) => `"${r}"`).join(' ')}`);
  const out = (res.stdout + res.stderr).trim().split(/\r?\n/);
  console.log(`tests: ${res.status === 0 ? 'ok' : 'FAILED'} (${testRoots.join(', ')})`);
  console.log(res.status === 0 ? out.slice(-6).map((l) => '  ' + l).join('\n') : out.join('\n'));
  if (res.status !== 0) failed = true;
} else console.log('tests: no test folder yet');

console.log(failed ? `FAIL ${plan.id}` : `PASS ${plan.id}`);
process.exit(failed ? 1 : 0);
