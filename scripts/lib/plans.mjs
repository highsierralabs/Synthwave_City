// Reads plan frontmatter (plans/T##-*.md) and turns `owns` globs into matchers.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const STATUSES = ['draft', 'ready', 'in-progress', 'blocked', 'done', 'abandoned'];

function parseList(value) {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner.trim() === '') return [];
  // Split on commas that are not inside braces.
  const out = [];
  let depth = 0, current = '';
  for (const ch of inner) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(current.trim()); current = ''; } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function readPlans(dir = 'plans') {
  const plans = [];
  for (const name of readdirSync(dir).sort()) {
    if (!/^T\d\d-.+\.md$/.test(name)) continue;
    const text = readFileSync(join(dir, name), 'utf8');
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const plan = { file: `${dir}/${name}`, problems: [] };
    if (!m) {
      plan.problems.push('no frontmatter');
      plans.push(plan);
      continue;
    }
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
      if (!kv) continue;
      const key = kv[1];
      let value = kv[2];
      if (value.startsWith('[')) plan[key] = parseList(value);
      else {
        // A trailing "# comment" is allowed on scalar lines.
        value = value.replace(/\s+#.*$/, '');
        plan[key] = value;
      }
    }
    for (const key of ['id', 'title', 'status', 'depends_on', 'owns', 'reads', 'updated']) {
      if (plan[key] === undefined) plan.problems.push(`missing "${key}"`);
    }
    if (plan.status && !STATUSES.includes(plan.status)) plan.problems.push(`unknown status "${plan.status}"`);
    if (plan.id && `${dir}/${plan.id}.md` !== plan.file) plan.problems.push(`id "${plan.id}" does not match the file name`);
    plans.push(plan);
  }
  return plans;
}

/** Expand {a,b} alternatives. */
export function expandBraces(pattern) {
  const m = /\{([^{}]*)\}/.exec(pattern);
  if (!m) return [pattern];
  return m[1].split(',').flatMap((alt) => expandBraces(pattern.slice(0, m.index) + alt.trim() + pattern.slice(m.index + m[0].length)));
}

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; } else re += '[^/]*';
    } else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

export function ownedGlobs(plan) {
  return (plan.owns ?? []).flatMap(expandBraces);
}

export function ownsMatcher(plan) {
  const regexes = ownedGlobs(plan).map(globToRegExp);
  return (path) => regexes.some((r) => r.test(path.replaceAll('\\', '/')));
}

export function findPlan(plans, task) {
  return plans.find((p) => p.id === task || (p.id ?? '').startsWith(task + '-'));
}
