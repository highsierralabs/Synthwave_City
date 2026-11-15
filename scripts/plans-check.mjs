// Every plan parses, and no path is owned by two plans (Agents.md, "Parallel tasks").
import { globToRegExp, ownedGlobs, readPlans } from './lib/plans.mjs';

const plans = readPlans();
let bad = 0;
for (const plan of plans) {
  for (const problem of plan.problems) {
    console.log(`${plan.file}: ${problem}`);
    bad++;
  }
}

// Two globs overlap if either one matches a sample path built from the other.
const samples = (glob) => [glob, glob.replace(/\*\*/g, 'a/b').replace(/\*/g, 'x'), glob.replace(/\/\*\*$/, '/x.ts')];
for (let i = 0; i < plans.length; i++) {
  for (let j = i + 1; j < plans.length; j++) {
    for (const ga of ownedGlobs(plans[i])) {
      for (const gb of ownedGlobs(plans[j])) {
        const ra = globToRegExp(ga), rb = globToRegExp(gb);
        if (samples(gb).some((p) => ra.test(p)) || samples(ga).some((p) => rb.test(p))) {
          console.log(`overlap: ${plans[i].id} owns "${ga}" and ${plans[j].id} owns "${gb}"`);
          bad++;
        }
      }
    }
  }
}

console.log(`${plans.length} plans`);
for (const plan of plans) console.log(`  ${String(plan.status ?? '?').padEnd(12)} ${plan.id ?? plan.file}`);
if (bad > 0) {
  console.log(`FAIL: ${bad} problem(s)`);
  process.exit(1);
}
console.log('OK');
