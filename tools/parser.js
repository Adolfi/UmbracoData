/* Reads umbraco.com's history page and turns it into structured yearly data.
   This runs in Node, as part of `node tools/update-data.js` - the browser never
   fetches anything, it just loads the JSON this produces. */
'use strict';

const SOURCE_URL = 'https://umbraco.com/about-us/the-history-of-umbraco/';

/* Node has no same-origin policy, so the page can be read directly. The reader
   service is only a fallback for the day umbraco.com blocks a plain request. */
const ROUTES = [
  { id: 'umbraco.com', format: 'html', url: SOURCE_URL },
  { id: 'r.jina.ai', format: 'markdown', url: 'https://r.jina.ai/' + SOURCE_URL }
];

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchHistory() {
  const failures = [];
  for (const route of ROUTES) {
    try {
      const res = await fetch(route.url, { headers: { 'user-agent': UA, accept: '*/*' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = parse(await res.text(), route.format);
      if (!data.years.length) throw new Error('no timeline blocks found');
      data.via = route.id;
      data.source = SOURCE_URL;
      return data;
    } catch (err) {
      failures.push(route.id + ': ' + err.message);
    }
  }
  throw new Error('could not read the history page -\n  ' + failures.join('\n  '));
}

/* ---------- HTML without a DOM ----------
   A tag-counting slicer rather than a regex per element, so nested <ul>/<li>
   and the page footer cannot bleed into a block. */

function sliceElement(html, startIdx, tag) {
  const re = new RegExp('<(/?)' + tag + '(?=[\\s/>])', 'gi');
  re.lastIndex = startIdx;
  const contentStart = html.indexOf('>', startIdx) + 1;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[1] === '/') {
      if (--depth === 0) {
        return { inner: html.slice(contentStart, m.index), end: html.indexOf('>', m.index) + 1 };
      }
    } else {
      depth++;
    }
  }
  return { inner: html.slice(contentStart), end: html.length };
}

/* Only the bullets at the top of the list. A nested <ul> lives inside its
   parent <li>, whose text already carries it - counting both would double it. */
function topLevelItems(html) {
  const out = [];
  const re = /<li\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const slice = sliceElement(html, m.index, 'li');
    out.push(slice.inner);
    re.lastIndex = slice.end;
  }
  return out;
}

const NAMED = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  ndash: '–', mdash: '—', hellip: '…', eacute: 'é', euro: '€'
};

function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : full;
    }
    const hit = NAMED[code.toLowerCase()];
    return hit === undefined ? full : hit;
  });
}

/* Matches what a browser's textContent would give: tags vanish without adding
   whitespace, then runs of space collapse. */
function textOf(fragment) {
  const stripped = String(fragment)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '');
  return decode(stripped).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

function firstTagText(html, tag) {
  const m = new RegExp('<' + tag + '\\b[^>]*>', 'i').exec(html);
  return m ? textOf(sliceElement(html, m.index, tag).inner) : null;
}

function blocksFromHtml(html) {
  const tlStart = html.search(/<div[^>]*class="[^"]*\bdc-timeline\b[^"]*"/i);
  if (tlStart < 0) return [];
  const timeline = sliceElement(html, tlStart, 'div').inner;

  const out = [];
  let pendingHeadline = null;

  const re = /<div[^>]*class="([^"]*\bdc-timeline-block\b[^"]*)"[^>]*>/gi;
  let m;
  while ((m = re.exec(timeline))) {
    const cls = m[1];
    const slice = sliceElement(timeline, m.index, 'div');
    re.lastIndex = slice.end;
    const block = slice.inner;

    if (/dc-timeline-block__headline/.test(cls)) {
      pendingHeadline = firstTagText(block, 'h2') || pendingHeadline;
      continue;
    }

    const label = firstTagText(block, 'h3');
    if (!label || !/\d{4}/.test(label)) continue;

    let items = [];
    const itemStart = block.search(/<div[^>]*class="[^"]*\bdc-timeline-item\b[^"]*"/i);
    if (itemStart >= 0) {
      const itemBox = sliceElement(block, itemStart, 'div').inner;
      items = topLevelItems(itemBox).map(textOf).filter(Boolean);
      if (!items.length) {   /* a few entries use <p> instead of a list */
        const pre = /<p\b[^>]*>/gi;
        let pm;
        while ((pm = pre.exec(itemBox))) {
          const s = sliceElement(itemBox, pm.index, 'p');
          pre.lastIndex = s.end;
          const t = textOf(s.inner);
          if (t) items.push(t);
        }
      }
    }

    out.push({ label, headline: pendingHeadline, items });
    pendingHeadline = null;
  }
  return out;
}

/* The reader service returns the page as markdown: `## headline`, `### year`,
   `*   item`. Same shape, different skin. */
function blocksFromMarkdown(md) {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let pendingHeadline = null;
  let current = null;
  const flush = () => { if (current) { out.push(current); current = null; } };

  for (const line of lines) {
    const h2 = line.match(/^##\s+(?!#)(.+?)\s*$/);
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    const li = line.match(/^(\s*)[*-]\s+(.+?)\s*$/);

    if (h3) {
      flush();
      const label = collapse(stripMd(h3[1]));
      if (/\d{4}/.test(label)) { current = { label, headline: pendingHeadline, items: [] }; pendingHeadline = null; }
      continue;
    }
    if (h2) { flush(); pendingHeadline = collapse(stripMd(h2[1])); continue; }
    if (li && current) {
      const t = collapse(stripMd(li[2]));
      if (!t) continue;
      /* An indented bullet is a sub-item; fold it into its parent so this route
         counts the same bullets the HTML route does. */
      if (li[1].length >= 2 && current.items.length) current.items[current.items.length - 1] += ' ' + t;
      else current.items.push(t);
      continue;
    }
    if (current && /^\s{4,}\S/.test(line) && current.items.length) {
      current.items[current.items.length - 1] += ' ' + collapse(stripMd(line));
    }
  }
  flush();
  return out;
}

function collapse(s) { return String(s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim(); }

function stripMd(s) {
  return decode(String(s))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, ' ')   /* a space, not nothing: **2013,**250 must not glue */
    .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1');
}

/* ---------- pulling metrics out of a block's bullet list ---------- */

/* A run of digits, optionally with , or . as thousands separators. Deliberately
   refuses to span a separator followed by a space, so "In 2013, 250 pull
   requests" yields 250 and not 2013250. */
const INT = '(\\d{1,3}(?:[.,]\\d{3})+|\\d+)';

/* Bullets that are a published figure rather than a thing that happened.
   The colon is required: 2006's only bullet is the sentence "Codegarden is held
   for the 2nd time...", which is an event, not a statistics line. */
const STAT_LINE = /^\s*(number of employees|number of installs|no\.? of installs|installs|pull requests|prs|codegarden|revenue|mvps?)\b\s*:/i;

const DKK_PER_EUR = 7.46; /* the Danish krone's fixed ERM II central rate */

const toInt = s => parseInt(String(s).replace(/[^\d]/g, ''), 10);

function toFloat(s) {
  let t = String(s).trim();
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  return parseFloat(t);
}

const firstMatch = (items, re) => items.find(t => re.test(t)) || null;

function readEmployees(items) {
  const it = firstMatch(items, /number of employees/i);
  if (!it) return null;
  const m = new RegExp('number of employees\\s*:?\\s*' + INT + '\\s*(\\+)?', 'i').exec(it);
  return m ? { value: toInt(m[1]), atLeast: !!m[2], note: it } : null;
}

function readPullRequests(items, year) {
  let it = firstMatch(items, /pull requests\s*:/i);
  if (it) {
    const after = it.split(/pull requests\s*:/i)[1] || '';
    const re = new RegExp(INT, 'g');
    let m;
    while ((m = re.exec(after))) {
      const v = toInt(m[1]);
      if (v === year) continue;             /* "In 2020 we had 1387 PRs" */
      return { value: v, note: it };
    }
  }
  /* 2013 states the figure mid-sentence, with no label. */
  const prose = new RegExp(INT + '\\s*(?:incoming\\s+)?pull requests', 'i');
  it = firstMatch(items, prose);
  if (it) {
    const m = prose.exec(it);
    if (m) return { value: toInt(m[1]), note: it };
  }
  return null;
}

const CG_PEOPLE = '(?:attendees?|attended|attending|developers?|participants?|people|users)';

function readCodegarden(items) {
  const mentions = items.filter(t => /codegarden/i.test(t));
  const labelled = mentions.filter(t => /^\s*codegarden\s*:/i.test(t));

  for (const pool of [labelled, mentions]) {
    for (const it of pool) {
      if (/did not take place|cancell?ed|no codegarden/i.test(it)) {
        return { value: 0, cancelled: true, note: it };
      }
      /* Requires a people-word after the number, so "the 9th Codegarden takes
         place" correctly reports no attendance figure at all. */
      const m = new RegExp(INT + '\\s+(?:[A-Za-z]+\\s+)?' + CG_PEOPLE, 'i').exec(it);
      if (m) return { value: toInt(m[1]), cancelled: false, note: it };
    }
  }
  return null;
}

function readRevenue(items) {
  for (const it of items) {
    if (!/revenue/i.test(it)) continue;
    const m = /(\d+(?:[.,]\d+)?)\s*M\.?\s*(euro|eur|€|danish)/i.exec(it);
    if (!m) continue;
    const isEur = /^(euro|eur|€)$/i.test(m[2]);
    const amount = toFloat(m[1]);
    return {
      value: isEur ? amount : amount / DKK_PER_EUR,   /* charted in € millions */
      reported: amount,
      currency: isEur ? 'EUR' : 'DKK',
      note: it
    };
  }
  return null;
}

function readMilestones(headline, items) {
  const out = [];
  if (headline) out.push({ text: headline, headline: true });
  for (const t of items) if (!STAT_LINE.test(t)) out.push({ text: t, headline: false });
  return out;
}

function readYear(block) {
  const m = /(\d{4})/.exec(block.label);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const items = block.items || [];
  return {
    year,
    label: block.label,
    headline: block.headline || null,
    employees: readEmployees(items),
    codegarden: readCodegarden(items),
    pullRequests: readPullRequests(items, year),
    revenue: readRevenue(items),
    milestones: readMilestones(block.headline, items)
  };
}

function parse(text, format) {
  const blocks = format === 'markdown' ? blocksFromMarkdown(text) : blocksFromHtml(text);
  return { years: blocks.map(readYear).filter(Boolean) };
}

module.exports = { SOURCE_URL, DKK_PER_EUR, fetchHistory, parse };
