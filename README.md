# Tresse

Tresse merges the logs of several services onto a single timeline, right in the browser.

During an incident, you often end up with five terminals open (nginx, the API, a worker, the database…) trying to
stitch the pieces together by hand, with different time formats, different time zones and drifting clocks.
Observability platforms solve this problem, provided everything is already shipped to them. Tresse solves it with
what you have at hand: files, or text copied from a terminal.

## What it does

- **Automatic format detection** for each source: ISO 8601, Apache/Nginx, JSON lines
  (pino, bunyan, logrus, zap…), BSD syslog, klog/glog (Kubernetes), Redis (including < 5, without a year), DD/MM/YYYY, Unix timestamps, time only
  (with midnight rollover handling). A mixed-format file is read according to its majority format; a line
  that does not match it is tried against the other formats if its timestamp is at the start of the line.
- **Time zones**: read from the lines when present, otherwise configurable per source.
- **Clock offset** per source, to the millisecond, or by alignment: pick a line as T0, then the line
  from another source that corresponds to the same moment, and Tresse computes the offset.
- **Shared threads**: identifiers present in at least two sources (UUID, request id, `ord_…`, `trace_id=…`,
  IP) are detected automatically. Clicking a thread shows its journey from one service to the next and can
  filter the log down to that thread alone.
- **The braid**: a density strip per source, with errors marked in red. Drag across it to isolate a
  range, click it to jump there.
- **Queries**: free text, `"phrases"`, `/regex/`, fields (`status:>=500`, `source:api,worker`, `level:>=warn`),
  ranges, wildcards, time windows and `AND` / `OR` / `NOT`, with syntax highlighting and autocomplete (see below).
- Multi-line entries (stack traces) attached to their entry, activity gaps flagged, level filters,
  time relative to T0, copy or download of the merged view.
- Virtualized list: several hundred thousand lines stay smooth.

Nothing leaves the browser: no server, no dependencies, no network requests (apart from the optional Google Fonts).

## Running

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
# then http://localhost:8000
```

A sample incident (payments stuck behind a PostgreSQL lock, worker clock 1.8 s behind) is loaded
on startup. It is removed as soon as you add your own logs.

## Adding logs

- Drag and drop one or more files (one source per file).
- Paste text anywhere on the page (`Ctrl+V`).
- The "Add logs" button lets you name the source and choose its time zone.

## Queries

Type in the search box. Plain words search the whole entry (stack traces included, case-insensitive); everything
else is optional. Press `Tab` or `↓` for suggestions, `Enter` to apply, and `?` for the syntax reference.

| Query | Matches |
| --- | --- |
| `lock timeout` | entries containing both words |
| `"lock timeout"` | the exact phrase |
| `/timeout\|refused/i` | a regular expression (`i`: ignore case) |
| `a OR b`, `-a`, `NOT (a b)` | either, exclude, group |
| `source:api,worker` | these sources (`,` means “or”) |
| `level:error`, `level:>=warn` | a level, or that level and above |
| `status:>=500`, `amount:2000..5000` | any field found in the logs, compared or within a range |
| `order:ord_482*` | wildcard |
| `msg:charge`, `id:ord_48210` | text only, a detected identifier |
| `has:stack`, `has:thread`, `has:charge_id` | a stack trace, an identifier shared with another source, a field |
| `time:12:02..12:03`, `after:12:02:04`, `before:2026-09-28T12:03` | time of day or date, in the displayed time zone |
| `t0:-1s..2s`, `t0:5s` | relative to T0 (`t0:5s`: within 5 s of it) |

Terms are combined with AND. `OR` binds tighter, so `level:error source:api OR source:worker` means errors from
either source. Fields come from `key=value` pairs, JSON keys (nested ones as `a.b`), and the parts of access log
lines (`ip`, `method`, `path`, `status`, `bytes`, `ua`). A field that does not appear in any source is searched as
plain text, so `LOG:` or `https://…` still work. In a line's details, `+` and `−` next to each field add it to the
query. Recent queries are offered when the box is empty.

## Shortcuts

| Key | Action |
| --- | --- |
| `/` | Search |
| `?` | Query syntax |
| `↑` `↓` or `j` `k` | Previous / next line |
| `n` / `Shift+n` | Next / previous error |
| `t` or double-click | Set the line as T0 |
| `Esc` | Close the thread, then the range, then the selection |
| `Alt+click` on a level | Show only that level |

## Files

- `parser.js`: format, level and identifier detection (also runs under Node/Bun)
- `query.js`: query language, field extraction (also runs under Node/Bun)
- `app.js`: UI, merging, virtualized list, braid
- `demo.js`: sample data generation
- `style.css`, `index.html`
- `build.py`: generates `index-full.html`, a self-contained single-file version (`python3 build.py`)
