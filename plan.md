# plan.md — Codebase Definition (living document)

This file describes how the codebase is set up and is updated as the code
changes. High-level product decisions are in `projectOutline.md`. The original
brief is `project.md`.

**Status:** Phases 1–6 done and checked in the browser (MVP complete).

---

## Running locally

```bash
cp .env.example .env    # then fill in the keys
npm install
npm run dev             # client on :5173, API server on :3001
```

## Environment (`.env`, read only by the server)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | For chat | — | Claude API. Without it the form still works and chat shows a setup message. |
| `ANTHROPIC_MODEL` | No | `claude-sonnet-5-5` | Model the chat agent uses |
| `SOCRATA_API_KEY` / `SOCRATA_API_SECRET` | No | — | Socrata API key ID and secret (from evergreen.data.socrata.com developer settings). Sent as HTTP Basic auth, only to data.wa.gov, to avoid throttling |
| `AI_AUTO_RUN` | No | `false` | `true` runs the AI's query immediately. Otherwise the AI only fills in the form. |
| `AI_CLASSIFY_COLUMNS` | No | `true` | Classify each dataset's columns with a small model (once per dataset, cached). `false` = name heuristics only. |
| `ANTHROPIC_CLASSIFY_MODEL` | No | `claude-haiku-5-5` | Model for column classification. |
| `PORT` | No | `3001` | API server port |

## Stack

- **Client:** Vite, React and TypeScript, styled with Tailwind CSS and
  shadcn/ui components, with charts drawn by Apache ECharts via
  `echarts-for-react`.
- **Server:** Express run with `tsx watch`. `.env` is loaded with Node's
  built-in `process.loadEnvFile` (no dotenv), and Socrata is called with
  Node's built-in `fetch` (no SODA SDK).
- **Shared:** zod schemas and the chart registry, imported by both the client
  and the server.
- **AI:** `@anthropic-ai/sdk` with tool use, streamed to the browser over
  Server-Sent Events.
- **Dev:** `concurrently` runs Vite and the server together. Vite forwards
  `/api` requests to the server.

## Directory layout

```
.
├── .env.example
├── components.json          # shadcn/ui config
├── index.html
├── vite.config.ts
├── datasets/                # optional notes file per dataset (hint layer)
│   └── gmgy-gm47.json
└── src/
    ├── shared/              # imported by the client and the server
    │   ├── types.ts         # DatasetProfile, ColumnProfile, column roles
    │   ├── querySpec.ts     # QuerySpec zod schema and type
    │   ├── charts.ts        # chart registry, compatibility, validateSpec, defaultSpec, reconcileSpec
    │   └── describe.ts      # plain-English labels (chart title, filter chips)
    ├── server/
    │   ├── index.ts         # Express app and routes
    │   ├── config.ts        # loads and validates .env
    │   ├── cache.ts         # in-memory TTL cache
    │   ├── soda/            # all Socrata access lives here (the place to switch to SODA3)
    │   │   ├── http.ts      # fetch wrapper (token header, errors)
    │   │   ├── catalog.ts   # dataset search (Discovery API)
    │   │   ├── profile.ts   # /api/views metadata → DatasetProfile (+ dataset notes)
    │   │   ├── columnRoles.ts # name/type heuristics: measure vs identifier vs ordinal
    │   │   └── compile.ts   # QuerySpec → SoQL params; result parsing
    │   └── ai/              # agent, tools, system prompt, shared client, column classifier (classify.ts)
    └── client/
        ├── main.tsx, App.tsx, index.css
        ├── lib/             # api client, utils (shadcn `cn`)
        ├── components/ui/   # shadcn/ui generated components
        ├── hooks/useExplorer.ts  # all app state: profile, spec, staleness, runs, AI highlights
        ├── hooks/useChat.ts      # chat state, SSE parsing, applies AI specs to the form
        ├── lib/chartOptions.ts   # QueryResult → ECharts option, per chart type
        └── components/      # QueryForm, FilterSection, ValuesPicker, DatasetPicker, TruncatedText, Reveal, ChartPanel, ChatPanel
```

Import aliases: `@/*` → `src/client/*` (the shadcn convention) and `@shared/*`
→ `src/shared/*`.

## Core types (in `src/shared`)

- **`ColumnProfile`**: `fieldName`, `label`, `description`, `socrataType`,
  `role` (`dimension` | `measure` | `temporal`), `numericText` (a number stored
  as text, which needs a cast), `cardinality`, `topValues`, `min`/`max`,
  `rollupValues` (values such as "All" that are excluded by default),
  `nullTokens` (strings such as `"NULL"` to exclude before casting).
- **`DatasetProfile`**: `id`, `name`, `description`, `rowCount`, `columns`,
  `notes` (free text passed to the AI).
- **`QuerySpec`**: `datasetId`, `chartType`, `x` (a column, plus a date grain
  if the column is temporal), `measures[]` (`{ column | '*', agg }`), `series`
  (an optional column), `filters[]` (`in` / `not_in` / `range` / `contains`),
  `sort`, `limit`.
- **Chart registry**: for each chart type, its slots, the roles each slot
  accepts, its minimum requirements, and its ECharts option builder.
  `checkCompatibility(profile, chartType)` returns
  `{ ok, reason }`, which drives the hard stop in the form.

## API (server)

| Method and path | Purpose |
| --- | --- |
| `GET /api/config` | `{ aiEnabled, aiAutoRun }` for the client |
| `GET /api/datasets?q=` | Search data.wa.gov datasets |
| `GET /api/datasets/:id/profile` | `DatasetProfile` (cached) |
| `GET /api/datasets/:id/values?column=&q=` | Distinct values with counts (filter type-ahead, AI value lookup) |
| `POST /api/query` | Body `QuerySpec` → `{ rows, truncated, totalGroups }` |
| `POST /api/chat` | SSE stream (Phase 6) |

---

## Build phases

- [x] **1. Setup:** Vite + React + TS, Tailwind and shadcn/ui init, Express
  server, `concurrently` dev script, `.env.example` and `.env`, `.gitignore`,
  config loader.
- [x] **2. Shared types:** `QuerySpec` schema, chart registry (bar, line,
  scatter, pie), compatibility check.
- [x] **3. SODA module:** catalog search, building the profile from metadata
  (roles, numeric-text detection, rollup guesses, merging in the dataset
  notes), compiling a `QuerySpec` to SoQL (casting, null-token exclusion,
  aggregation, sort by measure, top N), the values endpoint, caching.
- [x] **4. Form:**
  - Dataset combobox, then chart type. If the pair is incompatible, everything
    below is disabled and a warning is shown.
  - Slot selects that offer only compatible columns.
  - Filters whose widget depends on the column's cardinality, and rollup
    exclusions shown as chips.
  - The Generate button and stale-state tracking (a hash of the last
    `QuerySpec` that was run).
- [x] **5. Chart:** an ECharts option for each type, tooltips, a truncation
  notice, and empty, loading (dimmed) and error states.
  **Checkpoint: the full flow works with no API key.**
- [x] **6. Chat:**
  - SSE streaming.
  - Tools: `get_schema`, `search_values`, `set_query`.
  - Server-side validation that sends errors back to Claude.
  - A system prompt that asks clarifying questions first.
  - Highlighting of the fields the AI changed, plus a restatement.
  - The `AI_AUTO_RUN` switch.

## How things work (implementation notes)

- **Building the profile** (`soda/profile.ts`, cached for 1 hour):
  - Start from `/api/views/{id}.json` metadata and run one `count(*)` query.
  - `cachedContents.cardinality` is unreliable (it repeats the row count), and
    `top` is capped at 20 values. So a column's number of distinct values is
    the length of its `top` list when that's under 20. Otherwise it comes from
    a best-effort `count(distinct)` query for text columns, with an 8-second
    timeout. That query is slow on datasets with millions of rows, so it's
    skipped if it times out.
  - **Numbers stored as text:** a text column counts as numeric when all its
    top values are numbers, ignoring null placeholders such as `NULL`. Its real
    min/max comes from a `min(col::number)` query.
  - **Column kinds:** `number`, `time` and `category`. Numeric columns with 50
    or fewer distinct values also count as `category`, so "years after
    graduation" can be an axis. Columns with a single value are hidden.
  - **Column roles:** each column also gets a `role` (`measure`, `identifier`,
    `ordinal` such as a year, or `other`) plus the aggregations that make
    sense (`aggs`, `defaultAgg`). Only measures can be values, and only with
    their own aggregations. So "average of Stock Number" or "sum of median
    earnings" can't be built in the form, and `validateSpec` rejects them from
    the AI. There are three layers, each overriding the one before:
    1. `columnRoles.ts` heuristics: words such as id, code, version, zip, a
       trailing "Number", year, and values that look like years. Rate words
       (percent, rate, median, average) rule out `sum`.
    2. `ai/classify.ts`: one structured-output call to Haiku per dataset
       (about 2 s and 4k tokens). It runs in parallel with the min/max
       queries and also picks `suggested.measure` and `suggested.dimension`,
       which `defaultSpec` prefers. The result is saved to
       `.cache/columns/<id>.json`, keyed by a hash of the columns and the
       model, so each dataset is classified only once. On failure the
       heuristics stay in place.
    3. The notes file (`role`, `aggs`, `defaultAgg`, `suggested`).
- **Rollups and default filters:** detected rollup values become removable
  `not_in` chips. A dataset notes file can set `defaultFilters` to replace
  them. This matters because nested rollups can't all be excluded at once: in
  `gmgy-gm47`, 4-digit program rows exist only for `Statewide`, so excluding
  every rollup returns no rows. Its notes default to excluding `Statewide` and
  keeping `cip_level = 'All CIPs'`.
- **Running a query** (`soda/compile.ts`):
  - One SoQL request groups by dimension (and series) with `$limit=50000`.
  - Top N happens on the server: groups are ranked by measure, and series are
    ranked by total and capped at 10.
  - `totalGroups` and `totalSeries` drive the "Showing top N of M" badge.
  - Results are cached for 10 minutes, keyed by the compiled query.
- **Form rules:**
  - Changing the chart type calls `reconcileSpec`, which keeps whatever still
    fits.
  - An incompatible dataset and chart type sets the spec to `null`, which
    disables the fields below and shows the warning. The last valid spec is
    restored when the user switches back.
  - `validateSpec` errors are listed above the Generate button and disable it.
  - A field that can't be used is not rendered (never shown disabled): Sort
    when the chart allows only one order, "Split by" when there are several
    values (a hint explains why), the aggregation picker for "Number of rows",
    and "Add value" when a split is set. The incompatibility hard stop is the
    one exception: there the fields stay visible but disabled.
  - While a dataset is loading (picked by hand or by the AI), the fields below
    the chart type collapse into a skeleton, the chart type is disabled, the
    info line reads "Loading columns…", and Generate is off. The old form
    describes the old dataset, so it must not be editable.
  - Fields that appear or disappear animate with `Reveal` (grid-template-rows
    0fr ↔ 1fr, 300 ms). `RevealList` does the same for filter cards and value
    rows, keeping a removed item until its collapse finishes. Spacing lives on
    each field (`pt-5`), not on the parent, so gaps collapse too.
  - shadcn `SelectContent` defaults to `position="popper"`. The stock
    "item-aligned" mode lines the list up with the selected item, and with no
    selection (as in "Add filter") it rendered off-screen.
  - The chart is stale when `specKey(spec)` differs from the spec of the last
    attempted run.
- **Filter widgets:** columns of kind `category` get a searchable multi-select.
  Values come from the profile when it holds every distinct value; otherwise
  they come from a server search as you type. Numeric columns get a min/max
  range, and other text columns get "contains".
- **Dataset search** (`soda/catalog.ts`):
  - The catalog API is slow (1–5 s per search) and heavy (about 11 KB per
    result, since it includes column metadata).
  - So on startup the server downloads the whole data.wa.gov catalog (about
    1,100 datasets, roughly 45 s, in parallel pages of 200) in the background.
  - It keeps a slim in-memory index, saved to `.cache/catalog-data.wa.gov.json`
    (gitignored) so restarts load instantly, and refreshes it every 12 hours.
  - Searches run locally in under 5 ms. Every word must match. Name matches
    rank above tag/category matches, which rank above description matches;
    page views break ties.
  - Until the index exists, searches fall back to the live catalog API.
  - The client loads the default list on page load, so the dropdown opens
    instantly.
  - (data.wa.gov's own search box uses Socrata's `/autocomplete` endpoint. It's
    fast, but returns titles only, with no dataset ids.)
  - The local index skips column names, which is fine for the picker. The AI's
    `search_datasets` tool uses `searchDatasetsWithColumns` instead: the live
    catalog full-text search (which also matches column names, about 0.6 s),
    returning each dataset's column names, cached for 10 minutes, and falling
    back to the local index if the API fails.
- **Long text:** `TruncatedText` truncates with an ellipsis and shows the full
  text in a tooltip on hover, only when it's actually cut off (measured
  against the text's natural width, since `scrollWidth` misses sub-pixel
  overflow).
- **Bar orientation:** bar charts turn horizontal automatically when labels
  are long or there are many of them, and the chart height grows with the
  number of bars.
- **Chat agent** (`src/server/ai`):
  - The server keeps no state. The client stores the API conversation history
    returned by the `done` event and sends it back with each message. History
    is only ever appended to; thinking blocks are passed back unchanged.
  - Every user turn begins with a `<form_state>` block (the current dataset,
    chart type and spec), so Claude sees what the user has done by hand.
  - The loop runs up to 10 model calls per user message. Tool inputs are
    streamed (`eager_input_streaming`) and validated with zod before use.
  - `ask_user` ends the turn and returns `pending`. The user's next message
    becomes that tool's result, along with the results of any other tools
    called in the same turn.
  - `set_query` validates the spec with zod and `validateSpec`, and checks
    that every `in` / `not_in` filter value exists (`findMissingValues`), which
    catches invented values. Errors go back to Claude to fix. On success the
    client fills in the form and highlights the fields that changed; the
    highlights clear on Generate.
  - `AI_AUTO_RUN=true`: the server also runs the query and returns the first
    15 rows to Claude, and the client generates the chart immediately. When
    false, Claude only fills in the form.
  - Model settings: `ANTHROPIC_MODEL`, effort `medium`, automatic prompt
    caching (top-level `cache_control`), and server-side refusal fallback
    (`fallbacks: "default"`) on models that support it.
  - The server logs `[chat]` lines with per-step token usage and cache hits.
- **No API key:** `App` swaps the chat for `AiSetup`, a setup guide. It
  covers getting API access (Max, Ultra and Team plans include monthly API
  credits, claimed by linking a Console organization from claude.ai Settings
  → Billing; Free, Pro and Enterprise users buy credits in the Console), then
  creating a key at platform.claude.com/settings/keys in that same
  organization, adding it to `.env` and restarting. It
  also describes what chat adds. "Hide" collapses it to a slim bar
  (`AiSetupBar`) so the chart gets the space; the choice is remembered in
  `localStorage` (`golden:ai-setup-hidden`).
- **Dataset notes files** (`datasets/<id>.json`): `notes` (plain text for the
  AI), `defaultFilters`, and per-column overrides for `label`, `description`,
  `rollupValues`, `nullTokens`, `numericText`, `hidden`, `kinds`, `role`,
  `aggs` and `defaultAgg`, plus a dataset-level `suggested` ({dimension,
  measure}). The server
  doesn't reload notes files automatically, so restart it after editing one.

## Conventions

- No tests in the MVP. Verify by running the app.
- Socrata JSON values are always strings. Convert them in the server according
  to the column profile.
- Never put tokens or keys in URLs or send them to the client. Socrata credentials go only to the data domain.
