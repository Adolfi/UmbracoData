var UD = window.UD || (window.UD = {});

(function () {
  'use strict';

  var CACHE_KEY = 'umbraco-history-cache-v1';
  var CACHE_TTL = 6 * 60 * 60 * 1000;  /* re-read in the background after 6h */

  /* Each metric owns a fixed palette slot. Colour follows the metric, never its
     rank, so switching views never repaints anything. */
  var METRICS = [
    {
      id: 'employees', slot: 1, label: 'Employees', short: 'Employees',
      title: 'People at Umbraco HQ',
      blurb: 'Headcount as published in the year’s entry.',
      pick: function (r) { return r.employees; },
      format: function (v, p) { return fmtInt(v) + (p && p.atLeast ? '+' : ''); },
      tick: fmtInt, unit: 'employees'
    },
    {
      id: 'codegarden', slot: 2, label: 'Codegarden attendees', short: 'Codegarden',
      title: 'Codegarden attendees',
      blurb: 'Attendance at the annual Umbraco conference.',
      pick: function (r) { return r.codegarden; },
      format: function (v, p) { return p && p.cancelled ? 'Cancelled' : fmtInt(v); },
      tick: fmtInt, unit: 'attendees'
    },
    {
      id: 'pullRequests', slot: 3, label: 'Pull requests', short: 'Pull requests',
      title: 'Community pull requests',
      blurb: 'Incoming PRs to the Umbraco core and docs.',
      pick: function (r) { return r.pullRequests; },
      format: fmtInt, tick: fmtInt, unit: 'pull requests'
    },
    {
      id: 'revenue', slot: 4, label: 'Revenue', short: 'Revenue',
      title: 'Company revenue',
      blurb: 'Reported revenue, shown in euro millions.',
      pick: function (r) { return r.revenue; },
      format: function (v) { return '€' + (v >= 10 ? v.toFixed(1) : v.toFixed(2)) + 'M'; },
      tick: function (v) { return '€' + (v % 1 ? v.toFixed(1) : v) + 'M'; },
      unit: 'M EUR'
    },
    {
      id: 'milestones', slot: 5, label: 'Milestones', short: 'Milestones',
      title: 'Milestones per year',
      blurb: 'Events the history page records for each year.',
      pick: function (r) { return r.milestones && r.milestones.length ? { value: r.milestones.length } : null; },
      format: fmtInt, tick: fmtInt, unit: 'milestones'
    }
  ];

  var state = {
    data: null,
    metric: METRICS[0],
    selected: null,
    live: false
  };

  var $ = function (id) { return document.getElementById(id); };

  function fmtInt(v) { return Number(v).toLocaleString('en-US'); }

  /* ---------- storage (any of this can throw in a private window) ---------- */

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      return obj && obj.years && obj.years.length ? obj : null;
    } catch (e) { return null; }
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* fine */ }
  }

  /* ---------- boot ---------- */

  /* #codegarden, #revenue&year=2019 ... so a view can be linked to and reloaded. */
  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return;
    var parts = h.split('&');
    var id = parts[0];
    var m = METRICS.filter(function (x) { return x.id === id; })[0];
    if (m) state.metric = m;
    for (var i = 1; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0] === 'year' && /^\d{4}$/.test(kv[1])) state.selected = parseInt(kv[1], 10);
    }
  }

  function writeHash() {
    var h = '#' + state.metric.id + (state.selected ? '&year=' + state.selected : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  function init() {
    readHash();
    buildMetricNav();
    wireControls();
    $('brand-year').textContent = new Date().getFullYear();

    var cached = readCache();
    var fresh = cached && (Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_TTL);

    if (cached) {
      apply(cached, cached.via === 'snapshot' ? 'snapshot' : 'cache');
    } else {
      apply(UD.snapshot, 'snapshot');
    }
    if (!fresh) refresh(true);
  }

  function refresh(quiet) {
    setStatus('loading', quiet ? 'Checking umbraco.com…' : 'Reading umbraco.com…');
    $('refresh').disabled = true;

    UD.parser.load()
      .then(function (data) {
        writeCache(data);
        apply(data, 'live');
      })
      .catch(function (err) {
        if (state.data) {
          setStatus('warn', 'Live read failed – showing ' + (state.live ? 'last good data' : 'the bundled snapshot'));
        } else {
          apply(UD.snapshot, 'snapshot');
          setStatus('warn', 'Live read failed – showing the bundled snapshot');
        }
        if (window.console) console.warn('[umbraco-data] live read failed', err && err.attempts);
      })
      .then(function () { $('refresh').disabled = false; });
  }

  function apply(data, origin) {
    state.data = data;
    state.live = origin === 'live' || origin === 'cache';

    var when = data.fetchedAt ? new Date(data.fetchedAt) : null;
    if (origin === 'live') setStatus('ok', 'Live from umbraco.com · ' + timeOf(when));
    else if (origin === 'cache') setStatus('ok', 'Cached from umbraco.com · ' + timeOf(when));
    else setStatus('warn', 'Bundled snapshot · ' + (when ? timeOf(when) : 'offline'));

    if (!state.selected) {
      var last = lastYearWith(state.metric);
      state.selected = last ? last.year : null;
    }
    draw();
  }

  function timeOf(d) {
    if (!d) return 'unknown time';
    var mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + ' h ago';
    return d.toLocaleDateString();
  }

  function setStatus(kind, text) {
    $('status').className = 'status is-' + kind;
    $('status-text').textContent = text;
  }

  /* ---------- controls ---------- */

  function buildMetricNav() {
    var nav = document.querySelector('.metrics');
    nav.innerHTML = '';
    METRICS.forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'metric';
      b.dataset.slot = m.slot;
      b.dataset.id = m.id;
      b.setAttribute('aria-pressed', String(m.id === state.metric.id));
      if (m.id === state.metric.id) b.classList.add('is-on');
      b.innerHTML = '<span class="swatch" aria-hidden="true"></span>' +
                    '<span class="metric-label">' + m.label + '</span>' +
                    '<span class="metric-latest"></span>';
      b.addEventListener('click', function () { selectMetric(m); });
      nav.appendChild(b);
    });
  }

  function selectMetric(m) {
    state.metric = m;
    var last = lastYearWith(m);
    state.selected = last ? last.year : null;
    document.querySelectorAll('.metric').forEach(function (b) {
      var on = b.dataset.id === m.id;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    draw();
  }

  function wireControls() {
    $('refresh').addEventListener('click', function () { refresh(false); });
    window.addEventListener('hashchange', function () {
      readHash();
      document.querySelectorAll('.metric').forEach(function (b) {
        var on = b.dataset.id === state.metric.id;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      draw();
    });

    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(draw, 120);
    });
  }

  /* ---------- data shaping ---------- */

  function series(metric) {
    if (!state.data) return [];
    var out = [];
    state.data.years.forEach(function (r) {
      var hit = metric.pick(r);
      if (!hit || typeof hit.value !== 'number' || isNaN(hit.value)) return;
      out.push({
        year: r.year, label: r.label, value: hit.value,
        atLeast: !!hit.atLeast, cancelled: !!hit.cancelled,
        reported: hit.reported, currency: hit.currency, note: hit.note || null
      });
    });
    out.sort(function (a, b) { return a.year - b.year; });
    return out;
  }

  function lastYearWith(metric) {
    var s = series(metric);
    return s.length ? s[s.length - 1] : null;
  }

  function yearAxis() {
    var end = new Date().getFullYear();
    var start = 1997;
    var out = [];
    for (var y = start; y <= end; y++) out.push(y);
    return out;
  }

  function rowFor(year) {
    if (!state.data) return null;
    for (var i = 0; i < state.data.years.length; i++) {
      if (state.data.years[i].year === year) return state.data.years[i];
    }
    return null;
  }

  /* ---------- rendering ---------- */

  function draw() {
    if (!state.data) return;
    writeHash();
    var m = state.metric;
    var pts = series(m);

    document.body.dataset.slot = m.slot;

    $('chart-title').textContent = m.title;
    $('chart-sub').textContent = m.blurb;

    document.querySelectorAll('.metric').forEach(function (b) {
      var def = METRICS.filter(function (x) { return x.id === b.dataset.id; })[0];
      var last = lastYearWith(def);
      b.querySelector('.metric-latest').textContent = last ? def.format(last.value, last) : '–';
    });

    drawStats(m, pts);
    drawFootnote(m, pts);

    drawChart(m, pts);

    drawMilestones();
  }

  function drawStats(m, pts) {
    var box = $('stats');
    box.innerHTML = '';
    if (!pts.length) { box.innerHTML = '<p class="empty">No figures for this metric on the page.</p>'; return; }

    var latest = pts[pts.length - 1];
    var peak = pts.reduce(function (a, b) { return b.value > a.value ? b : a; });
    var first = pts[0];

    var growth = first.value > 0 ? (latest.value / first.value) : null;

    add('hero', 'Latest published (' + latest.year + ')', m.format(latest.value, latest), null);
    if (peak.year !== latest.year) add('', 'Peak', m.format(peak.value, peak), 'in ' + peak.year);
    add('', 'First published', m.format(first.value, first), 'in ' + first.year);
    add('', 'Years with a figure', fmtInt(pts.length), first.year + '–' + latest.year);
    /* A growth multiple says something about headcount or revenue; for a count of
       events per year it would just be noise. */
    if (m.id !== 'milestones' && growth && growth > 1.05) {
      add('', 'Growth since ' + first.year, '×' + growth.toFixed(growth < 10 ? 1 : 0), null);
    }

    function add(cls, label, value, sub) {
      var d = document.createElement('div');
      d.className = 'stat ' + cls;
      d.innerHTML = '<span class="stat-label"></span><span class="stat-value"></span>' +
                    (sub ? '<span class="stat-sub"></span>' : '');
      d.querySelector('.stat-label').textContent = label;
      d.querySelector('.stat-value').textContent = value;
      if (sub) d.querySelector('.stat-sub').textContent = sub;
      box.appendChild(d);
    }
  }

  function drawFootnote(m, pts) {
    var notes = [];
    var axis = yearAxis();
    if (pts.length) {
      var missing = [];
      for (var y = pts[0].year; y <= pts[pts.length - 1].year; y++) {
        if (!pts.some(function (p) { return p.year === y; })) missing.push(y);
      }
      if (missing.length) notes.push('No figure published for ' + missing.join(', ') + '.');
      var tail = axis[axis.length - 1];
      if (pts[pts.length - 1].year < tail) {
        notes.push('The history page has not yet published this figure for ' +
                   (pts[pts.length - 1].year + 1 === tail ? tail : (pts[pts.length - 1].year + 1) + '–' + tail) + '.');
      }
    }
    if (m.id === 'revenue') {
      notes.push('Figures published in Danish kroner are converted at the krone’s fixed rate of ' +
                 UD.parser.DKK_PER_EUR + ' DKK per euro; hover a column for the figure as published.');
    }
    if (m.id === 'employees') notes.push('A “+” means the page states the figure as “120+” and similar.');
    if (m.id === 'milestones') notes.push('Counted as the number of non-statistic bullet points the page lists for the year.');
    $('footnote').textContent = notes.join(' ');
  }

  function drawChart(m, pts) {
    var svg = $('chart');
    var axis = yearAxis();

    var geo = UD.chart.render(svg, {
      points: pts, years: axis, selected: state.selected,
      format: m.format, formatTick: m.tick,
      height: window.innerWidth < 720 ? 320 : 400
    });

    $('chart-desc').textContent = m.title + '. ' + pts.map(function (p) {
      return p.year + ': ' + m.format(p.value, p);
    }).join('; ') + '.';

    var tip = $('tip');
    var wrap = $('chart-wrap');

    svg.querySelectorAll('.hit').forEach(function (hit) {
      var yr = parseInt(hit.getAttribute('data-year'), 10);
      hit.addEventListener('mouseenter', function () { showTip(yr, hit); });
      hit.addEventListener('focus', function () { showTip(yr, hit); });
      hit.addEventListener('mousemove', function () { showTip(yr, hit); });
      hit.addEventListener('mouseleave', hideTip);
      hit.addEventListener('blur', hideTip);
      hit.addEventListener('click', function () { state.selected = yr; draw(); });
      hit.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.selected = yr; draw(); }
      });
    });

    function showTip(yr, hit) {
      var p = pts.filter(function (q) { return q.year === yr; })[0];
      var row = rowFor(yr);
      var head = '<strong>' + (row ? row.label : yr) + '</strong>';
      var body;
      if (!p) {
        body = '<span class="tip-none">No ' + m.unit + ' figure published</span>';
      } else if (p.cancelled) {
        body = '<span class="tip-val">Cancelled</span><span class="tip-note">Codegarden did not take place</span>';
      } else {
        body = '<span class="tip-val">' + m.format(p.value, p) + '</span>';
        if (m.id === 'revenue' && p.currency === 'DKK') {
          body += '<span class="tip-note">Published as ' + p.reported + ' M DKK</span>';
        }
        if (m.id === 'milestones' && row) {
          body += '<span class="tip-note">' + (row.milestones[0] ? clip(row.milestones[0].text, 70) : '') + '</span>';
        }
      }
      tip.innerHTML = head + body;
      tip.hidden = false;

      var box = hit.getBoundingClientRect();
      var wb = wrap.getBoundingClientRect();
      var left = box.left - wb.left + box.width / 2;
      tip.style.left = Math.max(8, Math.min(wrap.clientWidth - tip.offsetWidth - 8, left - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(4, (geo.top + 4)) + 'px';
    }
    function hideTip() { tip.hidden = true; }
  }

  function clip(s, n) { return s.length > n ? s.slice(0, n - 1).replace(/\s\S*$/, '') + '…' : s; }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function drawMilestones() {
    var row = rowFor(state.selected);
    var body = $('ms-body');
    if (!row) {
      $('ms-sub').textContent = 'Select a year in the chart to read what happened.';
      body.innerHTML = '<p class="empty">The history page has no entry for ' +
        (state.selected || 'this year') + '.</p>';
      return;
    }
    $('ms-sub').textContent = row.label + ' · ' + row.milestones.length +
      ' event' + (row.milestones.length === 1 ? '' : 's') + ' recorded';

    var html = '<ul class="ms-list">';
    row.milestones.forEach(function (ms) {
      html += '<li class="' + (ms.headline ? 'is-head' : '') + '">' + esc(ms.text) + '</li>';
    });
    html += '</ul>';

    var figs = [];
    if (row.employees) figs.push(['Employees', row.employees.value + (row.employees.atLeast ? '+' : '')]);
    if (row.codegarden) figs.push(['Codegarden', row.codegarden.cancelled ? 'Cancelled' : fmtInt(row.codegarden.value) + ' attendees']);
    if (row.pullRequests) figs.push(['Pull requests', fmtInt(row.pullRequests.value)]);
    if (row.revenue) figs.push(['Revenue', row.revenue.reported + ' M ' + row.revenue.currency]);
    if (figs.length) {
      html += '<dl class="ms-figs">';
      figs.forEach(function (f) { html += '<div><dt>' + f[0] + '</dt><dd>' + esc(f[1]) + '</dd></div>'; });
      html += '</dl>';
    }
    body.innerHTML = html;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
