#!/usr/bin/env node
/* Re-reads umbraco.com's history page and rewrites js/data.js, which is the
   only thing the page loads.

   Run it whenever the source page has been updated:

     node tools/update-data.js            write the new data, print what changed
     node tools/update-data.js --check    print what changed, write nothing
*/
'use strict';

const fs = require('fs');
const path = require('path');
const parser = require('./parser.js');

const OUT = path.resolve(__dirname, '..', 'js', 'data.js');
const METRICS = [
  ['employees', 'Employees', y => y.employees && y.employees.value + (y.employees.atLeast ? '+' : '')],
  ['codegarden', 'Codegarden', y => y.codegarden && (y.codegarden.cancelled ? 'cancelled' : String(y.codegarden.value))],
  ['pullRequests', 'Pull requests', y => y.pullRequests && String(y.pullRequests.value)],
  ['revenue', 'Revenue', y => y.revenue && y.revenue.reported + ' M ' + y.revenue.currency],
  ['milestones', 'Milestones', y => String(y.milestones.length)]
];

/* The previous run's dataset, read back out of the generated script. */
function readExisting() {
  try {
    const sandbox = { window: {} };
    sandbox.window.window = sandbox.window;
    new Function('window', fs.readFileSync(OUT, 'utf8'))(sandbox.window);
    return sandbox.window.UD.data;
  } catch { return null; }
}

/* What actually moved, in words - the point of running this is to see that. */
function diff(before, after) {
  const lines = [];
  if (!before) return ['first run - no previous data to compare against'];

  const oldYears = new Map(before.years.map(y => [y.year, y]));
  const newYears = new Map(after.years.map(y => [y.year, y]));

  for (const [year, y] of newYears) {
    if (!oldYears.has(year)) { lines.push(`+ ${y.label}: new year entry`); continue; }
    const prev = oldYears.get(year);
    for (const [, label, read] of METRICS) {
      const a = read(prev) || null;
      const b = read(y) || null;
      if (a === b) continue;
      if (a === null) lines.push(`+ ${y.label} ${label}: ${b}`);
      else if (b === null) lines.push(`- ${y.label} ${label}: was ${a}`);
      else lines.push(`~ ${y.label} ${label}: ${a} -> ${b}`);
    }
  }
  for (const [year, y] of oldYears) {
    if (!newYears.has(year)) lines.push(`- ${y.label}: year entry gone`);
  }
  return lines;
}

(async () => {
  const checkOnly = process.argv.includes('--check');

  process.stdout.write('reading ' + parser.SOURCE_URL + ' ... ');
  const data = await parser.fetchHistory();
  console.log('ok (via ' + data.via + ')');

  data.generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  data.dkkPerEur = parser.DKK_PER_EUR;   /* the page needs it for a footnote */

  const before = readExisting();
  const changes = diff(before, data);

  const first = data.years[0], last = data.years[data.years.length - 1];
  console.log(`parsed ${data.years.length} year entries, ${first.label} to ${last.label}`);

  if (!before) console.log('\n' + changes[0]);
  else if (!changes.length) console.log('\nno changes since the last update');
  else { console.log('\nchanges:'); changes.forEach(l => console.log('  ' + l)); }

  if (checkOnly) { console.log('\n--check: nothing written'); return; }

  const banner =
    '/* Umbraco history data, generated from\n' +
    ' *   ' + parser.SOURCE_URL + '\n' +
    ' * on ' + data.generatedAt + '. Do not edit by hand.\n' +
    ' *\n' +
    ' * Regenerate with: node tools/update-data.js\n' +
    ' *\n' +
    ' * This is a script rather than a .json file so the page also works when\n' +
    ' * opened straight from disk, where browsers refuse to fetch local JSON.\n' +
    ' */\n';

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT,
    banner +
    'var UD = window.UD || (window.UD = {});\n' +
    'UD.data = ' + JSON.stringify(data, null, 1) + ';\n');
  console.log('\nwrote ' + path.relative(path.resolve(__dirname, '..'), OUT));
})().catch(err => {
  console.error('\nupdate failed: ' + err.message);
  process.exit(1);
});
