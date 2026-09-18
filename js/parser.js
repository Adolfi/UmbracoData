/* Reads umbraco.com's history page and turns it into structured yearly data.
   Nothing here is hard-coded from the page: every number is extracted at runtime,
   so when Umbraco edits the page, the dashboard follows. */
var UD = window.UD || (window.UD = {});

UD.parser = (function () {
  'use strict';

  var SOURCE_URL = 'https://umbraco.com/about-us/the-history-of-umbraco/';

  /* umbraco.com serves no Access-Control-Allow-Origin, so a browser cannot read it
     directly. We try the direct request first anyway (it is the cheapest and works
     if the page is ever served same-origin), then fall back through public CORS
     relays. `format` says how to read what comes back. */
  var ROUTES = [
    { id: 'direct',     format: 'html',     url: function (u) { return u; } },
    { id: 'cors.workers.dev', format: 'html', url: function (u) { return 'https://test.cors.workers.dev/?' + u; } },
    { id: 'allorigins', format: 'html',     url: function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); } },
    { id: 'codetabs',   format: 'html',     url: function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); } },
    { id: 'jina.ai',    format: 'markdown', url: function (u) { return 'https://r.jina.ai/' + u; } }
  ];

  var TIMEOUT_MS = 15000;

  function fetchWithTimeout(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, redirect: 'follow' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* Walks the relay list until one returns something that actually parses into
     year blocks. A relay that answers 200 with a block page is still a failure. */
  function load() {
    var attempts = [];

    function tryRoute(i) {
      if (i >= ROUTES.length) {
        var err = new Error('Could not reach the history page');
        err.attempts = attempts;
        return Promise.reject(err);
      }
      var route = ROUTES[i];
      return fetchWithTimeout(route.url(SOURCE_URL))
        .then(function (text) {
          var data = parse(text, route.format);
          if (!data.years.length) throw new Error('no timeline found in response');
          data.via = route.id;
          data.fetchedAt = new Date().toISOString();
          data.source = SOURCE_URL;
          attempts.push({ route: route.id, ok: true });
          data.attempts = attempts;
          return data;
        })
        .catch(function (e) {
          attempts.push({ route: route.id, ok: false, error: String(e && e.message || e) });
          return tryRoute(i + 1);
        });
    }
    return tryRoute(0);
  }

  /* ---------- turning a response into year blocks ---------- */

  function clean(s) {
    return String(s).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  }

  function parse(text, format) {
    var blocks = format === 'markdown' ? blocksFromMarkdown(text) : blocksFromHtml(text);
    return { years: blocks.map(readYear).filter(Boolean) };
  }

  function blocksFromHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var timeline = doc.querySelector('.dc-timeline');
    if (!timeline) return [];

    var out = [];
    var pendingHeadline = null;

    var nodes = timeline.querySelectorAll('.dc-timeline-block');
    for (var i = 0; i < nodes.length; i++) {
      var block = nodes[i];
      var h2 = block.querySelector('.dc-timeline-headline h2, .dc-timeline-headline');
      if (block.classList.contains('dc-timeline-block__headline') || (h2 && !block.querySelector('.dc-timeline-title'))) {
        if (h2) pendingHeadline = clean(h2.textContent);
        continue;
      }
      var titleEl = block.querySelector('.dc-timeline-title h3, .dc-timeline-title');
      if (!titleEl) continue;
      var label = clean(titleEl.textContent);
      if (!/\d{4}/.test(label)) continue;

      var items = [];
      var itemBox = block.querySelector('.dc-timeline-item');
      if (itemBox) {
        /* Top-level bullets only. Some entries nest a <ul> inside an <li>
           (2022's community teams); the parent's textContent already carries the
           children, so counting the nested <li>s too would double them. */
        var lis = itemBox.querySelectorAll('li');
        for (var j = 0; j < lis.length; j++) {
          if (lis[j].parentNode.closest && lis[j].parentNode.closest('li')) continue;
          var t = clean(lis[j].textContent);
          if (t) items.push(t);
        }
        if (!items.length) {
          var ps = itemBox.querySelectorAll('p');
          for (var k = 0; k < ps.length; k++) {
            var pt = clean(ps[k].textContent);
            if (pt) items.push(pt);
          }
        }
      }
      out.push({ label: label, headline: pendingHeadline, items: items });
      pendingHeadline = null;
    }
    return out;
  }

  /* The jina.ai relay returns the page as markdown: `## headline`, `### year`,
     `*   item`. Same shape, different skin. */
  function blocksFromMarkdown(md) {
    var lines = String(md).split(/\r?\n/);
    var out = [];
    var pendingHeadline = null;
    var current = null;

    function flush() { if (current) { out.push(current); current = null; } }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var h2 = line.match(/^##\s+(?!#)(.+?)\s*$/);
      var h3 = line.match(/^###\s+(.+?)\s*$/);
      var li = line.match(/^(\s*)[*-]\s+(.+?)\s*$/);

      if (h3) {
        flush();
        var label = clean(stripMd(h3[1]));
        if (/\d{4}/.test(label)) {
          current = { label: label, headline: pendingHeadline, items: [] };
          pendingHeadline = null;
        }
        continue;
      }
      if (h2) { flush(); pendingHeadline = clean(stripMd(h2[1])); continue; }
      if (li && current) {
        var t = clean(stripMd(li[2]));
        if (!t) continue;
        /* An indented bullet is a sub-item; fold it into its parent so the
           markdown route counts the same bullets the HTML route does. */
        if (li[1].length >= 2 && current.items.length) {
          current.items[current.items.length - 1] += ' ' + t;
        } else {
          current.items.push(t);
        }
        continue;
      }
      if (current && /^\s{4,}\S/.test(line) && current.items.length) {
        current.items[current.items.length - 1] += ' ' + clean(stripMd(line));
      }
    }
    flush();
    return out;
  }

  function stripMd(s) {
    return String(s)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`]+/g, ' ')   /* a space, not nothing: **2013,**250 must not glue */
      .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1');
  }

  /* ---------- pulling metrics out of a block's bullet list ---------- */

  /* A run of digits, optionally with , or . as thousands separators. Deliberately
     refuses to span a separator followed by a space, so "In 2013, 250 pull
     requests" yields 250 and not 2013250. */
  var INT = '(\\d{1,3}(?:[.,]\\d{3})+|\\d+)';

  /* Bullets that are a published figure rather than a thing that happened.
     The colon is required: 2006's only bullet is the sentence "Codegarden is held
     for the 2nd time...", which is an event, not a statistics line. */
  var STAT_LINE = /^\s*(number of employees|number of installs|no\.? of installs|installs|pull requests|prs|codegarden|revenue|mvps?)\b\s*:/i;

  var DKK_PER_EUR = 7.46; /* the Danish krone's fixed ERM II central rate */

  function toInt(s) { return parseInt(String(s).replace(/[^\d]/g, ''), 10); }

  function toFloat(s) {
    var t = String(s).trim();
    if (t.indexOf(',') > -1 && t.indexOf('.') > -1) t = t.replace(/,/g, '');
    else if (t.indexOf(',') > -1) t = t.replace(',', '.');
    return parseFloat(t);
  }

  function firstMatch(items, re) {
    for (var i = 0; i < items.length; i++) if (re.test(items[i])) return items[i];
    return null;
  }

  function readEmployees(items) {
    var it = firstMatch(items, /number of employees/i);
    if (!it) return null;
    var m = new RegExp('number of employees\\s*:?\\s*' + INT + '\\s*(\\+)?', 'i').exec(it);
    if (!m) return null;
    return { value: toInt(m[1]), atLeast: !!m[2], note: it };
  }

  function readPullRequests(items, year) {
    var it = firstMatch(items, /pull requests\s*:/i);
    if (it) {
      var after = it.split(/pull requests\s*:/i)[1] || '';
      var re = new RegExp(INT, 'g'), m;
      while ((m = re.exec(after))) {
        var v = toInt(m[1]);
        if (v === year) continue;           /* "In 2020 we had 1387 PRs" */
        return { value: v, note: it };
      }
    }
    /* 2013 states the figure in prose, with no label. */
    it = firstMatch(items, new RegExp(INT + '\\s*(?:incoming\\s+)?pull requests', 'i'));
    if (it) {
      var m2 = new RegExp(INT + '\\s*(?:incoming\\s+)?pull requests', 'i').exec(it);
      if (m2) return { value: toInt(m2[1]), note: it };
    }
    return null;
  }

  var CG_PEOPLE = '(?:attendees?|attended|attending|developers?|participants?|people|users)';

  function readCodegarden(items) {
    var mentions = items.filter(function (t) { return /codegarden/i.test(t); });
    var labelled = mentions.filter(function (t) { return /^\s*codegarden\s*:/i.test(t); });
    var pools = [labelled, mentions];

    for (var p = 0; p < pools.length; p++) {
      for (var i = 0; i < pools[p].length; i++) {
        var it = pools[p][i];
        if (/did not take place|cancell?ed|no codegarden/i.test(it)) {
          return { value: 0, cancelled: true, note: it };
        }
        /* Requires a people-word after the number, so "the 9th Codegarden takes
           place" correctly reports no attendance figure at all. */
        var m = new RegExp(INT + '\\s+(?:[A-Za-z]+\\s+)?' + CG_PEOPLE, 'i').exec(it);
        if (m) return { value: toInt(m[1]), cancelled: false, note: it };
      }
    }
    return null;
  }

  function readRevenue(items) {
    for (var i = 0; i < items.length; i++) {
      if (!/revenue/i.test(items[i])) continue;
      var m = /(\d+(?:[.,]\d+)?)\s*M\.?\s*(euro|eur|€|danish)/i.exec(items[i]);
      if (!m) continue;
      var isEur = /^(euro|eur|€)$/i.test(m[2]);
      var amount = toFloat(m[1]);
      return {
        value: isEur ? amount : amount / DKK_PER_EUR,   /* charted in € millions */
        reported: amount,
        currency: isEur ? 'EUR' : 'DKK',
        note: items[i]
      };
    }
    return null;
  }

  function readMilestones(headline, items) {
    var out = [];
    if (headline) out.push({ text: headline, headline: true });
    for (var i = 0; i < items.length; i++) {
      if (STAT_LINE.test(items[i])) continue;
      out.push({ text: items[i], headline: false });
    }
    return out;
  }

  function readYear(block) {
    var m = /(\d{4})/.exec(block.label);
    if (!m) return null;
    var year = parseInt(m[1], 10);
    var items = block.items || [];
    return {
      year: year,
      label: block.label,
      headline: block.headline || null,
      employees: readEmployees(items),
      codegarden: readCodegarden(items),
      pullRequests: readPullRequests(items, year),
      revenue: readRevenue(items),
      milestones: readMilestones(block.headline, items)
    };
  }

  return {
    SOURCE_URL: SOURCE_URL,
    DKK_PER_EUR: DKK_PER_EUR,
    load: load,
    parse: parse
  };
})();
