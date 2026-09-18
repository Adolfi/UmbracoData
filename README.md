# UmbracoData

A static single-page dashboard charting Umbraco community and company data from
1997 to today.

The page itself fetches nothing from the internet. It loads one local file,
`js/data.js`, which is generated from Umbraco's own history page —
<https://umbraco.com/about-us/the-history-of-umbraco/>. When that page is
updated, run the update command below to regenerate it.

## Updating the data

```sh
node tools/update-data.js            # read the source page, rewrite js/data.js, list what changed
node tools/update-data.js --check    # show what would change, write nothing
```

Both print a plain summary of what moved, so you can see the effect of an update
at a glance:

```
reading https://umbraco.com/about-us/the-history-of-umbraco/ ... ok (via umbraco.com)
parsed 23 year entries, 1997-1999 to 2024

changes:
  ~ 2024 Employees: 140+ -> 150+
  + 2025 Codegarden: 1800
```

No dependencies — Node's built-in `fetch` and nothing else.

## Running the page

It is a plain static site — no build step, no dependencies, no server required.
Open `index.html` in a browser, or serve the folder if you prefer:

```sh
python3 -m http.server 8000     # then open http://localhost:8000
```

The data is a `.js` file assigning `UD.data` rather than a `.json` file, which is
what lets `file://` work — browsers refuse to fetch local JSON.

## Metrics

Toggle between five views:

| Metric | Published for | Notes |
|---|---|---|
| Employees | 2008–2024 | `120+` style figures are charted at the stated number and marked with `+` |
| Codegarden attendees | 2005–2024 | 2020 is charted as a reported zero (cancelled for COVID-19) |
| Pull requests | 2013–2024 | Incoming PRs to the CMS and documentation |
| Revenue | 2014–2023 | Charted in € millions; DKK figures converted at the krone's fixed 7.46 rate |
| Milestones | 1997–2024 | Count of non-statistic bullet points the page lists for the year |

Gaps are real gaps: where Umbraco has not published a figure, no column is drawn
and the footnote names the missing years. Clicking any year opens that year's
events in the Milestones panel.

Each view is linkable: `#revenue`, `#codegarden&year=2021`, and so on.

## Files

```
index.html              markup and layout
css/styles.css          layout and theming
js/data.js              the generated dataset the page reads
js/chart.js             the SVG column chart
js/app.js               state, toggles, milestones
tools/parser.js         reads the source page into structured data
tools/update-data.js    regenerates js/data.js, reports what changed
```

## How the source page is read

`tools/parser.js` fetches umbraco.com directly — running in Node there is no
same-origin policy to work around — and falls back to `r.jina.ai` only if the
direct request is refused. That fallback returns markdown rather than HTML, so
there are two parsers behind it, held to producing identical output.

The HTML is walked by counting tags rather than by a regex per element, so a
nested `<ul>` and the page footer cannot bleed into a year's bullet list.

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
- 2022 nests a `<ul>` inside an `<li>`, which double-counts milestones unless
  only top-level bullets are taken.

Charts follow one series at a time on a single axis. The palette is validated for
colour-vision deficiency and every series clears 3:1 contrast against the page
surface. Each column carries a hover tooltip and a screen-reader label, and the
full series is also exposed as a text description behind the chart.
