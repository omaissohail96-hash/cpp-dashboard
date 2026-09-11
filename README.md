# CPP Operations Dashboard

Read-only local dashboard for `Copy of 17.08.2026.xlsb`. The original workbook is not copied, changed, or overwritten.

## Workbook mapping found

| Dashboard area | Workbook source | Real fields used |
|---|---|---|
| Production | `Production (Software)` | `Start Date Time`, `Machine`, `Film`, `Net Weight`, `job Status` |
| Rejection | `Rejection (Software)` | `Date`, `Machine`, `Net Wt`, `Reason:`, `Shift`, `Status` |
| Waste | `Line waste` | `Date`, `SHIFT`, `Film`, `Cattegory`, `Nature of DT`, `Waste (Kg)` |
| Stock | `Closing Stock Summary` | `Material Type`, `Good stock (Kg)`, `Hold/ Reworkable stock (kg)`, `Total` |
| Hold Stock | `Metallizable Rolls Detail` + `Metallized Rolls Detail` | `Film`, `Weight as per sticker (kg)`, `Quality status`, `Reason`, `Processing status` |

The API detects header rows and resolves sheet names by name, so minor non-structural workbook layout changes are handled safely. Missing values are served as `null` and rendered as an em dash; invalid Excel values do not break a dashboard load.

## Run locally

1. Backend (from `backend`):

   `C:\Users\omais.sohail\AppData\Local\Programs\Python\Python312\python.exe -m pip install -r requirements.txt`

   `C:\Users\omais.sohail\AppData\Local\Programs\Python\Python312\python.exe -m uvicorn main:app --reload --port 8000`

2. Frontend (from `frontend`, after installing Node.js):

   `npm install`

   `npm run dev`
   
Using white potton soak in hell maybe PN Shadha, Shadi attending stuff, like chizen basic value, bar charge draw, a plane memory, memory might play krusi, lawns to it to pluga physician grinning, or broke note, charge, droughts, down, to keep bar there, day, wow, day, driver type physician richer mafial shows the day, day sir, small new share lecker, you know, math market, campaign down section, basically monote trials, based hoga, total overall space thirty four h three farm to witch physical, tricks two point zero, my percentage, percentage, or she trial security, or net value drop down description, or shit, down, baking air platform, data to shame such a bitful manually shall fold share, doing sharedplace different shifts,my job cap lugged, car led to shild operator operate Umr Philip, no so phy, or do you start light, is gonpm.cmd run dev -- -p 3000

Open `http://localhost:3000`. The Refresh data button rereads the workbook from disk.

## Z Drive readiness

Set `EXCEL_FILE` before starting the API, for example:

`$env:EXCEL_FILE = 'Z:\Operations\Copy of 17.08.2026.xlsb'`

No database is used. The backend is deliberately stateless. It loads the full configured workbook at startup and on a user-initiated Refresh. The dedicated Waste workbook is checked every 60 seconds, and an open browser dashboard refreshes its displayed snapshot every 60 seconds.

To change the polling cadence, set `REFRESH_INTERVAL_SECONDS` before starting the API (the default is `60`; values below 10 seconds are prevented). If the source file is temporarily unavailable or invalid during a refresh, the API keeps serving the last valid snapshot and exposes the read error through `/api/health`.

## Dedicated Waste workbook watcher

Set `WASTE_EXCEL_FILE` to the `.xlsx` workbook containing a `Waste` sheet. It defaults to the current user's Desktop, so no username is embedded in code. Every 60 seconds the backend reads that sheet, compares a SHA-256 fingerprint of its normalized rows, and only replaces the Waste dashboard snapshot when content has changed. This replacement model never appends rows, preventing duplicates. If Excel temporarily locks the workbook or it is mid-save, the error is logged and the previous valid Waste report remains available. Watcher state and errors are included in `/api/health`.
