# Inventory Health Dashboard — One-Page Process Note

## 1. Purpose

The Inventory Health Dashboard provides a single view of cycle-count accuracy,
bin completion, inventory differences, COGS impact, and ABC-class coverage. It
continues refreshing and sending scheduled reports through Google Apps Script
when the user's computer is switched off.

## 2. Process Flow

```text
Inventory Sheets + Q1 History + SKU Master + COGS + Activity Status
                              |
                              v
                 Google Apps Script processing
                              |
                +-------------+-------------+
                |                           |
                v                           v
       GitHub Pages Dashboard       Scheduled Email + QTD CSV
```

Google Sheets is the database. Google Apps Script combines and calculates the
data in Google's cloud. The React frontend is hosted separately on GitHub
Pages. No laptop, local server, Docker container, or physical Combine sheet is
required during normal operation.

## 3. Source and Master Data

| Data | Google Sheet | Owner action |
|---|---|---|
| Current cycle counts | `SL_AMBIENT`, `SL_MH`, `SL_RX`, `OWN`, `SL_B2C` | Enter or upload correctly dated inventory rows. Do not change the required headers. |
| Historical quarter | `Q1-AMJ26` | Maintain April–June 2026 history used for Last Quarter and past-date reporting. |
| SKU classification | `SKU_MASTER` | Maintain each SKU and enter `A`, `B`, or `C` in `ABC Class`. |
| Inventory cost | `COGS` | Maintain the SKU unit rate excluding GST. |
| No-count reason | `Activity_Status` | Enter Date, Reason, and Remark when no cycle count was performed. |
| Dashboard settings | `Config` | Maintain plans, refresh frequency, email recipients, email hour, theme, and dashboard URL. |

Blank or invalid ABC mappings remain visible as `Unclassified`. Rows without a
valid COGS rate remain in quantity reporting but are excluded from value totals
and reduce Cost Coverage.

## 4. Daily Operating Process

1. Warehouse users complete the cycle count and update the correct facility
   sheet with Date, Rack, SKU, Shelf, Batch, Physical Quantity, System Quantity,
   Difference, and Remark.
2. The master-data owner maintains missing ABC classifications in `SKU_MASTER`
   and missing unit rates in `COGS`.
3. Google Apps Script refreshes the dashboard cache automatically using the
   interval in `Config > Auto Refresh Minutes`.
4. Users open the dashboard, review the four period banners, and select a card
   to open its ABC quantity and COGS breakdown.
5. Users can select a Date and Facility, review detailed KPIs and transactions,
   search or sort the table, and download the selected rows as CSV.
6. Before sending the daily email, Apps Script reads fresh Sheet data. It sends
   Yesterday's report at the configured hour and attaches the quarter-to-date
   transaction CSV.

If urgent data was entered after the latest refresh, run
`refreshDashboardCache()` once from Apps Script and then refresh the dashboard.

After the first successful visit, the browser keeps the last successful KPI
snapshot. On later visits, the indicators appear immediately while fresh cloud
data loads in the background. A temporary Apps Script error shows a warning and
Retry button without removing the last available dashboard.

## 5. Main Reporting Rules

| Measure | Rule |
|---|---|
| Quantity Accuracy | `100 − (Total Absolute Quantity Difference ÷ System Quantity × 100)` |
| Value/COGS Accuracy | `100 − (Total Absolute Difference Value ÷ System Value × 100)` |
| Bin Accuracy | Accurate unique `Facility + Rack + Shelf` bins ÷ counted bins |
| Net Difference | Physical Quantity − System Quantity |
| Planned Bins | Daily plan from `Config`; MTD uses completed working days |
| Cycle Count Completion | Actual unique bins ÷ planned bins |
| NTF treatment | NTF means not found: Physical Quantity becomes zero and Difference becomes `0 − System Quantity` |
| ABC breakdown | Unique SKUs and total quantities/values grouped into A, B, C, Unclassified, and Total |

Accuracy colour rules are Red below 96%, Yellow from 96% to below 99%, and
Green from 99% upward. Negative quantities and values are displayed in
parentheses.

## 6. Reporting Periods and Outputs

- **Last Quarter:** Uses `Q1-AMJ26` for April–June 2026 history.
- **Last Month:** Calculated automatically from transaction dates.
- **Month to Date:** Calculated automatically from the first day of the current
  month through today.
- **Yesterday:** Calculated automatically for the previous calendar date.

Outputs include the KPI dashboard, expandable ABC quantity/COGS detail,
searchable inventory transactions, CSV download, scheduled HTML email, and a
quarter-to-date CSV email attachment. Dashboard Charts and frontend master
tables are currently disabled.

## 7. Exceptions and Checks

| Issue | Required action |
|---|---|
| Yesterday is zero despite data entry | Confirm the row Date, run `refreshDashboardCache()`, and refresh the browser. |
| No count was performed | Enter the date, supported reason, and remark in `Activity_Status`. |
| High Unclassified count | Match the SKU in `SKU_MASTER` and enter A, B, or C in `ABC Class`. |
| Low Cost Coverage | Add or correct the SKU unit rate in `COGS`. |
| Dashboard does not load | Confirm the Apps Script Web App deployment is active and accessible, then use Refresh. |
| Email is not sent | Check `Email Enabled`, recipients, send hour, Apps Script Triggers, and Executions. |

## 8. Key Links

- Dashboard: <https://bjpatel90.github.io/Inventory_Visibility/>
- Repository: <https://github.com/BJPATEL90/Inventory_Visibility>
- Spreadsheet: <https://docs.google.com/spreadsheets/d/1uB9hiqI8z46_fYxiB1syRwNNw0TM_ZV2NCYZcAVmWIk/edit>
- Detailed installation, calculation, testing, and troubleshooting guide:
  [README.md](README.md)
