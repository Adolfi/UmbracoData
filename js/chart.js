/* A small hand-rolled SVG column chart. No chart library, so the page stays a
   plain static file that works from disk as well as from a server. */
var UD = window.UD || (window.UD = {});

UD.chart = (function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var M = { top: 26, right: 16, bottom: 46, left: 62 };
  var BAR_MAX = 24;      /* marks stay thin; the band's leftover is air */
  var BAR_RADIUS = 4;    /* rounded data-end, square at the baseline */
  var STUB = 3;          /* height used to show a real, reported zero */

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    return node;
  }

  /* Rounded at the top, square where it meets the baseline. */
  function barPath(x, y, w, h) {
    var r = Math.min(BAR_RADIUS, w / 2, h);
    return 'M' + x + ',' + (y + h) +
           'L' + x + ',' + (y + r) +
           'Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
           'L' + (x + w - r) + ',' + y +
           'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
           'L' + (x + w) + ',' + (y + h) + 'Z';
  }

  /* Axis ticks land on 1/2/5 x 10^n so the reader gets round numbers. */
  function niceTicks(max, count) {
    if (!(max > 0)) return [0, 1];
    var raw = max / count;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    var ticks = [];
    for (var v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  /* opts: { points:[{year,value,...}], years:[...], color, format, onSelect, selected } */
  function render(svg, opts) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var wrap = svg.parentNode;
    var W = Math.max(320, wrap.clientWidth || 720);
    var H = opts.height || 400;
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    var innerW = W - M.left - M.right;
    var innerH = H - M.top - M.bottom;

    var years = opts.years;
    var byYear = {};
    opts.points.forEach(function (p) { byYear[p.year] = p; });

    var band = innerW / years.length;
    var barW = Math.max(3, Math.min(BAR_MAX, band - 6)); /* leftover is the surface gap */

    var values = opts.points.map(function (p) { return p.value; });
    var max = values.length ? Math.max.apply(null, values) : 1;
    var ticks = niceTicks(max, 4);
    var top = ticks[ticks.length - 1] || 1;

    function x(year) { return M.left + (year - years[0]) * band + (band - barW) / 2; }
    function y(v) { return M.top + innerH - (v / top) * innerH; }

    var g = el('g');
    svg.appendChild(g);

    /* gridlines + y axis, recessive */
    ticks.forEach(function (t) {
      var yy = Math.round(y(t)) + 0.5;
      g.appendChild(el('line', {
        x1: M.left, x2: M.left + innerW, y1: yy, y2: yy,
        class: t === 0 ? 'axis-base' : 'grid'
      }));
      var lab = el('text', { x: M.left - 10, y: yy + 4, class: 'tick tick-y' });
      lab.textContent = opts.formatTick ? opts.formatTick(t) : String(t);
      g.appendChild(lab);
    });

    /* x labels thin out rather than collide */
    var step = Math.max(1, Math.ceil(years.length / Math.max(3, Math.floor(innerW / 38))));
    /* The final year gets a label only if it clears the last regular tick -
       otherwise the two overlap at the right edge. */
    var lastTick = Math.floor((years.length - 1) / step) * step;
    var showLast = (years.length - 1) - lastTick >= step;
    years.forEach(function (yr, i) {
      var showIt = (i % step === 0) || (showLast && i === years.length - 1);
      if (!showIt) return;
      var lab = el('text', {
        x: M.left + i * band + band / 2,
        y: M.top + innerH + 20,
        class: 'tick tick-x' + (opts.selected === yr ? ' is-sel' : '')
      });
      lab.textContent = String(yr).slice(2) === '00' ? yr : "'" + String(yr).slice(2);
      g.appendChild(lab);
    });

    /* decade anchors, so the eye can place a bar in time */
    years.forEach(function (yr, i) {
      if (yr % 10 !== 0) return;
      g.appendChild(el('text', {
        x: M.left + i * band + band / 2, y: M.top + innerH + 36, class: 'tick tick-decade'
      }));
      g.lastChild.textContent = yr;
    });

    /* the marks */
    var labelled = {};
    if (opts.points.length) {
      var peak = opts.points.reduce(function (a, b) { return b.value > a.value ? b : a; });
      var latest = opts.points[opts.points.length - 1];
      labelled[peak.year] = true;
      labelled[latest.year] = true;   /* label the extreme and the endpoint, nothing else */
    }

    years.forEach(function (yr, i) {
      var p = byYear[yr];
      var bx = x(yr);

      if (p) {
        var h = Math.max(p.value > 0 ? 2 : 0, Math.round(innerH - (y(p.value) - M.top)));
        if (p.value === 0) {
          /* a published zero is data, not a gap - show it as a stub */
          g.appendChild(el('rect', {
            x: bx, y: M.top + innerH - STUB, width: barW, height: STUB,
            rx: 1.5, class: 'bar-zero'
          }));
        } else {
          g.appendChild(el('path', {
            d: barPath(bx, M.top + innerH - h, barW, h),
            class: 'bar' + (opts.selected === yr ? ' is-sel' : '')
          }));
        }

        if (labelled[yr]) {
          var vl = el('text', {
            x: bx + barW / 2,
            y: Math.max(M.top - 8, M.top + innerH - h - 8),
            class: 'bar-label'
          });
          vl.textContent = opts.format(p.value, p);
          g.appendChild(vl);
        }
      }

      /* full-height hit target: bigger than the mark, and present on empty years
         so the reader can tell "nothing published" from "zero" */
      var hit = el('rect', {
        x: M.left + i * band, y: M.top, width: band, height: innerH,
        class: 'hit', 'data-year': yr, tabindex: 0, role: 'button',
        'aria-label': yr + ': ' + (p ? opts.format(p.value, p) : 'no figure published')
      });
      g.appendChild(hit);
    });

    return { band: band, left: M.left, top: M.top, innerH: innerH, barW: barW, xOf: x, yOf: y };
  }

  return { render: render, niceTicks: niceTicks };
})();
