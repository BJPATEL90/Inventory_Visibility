# Inventory Health Dashboard

Inventory Health Dashboard is a small inventory reporting application built for
Google Sheets, Google Apps Script, React, and GitHub Pages.

- Google Sheets stores the inventory, configuration, activity status, and master
  data.
- Google Apps Script reads the sheets, calculates KPIs, refreshes cached data,
  and sends the daily email.
- React displays the dashboard.
- GitHub Pages hosts the React frontend.

The refresh and email jobs run in Google's cloud. After the Apps Script triggers
are installed, they continue to run when your laptop is switched off.

## Project folders

```text
Inventory_Visibility/
├── .github/
│   └── workflows/
│       └── deploy-pages.yml
├── frontend/
│   ├── src/
│   ├── package.json
│   ├── package-lock.json
│   ├── vite.config.ts
│   └── .env.example
├── apps-script/
│   ├── Code.gs
│   ├── EmailTemplate.html
│   └── appsscript.json
└── README.md
```

## Before you start

You need:

1. Access to the `Inventory_Dashboard` Google spreadsheet.
2. A Google account that can create an Apps Script deployment and triggers.
3. Access to the GitHub repository
   `BJPATEL90/Inventory_Visibility`.
4. Node.js 22 if you want to test the frontend on your computer.

Local testing is optional. The final dashboard is hosted on GitHub Pages.

# Part 1: Google Sheets setup

## 1. Open the spreadsheet

Open the `Inventory_Dashboard` spreadsheet:

`https://docs.google.com/spreadsheets/d/1uB9hiqI8z46_fYxiB1syRwNNw0TM_ZV2NCYZcAVmWIk/edit`

## 2. Check the five inventory sheets

Check that these sheets exist:

- `SL_AMBIENT`
- `SL_MH`
- `SL_RX`
- `OWN`
- `SL_B2C`

Each source sheet should use this first row:

```text
Date | Rack | Sku Code | Item Name | Shelf | Batch | Vendor Batch Number | Pack | Box | Loose | Phy | Sys | Diff | Remark
```

The application does not change these source sheets. A missing or empty source
sheet is skipped safely. Do not create a `Combine` sheet; the combined data is
created only in Apps Script memory.

## 3. Create or check the Config sheet

The easiest method is to run `setupApplication()` in Part 2. It creates the
`Config` sheet when it is missing and adds any missing settings without
overwriting existing values.

The sheet must be named `Config` and must contain:

| Setting | Example value |
|---|---|
| Dashboard Name | Inventory Health Dashboard |
| Daily Planned Bin Count | 100 |
| Working Days | 26 |
| Auto Refresh Minutes | 30 |
| Email Enabled | Yes |
| Email To | example@email.com |
| Email CC | |
| Email BCC | |
| Email Subject | Daily Inventory Health Report |
| Email Send Hour | 9 |
| Dashboard URL | https://bjpatel90.github.io/Inventory_Visibility/ |
| Theme | Light |

Important:

- `Email Enabled` must be `Yes` or `No`.
- `Email To` is required when email is enabled.
- `Email Send Hour` uses a whole number from `0` to `23`.
- `Auto Refresh Minutes` must be `1`, `5`, `10`, `15`, `30`, or `60`.
- The project time zone is `Asia/Kolkata`.
- Run `createRefreshTrigger()` after changing the refresh minutes.
- Run `createDailyEmailTrigger()` after changing the email hour.

## 4. Create or check Activity_Status

The sheet must be named `Activity_Status` and use:

```text
Date | Reason | Remark
```

Supported reasons:

- `Sunday`
- `Public Holiday`
- `Inventory Freeze`
- `System Issue`
- `Other`

Example:

```text
2026-07-22 | Public Holiday | Warehouse closed for scheduled holiday.
```

Enter a row only when no cycle count was performed for that date. Keep the Date
cell as a real Google Sheets date.

## 5. Create or check Bin_Master

The sheet must be named `Bin_Master` and use:

```text
Facility | Rack | Bin | Status
```

This table is read-only in the dashboard. Maintain its rows directly in Google
Sheets.

## 6. Create or check SKU_MASTER

The recommended sheet name is `SKU_Master`, using:

```text
SKU | Item Name | Brand | Category | Pack Size
```

The backend also accepts the existing name `SKU_MASTER` because sheet lookup is
case-insensitive. This table is read-only in the dashboard.

# Part 2: Google Apps Script setup

## 1. Open Apps Script

1. Open the `Inventory_Dashboard` spreadsheet.
2. Select **Extensions > Apps Script**.
3. Wait for the Apps Script editor to open.

## 2. Add Code.gs

1. In the left **Files** panel, select `Code.gs`.
2. Delete the starter code.
3. Open this project's `apps-script/Code.gs` file.
4. Copy the complete file and paste it into the Apps Script `Code.gs` editor.

## 3. Add EmailTemplate.html

1. In the left **Files** panel, click **Add a file (+)**.
2. Select **HTML**.
3. Enter the name `EmailTemplate`.
4. Open this project's `apps-script/EmailTemplate.html` file.
5. Copy the complete file into the new Apps Script HTML file.

The editor displays the file as `EmailTemplate.html`.

## 4. Check the project settings

1. Click **Project Settings** in the left panel.
2. Set the time zone to **(GMT+05:30) India Standard Time – Kolkata** if it is
   not already selected.
3. Click **Save project**.

The supplied `appsscript.json` uses `Asia/Kolkata` and the V8 runtime.

## 5. Run the one-time setup

1. At the top of the editor, open the function dropdown.
2. Select `setupApplication`.
3. Click **Run**.
4. When Google asks for authorization, click **Review permissions**.
5. Select the Google account that owns or manages the dashboard.
6. Review the requested permissions and click **Allow**.

Expected result:

- `Config` and `Activity_Status` exist.
- Missing settings are appended without changing the five source sheets.
- A refresh trigger is created.
- A daily email trigger is created.
- The dashboard cache is refreshed.

To see the result, click **Execution log** at the bottom of the editor.

## 6. Test the backend

Run these functions one at a time from the function dropdown:

1. `testKpiCalculations()` checks the KPI formulas using safe sample data.
2. `testPhase1()` reads the real source sheets and prints the combined counts,
   skipped sheets, periods, KPIs, and last refresh time.
3. `testMasters()` prints the Bin Master and SKU Master row counts and samples.
4. `testEmailPreview()` creates the email HTML and saves a temporary preview
   file in Google Drive. It does not send an email.

For each test:

1. Select the function.
2. Click **Run**.
3. Open **Execution log**.
4. Confirm that the output does not contain an error.

To inspect past runs, click **Executions** in the left panel.

## 7. Deploy the Apps Script Web App

1. In the Apps Script editor, click **Deploy > New deployment**.
2. Next to **Select type**, click the gear icon.
3. Select **Web app**.
4. Enter a description such as `Inventory Dashboard API v1`.
5. For **Execute as**, select **Me**.
6. Choose the access setting that is appropriate for your data.
7. Click **Deploy**.
8. Approve permissions if Google asks again.
9. Copy the Web App URL ending in `/exec`.

### Important access note

The React site calls the Apps Script URL directly from GitHub Pages. For this
simple first version, the deployment normally needs the access option labelled
**Anyone** so the browser can receive JSON without a Google sign-in redirect.
This means anyone who obtains the Apps Script URL can read the data returned by
the API.

Do not treat the Web App URL or the GitHub secret as authentication. Vite places
the URL in the published browser files during the build.

If the inventory data must be restricted to named users or only your Google
Workspace domain, stop before publishing. A static GitHub Pages site plus a
direct Apps Script request is not a complete secure login system. Controlled
user authentication should be added as a future security enhancement before
exposing sensitive data.

## 8. Test the Web App URL

Paste each URL into a browser, replacing `YOUR_WEB_APP_URL`:

```text
YOUR_WEB_APP_URL?action=config
YOUR_WEB_APP_URL?action=dashboard
YOUR_WEB_APP_URL?action=transactions
YOUR_WEB_APP_URL?action=binMaster
YOUR_WEB_APP_URL?action=skuMaster
```

Expected result:

```json
{
  "success": true,
  "data": {},
  "lastRefreshTime": "2026-07-23T10:30:00.000Z"
}
```

The exact `data` value changes by action. If the browser shows an authorization
page or HTML instead of JSON, review the Web App access setting.

When `Code.gs` changes later:

1. Click **Deploy > Manage deployments**.
2. Select the Web App deployment.
3. Click **Edit**.
4. Under **Version**, choose **New version**.
5. Click **Deploy**.

Keep the same `/exec` URL when updating the existing deployment.

# Part 3: Frontend setup

## 1. Add the files to GitHub

The repository should contain the complete `frontend`, `apps-script`,
`.github/workflows`, and `README.md` files from this project.

Do not upload:

- `frontend/node_modules`
- `frontend/dist`
- `frontend/.env.local`

They are already excluded by `frontend/.gitignore`.

## 2. Add the Apps Script URL for local testing

Inside the `frontend` folder:

1. Copy `.env.example`.
2. Rename the copy to `.env.local`.
3. Replace the example value with the `/exec` Web App URL:

```text
VITE_APPS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Do not add quotation marks. Do not commit `.env.local`.

## 3. Run locally

Open a terminal in the `frontend` folder and run:

```powershell
npm install
npm run dev
```

Open the local address shown in the terminal, normally
`http://localhost:5173/Inventory_Visibility/`.

Local mode is only for checking changes. You may close it after testing; the
published dashboard and Google triggers do not depend on it.

## 4. Check a production build

From the `frontend` folder, run:

```powershell
npm run build
```

Expected result:

- TypeScript completes without errors.
- Vite creates `frontend/dist`.
- The build uses `/Inventory_Visibility/` as its GitHub Pages base path.

# Part 4: GitHub Pages deployment

## 1. Open the repository

Open:

`https://github.com/BJPATEL90/Inventory_Visibility`

Make sure the default branch is named `main`.

## 2. Add the Apps Script URL as a GitHub secret

1. Open the repository.
2. Select **Settings**.
3. In the left menu, select **Secrets and variables > Actions**.
4. Select the **Secrets** tab.
5. Click **New repository secret**.
6. For **Name**, enter exactly:

```text
VITE_APPS_SCRIPT_URL
```

7. For **Secret**, paste the Apps Script Web App URL ending in `/exec`.
8. Click **Add secret**.

The workflow stops with a clear error if this secret is missing.

## 3. Enable GitHub Pages

1. In the repository, select **Settings**.
2. In **Code and automation**, select **Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.

## 4. Push the project

Push all project files to the `main` branch. The file
`.github/workflows/deploy-pages.yml` starts the deployment automatically.

If using Git from the project folder for the first time:

```powershell
git init
git branch -M main
git add .
git commit -m "Build inventory health dashboard"
git remote add origin https://github.com/BJPATEL90/Inventory_Visibility.git
git push -u origin main
```

If the GitHub repository already contains files, clone it first or connect and
merge it carefully instead of overwriting its history.

## 5. Watch the deployment

1. Open the repository's **Actions** tab.
2. Open **Deploy Inventory Dashboard to GitHub Pages**.
3. Wait for both jobs to turn green:
   - **Build React frontend**
   - **Publish GitHub Pages site**
4. Open **Settings > Pages** and click **Visit site**.

Final dashboard address:

`https://bjpatel90.github.io/Inventory_Visibility/`

The workflow also has a manual option:

1. Open **Actions**.
2. Select **Deploy Inventory Dashboard to GitHub Pages**.
3. Click **Run workflow**.
4. Select `main`.
5. Click **Run workflow** again.

Every later push to `main` builds and republishes only the React frontend.
Apps Script is still deployed separately through the Apps Script editor.

# Part 5: Testing checklist

## A. KPI calculations

- [ ] Run `testKpiCalculations()` and confirm it completes without errors.
- [ ] Run `testPhase1()` and compare the combined row count with the source
  sheets.
- [ ] Confirm System Quantity is the sum of `Sys`.
- [ ] Confirm Physical Quantity is the sum of `Phy`.
- [ ] Confirm Net Difference equals Physical Quantity minus System Quantity.
- [ ] Confirm Short Quantity uses the absolute total of negative differences.
- [ ] Confirm Excess Quantity totals positive differences.
- [ ] Confirm Actual Bin Count counts unique Facility + Rack + Shelf values.
- [ ] Confirm Yesterday planned bins equals Daily Planned Bin Count.
- [ ] Confirm Month to Date planned bins equals Daily Planned Bin Count
  multiplied by completed working days.
- [ ] Confirm `NTF` matching is case-insensitive.
- [ ] Confirm accuracy colours: below 96 red, 96 to below 99 yellow, and 99 or
  above green.

## B. Filters and states

- [ ] Select each reporting period: Last Month, Month to Date, and Yesterday.
- [ ] Test Date, Facility, Rack, SKU, Batch, and Remark filters.
- [ ] Confirm KPI cards, all charts, and the transaction table change together.
- [ ] Click **Clear Filters** and confirm all filters reset.
- [ ] Confirm the loading message appears during a refresh.
- [ ] Select a period with no data and confirm the empty or zero-activity
  message is clear.
- [ ] Temporarily use an invalid Apps Script URL locally and confirm the error
  message is readable, then restore the correct URL.
- [ ] Check the Last Refresh Time.
- [ ] Test light mode and dark mode.
- [ ] Open the dashboard on a phone-sized screen.

## C. Charts

- [ ] Confirm only these four charts are shown:
  - Inventory Accuracy Trend
  - Bin Accuracy Trend
  - Facility-Wise Inventory Accuracy
  - NTF Trend
- [ ] Confirm chart values change when filters change.
- [ ] Confirm chart tooltips and labels are readable in light and dark modes.

## D. Inventory transactions

- [ ] Use Global Search with a SKU, item, rack, batch, and remark.
- [ ] Click several column headings and confirm sorting changes direction.
- [ ] Test the page buttons.
- [ ] Test each page-size option.
- [ ] Click **Export CSV**.
- [ ] Open the CSV and confirm it contains the currently filtered and searched
  transactions.

## E. Masters

- [ ] Run `testMasters()` in Apps Script.
- [ ] Confirm Bin Master is read-only.
- [ ] Confirm SKU Master is read-only.
- [ ] Test search, sorting, and pagination in both master tables.
- [ ] Confirm an empty Bin Master shows an empty-data message without breaking
  the SKU Master.

## F. Email report

- [ ] Set `Email To` in the Config sheet.
- [ ] Keep `Email Enabled` as `No` while previewing.
- [ ] Run `testEmailPreview()` and open the temporary HTML file created in
  Google Drive.
- [ ] Confirm title, date, KPI values, colours, generation time, and dashboard
  link are correct.
- [ ] Set `Email Enabled` to `Yes`.
- [ ] Run `sendInventoryEmail()` once manually.
- [ ] Confirm the To, CC, BCC, and subject values come from Config.
- [ ] Open the email in Gmail and Outlook if both are available.
- [ ] Return `Email Enabled` to the intended final value.

## G. Triggers and laptop-off operation

- [ ] Run `createRefreshTrigger()` after finalizing Auto Refresh Minutes.
- [ ] Run `createDailyEmailTrigger()` after finalizing Email Send Hour.
- [ ] In Apps Script, open **Triggers** from the left panel.
- [ ] Confirm one trigger calls `refreshDashboardCache`.
- [ ] Confirm one trigger calls `sendInventoryEmail`.
- [ ] In Apps Script, open **Executions** and confirm scheduled runs complete.
- [ ] Switch off the laptop for longer than the refresh interval.
- [ ] Later, check **Executions** and confirm the trigger ran while the laptop
  was off.

Google may run a daily time trigger at a consistent time within the selected
hour rather than at exactly the first minute of that hour.

## H. Zero-activity reason

- [ ] Choose a date with no inventory rows.
- [ ] Add that date, a supported reason, and a remark to `Activity_Status`.
- [ ] Refresh the dashboard and select the same date.
- [ ] Confirm the dashboard shows `No cycle count was performed`, the reason,
  and the remark.
- [ ] Run `testEmailPreview()` or send the report for a matching no-activity
  date and confirm the same reason and remark appear.

## I. Published dashboard

- [ ] Confirm the GitHub Actions workflow is green.
- [ ] Open `https://bjpatel90.github.io/Inventory_Visibility/`.
- [ ] Refresh the page and confirm it does not show a 404 error.
- [ ] Confirm browser requests return JSON, not a Google sign-in page.
- [ ] Confirm the dashboard still works after the local development server is
  stopped.

# Common errors

## `VITE_APPS_SCRIPT_URL is missing`

For local use, create `frontend/.env.local`. For GitHub Pages, add the repository
secret named exactly `VITE_APPS_SCRIPT_URL`, then rerun the workflow.

## Apps Script URL returns HTML instead of JSON

Confirm that:

- The URL ends in `/exec`, not `/dev`.
- The latest Apps Script version is deployed.
- The Web App access setting permits the browser request.
- The URL works directly with `?action=config`.

## GitHub Actions build fails during `npm ci`

Confirm that both `frontend/package.json` and `frontend/package-lock.json` were
committed and were not edited manually.

## GitHub Pages shows a blank page or missing files

Confirm:

- The repository name is exactly `Inventory_Visibility`.
- `frontend/vite.config.ts` contains
  `base: '/Inventory_Visibility/'`.
- **Settings > Pages > Source** is set to **GitHub Actions**.
- The latest workflow run completed successfully.

## Trigger did not run at the exact minute

Apps Script time-driven triggers can run within the selected time window. Check
**Executions** for the actual start time and any error message.

## Email was not sent

Confirm:

- `Email Enabled` is `Yes`.
- `Email To` contains a valid address.
- `sendInventoryEmail()` succeeds when run manually.
- The daily trigger exists.
- The Apps Script account has not exceeded its email quota.

# First-version scope

This release intentionally does not include a Node/Express backend, Docker,
editable master forms, role-management screens, Excel/PDF export, value-based
KPIs, or a materialized Combine sheet. Those features can be considered after
the first version is stable.
