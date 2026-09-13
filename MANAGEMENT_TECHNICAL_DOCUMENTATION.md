# CPP Operations Dashboard

## Management and Technical Documentation

**Purpose:** Explain how the dashboard turns an uploaded Excel workbook into management KPIs, what the workbook must contain, and which workbook changes are safe or risky.

**Important scope note:** The current frontend runs the **single-workbook Waste dashboard**. The repository also contains a separate CPP-1/CPP-2 daily dashboard prototype, but it is not connected to the page that managers currently open. This document therefore describes the active dashboard first and identifies the prototype separately.

---

## 1. End-to-end data flow

### 1.1 What the user does

1. The user opens the web page.
2. The frontend checks the backend health endpoint:
   - `GET /api/health`
3. If no workbook is loaded, the upload screen is shown.
4. The user:
   - selects one Excel workbook;
   - enters their name;
   - uploads the file.
5. The supported extensions shown by the application are `.xls`, `.xlsx`, and `.xlsb`.
6. The browser sends the workbook, uploader name, and (when needed) a reporting date to:
   - `POST /api/upload`

### 1.2 Reporting-date detection

The application first looks for a date in the filename in this form:

```text
DD.MM.YYYY
DD-MM-YYYY
DD_MM_YYYY
```

The backend treats the first matching date as **day-month-year** and stores it internally as `YYYY-MM`.

Example:

```text
Copy of 17.08.2026.xlsb -> reporting date 2026-08-17 -> reporting period 2026-08
```

If no date-like value is found, the upload screen asks the user to enter a date as `YYYY-MM-DD`.

The filename date is used for:

- the displayed upload date;
- the reporting month shown in the dashboard;
- selecting the reporting month for rejection analysis.

The date in the filename is **not compared with every date in every workbook sheet**. A filename can therefore be syntactically valid but still describe the wrong reporting period.

### 1.3 Workbook is saved and parsed

The backend:

1. creates a UUID-based filename under `backend/data/uploads`;
2. saves the uploaded workbook without changing the original;
3. reads the workbook with pandas;
4. uses `pyxlsb` for `.xlsb` files and pandas' default Excel engine for other extensions;
5. extracts the main Waste table;
6. attempts to extract line-waste, stock, and rejection detail;
7. stores the parsed result in the active in-memory cache;
8. writes a JSON snapshot to `backend/data/cache.json`;
9. returns upload metadata to the browser.

The main Waste table is required. Line-waste, stock, and rejection parsing errors are intentionally allowed to produce an incomplete dashboard rather than reject the entire upload.

### 1.4 Which sheets are read

The active dashboard reads these sheets:

| Sheet | Purpose | Required for upload? |
|---|---|---|
| `Waste` | Main film-wise table and primary KPI totals | Yes |
| `Line waste` | Waste, downtime, reason, category, and film breakdowns | No; failures become an empty detail report |
| `Opening Stock Summary` | Metallized opening-stock total | No; failure returns no stock detail |
| `Closing Stock Summary` | Metallized closing-stock total | No; failure returns no stock detail |
| `Rejection (Software)` | Rejection-by-reason and responsible-department analysis | No; failure produces no rejection detail |

### 1.5 Main Waste table extraction

The parser reads the `Waste` sheet without assuming that the table starts at Excel row 1.

It searches the **first column** for the title:

```text
FILM WISE WASTE
```

Matching is case-insensitive and surrounding whitespace is ignored. The next row is treated as the table header. The parser then searches the first column below the header for the first row whose value is:

```text
Total
```

Rows between the header and that Total row become the film-wise data rows. Values on the Total row become the overall totals returned to the dashboard. The totals are read from Excel; they are not recalculated from the detail rows.

Duplicate column names receive suffixes such as `(2)`. Blank headers receive names such as `Column 4`.

### 1.6 KPI calculation

The main Waste table contains the values used for the headline KPIs. The backend recognizes these exact field names:

- `RM Input`
- `Line Production`
- `Line Waste`
- `Overall CPP waste`
- `Overall CPP waste %`
- `Transparent/ Metallizable Stock Opening`
- `Transparent/ Metallizable Stock Closing`
- `Metallizer Input`
- `Metallized Stock Opening`
- `Metallized Stock Closing`
- `PS Input`
- `PS Production`
- `Rejection`
- `Conversion Waste`

The headline calculations are:

| Dashboard KPI | Calculation |
|---|---|
| RM Input | Value from the `RM Input` field on the Waste Total row |
| Line Production | Value from the `Line Production` field on the Waste Total row |
| Line Waste | Value from the `Line Waste` field on the Waste Total row |
| Overall CPP Waste | Value from the `Overall CPP waste` field on the Waste Total row |
| Overall CPP Waste % | `Overall CPP waste / RM Input`; zero when RM Input is zero |
| Rejection | Sum of the `Rejection` field across the currently displayed Waste rows when a filtered summary is requested |
| Rejection Rate | `Rejection / Line Production`; calculated in the browser for filtered row summaries |

The dashboard also exposes additional KPI fields in row-level summaries and KPI detail dialogs, including stock, metallizer, PS, and conversion-waste fields. These are summed across numeric rows when a search or filter is active.

The browser can display weight as either:

- kilograms; or
- tons, by dividing the raw kilogram value by 1,000.

Percentage fields are displayed as percentages. The stored `Overall CPP waste %` value is a ratio, so the browser multiplies it by 100 for display.

### 1.7 Line Waste analysis

The `Line waste` sheet is read with row 2 as the header. The detail endpoint:

1. identifies the latest valid `Month` value in `MM-YY` form;
2. keeps rows for that month;
3. groups rows by:
   - `Nature of DT`;
   - category;
   - `Film`;
4. sums:
   - `Waste (Kg)`;
   - `Downtime (Hours)`;
   - `Instances`;
5. calculates each reason's share as:

```text
reason waste / total line waste × 100
```

It also creates a film-to-category breakdown and a downtime-by-category view.

The expected category column may be `Category` or the workbook's known misspelling `Cattegory`. The code finds a column whose name starts with `categ` or `catteg`.

### 1.8 Rejection by Reason analysis

The `Rejection (Software)` sheet is scanned for a header row containing at least two of:

- `Reason`
- `Net Wt`
- `Gross Wt`

The parser then expects:

- a `Month` column;
- a reason column containing `Reason`;
- preferably `Net Wt` or `Net Weight`;
- otherwise `Gross Wt` or `Gross Weight`.

Numeric rejection rows are retained. Rows labelled `Total`, `Subtotal`, or `Grand Total` are excluded.

The rejection endpoint selects the reporting month from the filename date. It then:

1. converts month values such as `08-26` to `2026-08`;
2. keeps only rows for that month;
3. normalizes known reason aliases;
4. sums `Net Wt` (or the selected gross-weight fallback);
5. counts records;
6. groups by responsible department;
7. provides a combined reason-and-department breakdown.

Unknown reasons are assigned to `Other`. This is a valid response, not an error, so an unrecognized spelling can reduce the apparent size of a named reason without warning.

Known reason aliases include examples such as:

- `Pin Hole`, `PIN HOLES`, `PINHOLE` -> `PIN HOLES`;
- `Scratch` -> `SCRATCHES`;
- `Dematt`, `Demetalize` -> `DEMATALIZE`;
- `Slack` -> `SLACKNESS`;
- `Tram Line` -> `TRAM LINES`;
- `Bottom Wrinkles` -> `WRINKLES`.

### 1.9 Metallized stock analysis

For each of these sheets:

- `Opening Stock Summary`
- `Closing Stock Summary`

the parser searches for a row containing both the relevant word (`OPENING` or `CLOSING`) and `SUMMARY CPP METALLIZED`.

The next row is treated as the header. The first `Total` row after it is used. The stock detail endpoint returns that Total row to the dashboard; it does not recompute stock from all individual stock records.

### 1.10 How data reaches the frontend

After upload, the frontend reloads the overview:

```text
GET /api/overview
```

It then requests:

```text
GET /api/sections/waste
GET /api/sections/waste/filters
GET /api/kpis/line-waste
GET /api/kpis/rejection-reasons
GET /api/kpis/metallized-stock/opening
GET /api/kpis/metallized-stock/closing
```

The React dashboard:

- renders KPI cards;
- provides kg/tons display selection;
- supports search and Film/Group filters;
- renders line-waste and rejection breakdowns;
- shows stock detail in KPI dialogs;
- displays warnings/errors when a detail section is unavailable.

### 1.11 Separate CPP-1/CPP-2 prototype

The repository also contains `backend/app/main.py`, `backend/app/services/cpp_extractor.py`, `frontend/lib/api.ts`, and `frontend/components/DailyDashboard.tsx`.

That path is separate from the active page. It expects **two files** and these sheets:

- `Waste`
- `Monthly Summary`
- `OEE`
- `Downtime`

It calculates daily and month-to-date production, waste, OEE, and downtime. It is not the API used by `frontend/app/page.tsx` when the application is started through `backend/main.py`.

---

## 2. What the app depends on in the Excel file

### 2.1 Sheet names

The active parser expects the following names:

- `Waste`
- `Line waste`
- `Opening Stock Summary`
- `Closing Stock Summary`
- `Rejection (Software)`

Sheet matching is case-insensitive and ignores surrounding spaces, but the meaningful words and punctuation must still be present. For example, `Rejection Software` is not the same as `Rejection (Software)`.

### 2.2 Waste sheet structure

The `Waste` sheet must have:

- `FILM WISE WASTE` in the first column;
- the header row immediately below that title;
- a `Total` row in the first column below the header;
- detail rows between the header and Total row;
- the KPI columns named as expected.

The first matching Total row ends the table. Any table or subtotal before the intended table can therefore change what is read.

### 2.3 Main KPI headers

The following headers are treated as fixed names:

- `RM Input`
- `Line Production`
- `Line Waste`
- `Overall CPP waste`
- `Overall CPP waste %`
- `Transparent/ Metallizable Stock Opening`
- `Transparent/ Metallizable Stock Closing`
- `Metallizer Input`
- `Metallized Stock Opening`
- `Metallized Stock Closing`
- `PS Input`
- `PS Production`
- `Rejection`
- `Conversion Waste`

Capitalization is not normalized for these KPI names. A spelling or punctuation change can make a value become zero or disappear from a KPI calculation.

### 2.4 Line waste headers and layout

The `Line waste` parser expects the header on row 2 and uses:

- `Month`
- `Film`
- `Nature of DT`
- `Waste (Kg)`
- `Downtime (Hours)`
- `Instances`
- `Category` or `Cattegory`

The sheet may contain other columns, but these fields drive the report.

### 2.5 Rejection headers and layout

The rejection sheet must contain a detectable header row and:

- `Month`;
- `Reason` or `Reason:`;
- `Net Wt` or `Net Weight`, preferably;
- `Gross Wt` or `Gross Weight` as fallback;
- `Responsible Dept` or `Responsible Department` for department analysis.

The parser reads through the end of the sheet because the workbook can contain stacked monthly blocks. Subtotal rows are excluded only when their reason is exactly `Total`, `Subtotal`, or `Grand Total`.

### 2.6 Stock table structure

Each stock summary sheet must contain:

- a title row containing the relevant opening/closing word and `SUMMARY CPP METALLIZED`;
- headers on the next row;
- a first-column `Total` row;
- values positioned under the corresponding headers.

### 2.7 Filename requirement

The preferred filename includes a date in `DD.MM.YYYY` form, for example:

```text
Copy of 17.08.2026.xlsb
```

The application also recognizes `DD-MM-YYYY` and `DD_MM_YYYY`. If absent, the user must enter `YYYY-MM-DD`.

---

## 3. Excel changes that can break the app or produce wrong data

### 3.1 Changes likely to stop or partially stop processing

- Renaming the `Waste` sheet.
- Removing the `FILM WISE WASTE` title.
- Moving the Waste title out of the first column.
- Removing the Waste `Total` row.
- Renaming a required KPI header.
- Renaming `Month` on the rejection sheet.
- Removing both `Net Wt` and `Gross Wt` from the rejection sheet.
- Moving the line-waste header away from row 2.
- Changing the workbook file type to an unsupported format.

### 3.2 Changes that can silently produce incomplete or wrong data

- Renaming `Line waste`, `Opening Stock Summary`, `Closing Stock Summary`, or `Rejection (Software)`.
  - The upload may still succeed because failures in these optional sections are swallowed.
  - The affected cards or breakdowns may show zero, blank, or unavailable data.
- Renaming `Waste (Kg)`, `Downtime (Hours)`, `Nature of DT`, `Instances`, or `Film`.
  - Line-waste totals can become zero or be grouped under `Unspecified`.
- Renaming `Category` and not using the recognized `Cattegory` spelling.
  - Category analysis can fall back to `Unspecified` or become unusable.
- Renaming `Overall CPP waste` to `Overall CPP Waste`.
  - The field lookup is case-sensitive in the KPI summary and may return zero.
- Changing `/` spacing in `Transparent/ Metallizable ...`.
  - The corresponding stock KPI may no longer be found.
- Removing `Total` from a stock summary.
  - Stock detail becomes unavailable.
- Adding a second similar-looking `FILM WISE WASTE` table.
  - The first matching title and first following Total row win; the wrong table can be loaded without an obvious error.
- Adding a second `Total` row before the real table total.
  - The table is truncated at the first Total row.
- Adding a numeric value near a rejection label.
  - The rejection parser can treat a nearby numeric value as the intended weight if the layout is changed.
- Adding subtotal-like rows with labels other than `Total`, `Subtotal`, or `Grand Total`.
  - They may be counted as real rejection records.
- Changing month values away from `MM-YY` or Excel-date-compatible values.
  - The line-waste or rejection month filter may select no rows or the wrong month.
- Using a filename date in `MM.DD.YYYY` order.
  - The backend assumes DD.MM.YYYY and can silently reverse the month and day.
- Including multiple date-like values in the filename.
  - The first matching value is used.
- Using a syntactically date-like but invalid filename date.
  - The upload is rejected instead of falling back to a manually entered date.
- Entering a valid filename date that does not match the workbook's actual reporting month.
  - The dashboard can show a valid-looking but mismatched period.
- Using an unfamiliar reason or category spelling.
  - Rejection reasons silently fall into `Other`; categories can be grouped as `Unspecified`.

---

## 4. Excel changes that are safe

The following changes are normally safe as long as the required structure and existing header names remain intact:

- Adding new film rows beneath the Waste header and above the Total row.
- Adding new line-waste rows with the existing columns.
- Uploading a different month or year when the filename contains a valid date.
- Adding unrelated columns to the Waste or detail sheets.
  - They are retained in the parsed table but are not used in KPI formulas.
- Changing capitalization or adding surrounding spaces to sheet names.
  - Sheet lookup is case-insensitive and trims surrounding spaces.
- Changing capitalization or extra whitespace in the `FILM WISE WASTE` title.
- Keeping duplicate headers.
  - The parser makes them unique with `(2)`, `(3)`, and so on.
- Keeping blank headers.
  - They receive generated names such as `Column 4`, though they are not useful KPI fields.
- Using common known reason aliases such as `Pin Hole` versus `PIN HOLES`.
- Using `Category` or the known workbook spelling `Cattegory`.
- Keeping empty or nonnumeric values in optional detail fields.
  - Such values are treated as zero or unavailable in the affected breakdown.
- Searching and filtering by Film or Group in the dashboard.
  - These operations recalculate row-level summaries without changing the uploaded source.

“Safe” means the application can process the workbook without breaking the expected report. It does not mean that a value is automatically validated against the business meaning of the workbook.

---

## 5. Current known limitations

### 5.1 Storage and restart behavior

The dashboard keeps its active state in process memory, but the current repository also includes a JSON-cache-to-disk mechanism:

- parsed state is written to `backend/data/cache.json`;
- uploaded workbooks are retained in `backend/data/uploads`;
- on restart, the cache is restored only if the referenced uploaded workbook still exists.

Therefore, the statement “a server restart always clears uploaded data” is no longer accurate for the current code when the JSON cache and upload files are preserved. However:

- deleting `backend/data` clears the persisted dashboard;
- deploying to a fresh or ephemeral server clears it;
- if the referenced uploaded workbook is missing, the JSON snapshot is not activated;
- the active state is still held in process memory after restore;
- multiple backend workers do not share the in-memory state reliably;
- uploaded files accumulate because there is no retention or cleanup policy.

### 5.2 Workbook and data limitations

- The main Waste Total values are trusted from Excel rather than independently recalculated from detail rows.
- Optional-sheet parsing failures can leave an apparently successful upload with missing detail.
- There is no systematic validation that the filename date agrees with workbook dates.
- Unknown rejection reasons become `Other` silently.
- Column names for the main KPI fields are not alias-mapped.
- The advertised `.xls` support may fail when the environment lacks a compatible pandas Excel engine.
- Large workbooks are loaded into memory and also copied into the disk cache.
- Formula cells must contain cached values that the Excel reader can see; the application does not recalculate Excel formulas.
- There is no upload size limit, file retention policy, or automatic deletion of old uploads.
- The application is designed around one active workbook at a time.

### 5.3 Operational recommendation

Before each management meeting:

1. confirm the workbook filename uses `DD.MM.YYYY`;
2. confirm the five expected sheet names;
3. confirm the Waste table has one intended `FILM WISE WASTE` title and one intended Total row;
4. confirm the KPI headers have not changed;
5. review the dashboard warning/error state and inspect `Other` in rejection analysis;
6. keep the uploaded workbook and `backend/data/cache.json` on persistent storage.

