# Project Outline — High-Level Decisions

Companion to `project.md` (the original brief). This file records the decisions
made so far. `plan.md` (created later) will describe the codebase itself and
be kept up to date as it changes.

## Goal (MVP)

A local, single-page web app that lets people explore open data without knowing
SQL. There are two ways in:

1. **Chat:** ask Claude in plain English. Claude asks clarifying questions, then
   fills in the query form.
2. **Form:** pick a dataset, then build a query with a form that is generated
   from the chart type and the dataset's columns. Clicking **Generate** fetches
   the data and renders the chart.

Charts update only when Generate is clicked. Editing the form never refetches.

## Stack

| Area | Decision |
| --- | --- |
| Language | TypeScript everywhere |
| Frontend | React (single page, single route), built with Vite |
| UI components | shadcn/ui (Tailwind CSS + Radix) |
| Backend | Node server. The browser talks only to this server. |
| Charts | Apache ECharts (`echarts-for-react`). Hover tooltips and legends come built in. |
| AI | Claude via the Anthropic API (API key, server side) |
| Data | Socrata SODA 2.1 on data.wa.gov, called with plain `fetch` (no soda-js) |
| Tests | None for the MVP |

## Configuration (`.env`, server only)

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Yes, for chat | Claude API access. If it's missing, the form still works and chat shows a setup message. |
| `SOCRATA_API_KEY` + `SOCRATA_API_SECRET` | No | Socrata API key ID and secret, sent as HTTP Basic auth for higher rate limits. The app works anonymously without them. |
| `AI_AUTO_RUN` | No (default `false`) | When `true`, the AI's query is run automatically. When `false`, the AI only fills in the form and the user clicks Generate. |
| `AI_CLASSIFY_COLUMNS` | No (default `true`) | When an API key is set, a small model classifies each dataset's columns once (cached). `false` falls back to name heuristics only. |

A `.env.example` is committed. `.env` is gitignored. API keys never reach the
browser.

**Why an API key rather than "log in with Claude":** Anthropic doesn't allow
third-party apps to offer claude.ai subscription login, including apps built on
the Agent SDK. They must authenticate with API keys.

## Core concept: `QuerySpec`

All queries are described by one typed JSON object, the `QuerySpec`:

- **The form** reads and writes the `QuerySpec`.
- **The AI** produces a `QuerySpec` through a tool call. The spec is validated
  against the dataset's schema and then fills in the form.
- **The server** translates the `QuerySpec` into SoQL (Socrata's query
  language). Neither the AI nor the browser writes SoQL directly.

Roughly, a `QuerySpec` contains: the dataset, the chart type, an assignment of
columns to the chart's slots (for example X, Y with an aggregate, and an
optional series), filters, sort order, and a row limit.

## Data-shape agnostic, with optional hints

- **Generic layer:** fetch the dataset's metadata (column names, types,
  descriptions). That metadata drives the form fields, the filters (a searchable
  multi-select of distinct values for text columns, a range for numbers) and
  the AI's understanding of the data.
- **Hint layer:** an optional notes file per dataset that fixes what the
  metadata gets wrong or leaves out. Examples from the test dataset `gmgy-gm47`:
  - `_25pctlearnings` and `_75pctlearnings` are numbers stored as text and need
    a cast.
  - `cip4_title = "All"` and the `cip_level` 2-digit/4-digit split are rollup
    rows, so summing across them counts records more than once.
  - The dataset has no enrollment numbers, so "percentage of student body"
    questions can't be answered from it.

- **Meaning layer (column roles):** metadata says a column is a number, not
  whether averaging it makes sense. Each numeric column is classified as a
  measure, an identifier/code, or an ordinal (such as a year), along with the
  aggregations that make sense for it. The form only offers sensible values
  and aggregations, and the AI's queries are held to the same rules. Name
  heuristics cover every dataset. When an API key is present, a Haiku call
  (about 2 s, once per dataset, cached on disk) refines them and picks the
  best starting measure and breakdown. Notes files can override both.

Push aggregation into SoQL (`$select`, `$group`, `$where`, `$order`) so
responses stay small and well under the default limit of 1,000 rows.

## AI agent behavior

- Its tools are kept small and focused:
  - `get_schema`
  - `get_distinct_values(column, search)`, which maps fuzzy names to exact
    values (for example "UW" to the full institution name)
  - `set_query(spec)`
- The system prompt prioritizes understanding over action: confirm ambiguous
  intent before calling `set_query`, don't waste queries, and say plainly when
  the data can't answer the question.
- Auto-run is controlled by `AI_AUTO_RUN` (off for the MVP to save API usage).

## UX patterns (taken from BI tools)

- **Column roles come from metadata.** Socrata's `/api/views/{id}.json`
  includes per-column `cachedContents` (cardinality, top values, min/max, null
  counts). Use it to classify each column as dimension, measure or date, to
  detect numbers stored as text, and to flag suspected rollup values such as
  "All", "Total" or "Statewide". The per-dataset notes file overrides any of
  these guesses.
- **Dataset and chart type are the first two fields.** Everything else in the
  form depends on them. Each chart type declares its slots (for example, a line
  chart needs one x column of type date or number and one or more measures)
  plus the minimum columns of each role a dataset must have to fill them.
- **Hard stop on an incompatible combination.** If the chosen dataset can't
  satisfy the chosen chart type's requirements, every field below them is
  disabled. A warning explains what's missing, for example "Line charts need a
  date or numeric column; this dataset has none." Changing either of the two
  fields re-runs the check. In the chart-type dropdown, types that are
  incompatible with the current dataset are labeled as such, so the user sees
  the problem before choosing.
- **Slot dropdowns only offer compatible columns**, so a slot assignment can't
  become invalid on its own. When the chart type changes, assignments that
  still fit are kept and the rest are cleared.
- **Filter widget depends on cardinality** (Metabase): checkboxes up to about 30
  values, a searchable multi-select up to about 1,000, and server-side
  type-ahead above that. Number ranges are prefilled from min/max.
- **Rollup and suppressed rows are excluded by default**, shown as visible
  filter chips the user can remove. This prevents double counting, and it
  handles WA education data's suppression markers (e.g. `N<10` or `*` inside
  numeric-looking text).
- **Top N plus "Other".** Order by the measure before applying the limit, and
  always say so when results are truncated ("Showing top 20 of 312").
- **Stale chart state.** Store a hash of the `QuerySpec` from the last
  Generate. When the form no longer matches it, show a banner and make the
  Generate button primary. While a new query runs, keep the old chart visible
  but dimmed.
- **Empty and error states differ.** When a query returns zero rows, list the
  active filters so the user can remove one. An error shows an error message.
- **AI output is shown in the form.** When Claude fills in the form, the fields
  it changed are highlighted, and Claude adds a one-sentence restatement of
  what it understood the question to be.
- **Clarifying questions are capped at about two.** Where possible, offer
  clickable options built from real values or columns.
- **The AI's `QuerySpec` is validated on the server** with the same schema
  (zod) the form uses. Validation errors go back to Claude so it can retry
  before anything reaches the form.

## UI layout

```
┌───────────────┬──────────────────────────────────────┐
│ 1. Dataset    │                                      │
│ 2. Chart type │              Chart                   │
│ Dynamic fields│                                      │
│ Filters       ├──────────────────────────────────────┤
│ [Generate]    │         Chat with Claude             │
│   (~25% vw)   │                                      │
└───────────────┴──────────────────────────────────────┘
```

The chat sits below the chart so it doesn't shrink the chart's width. This may
be revisited after use.

## Data source: SODA 2.1, optional token

SODA3 adds nothing these charts need. It runs the same SoQL engine with the
same functions: casting, `case()`, window functions, `|>` chaining and full-text
search all work on 2.1, and neither version has a row maximum. Its main
difference is that requests are sent as POST bodies. SODA3 can't be used
without a token, while 2.1 works anonymously. An app token sent to 2.1 gets the
same per-app throttling pool, so the Socrata API key is only needed to avoid
429 (rate-limit) errors.

| Need | Endpoint (all work without a token) |
| --- | --- |
| Query | `GET https://data.wa.gov/resource/{id}.json` with `$select`, `$where`, `$group`, `$order`, `$limit` |
| Schema and column profile | `GET https://data.wa.gov/api/views/{id}.json` (`columns[].cachedContents`) |
| Dataset search (dropdown) | `GET https://api.us.socrata.com/api/catalog/v1?domains=data.wa.gov&only=dataset&q=...` (about 1,076 datasets) |

Rules:
- Send the API key ID and secret as HTTP Basic auth, never in the URL.
- Always set `$limit` explicitly. Without it the response is silently capped at
  1,000 rows.
- Every value comes back as a string. Convert values to numbers based on the
  schema type.
- Numeric text columns can contain the literal `"NULL"`. Exclude it before
  casting, or the query fails with a 400 error.
- Text comparisons are case-sensitive.
- Tyler (Socrata's vendor) has SODA2 deprecation on a "future roadmap" with no
  date set. All SODA calls live in one module so switching to v3 later is a
  local change.

## Network strategy

- Browser → Node server only.
- The server proxies SODA, caches responses keyed by the normalized query, and
  caches dataset metadata and distinct values.
- The server proxies Claude and streams responses to the chat.

## Open decisions

- [x] SODA 2.1 with an optional token. See "Data source" above.
- [x] UX patterns borrowed from existing BI tools. See "UX patterns" above.
- [x] Form order: dataset, then chart type, then the generated fields, with a
      hard stop when the first two are incompatible.
- [x] Read-only SoQL panel: out of scope.

## Out of scope for this round

- Viewing (even read-only) or editing the generated SoQL
- Remembering previous queries
- Chart styling and color palettes
- Filtering through the legend (filtering stays in the form)
- Multiple datasets per question (start with `gmgy-gm47`, then generalize)
