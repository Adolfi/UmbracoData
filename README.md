# UmbracoData

A static single-page dashboard that charts Umbraco community and company data
from 1997 to today.

Every figure is read **at page load** from Umbraco's own history page —
<https://umbraco.com/about-us/the-history-of-umbraco/> — and parsed in the
browser. Nothing is hard-coded, so when Umbraco edits that page, this dashboard
shows the new numbers on the next load.

## Metrics

Toggle between five views:

| Metric | Published for | Notes |
|---|---|---|
| Employees | 2008–2024 | `120+` style figures are charted at the stated number and marked with `+` |
| Codegarden attendees | 2005–2024 | 2020 is charted as a reported zero (cancelled for COVID-19) |
| Pull requests | 2013–2024 | Incoming PRs to the CMS and documentation |
| Revenue | 2014–2023 | Charted in € millions; DKK figures converted at the krone's fixed 7.46 rate |
| Milestones | 1997–2024 | Count of non-statistic bullet points the page lists for the year |

Gaps are real gaps: where Umbraco has not published a figure, no column is
drawn and the footnote names the missing years. Clicking any year opens that
year's events in the Milestones panel.

Each view is linkable: `#revenue`, `#codegarden&year=2021`, and so on.

## Running it

It is a plain static site — no build step, no dependencies.

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

Opening `index.html` straight from disk also works, though a couple of the
CORS relays behave better over `http://`.

## How the live read works

`umbraco.com` sends no `Access-Control-Allow-Origin` header, so a browser cannot
fetch it directly. `js/parser.js` tries a direct request first, then falls back
through public CORS relays until one returns a page that actually parses:

1. direct
2. `test.cors.workers.dev`
3. `api.allorigins.win`
4. `api.codetabs.com`
5. `r.jina.ai` (returns markdown rather than HTML)

There are two parsers behind that — one for HTML, one for markdown — and they
are held to producing identical output. A successful read is cached in
`localStorage` for six hours, so a repeat visit paints immediately and then
revalidates in the background.

If every relay fails, the page falls back to `js/snapshot.js` and says so in the
status pill rather than showing stale data silently.

### Refreshing the bundled snapshot

```sh
node tools/snapshot.js
```

This runs the same parser over the live page and rewrites `js/snapshot.js`.

## Files

```
index.html        markup and layout
css/styles.css    layout and theming
js/parser.js      fetching and extracting the data
js/chart.js       the SVG column chart
js/app.js         state, toggles, tables, milestones
js/snapshot.js    generated offline fallback
tools/snapshot.js regenerates the above
```

## Notes on the data

The history page is prose, not a dataset, so the parser reads figures the way a
person would — and a few entries need care:

- 2013's PR count is stated mid-sentence (“In 2013, 250 pull requests were
  made”) rather than as a labelled figure.
- 2020's PR line reads “In 2020 we had a whooping 1387 incoming pull requests”,
  so the year itself has to be skipped when picking the number.
- Several years say only “the 9th Codegarden takes place”, with no attendance
  figure — those are treated as not published, not as zero.
- 2006's single bullet is a sentence about Codegarden, which is an event rather
  than a statistics line, so it counts as a milestone.

Charts follow one series at a time on a single axis. The palette is validated
for colour-vision deficiency and every series clears 3:1 contrast against the
page surface. Each column carries a hover tooltip and a screen-reader label, and
the full series is also exposed as a text description behind the chart.
