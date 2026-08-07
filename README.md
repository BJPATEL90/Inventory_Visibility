# Inventory Health Dashboard

A small inventory reporting application built with:

- Google Sheets as the database
- Google Apps Script as the cloud backend
- React, TypeScript, Vite, Tailwind CSS, React Query, and Lucide icons
- GitHub Pages for frontend hosting

Published dashboard: [Inventory Health Dashboard](https://bjpatel90.github.io/Inventory_Visibility/)

Repository: [BJPATEL90/Inventory_Visibility](https://github.com/BJPATEL90/Inventory_Visibility)

One-page operating guide:
[PROJECT_PROCESS_NOTE.md](PROJECT_PROCESS_NOTE.md)

The Apps Script refresh and email triggers run in Google's cloud. After they are
installed, the dashboard can refresh its cached summary and send scheduled
emails even when the user's laptop is switched off.

For faster startup, the frontend saves the last successful Dashboard and Config
responses in the user's browser. Returning users see the saved KPI banners
immediately while the latest Apps Script response loads in the background. If
Google temporarily returns a Web App error, the saved dashboard remains visible
with a warning and Retry button. A new browser or cleared browser storage needs
one successful load before this fallback is available.

## Current production release and V1 rollback

The approved **V2 production release** adds quantity cycle-coverage to the
existing accuracy dashboard. The previous V1 production code is preserved at
commit `abbcbc5`, tag `v1-production-backup-2026-08-06`, and branch
`codex/backup-v1-production-2026-08-06`. These references must not be deleted;
they provide the rollback source if a production issue is found.

V2 adds four separate frontend pages using a left navigation panel:

1. **Executive KPI** - the landing page contains KPI cards only. Clicking a
   four-period accuracy card can still open its ABC detail.
2. **Inventory Transactions** - date/facility filters, detailed KPIs, search,
   sorting, pagination, and CSV download.
3. **Facility MTD Progress** - facility cards, a 0%-100% progress bar, opening
   GOOD quantity, cumulative counted quantity, and a day-wise MTD table.
4. **Calculation Logic** - read-only documentation of data sources, reporting
   periods, KPI formulas, special NTF/COGS rules, coverage calculations,
   colour thresholds, skipped rows, refreshes, emails, and CSV publication.

The Inventory Transactions request is not started on the landing page. This
allows the saved KPI snapshot to appear first and reduces initial page work.

### V2 inventory email rules

Apps Script searches Gmail for:

- Sender: `noreply@e.unicommerce.com`
- Subject: `Export Job Complete - All facility Shelfwise Inventory`
- Export name: `Shelf inventory ALL 9AM`
- Status: `SUCCESSFUL`

The script reads the CloudFront CSV hyperlink in the email body. It includes
only these exact inventory-export facilities:

- `SL Ambient` -> `SL_AMBIENT`
- `SL Mother Hub` -> `SL_MH`
- `SL RX` -> `SL_RX`
- `SL MM` -> `SL_MM`
- `SLLJ` -> `SL_LJ`
- `SL BW` -> `SL_BW`
- exact `OWN` -> `OWN`

Facilities such as `OWN B2B`, `OWN Beyond BLR`, and other `OWN ...` names are
not included.

Only the CSV `Quantity` column is summed. `GOOD_INVENTORY` drives the displayed
opening quantity and coverage percentage. `BAD_INVENTORY` and `QC_REJECTED`
quantities are stored separately for audit but are not displayed and never
enter the completion calculation.

The daily cycle-count source tab is `B2C` in the separate
[Bin wise cycle Count-Q2-JAS workbook](https://docs.google.com/spreadsheets/d/1_kBrwiM6ezFeE5kJFqeCMKcl7p_pe_XpNuVYhUmkUpw/edit?gid=2112925392).
It is only a parent sheet name. Its `Facility` column must contain `SL_MM`,
`SL_LJ`/`SLLJ`, or `SL_BW`. `B2C` itself is never displayed as a facility. Blank
or unsupported values are skipped and listed by
`testB2cFacilityMapping()`.

The B2C layout uses `Total` as System Quantity, `Phy` as Physical Quantity,
and `Diff.` as Difference. It does not need separate `Rack` or `Remark`
columns; `Shelf` remains the unique bin identifier for B2C reporting. Only
`Facility`, `Date`, `Shelf`, `Total`/`Sys`, and `Phy` are mandatory. Missing
`Pack`, `Box`, `Loose`, SKU-description, batch, and difference columns are
treated as optional instead of rejecting the complete B2C source.

The `OWN` tab in the same external workbook is the authoritative OWN
cycle-count source. It uses the standard Date/Rack/SKU/Shelf/Phy/Sys/Diff
layout. The header-only OWN tab inside `Inventory_Dashboard` is not used.

This is separate from the daily inventory CSV. The CSV contains the facility
names `SL MM`, `SLLJ`, and `SL BW`; it is not expected to contain a facility
named `B2C`.

### V2 quantity completion formula

```text
Cumulative Counted Quantity
= Sum of cycle-count System Quantity from the cycle start through the date

Quantity Completion %
= Cumulative Counted Quantity / that date's opening GOOD Quantity x 100
```

The progress-bar width stops visually at 100%, but the number remains visible
if data quality or repeat counting produces a result above 100%.

### Hidden system sheet

Running `setupApplication()` creates and hides `Cycle_Coverage_System`. Dates
are stored in rows. Each facility has columns for opening GOOD quantity, daily
counted quantity, cumulative counted quantity, completion percentage, BAD
quantity, and QC rejected quantity. The same row also stores the inventory
change note, source filename, source URL, Gmail Message ID, import time, and
import status.

To inspect it in Google Sheets, open **View > Hidden sheets >
Cycle_Coverage_System**. Do not enter data manually. Re-hide it by right-clicking
the sheet tab and selecting **Hide sheet**.

`setupApplication()` also adds these missing Config settings without replacing
existing values:

| Setting | Initial value |
| --- | --- |
| Coverage Cycle Start Date | `2026-07-01` |
| Coverage Cycle Months | `3` |
| Inventory Import Minutes | `30` |
| Inventory Change Alert % | `5` |
| Inventory Email Sender | `noreply@e.unicommerce.com` |
| Inventory Email Subject | `Export Job Complete - All facility Shelfwise Inventory` |
| Inventory Export Name | `Shelf inventory ALL 9AM` |

The import trigger checks Gmail every configured number of minutes. Gmail
Message IDs prevent duplicate imports. When the total opening GOOD quantity
changes by at least the configured alert percentage, the Facility MTD Progress
page displays the increase/decrease note.

The 2026 Q2 cycle runs from **1 July 2026 through 30 September 2026**. If an
existing V2 test copy was initially configured for August, paste the latest
`Code.gs` and run `setQ2CoverageCycle2026()` once. It updates only the coverage
dates in Config and recalculates the hidden coverage results; source sheets are
not changed. The Gmail importer searches from the configured cycle start so
July inventory snapshots can then be backfilled with repeated
`importLatestInventoryEmail()` runs.

### Apps Script verification order

Use the following order after copying a new backend version or while checking
the production project:

1. Run `testCycleCoverageCalculations()` - it changes nothing and verifies
   exact OWN, inventory-type separation, and counted-quantity grouping.
2. Run `testB2cFacilityMapping()` - it changes nothing and prints accepted
   SL_MM/SL_LJ/SL_BW row counts plus skipped source row numbers.
3. Run `setupCycleCoverageV2()` - it adds the optional Config rows, creates the
   hidden system sheet, and creates only the Gmail import trigger. It does not
   create another dashboard refresh or daily report email trigger.
4. Run `importLatestInventoryEmail()` - approve Gmail and external-request
   permissions, then check the execution log.
5. Run `testCycleCoverageApi()` - confirm the MTD dates, facility totals, and
   completion percentages returned to the frontend.

Run `removeCycleCoverageV2Trigger()` if the isolated test should stop checking
Gmail. This removes only the V2 inventory-import trigger from that test project.

## Current dashboard behavior

The current frontend contains four visible pages:

1. **Executive KPI**, including quantity coverage, four-period quantity and
   COGS accuracy, ABC Class details, and KPI cards.
2. **Inventory Transactions**, including Date and Facility filters, search,
   sorting, pagination, and CSV download.
3. **Facility MTD Progress**, including facility coverage cards and the
   day-wise opening inventory, counted quantity, completion, and inventory
   movement table.
4. **Calculation Logic**, including the formulas and publishing rules used by
   the production Apps Script and React dashboard.

The read-only Bin Master and SKU Master APIs are implemented, but **Section 3:
Masters is intentionally hidden in the frontend for now**.

The filter bar currently contains only:

- Date
- Facility
- Clear filters

The Date filter changes the detailed KPI cards and transaction table
for the selected day. The Facility filter limits the same details and
recalculates the four-period comparison for that facility.

The two comparison ribbons always show these fixed calendar periods:

- Last Quarter
- Last Month
- Month to Date
- Yesterday

They are comparison periods, not filter buttons.

## Dashboard layout

### Inventory Accuracy - Quantity

The first ribbon shows quantity-based Inventory Accuracy and System Quantity
for all four periods. Each period card is clickable. It opens an ABC Class
detail panel with quantity and COGS views for A, B, C, Unclassified, and Total.

The quantity view shows unique SKU count, System Quantity, Physical Quantity,
Difference, and Accuracy. The COGS view shows costed SKU count, System Value,
Physical Value, Difference Value, Value Accuracy, and Cost Coverage.

### Inventory Accuracy - Value / COGS

The second ribbon shows:

- Value Accuracy
- System Value
- Cost Coverage

Value Accuracy and Cost Coverage answer different questions:

- **Value Accuracy** measures inventory variance for rows that have a valid
  cost.
- **Cost Coverage** shows what percentage of the selected rows had a valid
  cost and could therefore be included in value calculations.

For example, Value Accuracy of 99.17% with Cost Coverage of 93.10% means the
costed rows were 99.17% accurate by value, but 6.90% of the rows were not
included in that value calculation because their cost was unavailable.

Do not multiply these percentages and do not describe Value Accuracy as report
completeness. The conservative completeness figure for value reporting is Cost
Coverage.

### Detailed KPI cards

The detailed cards show:

- Bin Accuracy
- Planned Bin Count
- Actual Bin Count
- Cycle Count Completion
- Inventory Accuracy
- System Quantity and Value
- Physical Quantity and Value
- Net Difference Quantity and Value

Negative quantities and values are displayed in parentheses.

### Daily email

The daily email reports Yesterday's detailed KPIs and also includes both
four-period ribbons:

- Quantity Accuracy for Last Quarter, Last Month, Month to Date, and Yesterday
- Value Accuracy, System Value, and Cost Coverage for the same four periods

If Yesterday has no cycle-count rows, the email uses `Activity_Status` to show
the reason and remark.

Every daily email also includes one quarter-to-date CSV attachment. The file
starts on the first day of the quarter and ends on the email reporting date.
For example, the 31 July report contains dated transactions from 1 July through
31 July. It includes the inventory quantities, differences, COGS values, and
source row ID. Rows with no valid Date are not included in this dated file.

## Project structure

```text
Inventory_Visibility/
|-- .github/
|   `-- workflows/
|       `-- deploy-pages.yml
|-- frontend/
|   |-- src/
|   |   |-- App.tsx
|   |   |-- api.ts
|   |   |-- dashboardUtils.ts
|   |   |-- main.tsx
|   |   |-- types.ts
|   |   `-- components/
|   |       |-- FilterBar.tsx
|   |       |-- InventoryTable.tsx
|   |       |-- KpiCard.tsx
|   |       `-- MasterTable.tsx
|   |-- .env.example
|   |-- package.json
|   |-- package-lock.json
|   `-- vite.config.ts
|-- apps-script/
|   |-- Code.gs
|   |-- EmailTemplate.html
|   `-- appsscript.json
`-- README.md
```

There is no Node.js backend, Express server, Docker container, database server,
or physical Combine sheet.

# Part 1: Google Sheets setup

## 1. Open the spreadsheet

Spreadsheet name: `Inventory_Dashboard`

Spreadsheet ID:

```text
1uB9hiqI8z46_fYxiB1syRwNNw0TM_ZV2NCYZcAVmWIk
```

Open:

[Inventory_Dashboard Google Sheet](https://docs.google.com/spreadsheets/d/1uB9hiqI8z46_fYxiB1syRwNNw0TM_ZV2NCYZcAVmWIk/edit)

## 2. Check the five current inventory sources

The backend reads:

- `SL_AMBIENT`
- `SL_MH`
- `SL_RX`
- external workbook tab `OWN`
- external workbook tab `B2C`

The three `Inventory_Dashboard` source sheets and external `OWN` must use this
header row:

```text
Date | Rack | Sku Code | Item Name | Shelf | Batch | Vendor Batch Number | Pack | Box | Loose | Phy | Sys | Diff | Remark
```

The external `B2C` tab uses:

```text
Facility | Date | Sku Code | Item Name | Shelf | Batch | Vendor Batch number | Total | Blocked | Not Found | Pack | Box | Loose | Phy | Diff.
```

For B2C only, the backend maps `Total` to System Quantity and accepts only
`SL_MM`, `SL_LJ`/`SLLJ`, and `SL_BW` from the Facility column. The full row
shown above is supported, but only Facility, Date, Shelf, Total/Sys, and Phy
are required.

Header matching ignores case, extra spaces, and periods, so `Diff` and `Diff.`
are both accepted.

The backend:

- skips a missing, empty, or header-only source sheet
- ignores completely blank inventory rows
- ignores the first header row
- adds Facility from the source sheet name
- combines rows only in Apps Script memory
- never creates or changes a physical `Combine` sheet
- never changes the five source sheets

The frontend Refresh button first asks Apps Script to reread both workbooks,
recalculate the dashboard and coverage snapshot, and then refetches the visible
cards. It is therefore different from simply reloading a cached API response.

If `Diff` is blank, the backend calculates `Phy - Sys`. For normal rows, a
supplied `Diff` value is used for absolute difference, Short, Excess, bin
accuracy, and the related value calculations.

For an NTF row, the business rule overrides the source Physical Quantity and
Difference: Physical Quantity becomes zero and Difference becomes
`0 - System Quantity`.

## 3. Check the historical sheet

The historical sheet is:

```text
Q1-AMJ26
```

It supplies April-June 2026 history for Last Quarter and past-date
transactions. It is read-only.

Required headers:

```text
Facility | Date | Rack | Sku's | Item Name | Shelf | Batch | Vendor Batch number | Pack | Box | Loose | Phy | Sys | Diff. | Remarks | Cogs/Unit
```

Notes:

- The historical row's `Cogs/Unit` is preferred.
- If `Cogs/Unit` is blank, the current `COGS` rate is used as a fallback.
- `SL_AMB` is normalized to `SL_AMBIENT`.
- The backend reads only the fixed historical sheet named `Q1-AMJ26`.

## 4. Check the COGS sheet

The cost sheet must be named:

```text
COGS
```

Required headers:

```text
SKU | Product Name | Unit Rate (Excluding Gst) | GST Rate
```

Rules:

- Inventory `Sku Code` is matched to `COGS` `SKU` without case sensitivity.
- `Unit Rate (Excluding Gst)` is used for all value KPIs.
- GST is not included.
- A zero unit rate is valid.
- Blank, invalid, or negative rates are treated as missing costs.
- If a SKU appears more than once, the first valid cost row is used.
- Rows without a valid cost remain in quantity KPIs but are excluded from value
  totals.
- Missing costs reduce Cost Coverage.

Maintain the COGS data directly in Google Sheets. The application does not
change it.

## 5. Config sheet

Running `setupApplication()` creates `Config` if it is missing and adds any
missing settings without overwriting existing values.

The sheet must be named `Config` and use:

```text
Setting | Value
```

Required settings:

| Setting | Example value | Purpose |
|---|---:|---|
| Dashboard Name | Inventory Health Dashboard | Header and email title |
| Daily Planned Bin Count | 100 | Daily bin plan |
| Working Days | 26 | Monthly planning value |
| Auto Refresh Minutes | 30 | Cloud cache refresh interval |
| Email Enabled | No | Use `Yes` only when ready to send |
| Email To | example@email.com | Main recipient |
| Email CC | | Optional CC |
| Email BCC | | Optional BCC |
| Email Subject | Daily Inventory Health Report | Email subject prefix |
| Email Send Hour | 11 | Hour from 0 to 23 |
| Dashboard URL | https://bjpatel90.github.io/Inventory_Visibility/ | Email link |
| Theme | Light | Default `Light` or `Dark` |

Important:

- `Auto Refresh Minutes` must be `1`, `5`, `10`, `15`, `30`, or `60`.
- The script time zone is `Asia/Kolkata`.
- The daily trigger targets minute `10` of the configured hour. Google may vary
  that time by about 15 minutes. Hour `11` therefore normally sends between
  approximately 11:00 and 11:25 IST, before 11:30.
- The script records the last emailed report date. If another trigger starts for
  the same report date, it exits without sending a duplicate.
- After changing the refresh interval, run `createRefreshTrigger()` again.
- After changing the email hour, run `createDailyEmailTrigger()` again.
- The frontend also reads Auto Refresh Minutes and uses it as its API refetch
  interval while the page is open.

## 6. Activity_Status sheet

Running `setupApplication()` also creates this sheet and its Reason dropdown.

Required headers:

```text
Date | Reason | Remark
```

Supported reasons:

- Sunday
- Public Holiday
- Inventory Freeze
- System Issue
- Other

Example:

```text
2026-07-22 | Public Holiday | Warehouse closed for scheduled holiday.
```

Use a real Google Sheets date. Add a status only when no cycle count was
performed for that date.

## 7. Master sheets

The backend supports these read-only sheets:

`Bin_Master`

```text
Facility | Rack | Bin | Status
```

`SKU_Master` or `SKU_MASTER`

```text
SKU | Item Name | Brand | Category | Pack Size | ABC Class
```

Enter only `A`, `B`, or `C` in `ABC Class`. Inventory SKUs with a blank or
invalid class, or with no matching SKU master row, remain visible under
`Unclassified`. SKU matching is case-insensitive. The ABC breakdown includes
all transaction rows for the selected banner period and counts each SKU once
within its class.

Master sheet lookup is case-insensitive. These APIs remain available, but the
Masters section is currently disabled in the frontend.

# Part 2: Google Apps Script setup

## 1. Open the bound Apps Script project

1. Open the `Inventory_Dashboard` spreadsheet.
2. Select **Extensions > Apps Script**.
3. Wait for the Apps Script editor to open.

## 2. Replace Code.gs

1. In the Apps Script **Files** panel, select `Code.gs`.
2. Delete the old content.
3. Open [apps-script/Code.gs](apps-script/Code.gs) from this repository.
4. Copy the complete file.
5. Paste it into the Apps Script `Code.gs` file.
6. Click **Save project**.

## 3. Add or replace EmailTemplate.html

If the file does not exist:

1. Click **Add a file (+)** in the Apps Script Files panel.
2. Select **HTML**.
3. Enter `EmailTemplate`.

Then:

1. Open [apps-script/EmailTemplate.html](apps-script/EmailTemplate.html).
2. Copy the complete file.
3. Paste it into `EmailTemplate.html` in Apps Script.
4. Click **Save project**.

## 4. Check the time zone

1. In Apps Script, open **Project Settings**.
2. Set the time zone to **(GMT+05:30) India Standard Time - Kolkata**.
3. Save the project.

The supplied [apps-script/appsscript.json](apps-script/appsscript.json) uses
`Asia/Kolkata` and the V8 runtime.

## 5. Run the one-time setup

1. Return to **Editor**.
2. Open the function dropdown at the top.
3. Select `setupApplication`.
4. Click **Run**.
5. Click **Review permissions** when requested.
6. Select the Google account that manages the spreadsheet.
7. Review the permissions and click **Allow**.

Expected result:

- `Config` exists and contains every required setting.
- `Activity_Status` exists with the correct headers and Reason dropdown.
- One refresh trigger exists.
- One daily email trigger exists.
- The dashboard cache is calculated.
- None of the inventory, historical, COGS, or master sheets are changed.

Open **Execution log** to review the result.

## 6. Run backend tests

Run these functions one at a time:

| Function | What it checks | Changes data? |
|---|---|---|
| `testKpiCalculations()` | Quantity, value, bin, NTF-shortage, and coverage formulas using sample rows | No |
| `testPhase1()` | Current source rows, skipped sheets, periods, and KPIs | No |
| `testValueKpis()` | COGS matching, coverage, and missing-cost SKUs | No |
| `testNtfRecalculation()` | Live NTF normalization and revised four-period KPIs | No |
| `testQuarterData()` | `Q1-AMJ26`, historical date range, and four periods | No |
| `testMasters()` | Bin and SKU master APIs | No |
| `testEmailPreview()` | Email model, HTML, and quarter CSV without sending | No |
| `testPaginatedTransactions()` | Small MTD transaction page, KPI summary, and response size | No |
| `testAbcBreakdownCalculations()` | ABC quantity and COGS formulas, negative difference, and Unclassified handling | No |

For each test:

1. Select the function.
2. Click **Run**.
3. Open **Execution log**.
4. Confirm `"passed": true` where provided and review all counts.

`testEmailPreview()` does not send an email or create a Drive file. It prints
the preview summary, HTML length, CSV file name, quarter dates, transaction
count, and attachment size in the log.

## 7. Deploy the Web App

For the first deployment:

1. Click **Deploy > New deployment**.
2. Click the gear next to **Select type**.
3. Select **Web app**.
4. Enter a description.
5. Set **Execute as** to **Me**.
6. Select the access setting suitable for the dashboard.
7. Click **Deploy**.
8. Approve permissions if requested.
9. Copy the URL ending in `/exec`.

### Access and privacy warning

The React frontend is a static GitHub Pages site and calls Apps Script directly
from the user's browser. In this simple architecture, the Web App normally
needs the access setting **Anyone** to return JSON without a Google sign-in
redirect.

That means anyone who obtains the Web App URL can read the data exposed by its
GET endpoints. The Web App URL and the GitHub Actions secret are not a secure
login system because Vite places the URL inside the published browser files.

If the inventory data must be limited to named users or a Google Workspace
domain, do not publish this version as a public Web App. Add proper
authentication in a later security phase.

## 8. Test the API

Replace `YOUR_WEB_APP_URL` with the copied `/exec` URL:

```text
YOUR_WEB_APP_URL?action=config
YOUR_WEB_APP_URL?action=dashboard
YOUR_WEB_APP_URL?action=transactions&startDate=2026-08-01&endDate=2026-08-03&page=1&pageSize=25
YOUR_WEB_APP_URL?action=facilityDashboard&facility=SL_MH
YOUR_WEB_APP_URL?action=activityStatus&date=2026-07-23
YOUR_WEB_APP_URL?action=binMaster
YOUR_WEB_APP_URL?action=skuMaster
```

A successful response has this structure:

```json
{
  "success": true,
  "data": {},
  "lastRefreshTime": "2026-07-23T10:30:00.000Z"
}
```

The `data` shape depends on the action.

The `transactions` action is server-side paginated. It returns only the
requested page together with the KPI totals, row counts,
and Facility options for the selected date range. This prevents the browser
from downloading all current and historical rows during startup. The default
Month-to-Date page is also prewarmed by `refreshDashboardCache` and small page
responses are cached for 10 minutes.

If the browser shows HTML, a Google login page, or an authorization error
instead of JSON, check the deployment access setting and confirm the URL ends
in `/exec`.

## 9. Publish later Apps Script changes

Saving `Code.gs` does not update an existing Web App deployment.

After every backend or email change:

1. Click **Deploy > Manage deployments**.
2. Select the existing Web App.
3. Click **Edit**.
4. Set **Version** to **New version**.
5. Click **Deploy**.
6. Keep the same `/exec` URL.
7. Test `?action=dashboard` again.

Apps Script deployment is separate from GitHub Pages deployment.

# Part 3: Frontend setup

## 1. Requirements

For optional local testing, install Node.js 22.

The published dashboard does not need a local development server.

## 2. Configure the local Apps Script URL

Open a terminal in the repository and copy:

```powershell
Copy-Item frontend\.env.example frontend\.env.local
```

Open `frontend/.env.local` and set:

```text
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Do not add quotation marks. Do not commit `.env.local`.

## 3. Run locally

```powershell
cd frontend
npm install
npm run dev
```

Open the address shown by Vite. Local testing is temporary; the production
dashboard remains on GitHub Pages after the terminal and laptop are switched
off.

## 4. Verify a production build

From the `frontend` folder:

```powershell
npm run build
```

Expected result:

- TypeScript completes without errors.
- Vite creates `frontend/dist`.
- Assets use `/Inventory_Visibility/` as the GitHub Pages base path.

# Part 4: GitHub Pages deployment

## 1. Add the Apps Script URL as a repository secret

1. Open [the GitHub repository](https://github.com/BJPATEL90/Inventory_Visibility).
2. Select **Settings**.
3. Select **Secrets and variables > Actions**.
4. Open the **Secrets** tab.
5. Click **New repository secret**.
6. Enter this exact name:

```text
VITE_APPS_SCRIPT_URL
```

7. Paste the Apps Script `/exec` URL as the value.
8. Click **Add secret**.

The workflow deliberately fails at **Check Apps Script URL** if this secret is
missing.

## 2. Enable GitHub Pages

1. Open **Settings > Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

## 3. Deploy

Every push to `main` starts
[.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml).

The workflow:

1. Downloads the repository.
2. Uses Node.js 22.
3. Checks `VITE_APPS_SCRIPT_URL`.
4. Runs `npm ci` in `frontend`.
5. Runs `npm run build`.
6. Publishes `frontend/dist` to GitHub Pages.

To run it manually:

1. Open **Actions**.
2. Select **Deploy Inventory Dashboard to GitHub Pages**.
3. Click **Run workflow**.
4. Select `main`.
5. Click **Run workflow** again.

Wait for both jobs to turn green:

- Build React frontend
- Publish GitHub Pages site

Then open:

[https://bjpatel90.github.io/Inventory_Visibility/](https://bjpatel90.github.io/Inventory_Visibility/)

# KPI calculation reference

All percentages are rounded to two decimal places.

## Quantity Inventory Accuracy

```text
100 - (Total Absolute Difference / Total System Quantity x 100)
```

`Total Absolute Difference` is the sum of `ABS(Diff)` for all selected rows.
If System Quantity is zero, the result is zero.

## Value Inventory Accuracy

```text
Absolute Difference Value = Short Value + Excess Value

Value Accuracy % =
100 - (Absolute Difference Value / System Value x 100)
```

Only rows with a valid unit cost are included. If System Value is zero, the
result is zero.

## Cost Coverage

```text
Cost Coverage % = Costed Row Count / Selected Row Count x 100
```

This is row-based coverage, not quantity-based or value-based coverage.

## Bin Accuracy

One bin is a unique:

```text
Facility + Rack + Shelf
```

The backend sums `Diff` for every row in that bin. The bin is accurate when its
total difference is zero.

```text
Bin Accuracy % = Accurate Bin Count / Actual Bin Count x 100
```

Rows where both Rack and Shelf are blank do not form a bin.

## System and Physical quantities

```text
System Quantity = Sum of Sys
Physical Quantity = Sum of Phy
```

## Net Difference

```text
Net Difference = Physical Quantity - System Quantity
```

Net Difference deliberately uses `Phy - Sys` totals. Short and Excess use the
source `Diff` values. Therefore, if a source row's `Diff` does not equal
`Phy - Sys`, then `Excess - Short` will not equal Net Difference. This is a
source-data quality issue, not a hidden row.

## Short and Excess

```text
Short Quantity = Sum of ABS(Diff) where Diff is negative
Excess Quantity = Sum of Diff where Diff is positive
```

## Values

For rows with a valid unit cost:

```text
System Value = Sys x Unit Cost
Physical Value = Phy x Unit Cost
Net Difference Value = Physical Value - System Value
Short Value = ABS(Diff) x Unit Cost where Diff is negative
Excess Value = Diff x Unit Cost where Diff is positive
```

All values use INR and exclude GST.

## Actual and Planned Bin Count

```text
Actual Bin Count = Unique Facility + Rack + Shelf combinations
```

Planned Bin Count:

- Yesterday: Daily Planned Bin Count
- Last Month: Daily Planned Bin Count x Working Days
- Last Quarter: Daily Planned Bin Count x Working Days x 3
- Month to Date: Daily Planned Bin Count x completed Monday-Saturday days,
  capped at the configured Working Days
- A selected custom date in the frontend: Daily Planned Bin Count

## Cycle Count Completion

```text
Actual Bin Count / Planned Bin Count x 100
```

The result can be above 100% when actual counted bins exceed the plan.

## NTF

A row is NTF when `Rack`, `Shelf`, or `Remark` contains `NTF`,
case-insensitively. One row is counted once even if NTF appears in more than one
field.

```text
Physical Quantity = 0
Difference = 0 - System Quantity
```

NTF is not displayed as a separate KPI card. It is treated as a normal
inventory shortage and affects System Quantity, Physical Quantity, Net
Difference, Short Quantity, quantity accuracy, and all related costed value
KPIs.

Dated NTF rows are included in their normal reporting date. Current-sheet NTF
rows without a valid Date are included in Month to Date only. They cannot be
placed in Yesterday or a daily trend without a reliable date.

Other rows with a blank or invalid Date remain available in the transaction API
but cannot be assigned to a dated KPI period. Correct their Date in the source
sheet if they should appear in a daily or period report.

## Accuracy colours

The same rule is reused for quantity accuracy, value accuracy, and bin
accuracy:

| Result | Colour |
|---:|---|
| Below 96% | Red |
| 96% to below 99% | Yellow |
| 99% and above | Green |

# Testing checklist

## Google Sheets and backend

- [ ] Confirm the five current source sheets have the required headers.
- [ ] Confirm `Q1-AMJ26` has the required historical headers.
- [ ] Confirm `COGS` has the required cost headers.
- [ ] Run `testKpiCalculations()` and confirm it passes.
- [ ] Run `testPhase1()` and review current row counts and skipped sheets.
- [ ] Run `testValueKpis()` and review cost coverage and missing SKUs.
- [ ] Run `testNtfRecalculation()` and confirm `"passed": true`.
- [ ] Run `testQuarterData()` and review the historical date range.
- [ ] Run `testPaginatedTransactions()` and confirm only the requested page is
  returned while `selectedRowCount` shows the full selected-period count.
- [ ] Run `testEmailPreview()` and review both four-period summaries.
- [ ] Test every API URL directly in a browser.

## Frontend

- [ ] Confirm only Date and Facility appear in the filter bar.
- [ ] Select a current date and confirm KPI cards and transactions
  change.
- [ ] Select a date from `Q1-AMJ26` and confirm historical rows appear.
- [ ] Select a Facility and confirm the detailed results and period ribbons
  change.
- [ ] Click **Clear filters** and confirm Month-to-Date details return.
- [ ] Confirm the Quantity Accuracy ribbon has four periods.
- [ ] Confirm the Value/COGS ribbon has four periods, System Value, and Cost
  Coverage.
- [ ] Confirm there is no separate NTF KPI card.
- [ ] Confirm NTF rows contribute as full shortages in Month-to-Date totals.
- [ ] Open **Calculation Logic** and confirm the formulas, live Config values,
  data sources, and publication flow are readable on desktop and mobile.
- [ ] Confirm the Masters section is not visible.
- [ ] Test transaction global search.
- [ ] Test column sorting.
- [ ] Test pagination and page size.
- [ ] Export CSV and confirm it contains the filtered and searched rows.
- [ ] Confirm the Dashboard Charts section is not displayed.
- [ ] Test light and dark mode.
- [ ] Test on desktop and a phone-sized screen.

## Zero activity

- [ ] Choose a date with no cycle-count rows.
- [ ] Add the date, supported reason, and remark to `Activity_Status`.
- [ ] Refresh the dashboard and select the same date.
- [ ] Confirm the reason and remark appear.
- [ ] Confirm Yesterday's no-activity notice appears below the ribbons when
  Yesterday has no rows.
- [ ] Run `testEmailPreview()` and confirm the same Yesterday reason appears.

## Email and triggers

- [ ] Keep `Email Enabled` as `No` during preview testing.
- [ ] Set `Email To` before enabling email.
- [ ] Run `sendInventoryEmail()` manually once after enabling email.
- [ ] Check the email in Gmail and Outlook if both are used.
- [ ] Confirm the email contains Quantity Accuracy and Value Accuracy ribbons.
- [ ] Confirm the email contains one `Inventory_Transactions_QTD_...csv`
  attachment and that its first and last dates match the quarter-to-date range.
- [ ] Run `createRefreshTrigger()` after finalizing the refresh interval.
- [ ] Run `createDailyEmailTrigger()` after finalizing the send hour.
- [ ] Open **Triggers** and confirm one trigger for
  `refreshDashboardCache` and one for `sendInventoryEmail`.
- [ ] Open **Executions** later and confirm triggers ran while the laptop was
  switched off.

## Deployment

- [ ] Confirm the latest Apps Script code was saved and deployed as a new Web
  App version.
- [ ] Confirm the Web App `/exec` URL returns JSON.
- [ ] Confirm the GitHub secret `VITE_APPS_SCRIPT_URL` exists.
- [ ] Confirm the latest GitHub Actions run is green.
- [ ] Open the published dashboard after stopping the local development server.
- [ ] Refresh the published page and confirm it does not show a 404.

# Common errors

## GitHub Actions says `VITE_APPS_SCRIPT_URL is missing`

Add the repository secret under:

**Settings > Secrets and variables > Actions > New repository secret**

Use the exact name `VITE_APPS_SCRIPT_URL`, then rerun the workflow.

## Apps Script URL returns HTML instead of JSON

Check:

- the URL ends in `/exec`, not `/dev`
- the latest Apps Script version is deployed
- the Web App access setting permits the browser request
- `YOUR_WEB_APP_URL?action=config` works directly

After one successful dashboard visit, later temporary API failures keep the
last successful KPI snapshot visible. Use the warning's **Retry latest data**
button to try the cloud refresh again.

## Frontend still shows old backend results

Saving Apps Script is not enough. Use:

**Deploy > Manage deployments > Edit > New version > Deploy**

Then run `refreshDashboardCache()` or wait for the refresh trigger.

## Value Accuracy is high but Cost Coverage is lower

This is possible and expected. Value Accuracy measures only rows with a valid
cost. Cost Coverage tells how much of the selected row population was included.
Add missing SKU rates to `COGS`, redeploy only if code changed, and refresh the
cache.

## Net Difference does not equal Excess minus Short

Check whether every source `Diff` equals `Phy - Sys`. Net Difference uses
Physical minus System totals, while Short and Excess use the supplied `Diff`.

## A row does not appear in a dated period

Check:

- Date is a real Google Sheets date or a valid recognizable date
- the row is not completely blank
- the selected period includes the date
- current undated NTF is included in Month to Date only
- the source or historical sheet has every required header

## GitHub Pages is blank or has missing assets

Check:

- the repository name is exactly `Inventory_Visibility`
- `frontend/vite.config.ts` contains `base: '/Inventory_Visibility/'`
- **Settings > Pages > Source** is **GitHub Actions**
- the latest Actions workflow completed successfully

## Email was not sent

Check:

- `Email Enabled` is `Yes`
- `Email To` is not blank
- `sendInventoryEmail()` works manually
- the daily trigger exists
- Apps Script **Executions** has no error
- the sending account has remaining email quota

# Current scope and known limitations

This release intentionally does not include:

- Node.js or Express backend
- Docker
- database server
- complex authentication or user roles
- editable master forms
- visible Masters section
- Excel or PDF export
- GST-inclusive value KPIs
- service accounts
- a physical Combine sheet
- CI/CD deployment for Apps Script

The frontend is deployed automatically by GitHub Actions. Apps Script must
still be copied and deployed separately through the Apps Script editor.
