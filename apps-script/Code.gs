/**
 * Inventory Health Dashboard - Google Apps Script backend
 *
 * Spreadsheet:
 * Inventory_Dashboard
 * 1uB9hiqI8z46_fYxiB1syRwNNw0TM_ZV2NCYZcAVmWIk
 *
 * This file:
 * 1. Creates Config and Activity_Status when they are missing.
 * 2. Reads the five inventory sheets without changing them.
 * 3. Combines inventory rows in memory.
 * 4. Calculates Last Quarter, Last Month, Month to Date, and Yesterday KPIs.
 * 5. Exposes a small JSON API.
 * 6. Creates a cloud refresh trigger.
 * 7. Provides test functions that print results in Apps Script logs.
 * 8. Sends the daily HTML email report from Google's cloud.
 * 9. Joins the read-only COGS sheet and calculates Version 2 value KPIs.
 * 10. Reads Q1-AMJ26 as read-only history for quarter and past-date reporting.
 * 11. Attaches quarter-to-date transaction data to every inventory email.
 */

const SPREADSHEET_ID = '1uB9hiqI8z46_fYxiB1syRwNNw0TM_ZV2NCYZcAVmWIk';
const B2C_SOURCE_SPREADSHEET_ID =
  '1_kBrwiM6ezFeE5kJFqeCMKcl7p_pe_XpNuVYhUmkUpw';
const B2C_SOURCE_SHEET_NAME = 'B2C';
const OWN_SOURCE_SHEET_NAME = 'OWN';

const SOURCE_SHEETS = [
  'SL_AMBIENT',
  'SL_MH',
  'SL_RX',
  'OWN',
  'B2C'
];

const INVENTORY_HEADERS = [
  'Date',
  'Rack',
  'Sku Code',
  'Item Name',
  'Shelf',
  'Batch',
  'Vendor Batch Number',
  'Pack',
  'Box',
  'Loose',
  'Phy',
  'Sys',
  'Diff',
  'Remark'
];

const COST_SHEET_NAME = 'COGS';
const SKU_MASTER_SHEET_NAME = 'SKU_Master';
const HISTORICAL_SHEET_NAME = 'Q1-AMJ26';
const HISTORICAL_START_DATE = '2026-04-01';
const HISTORICAL_END_DATE = '2026-06-30';
const DEFAULT_TRANSACTION_PAGE_SIZE = 25;
const MAX_TRANSACTION_PAGE_SIZE = 100;
const TRANSACTION_CACHE_PREFIX = 'inventory_transaction_page_v2_external_own_';
const TRANSACTION_CACHE_SECONDS = 600;
const COST_HEADERS = [
  'SKU',
  'Product Name',
  'Unit Rate (Excluding Gst)',
  'GST Rate'
];
const HISTORICAL_HEADERS = [
  'Facility',
  'Date',
  'Rack',
  "Sku's",
  'Item Name',
  'Shelf',
  'Batch',
  'Vendor Batch number',
  'Pack',
  'Box',
  'Loose',
  'Phy',
  'Sys',
  'Diff.',
  'Remarks',
  'Cogs/Unit'
];

// These values are written only when Config is first prepared.
// After setup, the application reads every setting from the Config sheet.
const CONFIG_DEFAULTS = [
  ['Dashboard Name', 'Inventory Health Dashboard'],
  ['Daily Planned Bin Count', 100],
  ['Working Days', 26],
  ['Auto Refresh Minutes', 30],
  ['Email Enabled', 'No'],
  ['Email To', ''],
  ['Email CC', ''],
  ['Email BCC', ''],
  ['Email Subject', 'Daily Inventory Health Report'],
  ['Email Send Hour', 9],
  ['Dashboard URL', 'https://bjpatel90.github.io/Inventory_Visibility/'],
  ['Theme', 'Light']
];

// Version 2 coverage settings are optional until setupApplication() is run.
// This keeps the existing V1 dashboard safe while V2 is tested locally.
const CYCLE_COVERAGE_CONFIG_DEFAULTS = [
  ['Coverage Cycle Start Date', '2026-07-01'],
  ['Coverage Cycle Months', 3],
  ['Inventory Import Minutes', 30],
  ['Inventory Change Alert %', 5],
  ['Inventory Email Sender', 'noreply@e.unicommerce.com'],
  [
    'Inventory Email Subject',
    'Export Job Complete - All facility Shelfwise Inventory'
  ],
  ['Inventory Export Name', 'Shelf inventory ALL 9AM']
];

const CYCLE_COVERAGE_SHEET_NAME = 'Cycle_Coverage_System';
const INVENTORY_IMPORT_HANDLER = 'importLatestInventoryEmail';
const INVENTORY_EMAIL_SEARCH_LIMIT = 100;
const COVERAGE_FACILITIES = [
  'SL_AMBIENT',
  'SL_MH',
  'SL_RX',
  'SL_MM',
  'SL_LJ',
  'SL_BW',
  'OWN'
];
const COVERAGE_ABC_CLASSES = ['A', 'B', 'C', 'Unclassified'];
const LATEST_COVERAGE_ABC_PROPERTY = 'LATEST_COVERAGE_ABC_OPENING_V1';
const INVENTORY_EXPORT_FACILITY_MAP = {
  'SL AMBIENT': 'SL_AMBIENT',
  'SL MOTHER HUB': 'SL_MH',
  'SL RX': 'SL_RX',
  'SL MM': 'SL_MM',
  'SLLJ': 'SL_LJ',
  'SL LJ': 'SL_LJ',
  'SL BW': 'SL_BW',
  'OWN': 'OWN'
};
const B2C_SOURCE_FACILITY_MAP = {
  'SL MM': 'SL_MM',
  'SL_MM': 'SL_MM',
  'SLLJ': 'SL_LJ',
  'SL LJ': 'SL_LJ',
  'SL_LJ': 'SL_LJ',
  'SL BW': 'SL_BW',
  'SL_BW': 'SL_BW'
};

const ACTIVITY_REASONS = [
  'Sunday',
  'Public Holiday',
  'Inventory Freeze',
  'System Issue',
  'Other'
];

const DASHBOARD_CACHE_KEY =
  'inventory_dashboard_v7_external_own_v1';
const LAST_REFRESH_PROPERTY = 'INVENTORY_LAST_REFRESH_TIME';
const LAST_EMAIL_SENT_PROPERTY = 'INVENTORY_LAST_EMAIL_SENT_TIME';
const LAST_EMAIL_REPORT_DATE_PROPERTY = 'INVENTORY_LAST_EMAIL_REPORT_DATE';
const REFRESH_HANDLER = 'refreshDashboardCache';
const EMAIL_HANDLER = 'sendInventoryEmail';
const EMAIL_SEND_MINUTE = 10;
const MAX_EMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

let TIME_ZONE_CACHE = '';

/**
 * Main Apps Script Web App endpoint.
 *
 * Examples:
 * ?action=dashboard
 * ?action=transactions
 * ?action=binMaster
 * ?action=skuMaster
 * ?action=config
 * ?action=activityStatus&date=2026-07-23
 */
function doGet(e) {
  try {
    const parameters = e && e.parameter ? e.parameter : {};
    const action = String(parameters.action || 'dashboard').toLowerCase();
    let data;

    if (action === 'transactionscsv') {
      return getTransactionsCsv(parameters);
    }

    if (action === 'dashboard') {
      data = getDashboardData();
    } else if (action === 'refreshdashboard') {
      data = refreshDashboardNow();
    } else if (action === 'transactions') {
      data = getTransactions(parameters);
    } else if (action === 'facilitydashboard') {
      data = getFacilityDashboard(parameters.facility || '');
    } else if (action === 'binmaster') {
      data = getBinMaster();
    } else if (action === 'skumaster') {
      data = getSkuMaster();
    } else if (action === 'config') {
      data = getConfig();
    } else if (action === 'session') {
      data = getSessionUser();
    } else if (action === 'activitystatus') {
      data = getActivityStatus(parameters.date || '');
    } else if (action === 'cyclecoverage') {
      data = getCycleCoverage(parameters.month || '');
    } else if (action === 'ensurecoverageautomation') {
      data = ensureCoverageAutomation();
    } else if (action === 'b2csourceaudit') {
      data = getB2cSourceAudit();
    } else if (action === 'facilitysourceaudit') {
      data = getFacilitySourceAudit(parameters.date || '');
    } else if (action === 'ownsourceaudit') {
      data = getOwnSourceAudit();
    } else {
      throw new Error(
        'Unknown action. Use dashboard, refreshDashboard, transactions, transactionsCsv, facilityDashboard, binMaster, skuMaster, config, session, activityStatus, cycleCoverage, ensureCoverageAutomation, b2cSourceAudit, facilitySourceAudit, or ownSourceAudit.'
      );
    }

    return jsonResponse_({
      success: true,
      data: data,
      lastRefreshTime: getLastRefreshTime_()
    });
  } catch (error) {
    console.error(error);
    return jsonResponse_({
      success: false,
      message: error && error.message
        ? error.message
        : 'Unable to read inventory data.'
    });
  }
}

/**
 * One-time application setup.
 *
 * This function creates or completes only Config and Activity_Status.
 * It does not edit SL_AMBIENT, SL_MH, SL_RX, OWN, or B2C.
 */
function setupApplication() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

  setupConfigSheet_(spreadsheet);
  setupActivityStatusSheet_(spreadsheet);
  setupCycleCoverageSheet_(spreadsheet);

  const triggerResult = createRefreshTrigger();
  const emailTriggerResult = createDailyEmailTrigger();
  const inventoryImportTriggerResult = createInventoryImportTrigger();
  const dashboard = refreshDashboardCache();

  const result = {
    message: 'Application setup completed successfully.',
    spreadsheetName: spreadsheet.getName(),
    refreshTrigger: triggerResult,
    dailyEmailTrigger: emailTriggerResult,
    inventoryImportTrigger: inventoryImportTriggerResult,
    combinedRowCount: dashboard.sourceSummary.combinedRowCount,
    rowsByFacility: dashboard.sourceSummary.rowsByFacility,
    skippedSourceSheets: dashboard.sourceSummary.skippedSourceSheets
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Reads every application setting from the Config sheet.
 */
function getConfig() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName('Config');

  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error(
      'Config is missing or empty. Run setupApplication() first.'
    );
  }

  const values = sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues();
  const firstHeader = cleanText_(values[0][0]);
  const secondHeader = cleanText_(values[0][1]);

  if (firstHeader !== 'Setting' || secondHeader !== 'Value') {
    throw new Error('Config must use the headers Setting and Value.');
  }

  const settings = {};

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const name = cleanText_(values[rowIndex][0]);
    if (name) {
      settings[name] = values[rowIndex][1];
    }
  }

  CONFIG_DEFAULTS.forEach(function (defaultRow) {
    if (!Object.prototype.hasOwnProperty.call(settings, defaultRow[0])) {
      throw new Error('Config is missing the setting: ' + defaultRow[0]);
    }
  });

  return {
    dashboardName: requiredTextSetting_(settings, 'Dashboard Name'),
    dailyPlannedBinCount: requiredNumberSetting_(
      settings,
      'Daily Planned Bin Count',
      0,
      null
    ),
    workingDays: requiredNumberSetting_(
      settings,
      'Working Days',
      0,
      31
    ),
    autoRefreshMinutes: requiredNumberSetting_(
      settings,
      'Auto Refresh Minutes',
      1,
      60
    ),
    emailEnabled:
      cleanText_(settings['Email Enabled']).toLowerCase() === 'yes',
    emailTo: cleanText_(settings['Email To']),
    emailCC: cleanText_(settings['Email CC']),
    emailBCC: cleanText_(settings['Email BCC']),
    emailSubject: requiredTextSetting_(settings, 'Email Subject'),
    emailSendHour: requiredNumberSetting_(
      settings,
      'Email Send Hour',
      0,
      23
    ),
    dashboardUrl: requiredTextSetting_(settings, 'Dashboard URL'),
    theme: requiredTextSetting_(settings, 'Theme'),
    coverageCycleStartDate: optionalDateSetting_(
      settings,
      'Coverage Cycle Start Date',
      '2026-07-01',
      spreadsheet.getSpreadsheetTimeZone()
    ),
    coverageCycleMonths: optionalNumberSetting_(
      settings,
      'Coverage Cycle Months',
      3,
      1,
      12
    ),
    inventoryImportMinutes: optionalNumberSetting_(
      settings,
      'Inventory Import Minutes',
      30,
      1,
      60
    ),
    inventoryChangeAlertPercent: optionalNumberSetting_(
      settings,
      'Inventory Change Alert %',
      5,
      0,
      100
    ),
    inventoryEmailSender: optionalTextSetting_(
      settings,
      'Inventory Email Sender',
      'noreply@e.unicommerce.com'
    ),
    inventoryEmailSubject: optionalTextSetting_(
      settings,
      'Inventory Email Subject',
      'Export Job Complete - All facility Shelfwise Inventory'
    ),
    inventoryExportName: optionalTextSetting_(
      settings,
      'Inventory Export Name',
      'Shelf inventory ALL 9AM'
    )
  };
}

/**
 * Returns the Google account identity visible to this Web App execution.
 *
 * Session.getActiveUser() identifies the person accessing a domain-controlled
 * deployment when the Web App runs as the accessing user. Some Apps Script
 * deployment modes intentionally hide the email; the frontend then shows a
 * neutral Authorized Google user label instead of guessing an identity.
 */
function getSessionUser() {
  const email = cleanText_(Session.getActiveUser().getEmail());

  return {
    name: email ? sessionDisplayName_(email) : 'Authorized Google user',
    email: email,
    identityAvailable: Boolean(email)
  };
}

/**
 * Combines the five source sheets into one in-memory array.
 *
 * Rules:
 * - Missing, empty, and header-only sheets are skipped.
 * - The first row is treated as the header.
 * - Blank rows are ignored.
 * - Facility is added from the source sheet name, except B2C.
 * - B2C uses its Facility column for SL_MM, SL_LJ, or SL_BW.
 * - The existing physical Combine sheet is not read or changed.
 *
 * The live source sheets use "Diff." while the requested logical name is
 * "Diff". Header matching ignores case, extra spaces, and periods so both work.
 */
function getCombinedData(
  optionalSpreadsheet,
  optionalCostMap,
  optionalAbcClassMap
) {
  const spreadsheet =
    optionalSpreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const combinedRows = [];
  const costMap = optionalCostMap || readCostMap_(spreadsheet);
  const abcClassMap = optionalAbcClassMap || {};
  const timeZone = getTimeZone_();
  const skippedB2cFacilityRows = [];
  const externalCycleSpreadsheet = SpreadsheetApp.openById(
    B2C_SOURCE_SPREADSHEET_ID
  );

  SOURCE_SHEETS.forEach(function (sheetName) {
    if (sheetName === B2C_SOURCE_SHEET_NAME) {
      const b2cResult = readB2cCombinedRows_(
        costMap,
        abcClassMap,
        timeZone,
        externalCycleSpreadsheet
      );
      Array.prototype.push.apply(combinedRows, b2cResult.rows);
      Array.prototype.push.apply(
        skippedB2cFacilityRows,
        b2cResult.skippedFacilityRowNumbers
      );
      return;
    }

    const sourceSpreadsheet = sheetName === OWN_SOURCE_SHEET_NAME
      ? externalCycleSpreadsheet
      : spreadsheet;
    const sheet = sourceSpreadsheet.getSheetByName(sheetName);

    if (!sheet || sheet.getLastRow() <= 1 || sheet.getLastColumn() === 0) {
      return;
    }

    const values = sheet
      .getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn())
      .getValues();
    const indexes = inventoryHeaderIndexes_(values[0], sheetName);

    for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex];

      if (inventoryRowIsBlank_(row, indexes)) {
        continue;
      }

      const facility = sourceFacilityName_(
        sheetName,
        indexes.Facility === undefined
          ? ''
          : row[indexes.Facility]
      );

      if (!facility) {
        continue;
      }

      const physicalQuantity = toNumber_(row[indexes['Phy']]);
      const systemQuantity = toNumber_(row[indexes['Sys']]);
      const rawDifference = row[indexes['Diff']];
      const difference = isBlank_(rawDifference)
        ? physicalQuantity - systemQuantity
        : toNumber_(rawDifference);
      const skuCode = cleanText_(row[indexes['Sku Code']]);
      const normalizedSku = normalizeSku_(skuCode);
      const costRecord =
        normalizedSku &&
        Object.prototype.hasOwnProperty.call(costMap, normalizedSku)
          ? costMap[normalizedSku]
          : null;
      const unitCost = costRecord ? costRecord.unitCost : null;
      const abcClass = normalizedSku && abcClassMap[normalizedSku]
        ? abcClassMap[normalizedSku]
        : 'C';

      combinedRows.push(normalizeNtfShortage_({
        id: sheetName + '-' + String(rowIndex + 1),
        sourceType: 'current',
        sourceSheet: sheetName,
        facility: facility,
        date: normalizeDate_(row[indexes['Date']], timeZone),
        rack: cleanText_(row[indexes['Rack']]),
        skuCode: skuCode,
        abcClass: abcClass,
        itemName: cleanText_(row[indexes['Item Name']]),
        shelf: cleanText_(row[indexes['Shelf']]),
        batch: cleanText_(row[indexes['Batch']]),
        vendorBatchNumber: cleanText_(
          row[indexes['Vendor Batch Number']]
        ),
        pack: toNumber_(row[indexes['Pack']]),
        box: toNumber_(row[indexes['Box']]),
        loose: toNumber_(row[indexes['Loose']]),
        physicalQuantity: physicalQuantity,
        systemQuantity: systemQuantity,
        difference: difference,
        costAvailable: unitCost !== null,
        unitCost: unitCost,
        gstRate: costRecord ? costRecord.gstRate : null,
        systemValue: unitCost === null
          ? null
          : round_(systemQuantity * unitCost, 2),
        physicalValue: unitCost === null
          ? null
          : round_(physicalQuantity * unitCost, 2),
        differenceValue: unitCost === null
          ? null
          : round_(difference * unitCost, 2),
        remark: cleanText_(row[indexes['Remark']])
      }));
    }
  });

  if (skippedB2cFacilityRows.length > 0) {
    console.warn(JSON.stringify({
      sourceSheet: 'B2C',
      reason: 'Blank or unsupported Facility value',
      skippedRowCount: skippedB2cFacilityRows.length,
      firstSkippedRowNumbers: skippedB2cFacilityRows.slice(0, 100)
    }));
  }

  return combinedRows;
}

/**
 * Reads the B2C parent tab from its separate cycle-count workbook.
 *
 * The operational B2C tab uses Total for System Quantity. Only Facility, Date,
 * Shelf, Total/Sys, and Phy are mandatory; descriptive quantity columns are
 * optional. Shelf is retained as the bin identifier when Rack is absent.
 */
function readB2cCombinedRows_(
  costMap,
  abcClassMap,
  timeZone,
  optionalSpreadsheet
) {
  const spreadsheet = optionalSpreadsheet ||
    SpreadsheetApp.openById(B2C_SOURCE_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(B2C_SOURCE_SHEET_NAME);

  if (!sheet || sheet.getLastRow() <= 1 || sheet.getLastColumn() === 0) {
    return {
      rows: [],
      skippedFacilityRowNumbers: []
    };
  }

  const values = sheet
    .getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn())
    .getValues();
  const indexes = b2cHeaderIndexes_(values[0]);
  const rows = [];
  const skippedFacilityRowNumbers = [];

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    if (row.every(isBlank_)) {
      continue;
    }

    const facility = sourceFacilityName_(
      B2C_SOURCE_SHEET_NAME,
      row[indexes.Facility]
    );
    if (!facility) {
      skippedFacilityRowNumbers.push(rowIndex + 1);
      continue;
    }

    const physicalQuantity = toNumber_(row[indexes.Phy]);
    const systemQuantity = toNumber_(row[indexes.Sys]);
    const rawDifference = b2cCell_(row, indexes.Diff);
    const difference = isBlank_(rawDifference)
      ? physicalQuantity - systemQuantity
      : toNumber_(rawDifference);
    const skuCode = cleanText_(b2cCell_(row, indexes['Sku Code']));
    const normalizedSku = normalizeSku_(skuCode);
    const costRecord = normalizedSku &&
      Object.prototype.hasOwnProperty.call(costMap, normalizedSku)
        ? costMap[normalizedSku]
        : null;
    const unitCost = costRecord ? costRecord.unitCost : null;
    const abcClass = normalizedSku && abcClassMap[normalizedSku]
      ? abcClassMap[normalizedSku]
      : 'C';

    rows.push({
      id: B2C_SOURCE_SHEET_NAME + '-' + String(rowIndex + 1),
      sourceType: 'current',
      sourceSheet: B2C_SOURCE_SHEET_NAME,
      facility: facility,
      date: normalizeDate_(row[indexes.Date], timeZone),
      rack: cleanText_(b2cCell_(row, indexes.Rack)),
      skuCode: skuCode,
      abcClass: abcClass,
      itemName: cleanText_(b2cCell_(row, indexes['Item Name'])),
      shelf: cleanText_(row[indexes.Shelf]),
      batch: cleanText_(b2cCell_(row, indexes.Batch)),
      vendorBatchNumber: cleanText_(
        b2cCell_(row, indexes['Vendor Batch Number'])
      ),
      pack: toNumber_(b2cCell_(row, indexes.Pack)),
      box: toNumber_(b2cCell_(row, indexes.Box)),
      loose: toNumber_(b2cCell_(row, indexes.Loose)),
      physicalQuantity: physicalQuantity,
      systemQuantity: systemQuantity,
      difference: difference,
      costAvailable: unitCost !== null,
      unitCost: unitCost,
      gstRate: costRecord ? costRecord.gstRate : null,
      systemValue: unitCost === null
        ? null
        : round_(systemQuantity * unitCost, 2),
      physicalValue: unitCost === null
        ? null
        : round_(physicalQuantity * unitCost, 2),
      differenceValue: unitCost === null
        ? null
        : round_(difference * unitCost, 2),
      remark: cleanText_(b2cCell_(row, indexes.Remark))
    });
  }

  return {
    rows: rows,
    skippedFacilityRowNumbers: skippedFacilityRowNumbers
  };
}

/**
 * Reads the Q1-AMJ26 historical sheet without changing it.
 *
 * Historical dates are used by Last Quarter, Last Month, and past-date
 * transaction filtering. The sheet's own Cogs/Unit is preferred so historical
 * values do not change when the current COGS master is updated.
 */
function getHistoricalData(
  optionalSpreadsheet,
  optionalCostMap,
  optionalAbcClassMap
) {
  const spreadsheet =
    optionalSpreadsheet || SpreadsheetApp.openById(SPREADSHEET_ID);
  const costMap = optionalCostMap || readCostMap_(spreadsheet);
  const abcClassMap = optionalAbcClassMap || {};
  const sheet = findSheetIgnoreCase_(
    spreadsheet,
    HISTORICAL_SHEET_NAME
  );
  const historicalRows = [];

  if (!sheet || sheet.getLastRow() <= 1 || sheet.getLastColumn() === 0) {
    return historicalRows;
  }

  const values = sheet
    .getRange(1, 1, sheet.getLastRow(), HISTORICAL_HEADERS.length)
    .getValues();
  const indexes = historicalHeaderIndexes_(values[0], sheet.getName());
  const timeZone = getTimeZone_();

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];

    if (HISTORICAL_HEADERS.every(function (header) {
      return isBlank_(row[indexes[header]]);
    })) {
      continue;
    }

    const skuCode = cleanText_(row[indexes["Sku's"]]);
    const normalizedSku = normalizeSku_(skuCode);
    const currentCostRecord =
      normalizedSku &&
      Object.prototype.hasOwnProperty.call(costMap, normalizedSku)
        ? costMap[normalizedSku]
        : null;
    const historicalUnitCost = optionalNumber_(
      row[indexes['Cogs/Unit']]
    );
    const unitCost = historicalUnitCost !== null &&
      historicalUnitCost >= 0
      ? historicalUnitCost
      : currentCostRecord
        ? currentCostRecord.unitCost
        : null;
    const abcClass = normalizedSku && abcClassMap[normalizedSku]
      ? abcClassMap[normalizedSku]
      : 'C';
    const physicalQuantity = toNumber_(row[indexes['Phy']]);
    const systemQuantity = toNumber_(row[indexes['Sys']]);
    const rawDifference = row[indexes['Diff.']];
    const difference = isBlank_(rawDifference)
      ? physicalQuantity - systemQuantity
      : toNumber_(rawDifference);

    historicalRows.push(normalizeNtfShortage_({
      id: HISTORICAL_SHEET_NAME + '-' + String(rowIndex + 1),
      sourceType: 'historical',
      facility: normalizeFacility_(row[indexes['Facility']]),
      date: normalizeDate_(row[indexes['Date']], timeZone),
      rack: cleanText_(row[indexes['Rack']]),
      skuCode: skuCode,
      abcClass: abcClass,
      itemName: cleanText_(row[indexes['Item Name']]),
      shelf: cleanText_(row[indexes['Shelf']]),
      batch: cleanText_(row[indexes['Batch']]),
      vendorBatchNumber: cleanText_(
        row[indexes['Vendor Batch number']]
      ),
      pack: toNumber_(row[indexes['Pack']]),
      box: toNumber_(row[indexes['Box']]),
      loose: toNumber_(row[indexes['Loose']]),
      physicalQuantity: physicalQuantity,
      systemQuantity: systemQuantity,
      difference: difference,
      costAvailable: unitCost !== null,
      unitCost: unitCost,
      gstRate: currentCostRecord ? currentCostRecord.gstRate : null,
      systemValue: unitCost === null
        ? null
        : round_(systemQuantity * unitCost, 2),
      physicalValue: unitCost === null
        ? null
        : round_(physicalQuantity * unitCost, 2),
      differenceValue: unitCost === null
        ? null
        : round_(difference * unitCost, 2),
      remark: cleanText_(row[indexes['Remarks']])
    }));
  }

  return historicalRows;
}

/**
 * Reads current and historical inventory with one spreadsheet connection.
 */
function getAllInventoryData_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const costMap = readCostMap_(spreadsheet);
  const abcClassMap = readAbcClassMap_(spreadsheet);
  const currentRows = getCombinedData(
    spreadsheet,
    costMap,
    abcClassMap
  );
  const historicalRows = getHistoricalData(
    spreadsheet,
    costMap,
    abcClassMap
  );

  return {
    currentRows: currentRows,
    historicalRows: historicalRows,
    allRows: currentRows.concat(historicalRows),
    abcClassMap: abcClassMap
  };
}

/**
 * Returns one small, server-side page of transactions plus its KPI summary.
 *
 * Supported parameters:
 * startDate, endDate, facility, page, pageSize, search, sortKey,
 * sortDirection, and includeUndatedNtf.
 *
 * The old API returned every current and historical row in one response. That
 * eventually exceeded the practical Web App response time. This paginated
 * response keeps the dashboard fast while preserving the same calculations.
 */
function getTransactions(optionalParameters) {
  const parameters = optionalParameters || {};
  const cacheKey = transactionCacheKey_(parameters);
  const cache = CacheService.getScriptCache();
  const cachedText = cache.get(cacheKey);

  if (cachedText) {
    try {
      return JSON.parse(cachedText);
    } catch (error) {
      console.warn('A transaction page cache entry was invalid.');
    }
  }

  const result = buildTransactionsResponse_(parameters);
  cacheTransactionResponse_(cacheKey, result);
  return result;
}

/**
 * Safely prepares only the V2 cycle-coverage feature for testing.
 *
 * Unlike setupApplication(), this function does not create a dashboard refresh
 * trigger or a daily report email trigger. It therefore avoids duplicate V1
 * emails when V2 is tested from a separate Apps Script project.
 */
function setupCycleCoverageV2() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

  setupConfigSheet_(spreadsheet);
  const sheet = setupCycleCoverageSheet_(spreadsheet);
  const inventoryImportTrigger = createInventoryImportTrigger();
  const result = {
    prepared: true,
    spreadsheetName: spreadsheet.getName(),
    systemSheetName: sheet.getName(),
    systemSheetHidden: sheet.isSheetHidden(),
    inventoryImportTrigger: inventoryImportTrigger,
    dailyEmailTriggerCreated: false,
    dashboardRefreshTriggerCreated: false
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Corrects the 2026 Q2 coverage window and recalculates stored snapshots.
 *
 * Run this once in the existing V2 test project. It changes only the two
 * coverage-cycle Config values and the calculated fields in the hidden system
 * sheet. Inventory source sheets are never edited.
 */
function setQ2CoverageCycle2026() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const configSheet = setupConfigSheet_(spreadsheet);
  setConfigValue_(configSheet, 'Coverage Cycle Start Date', '2026-07-01');
  setConfigValue_(configSheet, 'Coverage Cycle Months', 3);
  SpreadsheetApp.flush();

  const coverageSheet = setupCycleCoverageSheet_(spreadsheet);
  const inventoryData = getAllInventoryData_();
  const coverage = refreshCycleCoverageSystem_(
    inventoryData.currentRows,
    coverageSheet
  );
  const result = {
    updated: true,
    quarter: 'Q2',
    cycleStartDate: '2026-07-01',
    cycleEndDate: '2026-09-30',
    storedSnapshotCount: coverage.rowCount,
    latestCoverage: coverage.latest
      ? {
          date: coverage.latest.date,
          totalCumulativeCountedQuantity:
            coverage.latest.totalCumulativeCountedQuantity,
          totalCompletionPercent:
            coverage.latest.totalCompletionPercent
        }
      : null
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Removes only the V2 Gmail import trigger from the current script project. */
function removeCycleCoverageV2Trigger() {
  let removedCount = 0;

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === INVENTORY_IMPORT_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
      removedCount += 1;
    }
  });

  const result = {
    removed: true,
    handler: INVENTORY_IMPORT_HANDLER,
    removedTriggerCount: removedCount
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Builds one transaction page from either fresh or already-read inventory.
 */
function buildTransactionsResponse_(parameters, optionalInventoryData) {
  const selection = buildTransactionSelection_(
    parameters,
    optionalInventoryData
  );
  const page = positiveIntegerParameter_(parameters.page, 1);
  const requestedPageSize = positiveIntegerParameter_(
    parameters.pageSize,
    DEFAULT_TRANSACTION_PAGE_SIZE
  );
  const pageSize = Math.min(
    requestedPageSize,
    MAX_TRANSACTION_PAGE_SIZE
  );
  const pageCount = Math.max(
    1,
    Math.ceil(selection.tableRows.length / pageSize)
  );
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const periodKey = selection.singleDate
    ? 'yesterday'
    : 'monthToDate';

  return {
    rows: selection.tableRows.slice(pageStart, pageStart + pageSize),
    totalRows: selection.tableRows.length,
    selectedRowCount: selection.selectedRows.length,
    page: safePage,
    pageSize: pageSize,
    pageCount: pageCount,
    startDate: selection.startDate,
    endDate: selection.endDate,
    facility: selection.facility,
    facilities: selection.facilities,
    kpis: calculateKpis(selection.selectedRows, {
      periodKey: periodKey,
      startDate: selection.startDate,
      endDate: selection.endDate,
      config: selection.config
    })
  };
}

/**
 * Returns the four fixed KPI periods recalculated for one facility.
 *
 * This small summary endpoint is called only when the Facility filter changes,
 * so the frontend never needs all historical transaction rows for its banners.
 */
function getFacilityDashboard(facility) {
  const requestedFacility = cleanText_(facility);

  if (!requestedFacility) {
    return getDashboardData();
  }

  return buildDashboard_(getAllInventoryData_(), {
    facility: requestedFacility
  });
}

/**
 * Creates the filtered CSV used by the transaction table Export button.
 *
 * CSV generation is deliberately separate from the initial JSON request. A
 * large file is therefore generated only when the user explicitly downloads
 * it, instead of blocking every dashboard visit.
 */
function getTransactionsCsv(optionalParameters) {
  const selection = buildTransactionSelection_(optionalParameters || {});
  const columns = transactionCsvColumns_();
  const csvLines = [columns.map(function (column) {
    return csvCell_(column[0]);
  }).join(',')];

  selection.tableRows.forEach(function (row) {
    csvLines.push(columns.map(function (column) {
      return csvCell_(column[1](row));
    }).join(','));
  });

  return ContentService
    .createTextOutput('\uFEFF' + csvLines.join('\r\n'))
    .setMimeType(ContentService.MimeType.CSV);
}

/**
 * Reads, filters, searches, and sorts the rows shared by JSON and CSV output.
 */
function buildTransactionSelection_(parameters, optionalInventoryData) {
  const range = transactionRangeFromParameters_(parameters);
  const facility = cleanText_(parameters.facility);
  const includeUndatedNtf =
    String(parameters.includeUndatedNtf || '').toLowerCase() === 'true';
  let currentRows;
  let historicalRows;

  if (optionalInventoryData) {
    currentRows = optionalInventoryData.currentRows;
    historicalRows = dateRangesOverlap_(
      range.startDate,
      range.endDate,
      HISTORICAL_START_DATE,
      HISTORICAL_END_DATE
    )
      ? optionalInventoryData.historicalRows
      : [];
  } else {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const costMap = readCostMap_(spreadsheet);
    currentRows = getCombinedData(spreadsheet, costMap);
    historicalRows = dateRangesOverlap_(
      range.startDate,
      range.endDate,
      HISTORICAL_START_DATE,
      HISTORICAL_END_DATE
    )
      ? getHistoricalData(spreadsheet, costMap)
      : [];
  }
  const availableRows = currentRows.concat(historicalRows);
  const selectedRows = availableRows.filter(function (row) {
    const datedMatch = row.date &&
      row.date >= range.startDate &&
      row.date <= range.endDate;
    const undatedNtfMatch = includeUndatedNtf &&
      row.sourceType === 'current' &&
      !row.date &&
      isNtfRow_(row);

    return (datedMatch || undatedNtfMatch) &&
      (!facility || row.facility === facility);
  });
  const searchText = cleanText_(parameters.search).toLowerCase();
  const searchedRows = searchText
    ? selectedRows.filter(function (row) {
        return transactionSearchText_(row).indexOf(searchText) >= 0;
      })
    : selectedRows.slice();
  const sortKey = validTransactionSortKey_(parameters.sortKey);
  const sortDirection = String(parameters.sortDirection).toLowerCase() === 'asc'
    ? 'asc'
    : 'desc';

  searchedRows.sort(function (first, second) {
    return compareTransactionRows_(
      first,
      second,
      sortKey,
      sortDirection
    );
  });

  return {
    config: getConfig(),
    startDate: range.startDate,
    endDate: range.endDate,
    singleDate: range.startDate === range.endDate,
    facility: facility,
    facilities: uniqueTexts_(currentRows.map(function (row) {
      return row.facility;
    })),
    selectedRows: selectedRows,
    tableRows: searchedRows
  };
}

/**
 * Uses Month to Date when the API caller does not provide an explicit range.
 */
function transactionRangeFromParameters_(parameters) {
  const defaultRange = reportingRanges_().monthToDate;
  const startDate = cleanText_(parameters.startDate) || defaultRange.startDate;
  const endDate = cleanText_(parameters.endDate) || defaultRange.endDate;

  if (!parseIsoDate_(startDate) || !parseIsoDate_(endDate)) {
    throw new Error(
      'Transaction dates must use yyyy-MM-dd format.'
    );
  }

  if (startDate > endDate) {
    throw new Error(
      'Transaction startDate cannot be after endDate.'
    );
  }

  return {
    startDate: startDate,
    endDate: endDate
  };
}

/**
 * Returns true when two inclusive ISO date ranges overlap.
 */
function dateRangesOverlap_(firstStart, firstEnd, secondStart, secondEnd) {
  return firstStart <= secondEnd && firstEnd >= secondStart;
}

/**
 * Converts one query parameter to a safe positive whole number.
 */
function positiveIntegerParameter_(value, fallback) {
  const number = Number(value);
  return isFinite(number) && number >= 1
    ? Math.floor(number)
    : fallback;
}

/**
 * Creates a short stable cache key for one transaction page request.
 */
function transactionCacheKey_(parameters) {
  const keyText = [
    cleanText_(parameters.startDate),
    cleanText_(parameters.endDate),
    cleanText_(parameters.facility),
    positiveIntegerParameter_(parameters.page, 1),
    Math.min(
      positiveIntegerParameter_(
        parameters.pageSize,
        DEFAULT_TRANSACTION_PAGE_SIZE
      ),
      MAX_TRANSACTION_PAGE_SIZE
    ),
    cleanText_(parameters.search).toLowerCase(),
    validTransactionSortKey_(parameters.sortKey),
    String(parameters.sortDirection).toLowerCase() === 'asc'
      ? 'asc'
      : 'desc',
    String(parameters.includeUndatedNtf).toLowerCase() === 'true'
      ? 'true'
      : 'false'
  ].join('|');
  let hash = 2166136261;

  for (let index = 0; index < keyText.length; index += 1) {
    hash ^= keyText.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return TRANSACTION_CACHE_PREFIX +
    (hash >>> 0).toString(36) +
    '_' +
    keyText.length;
}

/**
 * Stores one small JSON page when it fits safely inside Apps Script Cache.
 */
function cacheTransactionResponse_(cacheKey, result) {
  const responseText = JSON.stringify(result);

  if (responseText.length <= 90000) {
    CacheService.getScriptCache().put(
      cacheKey,
      responseText,
      TRANSACTION_CACHE_SECONDS
    );
  }
}

/**
 * Creates the case-insensitive text searched by the transaction table.
 */
function transactionSearchText_(row) {
  return [
    row.date,
    row.facility,
    row.rack,
    row.skuCode,
    row.itemName,
    row.shelf,
    row.batch,
    row.vendorBatchNumber,
    row.unitCost,
    row.systemQuantity,
    row.physicalQuantity,
    row.difference,
    row.systemValue,
    row.physicalValue,
    row.differenceValue,
    row.remark
  ].join(' ').toLowerCase();
}

/**
 * Allows sorting only by transaction fields exposed by the table.
 */
function validTransactionSortKey_(requestedKey) {
  const allowedKeys = [
    'date',
    'facility',
    'rack',
    'skuCode',
    'itemName',
    'shelf',
    'batch',
    'vendorBatchNumber',
    'unitCost',
    'systemQuantity',
    'physicalQuantity',
    'difference',
    'systemValue',
    'physicalValue',
    'differenceValue',
    'remark'
  ];
  const key = cleanText_(requestedKey);
  return allowedKeys.indexOf(key) >= 0 ? key : 'date';
}

/**
 * Compares two transaction values for server-side table sorting.
 */
function compareTransactionRows_(first, second, sortKey, direction) {
  const firstValue = first[sortKey];
  const secondValue = second[sortKey];
  let comparison = 0;

  if (firstValue === null && secondValue !== null) {
    comparison = 1;
  } else if (firstValue !== null && secondValue === null) {
    comparison = -1;
  } else if (
    typeof firstValue === 'number' &&
    typeof secondValue === 'number'
  ) {
    comparison = firstValue - secondValue;
  } else {
    comparison = String(firstValue || '').localeCompare(
      String(secondValue || ''),
      undefined,
      { numeric: true, sensitivity: 'base' }
    );
  }

  if (comparison === 0) {
    comparison = String(first.id).localeCompare(String(second.id));
  }

  return direction === 'asc' ? comparison : 0 - comparison;
}

/**
 * Returns unique nonblank text values in natural sort order.
 */
function uniqueTexts_(values) {
  const unique = {};

  values.forEach(function (value) {
    const text = cleanText_(value);
    if (text) {
      unique[text] = true;
    }
  });

  return Object.keys(unique).sort(function (first, second) {
    return first.localeCompare(second, undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });
}

/**
 * Defines the columns shared by table CSV export and email audit files.
 */
function transactionCsvColumns_() {
  return [
    ['Date', function (row) { return row.date; }],
    ['Facility', function (row) { return row.facility; }],
    ['Rack', function (row) { return row.rack; }],
    ['SKU', function (row) { return row.skuCode; }],
    ['Item Name', function (row) { return row.itemName; }],
    ['Shelf', function (row) { return row.shelf; }],
    ['Batch', function (row) { return row.batch; }],
    ['Vendor Batch', function (row) { return row.vendorBatchNumber; }],
    ['Unit Cost', function (row) { return csvOptionalNumber_(row.unitCost); }],
    ['System Quantity', function (row) { return row.systemQuantity; }],
    ['Physical Quantity', function (row) { return row.physicalQuantity; }],
    ['Difference', function (row) { return row.difference; }],
    ['System Value', function (row) {
      return csvOptionalNumber_(row.systemValue);
    }],
    ['Physical Value', function (row) {
      return csvOptionalNumber_(row.physicalValue);
    }],
    ['Difference Value', function (row) {
      return csvOptionalNumber_(row.differenceValue);
    }],
    ['Remark', function (row) { return row.remark; }]
  ];
}

/**
 * Returns the Bin_Master sheet as read-only API rows.
 *
 * Expected sheet columns:
 * Facility, Rack, Bin, Status
 *
 * A missing or header-only sheet safely returns an empty array.
 */
function getBinMaster() {
  return readMasterSheet_(
    'Bin_Master',
    ['Facility', 'Rack', 'Bin', 'Status'],
    ['facility', 'rack', 'bin', 'status']
  );
}

/**
 * Returns the SKU_MASTER sheet as read-only API rows.
 *
 * Expected sheet columns:
 * SKU, Item Name, Brand, Category, Pack Size, ABC Class
 *
 * Sheet-name matching is case-insensitive so SKU_MASTER and SKU_Master work.
 */
function getSkuMaster() {
  return readMasterSheet_(
    SKU_MASTER_SHEET_NAME,
    [
      'SKU',
      'Item Name',
      'Brand',
      'Category',
      'Pack Size',
      'ABC Class'
    ],
    [
      'sku',
      'itemName',
      'brand',
      'category',
      'packSize',
      'abcClass'
    ]
  );
}

/**
 * Calculates ABC-class quantity and COGS summaries for one reporting period.
 *
 * SKU_MASTER supplies A, B, or C by SKU. Missing or invalid mappings default
 * to C so no inventory is silently omitted. Quantity accuracy uses
 * absolute quantity difference. Value accuracy uses absolute difference value
 * for rows that have a valid COGS rate excluding GST.
 */
function calculateAbcBreakdown(inventoryRows) {
  const rows = Array.isArray(inventoryRows) ? inventoryRows : [];
  const classOrder = ['A', 'B', 'C', 'Unclassified'];
  const buckets = {};

  classOrder.forEach(function (abcClass) {
    buckets[abcClass] = newAbcBucket_(abcClass);
  });

  rows.forEach(function (row) {
    const abcClass = normalizeAbcClass_(row.abcClass);
    const bucket = buckets[abcClass];
    const sku = normalizeSku_(row.skuCode);
    const systemQuantity = toNumber_(row.systemQuantity);
    const physicalQuantity = isNtfRow_(row)
      ? 0
      : toNumber_(row.physicalQuantity);
    const difference = isNtfRow_(row)
      ? 0 - systemQuantity
      : toNumber_(row.difference);
    const unitCost = optionalNumber_(row.unitCost);

    if (sku) {
      bucket.skus[sku] = true;
    }

    bucket.rowCount += 1;
    bucket.systemQuantity += systemQuantity;
    bucket.physicalQuantity += physicalQuantity;
    bucket.absoluteDifference += Math.abs(difference);
    if (difference < 0) {
      bucket.shortQuantity += Math.abs(difference);
    } else if (difference > 0) {
      bucket.excessQuantity += difference;
    }

    if (unitCost !== null && unitCost >= 0) {
      bucket.costedRowCount += 1;
      if (sku) {
        bucket.costedSkus[sku] = true;
      }
      bucket.systemValue += systemQuantity * unitCost;
      bucket.physicalValue += physicalQuantity * unitCost;
      bucket.absoluteDifferenceValue += Math.abs(difference) * unitCost;
      if (difference < 0) {
        bucket.shortValue += Math.abs(difference) * unitCost;
      } else if (difference > 0) {
        bucket.excessValue += difference * unitCost;
      }
    }
  });

  const classRows = classOrder.map(function (abcClass) {
    return finishAbcBucket_(buckets[abcClass]);
  });
  const totalBucket = newAbcBucket_('Total');

  classOrder.forEach(function (abcClass) {
    mergeAbcBucket_(totalBucket, buckets[abcClass]);
  });

  return {
    classes: classRows,
    total: finishAbcBucket_(totalBucket),
    mappedSkuCount: countMappedAbcSkus_(classRows),
    unclassifiedSkuCount:
      classRows[classRows.length - 1].uniqueSkuCount
  };
}

/**
 * Calculates quantity and Version 2 value KPIs from combined inventory rows.
 *
 * A bin is Facility + Rack + Shelf.
 * A bin is accurate when its total Difference is zero.
 * Value KPIs use the COGS Unit Rate (Excluding Gst).
 * Rows without a matching cost are excluded from value totals and counted in
 * the cost-coverage diagnostics.
 */
function calculateKpis(inventoryRows, options) {
  const rows = Array.isArray(inventoryRows) ? inventoryRows : [];
  const calculationOptions = options || {};
  const config = calculationOptions.config || getConfig();

  let systemQuantity = 0;
  let physicalQuantity = 0;
  let absoluteDifference = 0;
  let shortQuantity = 0;
  let excessQuantity = 0;
  let systemValue = 0;
  let physicalValue = 0;
  let shortValue = 0;
  let excessValue = 0;
  let costedRowCount = 0;
  let missingCostRowCount = 0;
  const binDifferences = {};
  const missingCostSkus = {};

  rows.forEach(function (row) {
    const system = toNumber_(row.systemQuantity);
    const ntfRow = isNtfRow_(row);
    const physical = ntfRow
      ? 0
      : toNumber_(row.physicalQuantity);
    const difference = ntfRow
      ? 0 - system
      : toNumber_(row.difference);
    const unitCost = optionalNumber_(row.unitCost);

    systemQuantity += system;
    physicalQuantity += physical;
    absoluteDifference += Math.abs(difference);

    if (difference < 0) {
      shortQuantity += Math.abs(difference);
    }

    if (difference > 0) {
      excessQuantity += difference;
    }

    if (unitCost !== null && unitCost >= 0) {
      costedRowCount += 1;
      systemValue += system * unitCost;
      physicalValue += physical * unitCost;

      if (difference < 0) {
        shortValue += Math.abs(difference) * unitCost;
      }

      if (difference > 0) {
        excessValue += difference * unitCost;
      }
    } else {
      missingCostRowCount += 1;
      const missingSku = normalizeSku_(row.skuCode);
      if (missingSku) {
        missingCostSkus[missingSku] = true;
      }
    }

    const binKey = binKey_(row);
    if (binKey) {
      binDifferences[binKey] =
        (binDifferences[binKey] || 0) + difference;
    }
  });

  const binKeys = Object.keys(binDifferences);
  const actualBinCount = binKeys.length;
  const accurateBinCount = binKeys.filter(function (binKey) {
    return Math.abs(binDifferences[binKey]) < 0.000001;
  }).length;

  const inventoryAccuracy = systemQuantity === 0
    ? 0
    : 100 - (absoluteDifference / systemQuantity) * 100;
  const binAccuracy = actualBinCount === 0
    ? 0
    : (accurateBinCount / actualBinCount) * 100;
  const plannedBinCount = plannedBinCount_(calculationOptions, config);
  const completion = plannedBinCount === 0
    ? 0
    : (actualBinCount / plannedBinCount) * 100;
  const costCoverage = rows.length === 0
    ? 0
    : (costedRowCount / rows.length) * 100;
  const absoluteDifferenceValue = shortValue + excessValue;
  const valueAccuracy = systemValue === 0
    ? 0
    : 100 - (absoluteDifferenceValue / systemValue) * 100;

  return {
    inventoryAccuracy: round_(inventoryAccuracy, 2),
    inventoryAccuracyStyle: getAccuracyStyle(inventoryAccuracy),
    valueAccuracy: round_(valueAccuracy, 2),
    valueAccuracyStyle: getAccuracyStyle(valueAccuracy),
    binAccuracy: round_(binAccuracy, 2),
    binAccuracyStyle: getAccuracyStyle(binAccuracy),
    systemQuantity: round_(systemQuantity, 2),
    physicalQuantity: round_(physicalQuantity, 2),
    netDifference: round_(physicalQuantity - systemQuantity, 2),
    shortQuantity: round_(shortQuantity, 2),
    excessQuantity: round_(excessQuantity, 2),
    systemValue: round_(systemValue, 2),
    physicalValue: round_(physicalValue, 2),
    totalInventoryValue: round_(systemValue, 2),
    netDifferenceValue: round_(physicalValue - systemValue, 2),
    absoluteDifferenceValue: round_(absoluteDifferenceValue, 2),
    shortValue: round_(shortValue, 2),
    excessValue: round_(excessValue, 2),
    costCoverage: round_(costCoverage, 2),
    costedRowCount: costedRowCount,
    missingCostRowCount: missingCostRowCount,
    missingCostSkuCount: Object.keys(missingCostSkus).length,
    plannedBinCount: round_(plannedBinCount, 2),
    actualBinCount: actualBinCount,
    cycleCountCompletion: round_(completion, 2)
  };
}

/**
 * Calculates the four chart datasets for the selected transaction range.
 *
 * Returning these small datasets from Apps Script means the browser no longer
 * needs thousands of raw rows just to draw the dashboard charts.
 */
function calculateCharts(inventoryRows) {
  const rows = Array.isArray(inventoryRows) ? inventoryRows : [];
  const rowsByDate = {};
  const rowsByFacility = {};

  rows.forEach(function (row) {
    if (row.date) {
      rowsByDate[row.date] = rowsByDate[row.date] || [];
      rowsByDate[row.date].push(row);
    }

    if (row.facility) {
      rowsByFacility[row.facility] = rowsByFacility[row.facility] || [];
      rowsByFacility[row.facility].push(row);
    }
  });

  const dates = Object.keys(rowsByDate).sort();
  const facilities = Object.keys(rowsByFacility).sort(function (
    first,
    second
  ) {
    return first.localeCompare(second, undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });
  const inventoryAccuracyValues = dates.map(function (date) {
    return inventoryAccuracyForRows_(rowsByDate[date]);
  });

  return {
    inventoryAccuracyTrend: {
      categories: dates,
      values: inventoryAccuracyValues,
      pointColors: inventoryAccuracyValues.map(function (value) {
        return getAccuracyStyle(value).indicator;
      })
    },
    binAccuracyTrend: {
      categories: dates,
      values: dates.map(function (date) {
        return binAccuracyForRows_(rowsByDate[date]);
      })
    },
    facilityInventoryAccuracy: {
      categories: facilities,
      values: facilities.map(function (facility) {
        return inventoryAccuracyForRows_(rowsByFacility[facility]);
      }),
      pointColors: facilities.map(function (facility) {
        return getAccuracyStyle(
          inventoryAccuracyForRows_(rowsByFacility[facility])
        ).indicator;
      })
    },
    ntfTrend: {
      categories: dates,
      values: dates.map(function (date) {
        return rowsByDate[date].filter(isNtfRow_).length;
      })
    }
  };
}

/**
 * Calculates quantity accuracy for one chart group.
 */
function inventoryAccuracyForRows_(rows) {
  let systemQuantity = 0;
  let absoluteDifference = 0;

  rows.forEach(function (row) {
    const system = toNumber_(row.systemQuantity);
    const difference = isNtfRow_(row)
      ? 0 - system
      : toNumber_(row.difference);
    systemQuantity += system;
    absoluteDifference += Math.abs(difference);
  });

  return round_(
    systemQuantity === 0
      ? 0
      : 100 - (absoluteDifference / systemQuantity) * 100,
    2
  );
}

/**
 * Calculates bin accuracy for one chart group.
 */
function binAccuracyForRows_(rows) {
  const binDifferences = {};

  rows.forEach(function (row) {
    const key = binKey_(row);
    if (!key) {
      return;
    }

    const difference = isNtfRow_(row)
      ? 0 - toNumber_(row.systemQuantity)
      : toNumber_(row.difference);
    binDifferences[key] = (binDifferences[key] || 0) + difference;
  });

  const keys = Object.keys(binDifferences);
  if (keys.length === 0) {
    return 0;
  }

  const accurateBins = keys.filter(function (key) {
    return Math.abs(binDifferences[key]) < 0.000001;
  }).length;
  return round_((accurateBins / keys.length) * 100, 2);
}

/**
 * Identifies one NTF row from Rack, Shelf, or Remark.
 *
 * Checking all three fields preserves the original Remark behaviour while
 * supporting the Rack and Shelf markers used in the source sheets. A row is
 * evaluated once, so repeated NTF text does not double-count it.
 */
function isNtfRow_(row) {
  const inventoryRow = row || {};
  return [inventoryRow.rack, inventoryRow.shelf, inventoryRow.remark].some(
    function (value) {
      return /NTF/i.test(cleanText_(value));
    }
  );
}

/**
 * Applies the business rule for Inventory Not Found rows.
 *
 * NTF means the system inventory exists but the physical quantity was not
 * found. The API therefore exposes Physical Quantity as zero and Difference
 * as zero minus System Quantity. This keeps every downstream KPI, table, CSV,
 * chart, and email calculation consistent.
 */
function normalizeNtfShortage_(row) {
  if (!isNtfRow_(row)) {
    return row;
  }

  const systemQuantity = toNumber_(row.systemQuantity);
  const unitCost = optionalNumber_(row.unitCost);

  row.physicalQuantity = 0;
  row.difference = 0 - systemQuantity;
  row.physicalValue = unitCost === null
    ? null
    : 0;
  row.differenceValue = unitCost === null
    ? null
    : round_((0 - systemQuantity) * unitCost, 2);

  return row;
}

/**
 * Reusable Inventory Accuracy colour rule.
 */
function getAccuracyStyle(accuracyValue) {
  const accuracy = toNumber_(accuracyValue);

  if (accuracy < 96) {
    return {
      name: 'Red',
      text: '#991b1b',
      background: '#fee2e2',
      indicator: '#dc2626'
    };
  }

  if (accuracy < 99) {
    return {
      name: 'Yellow',
      text: '#854d0e',
      background: '#fef9c3',
      indicator: '#eab308'
    };
  }

  return {
    name: 'Green',
    text: '#166534',
    background: '#dcfce7',
    indicator: '#16a34a'
  };
}

/**
 * Reads Activity_Status.
 *
 * Pass yyyy-MM-dd to return one date. If no manual Sunday row exists,
 * Sunday is supplied automatically.
 */
function getActivityStatus(optionalDate) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName('Activity_Status');
  const requestedDate = cleanText_(optionalDate);
  const statuses = [];

  if (sheet && sheet.getLastRow() > 1) {
    const values = sheet.getRange(1, 1, sheet.getLastRow(), 3).getValues();
    const headers = values[0].map(normalizeHeader_);

    if (
      headers[0] !== 'date' ||
      headers[1] !== 'reason' ||
      headers[2] !== 'remark'
    ) {
      throw new Error(
        'Activity_Status must use the headers Date, Reason, and Remark.'
      );
    }

    for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
      if (values[rowIndex].every(isBlank_)) {
        continue;
      }

      const date = normalizeDate_(values[rowIndex][0], getTimeZone_());
      const enteredReason = cleanText_(values[rowIndex][1]);

      if (!date) {
        continue;
      }

      statuses.push({
        date: date,
        reason: ACTIVITY_REASONS.indexOf(enteredReason) >= 0
          ? enteredReason
          : 'Other',
        remark: cleanText_(values[rowIndex][2])
      });
    }
  }

  statuses.sort(function (first, second) {
    return String(second.date).localeCompare(String(first.date));
  });

  if (!requestedDate) {
    return statuses;
  }

  const matches = statuses.filter(function (status) {
    return status.date === requestedDate;
  });

  if (matches.length > 0) {
    return matches;
  }

  const dateObject = parseIsoDate_(requestedDate);
  if (dateObject && dateObject.getDay() === 0) {
    return [{
      date: requestedDate,
      reason: 'Sunday',
      remark: ''
    }];
  }

  return [];
}

/**
 * Returns the cached dashboard summary, or builds it when the cache is empty.
 */
function getDashboardData() {
  const cachedText = CacheService
    .getScriptCache()
    .get(DASHBOARD_CACHE_KEY);

  if (cachedText) {
    try {
      return JSON.parse(cachedText);
    } catch (error) {
      console.warn('The dashboard cache was invalid and will be rebuilt.');
    }
  }

  return refreshDashboardCache();
}

/**
 * Forces a cloud-side rebuild for the dashboard Refresh button.
 *
 * This rereads the current source workbooks, updates the dashboard cache and
 * hidden coverage snapshot, and returns only a small confirmation object.
 */
function refreshDashboardNow() {
  const dashboard = refreshDashboardCache();
  const coverage = getCycleCoverage('');

  return {
    refreshed: true,
    combinedRowCount: dashboard.sourceSummary.combinedRowCount,
    rowsByFacility: dashboard.sourceSummary.rowsByFacility,
    latestCoverageDate: coverage.latest ? coverage.latest.date : '',
    latestCoveragePercent: coverage.latest
      ? coverage.latest.totalCompletionPercent
      : 0,
    refreshedAt: getLastRefreshTime_()
  };
}

/**
 * Recalculates the summary and stores it in Google Apps Script Cache.
 *
 * This is the function used by the time-driven refresh trigger.
 */
function refreshDashboardCache() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {
    throw new Error('A dashboard refresh is already running.');
  }

  try {
    const inventoryData = getAllInventoryData_();
    const dashboard = buildDashboard_(inventoryData);
    refreshCycleCoverageSystemSafely_(inventoryData.currentRows);
    const refreshTime = new Date().toISOString();
    const scriptCache = CacheService.getScriptCache();

    scriptCache.put(
      DASHBOARD_CACHE_KEY,
      JSON.stringify(dashboard),
      21600
    );

    const monthToDate = dashboard.periods.monthToDate;
    const defaultTransactionParameters = {
      startDate: monthToDate.startDate,
      endDate: monthToDate.endDate,
      page: 1,
      pageSize: DEFAULT_TRANSACTION_PAGE_SIZE,
      search: '',
      sortKey: 'date',
      sortDirection: 'desc',
      includeUndatedNtf: 'true'
    };
    const defaultTransactionPage = buildTransactionsResponse_(
      defaultTransactionParameters,
      inventoryData
    );
    cacheTransactionResponse_(
      transactionCacheKey_(defaultTransactionParameters),
      defaultTransactionPage
    );

    PropertiesService.getScriptProperties().setProperty(
      LAST_REFRESH_PROPERTY,
      refreshTime
    );

    return dashboard;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Creates or replaces the cloud data refresh trigger.
 *
 * Apps Script supports 1, 5, 10, 15, 30, or 60 minute intervals.
 */
function createRefreshTrigger() {
  const config = getConfig();
  const minutes = Number(config.autoRefreshMinutes);
  const supportedMinutes = [1, 5, 10, 15, 30, 60];

  if (supportedMinutes.indexOf(minutes) < 0) {
    throw new Error(
      'Auto Refresh Minutes must be 1, 5, 10, 15, 30, or 60.'
    );
  }

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === REFRESH_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const builder = ScriptApp.newTrigger(REFRESH_HANDLER).timeBased();
  const trigger = minutes === 60
    ? builder.everyHours(1).create()
    : builder.everyMinutes(minutes).create();

  return {
    handler: REFRESH_HANDLER,
    refreshMinutes: minutes,
    triggerId: trigger.getUniqueId()
  };
}

/**
 * Creates or replaces the daily email trigger.
 *
 * The configured hour is combined with nearMinute(10). Google may vary a
 * nearMinute trigger by about 15 minutes, so hour 11 normally runs between
 * approximately 10:55-11:25 IST and remains before the 11:30 requirement.
 */
function createDailyEmailTrigger() {
  const config = getConfig();
  const sendHour = Number(config.emailSendHour);

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === EMAIL_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const trigger = ScriptApp
    .newTrigger(EMAIL_HANDLER)
    .timeBased()
    .atHour(sendHour)
    .nearMinute(EMAIL_SEND_MINUTE)
    .everyDays(1)
    .inTimezone(getTimeZone_())
    .create();

  return {
    handler: EMAIL_HANDLER,
    sendHour: sendHour,
    nearMinute: EMAIL_SEND_MINUTE,
    expectedWindow: 'Approximately ' +
      String(sendHour).padStart(2, '0') + ':00-' +
      String(sendHour).padStart(2, '0') + ':25',
    timeZone: getTimeZone_(),
    triggerId: trigger.getUniqueId()
  };
}

/**
 * Sends yesterday's Inventory Health Report.
 *
 * The function reads fresh source data at send time. When Email Enabled is No,
 * it exits safely without sending. The scheduled trigger runs in Google's cloud
 * and therefore continues to work while the user's laptop is switched off.
 */
function sendInventoryEmail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    return {
      sent: false,
      skipped: true,
      message: 'Another inventory email execution is already running.'
    };
  }

  try {
    return sendInventoryEmail_();
  } finally {
    lock.releaseLock();
  }
}

/** Builds and sends one report, while preventing duplicate report dates. */
function sendInventoryEmail_() {
  const config = getConfig();

  if (!config.emailEnabled) {
    const skippedResult = {
      sent: false,
      skipped: true,
      message: 'Email Enabled is No in the Config sheet.'
    };
    console.log(JSON.stringify(skippedResult, null, 2));
    return skippedResult;
  }

  if (!config.emailTo) {
    throw new Error(
      'Email To is blank. Add at least one recipient in the Config sheet.'
    );
  }

  const inventoryData = getAllInventoryData_();
  const dashboard = buildDashboard_(inventoryData);
  refreshCycleCoverageSystemSafely_(inventoryData.currentRows);
  const cycleCoverage = getCycleCoverage('');
  const period = dashboard.periods.yesterday;
  const scriptProperties = PropertiesService.getScriptProperties();
  const lastReportDate = scriptProperties.getProperty(
    LAST_EMAIL_REPORT_DATE_PROPERTY
  );

  if (lastReportDate === period.endDate) {
    const duplicateResult = {
      sent: false,
      skipped: true,
      reportDate: period.endDate,
      message: 'This report date was already emailed.'
    };
    console.log(JSON.stringify(duplicateResult, null, 2));
    return duplicateResult;
  }

  const quarterCsv = buildQuarterCsvAttachment_(
    inventoryData.allRows,
    period.endDate
  );
  const report = buildEmailReport_(
    config,
    period,
    dashboard.periods,
    cycleCoverage
  );
  report.quarterAttachment = {
    fileName: quarterCsv.fileName,
    rowCount: quarterCsv.rowCount,
    startDate: formatEmailDate_(quarterCsv.startDate),
    endDate: formatEmailDate_(quarterCsv.endDate)
  };
  const htmlBody = renderEmailTemplate_(report);
  const mailOptions = {
    to: config.emailTo,
    subject: config.emailSubject + ' - ' + report.reportingDate,
    body: buildPlainTextEmail_(report),
    htmlBody: htmlBody,
    name: config.dashboardName,
    attachments: [quarterCsv.blob]
  };

  if (config.emailCC) {
    mailOptions.cc = config.emailCC;
  }

  if (config.emailBCC) {
    mailOptions.bcc = config.emailBCC;
  }

  MailApp.sendEmail(mailOptions);

  const sentTime = new Date().toISOString();
  scriptProperties.setProperties({
    [LAST_EMAIL_SENT_PROPERTY]: sentTime,
    [LAST_EMAIL_REPORT_DATE_PROPERTY]: period.endDate
  });

  const result = {
    sent: true,
    skipped: false,
    reportDate: period.endDate,
    emailTo: config.emailTo,
    emailCC: config.emailCC,
    emailBCC: config.emailBCC,
    attachmentFileName: quarterCsv.fileName,
    attachmentRowCount: quarterCsv.rowCount,
    attachmentSizeBytes: quarterCsv.sizeBytes,
    sentTime: sentTime,
    remainingDailyQuota: MailApp.getRemainingDailyQuota()
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Builds and validates the email without sending it.
 *
 * Run this before enabling email. It checks the latest data, zero-activity
 * message, KPI view model, and EmailTemplate.html rendering.
 */
function testEmailPreview() {
  const config = getConfig();
  const inventoryData = getAllInventoryData_();
  const dashboard = buildDashboard_(inventoryData);
  refreshCycleCoverageSystemSafely_(inventoryData.currentRows);
  const cycleCoverage = getCycleCoverage('');
  const period = dashboard.periods.yesterday;
  const quarterCsv = buildQuarterCsvAttachment_(
    inventoryData.allRows,
    period.endDate
  );
  const report = buildEmailReport_(
    config,
    period,
    dashboard.periods,
    cycleCoverage
  );
  report.quarterAttachment = {
    fileName: quarterCsv.fileName,
    rowCount: quarterCsv.rowCount,
    startDate: formatEmailDate_(quarterCsv.startDate),
    endDate: formatEmailDate_(quarterCsv.endDate)
  };
  const html = renderEmailTemplate_(report);
  const coverageBannerRendered = Boolean(
    report.cycleCoverage &&
      html.indexOf('Overall Quantity Coverage') >= 0 &&
      html.indexOf('Opening GOOD Qty') >= 0 &&
      html.indexOf('Cumulative Counted') >= 0 &&
      html.indexOf('Counted Today') >= 0 &&
      html.indexOf('Inventory Change vs Previous Day') >= 0
  );
  const coverageProgressBarRendered = Boolean(
    report.cycleCoverage && html.indexOf('background-color:#22d3ee') >= 0
  );
  const result = {
    passed: coverageBannerRendered && coverageProgressBarRendered,
    sent: false,
    reportDate: period.endDate,
    hasActivity: report.hasActivity,
    zeroActivity: report.zeroActivity,
    periodSummaryCount: report.periodSummary.length,
    periodSummary: report.periodSummary,
    valuePeriodSummaryCount: report.valuePeriodSummary.length,
    valuePeriodSummary: report.valuePeriodSummary,
    cycleCoverage: report.cycleCoverage,
    coverageBannerRendered: coverageBannerRendered,
    coverageProgressBarRendered: coverageProgressBarRendered,
    metricCount: report.metrics.length,
    negativeNumberExample: formatEmailNumber_(-6307),
    negativeValueExample: formatEmailCurrency_(-225811.56),
    quarterAttachment: {
      fileName: quarterCsv.fileName,
      rowCount: quarterCsv.rowCount,
      startDate: quarterCsv.startDate,
      endDate: quarterCsv.endDate,
      sizeBytes: quarterCsv.sizeBytes
    },
    dashboardUrl: report.dashboardUrl,
    htmlLength: html.length
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Tests the V2 inventory-type and facility rules without reading Gmail or
 * changing Google Sheets. Run this first after pasting the V2 Code.gs file.
 */
function testCycleCoverageCalculations() {
  const sampleCsv = [
    'Facility,Inventory Type,Quantity',
    'SL Ambient,GOOD_INVENTORY,100',
    'SL Ambient,BAD_INVENTORY,7',
    'SL Ambient,QC_REJECTED,3',
    'SL MM,GOOD_INVENTORY,50',
    'SLLJ,GOOD_INVENTORY,20',
    'OWN,GOOD_INVENTORY,25',
    'OWN B2B,GOOD_INVENTORY,999'
  ].join('\r\n');
  const parsed = parseInventoryExportCsv_(sampleCsv);
  const b2cIndexes = b2cHeaderIndexes_([
    'Facility',
    'Date',
    'Sku Code',
    'Item Name',
    'Shelf',
    'Batch',
    'Vendor Batch number',
    'Total',
    'Blocked',
    'Not Found',
    'Pack',
    'Box',
    'Loose',
    'Phy',
    'Diff.'
  ]);
  const minimalB2cIndexes = b2cHeaderIndexes_([
    'Facility',
    'Date',
    'Shelf',
    'Total',
    'Phy'
  ]);
  const counts = coverageCountedQuantitiesByDate_([
    {
      date: '2026-08-01',
      facility: 'SL_MM',
      systemQuantity: 10
    },
    {
      date: '2026-08-02',
      facility: 'SL_MM',
      systemQuantity: 15
    },
    {
      date: '2026-08-02',
      facility: 'SL_AMBIENT',
      systemQuantity: 20
    }
  ], '2026-08-01');

  assertEqual_(
    parsed.facilities.SL_AMBIENT.goodQuantity,
    100,
    'SL Ambient GOOD Quantity'
  );
  assertEqual_(
    parsed.facilities.SL_AMBIENT.badQuantity,
    7,
    'SL Ambient BAD Quantity'
  );
  assertEqual_(
    parsed.facilities.SL_AMBIENT.qcRejectedQuantity,
    3,
    'SL Ambient QC Quantity'
  );
  assertEqual_(parsed.facilities.SL_MM.goodQuantity, 50, 'SL MM GOOD');
  assertEqual_(parsed.facilities.SL_LJ.goodQuantity, 20, 'SLLJ GOOD');
  assertEqual_(parsed.facilities.OWN.goodQuantity, 25, 'Exact OWN GOOD');
  assertEqual_(parsed.ignoredFacilityRowCount, 1, 'OWN child exclusion');
  assertEqual_(counts['2026-08-01'].SL_MM, 10, 'Day 1 counted qty');
  assertEqual_(counts['2026-08-02'].SL_MM, 15, 'Day 2 counted qty');
  assertEqual_(
    sourceFacilityName_('B2C', 'SL_MM'),
    'SL_MM',
    'B2C SL_MM mapping'
  );
  assertEqual_(
    sourceFacilityName_('B2C', 'SLLJ'),
    'SL_LJ',
    'B2C SLLJ mapping'
  );
  assertEqual_(
    sourceFacilityName_('B2C', 'SL_BW'),
    'SL_BW',
    'B2C SL_BW mapping'
  );
  assertEqual_(
    sourceFacilityName_('B2C', 'SL_B2C'),
    '',
    'B2C parent name exclusion'
  );
  assertEqual_(b2cIndexes.Sys, 7, 'B2C Total-to-System mapping');
  assertEqual_(b2cIndexes.Rack, null, 'B2C optional Rack mapping');
  assertEqual_(b2cIndexes.Remark, null, 'B2C optional Remark mapping');
  assertEqual_(minimalB2cIndexes.Sys, 3, 'Minimal B2C System mapping');
  assertEqual_(minimalB2cIndexes.Pack, null, 'B2C optional Pack mapping');

  const result = {
    passed: true,
    rule: 'Completion uses GOOD_INVENTORY Quantity only.',
    exactOwnOnly: true,
    b2cFacilityMapping: {
      SL_MM: sourceFacilityName_('B2C', 'SL_MM'),
      SL_LJ: sourceFacilityName_('B2C', 'SLLJ'),
      SL_BW: sourceFacilityName_('B2C', 'SL_BW')
    },
    sampleFacilities: parsed.facilities,
    ignoredFacilityRowCount: parsed.ignoredFacilityRowCount,
    countedByDate: counts
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Tests that completed and pending ABC contributions reconcile to 100%. */
function testCycleCoverageAbcContributions() {
  const result = calculateCoverageAbcBreakdown_([
    {
      abcClass: 'A',
      openingGoodQuantity: 45,
      dailyCountedQuantity: 0,
      cumulativeCountedQuantity: 30
    },
    {
      abcClass: 'B',
      openingGoodQuantity: 30,
      dailyCountedQuantity: 0,
      cumulativeCountedQuantity: 20
    },
    {
      abcClass: 'C',
      openingGoodQuantity: 25,
      dailyCountedQuantity: 0,
      cumulativeCountedQuantity: 20
    },
    {
      abcClass: 'Unclassified',
      openingGoodQuantity: 0,
      dailyCountedQuantity: 0,
      cumulativeCountedQuantity: 0
    }
  ], 100, 70);

  assertEqual_(result.completedPercent, 70, 'Completed coverage');
  assertEqual_(result.pendingPercent, 30, 'Pending coverage');
  assertEqual_(
    result.classes[0].completedContributionPercent,
    30,
    'A completed contribution'
  );
  assertEqual_(
    result.classes[1].completedContributionPercent,
    20,
    'B completed contribution'
  );
  assertEqual_(
    result.classes[2].completedContributionPercent,
    20,
    'C completed contribution'
  );
  assertEqual_(
    result.classes[0].pendingContributionPercent,
    15,
    'A pending contribution'
  );
  assertEqual_(
    result.classes[1].pendingContributionPercent,
    10,
    'B pending contribution'
  );
  assertEqual_(
    result.classes[2].pendingContributionPercent,
    5,
    'C pending contribution'
  );
  assertEqual_(result.classes[0].pendingQuantity, 15, 'A pending quantity');
  assertEqual_(result.classes[1].pendingQuantity, 10, 'B pending quantity');
  assertEqual_(result.classes[2].pendingQuantity, 5, 'C pending quantity');
  assertEqual_(result.totalPercent, 100, 'Completed plus pending');

  const missingOpeningResult = calculateCoverageAbcBreakdown_([
    {
      abcClass: 'A',
      openingGoodQuantity: 0,
      dailyCountedQuantity: 0,
      cumulativeCountedQuantity: 30
    },
    {
      abcClass: 'B',
      openingGoodQuantity: 0,
      dailyCountedQuantity: 0,
      cumulativeCountedQuantity: 20
    },
    {
      abcClass: 'C',
      openingGoodQuantity: 0,
      dailyCountedQuantity: 0,
      cumulativeCountedQuantity: 20
    }
  ], 100, 70);
  const repairedPendingTotal = missingOpeningResult.classes.reduce(
    function (total, item) {
      return total + item.pendingQuantity;
    },
    0
  );

  assertEqual_(
    repairedPendingTotal,
    30,
    'Missing ABC opening pending quantity fallback'
  );
  missingOpeningResult.classes.forEach(function (item) {
    if (item.pendingQuantity <= 0) {
      throw new Error(
        item.abcClass + ' pending quantity fallback remained zero.'
      );
    }
  });

  const output = {
    passed: true,
    rule: 'ABC completed contribution + ABC pending contribution = 100%.',
    result: result,
    missingOpeningFallback: missingOpeningResult
  };
  console.log(JSON.stringify(output, null, 2));
  return output;
}

/** Prints the stored V2 MTD coverage response without changing data. */
function testCycleCoverageApi() {
  const result = getCycleCoverage('');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Audits the latest Gmail inventory messages without downloading or saving.
 * Run this when importLatestInventoryEmail() cannot select an email.
 */
function testInventoryEmailSearch() {
  const config = getConfig();
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(CYCLE_COVERAGE_SHEET_NAME);
  const processedMessageIds = coverageProcessedMessageIds_(sheet);
  const search = findLatestInventoryEmail_(
    config,
    processedMessageIds,
    true
  );
  const result = {
    candidateFound: Boolean(search.candidate),
    coverageCycleStartDate: config.coverageCycleStartDate,
    expectedSender: config.inventoryEmailSender,
    expectedSubject: config.inventoryEmailSubject,
    expectedExportName: config.inventoryExportName,
    searchedMessageCount: search.searchedMessageCount,
    rejectionSummary: search.rejectionSummary,
    latestMessages: search.diagnostics
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Returns safe, read-only diagnostics for the external B2C parent tab.
 *
 * Only column names and facility row counts are returned. SKU, batch, item,
 * and quantity values are never included. This makes source-mapping problems
 * easy to diagnose without editing or exposing cycle-count transactions.
 */
function getB2cSourceAudit() {
  const spreadsheet = SpreadsheetApp.openById(B2C_SOURCE_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(B2C_SOURCE_SHEET_NAME);

  if (!sheet) {
    return {
      connected: true,
      spreadsheetName: spreadsheet.getName(),
      sheetFound: false,
      sheetName: B2C_SOURCE_SHEET_NAME
    };
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const headers = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    : [];
  const normalizedHeaders = headers.map(normalizeHeader_);
  let facilityIndex = normalizedHeaders.indexOf(normalizeHeader_('Facility'));

  if (facilityIndex < 0) {
    facilityIndex = normalizedHeaders.indexOf(
      normalizeHeader_('Facility Name')
    );
  }

  const rowsByEnteredFacility = {};
  const quantitySummaryByFacility = {};
  let mappingError = '';
  const dataRows = lastRow > 1 && lastColumn > 0
    ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues()
    : [];

  if (facilityIndex >= 0) {
    dataRows.forEach(function (row) {
      const enteredFacility = cleanText_(row[facilityIndex]);
      if (enteredFacility) {
        rowsByEnteredFacility[enteredFacility] =
          (rowsByEnteredFacility[enteredFacility] || 0) + 1;
      }
    });
  }

  if (headers.length > 0) {
    let indexes;
    try {
      indexes = b2cHeaderIndexes_(headers);
    } catch (error) {
      mappingError = error && error.message
        ? error.message
        : 'Unable to map the external B2C columns.';
    }

    if (indexes) {
    dataRows.forEach(function (row) {
      if (row.every(isBlank_)) {
        return;
      }

      const facility = sourceFacilityName_(
        B2C_SOURCE_SHEET_NAME,
        row[indexes.Facility]
      );
      if (!facility) {
        return;
      }

      if (!quantitySummaryByFacility[facility]) {
        quantitySummaryByFacility[facility] = {
          rowCount: 0,
          earliestDate: '',
          latestDate: '',
          systemQuantityFromTotal: 0,
          physicalQuantity: 0,
          difference: 0,
          inconsistentDifferenceRowCount: 0
        };
      }

      const summary = quantitySummaryByFacility[facility];
      const date = normalizeDate_(row[indexes.Date], getTimeZone_());
      const systemQuantity = toNumber_(row[indexes.Sys]);
      const physicalQuantity = toNumber_(row[indexes.Phy]);
      const rawDifference = b2cCell_(row, indexes.Diff);
      const difference = isBlank_(rawDifference)
        ? physicalQuantity - systemQuantity
        : toNumber_(rawDifference);
      summary.rowCount += 1;
      summary.systemQuantityFromTotal += systemQuantity;
      summary.physicalQuantity += physicalQuantity;
      summary.difference += difference;
      if (date && (!summary.earliestDate || date < summary.earliestDate)) {
        summary.earliestDate = date;
      }
      if (date && (!summary.latestDate || date > summary.latestDate)) {
        summary.latestDate = date;
      }
      if (
        Math.abs((physicalQuantity - systemQuantity) - difference) > 0.000001
      ) {
        summary.inconsistentDifferenceRowCount += 1;
      }
    });
    }
  }

  const requiredHeaders = {};
  INVENTORY_HEADERS.forEach(function (header) {
    const index = normalizedHeaders.indexOf(normalizeHeader_(header));
    requiredHeaders[header] = index >= 0 ? index + 1 : null;
  });

  return {
    connected: true,
    spreadsheetName: spreadsheet.getName(),
    sheetFound: true,
    sheetName: sheet.getName(),
    rowCount: Math.max(lastRow - 1, 0),
    columnCount: lastColumn,
    headers: headers,
    facilityColumnNumber: facilityIndex >= 0 ? facilityIndex + 1 : null,
    rowsByEnteredFacility: rowsByEnteredFacility,
    quantitySummaryByFacility: quantitySummaryByFacility,
    mappingError: mappingError,
    requiredHeaders: requiredHeaders
  };
}

/** Returns safe aggregate diagnostics for the external OWN cycle-count tab. */
function getOwnSourceAudit() {
  const spreadsheet = SpreadsheetApp.openById(B2C_SOURCE_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(OWN_SOURCE_SHEET_NAME);

  if (!sheet) {
    return {
      connected: true,
      spreadsheetName: spreadsheet.getName(),
      sheetFound: false,
      sheetName: OWN_SOURCE_SHEET_NAME
    };
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  const headers = lastColumn > 0
    ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    : [];
  const normalizedHeaders = headers.map(normalizeHeader_);
  const indexOf = function (name) {
    const index = normalizedHeaders.indexOf(normalizeHeader_(name));
    return index >= 0 ? index : null;
  };
  const indexes = {
    Date: indexOf('Date'),
    Shelf: indexOf('Shelf'),
    Phy: indexOf('Phy'),
    Diff: indexOf('Diff'),
    Facility: indexOf('Facility')
  };
  indexes.Sys = indexOf('Sys');
  if (indexes.Sys === null) {
    indexes.Sys = indexOf('Total');
  }

  const missingCoreHeaders = ['Date', 'Shelf', 'Phy', 'Sys'].filter(
    function (header) {
      return indexes[header] === null;
    }
  );
  const dataRows = lastRow > 1 && lastColumn > 0
    ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues()
    : [];
  const rowsByDate = {};
  let countedRowCount = 0;
  let systemQuantity = 0;
  let physicalQuantity = 0;
  let difference = 0;
  let inconsistentDifferenceRowCount = 0;

  if (missingCoreHeaders.length === 0) {
    dataRows.forEach(function (row) {
      if (row.every(isBlank_)) {
        return;
      }

      const date = normalizeDate_(row[indexes.Date], getTimeZone_());
      const system = toNumber_(row[indexes.Sys]);
      const physical = toNumber_(row[indexes.Phy]);
      const rawDifference = b2cCell_(row, indexes.Diff);
      const rowDifference = isBlank_(rawDifference)
        ? physical - system
        : toNumber_(rawDifference);
      countedRowCount += 1;
      systemQuantity += system;
      physicalQuantity += physical;
      difference += rowDifference;
      if (Math.abs((physical - system) - rowDifference) > 0.000001) {
        inconsistentDifferenceRowCount += 1;
      }

      const dateKey = date || 'Undated';
      if (!rowsByDate[dateKey]) {
        rowsByDate[dateKey] = {
          rowCount: 0,
          systemQuantity: 0,
          physicalQuantity: 0,
          difference: 0
        };
      }
      rowsByDate[dateKey].rowCount += 1;
      rowsByDate[dateKey].systemQuantity += system;
      rowsByDate[dateKey].physicalQuantity += physical;
      rowsByDate[dateKey].difference += rowDifference;
    });
  }

  return {
    connected: true,
    spreadsheetName: spreadsheet.getName(),
    sheetFound: true,
    sheetName: sheet.getName(),
    rowCount: Math.max(lastRow - 1, 0),
    columnCount: lastColumn,
    headers: headers,
    mappedColumns: indexes,
    mappingError: missingCoreHeaders.length > 0
      ? 'Missing required columns: ' + missingCoreHeaders.join(', ')
      : '',
    countedRowCount: countedRowCount,
    systemQuantity: round_(systemQuantity, 2),
    physicalQuantity: round_(physicalQuantity, 2),
    difference: round_(difference, 2),
    inconsistentDifferenceRowCount: inconsistentDifferenceRowCount,
    rowsByDate: rowsByDate
  };
}

/**
 * Audits the B2C parent sheet without editing it.
 *
 * The sheet may remain header-only until cycle-count data is available, but it
 * must include a Facility or Facility Name header before SL_MM, SL_LJ, and
 * SL_BW rows can be loaded.
 */
function testB2cFacilityMapping() {
  const spreadsheet = SpreadsheetApp.openById(B2C_SOURCE_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(B2C_SOURCE_SHEET_NAME);

  if (!sheet) {
    const missingResult = {
      passed: false,
      sourceSheet: 'B2C',
      message: 'B2C does not exist in the configured cycle-count workbook.'
    };
    console.log(JSON.stringify(missingResult, null, 2));
    return missingResult;
  }

  const headerRow = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
    .getValues()[0];
  const normalizedHeaders = headerRow.map(normalizeHeader_);
  let facilityIndex = normalizedHeaders.indexOf(
    normalizeHeader_('Facility')
  );
  if (facilityIndex < 0) {
    facilityIndex = normalizedHeaders.indexOf(
      normalizeHeader_('Facility Name')
    );
  }
  const facilityColumnFound = facilityIndex >= 0;

  if (sheet.getLastRow() <= 1) {
    const headerOnlyResult = {
      passed: facilityColumnFound,
      sourceSheet: 'B2C',
      sourceDataRowCount: 0,
      facilityColumnFound: facilityColumnFound,
      facilityColumnNumber: facilityColumnFound ? facilityIndex + 1 : null,
      message: facilityColumnFound
        ? 'B2C is ready but currently contains no cycle-count data rows.'
        : 'Add Facility or Facility Name as the next header in B2C before loading SL_MM, SL_LJ, or SL_BW rows.'
    };
    console.log(JSON.stringify(headerOnlyResult, null, 2));
    return headerOnlyResult;
  }

  const values = sheet
    .getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn())
    .getValues();
  const indexes = b2cHeaderIndexes_(values[0]);
  const rowsByFacility = emptyFacilityNumberMap_();
  const skippedRowNumbers = [];

  for (let index = 1; index < values.length; index += 1) {
    const row = values[index];
    if (row.every(isBlank_)) {
      continue;
    }

    const facility = sourceFacilityName_(
      'B2C',
      row[indexes.Facility]
    );
    if (facility) {
      rowsByFacility[facility] += 1;
    } else {
      skippedRowNumbers.push(index + 1);
    }
  }

  const result = {
    passed: skippedRowNumbers.length === 0,
    sourceSheet: 'B2C',
    sourceDataRowCount: values.length - 1,
    facilityColumnFound: true,
    rowsByFacility: {
      SL_MM: rowsByFacility.SL_MM,
      SL_LJ: rowsByFacility.SL_LJ,
      SL_BW: rowsByFacility.SL_BW
    },
    skippedRowCount: skippedRowNumbers.length,
    skippedRowNumbers: skippedRowNumbers
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/** Backward-compatible test name used by the first B2C test copy. */
function testSlB2cFacilityMapping() {
  return testB2cFacilityMapping();
}

/**
 * Lists the exact sheet-tab names in Inventory_Dashboard without changing any
 * data. Use this when a source tab cannot be found because of spaces, spelling,
 * or a different spreadsheet connection.
 */
function testListInventorySheetNames() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheets = spreadsheet.getSheets().map(function (sheet, index) {
    return {
      position: index + 1,
      name: sheet.getName(),
      rowCount: sheet.getLastRow(),
      columnCount: sheet.getLastColumn(),
      hidden: sheet.isSheetHidden()
    };
  });
  const likelyB2cMatches = sheets.filter(function (sheet) {
    return cleanText_(sheet.name)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .indexOf('B2C') >= 0;
  });
  const result = {
    passed: true,
    spreadsheetId: SPREADSHEET_ID,
    spreadsheetName: spreadsheet.getName(),
    sheetCount: sheets.length,
    likelyB2cMatches: likelyB2cMatches,
    sheets: sheets
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Tests the small Month-to-Date transaction response without changing sheets.
 *
 * The log confirms pagination, KPI summary, and the first response
 * size. Run this after deployment when checking dashboard loading performance.
 */
function testPaginatedTransactions() {
  const range = reportingRanges_().monthToDate;
  const result = getTransactions({
    startDate: range.startDate,
    endDate: range.endDate,
    page: 1,
    pageSize: 25,
    sortKey: 'date',
    sortDirection: 'desc',
    includeUndatedNtf: 'true'
  });
  const output = {
    passed: true,
    startDate: result.startDate,
    endDate: result.endDate,
    selectedRowCount: result.selectedRowCount,
    returnedRowCount: result.rows.length,
    page: result.page,
    pageSize: result.pageSize,
    pageCount: result.pageCount,
    facilityCount: result.facilities.length,
    responseBytes: JSON.stringify(result).length
  };

  console.log(JSON.stringify(output, null, 2));
  return output;
}

/**
 * Tests ABC quantity and COGS calculations without reading or changing sheets.
 *
 * Expected sample result:
 * - A: system 30, physical 30, quantity accuracy 100%
 * - B: system 50, physical 47, difference -3, quantity accuracy 94%
 * - C: system 20, physical 20, quantity accuracy 100%
 * - Total: system 100, physical 97, quantity accuracy 97%
 */
function testAbcBreakdownCalculations() {
  const sampleRows = [
    {
      skuCode: 'A-SKU',
      abcClass: 'A',
      rack: 'R1',
      systemQuantity: 30,
      physicalQuantity: 30,
      difference: 0,
      unitCost: 10,
      remark: ''
    },
    {
      skuCode: 'B-SKU',
      abcClass: 'B',
      rack: 'R2',
      systemQuantity: 50,
      physicalQuantity: 47,
      difference: -3,
      unitCost: 20,
      remark: ''
    },
    {
      skuCode: 'C-SKU',
      abcClass: 'C',
      rack: 'R3',
      systemQuantity: 20,
      physicalQuantity: 20,
      difference: 0,
      unitCost: 5,
      remark: ''
    },
    {
      skuCode: 'NO-CLASS',
      abcClass: '',
      rack: 'R4',
      systemQuantity: 5,
      physicalQuantity: 5,
      difference: 0,
      unitCost: null,
      remark: ''
    }
  ];
  const result = calculateAbcBreakdown(sampleRows);
  const bClass = result.classes[1];

  assertEqual_(bClass.differenceQuantity, -3, 'B difference quantity');
  assertEqual_(bClass.quantityAccuracy, 94, 'B quantity accuracy');
  assertEqual_(bClass.differenceValue, -60, 'B difference value');
  assertEqual_(bClass.valueAccuracy, 94, 'B value accuracy');
  assertEqual_(result.total.systemQuantity, 105, 'Total system quantity');
  assertEqual_(result.total.physicalQuantity, 102, 'Total physical quantity');
  assertEqual_(result.unclassifiedSkuCount, 0, 'Unclassified SKU count');

  const output = {
    passed: true,
    classes: result.classes,
    total: result.total,
    mappedSkuCount: result.mappedSkuCount,
    unclassifiedSkuCount: result.unclassifiedSkuCount
  };

  console.log(JSON.stringify(output, null, 2));
  return output;
}

/** Tests the Top 5 Volume and Variance SKU ranking without reading sheets. */
function testTopSkuInsightsCalculations() {
  const rows = [
    {
      skuCode: 'A-SKU-1',
      itemName: 'A first item',
      abcClass: 'A',
      systemQuantity: 10,
      physicalQuantity: 8,
      difference: -2,
      unitCost: 10,
      rack: '',
      shelf: '',
      remark: ''
    },
    {
      skuCode: 'A-SKU-1',
      itemName: 'A first item',
      abcClass: 'A',
      systemQuantity: 5,
      physicalQuantity: 7,
      difference: 2,
      unitCost: 10,
      rack: '',
      shelf: '',
      remark: ''
    },
    {
      skuCode: 'A-SKU-2',
      itemName: 'A second item',
      abcClass: 'A',
      systemQuantity: 20,
      physicalQuantity: 10,
      difference: -10,
      unitCost: 5,
      rack: '',
      shelf: '',
      remark: ''
    },
    {
      skuCode: 'B-SKU-1',
      itemName: 'B item',
      abcClass: 'B',
      systemQuantity: 4,
      physicalQuantity: 5,
      difference: 1,
      unitCost: 3,
      rack: '',
      shelf: '',
      remark: ''
    }
  ];
  const result = calculateTopSkuInsights_(rows);
  const classA = result.classes[0];

  assertEqual_(classA.volume[0].skuCode, 'A-SKU-2', 'A volume rank 1');
  assertEqual_(classA.volume[0].value, 100, 'A volume COGS value');
  assertEqual_(classA.variance[0].skuCode, 'A-SKU-2', 'A variance rank 1');
  assertEqual_(classA.variance[0].varianceQuantity, -10, 'A variance qty');
  assertEqual_(classA.variance[0].value, -50, 'A variance COGS value');

  const output = {
    passed: true,
    classes: result.classes
  };
  console.log(JSON.stringify(output, null, 2));
  return output;
}

/**
 * Creates the quarter-to-date CSV attached to the inventory email.
 *
 * The quarter is based on the email's reporting date. For example, an email
 * reporting 31 July includes dated rows from 1 July through 31 July. Undated
 * rows are excluded because they cannot be assigned to a reporting quarter.
 */
function buildQuarterCsvAttachment_(inventoryRows, reportEndDate) {
  const endDate = parseIsoDate_(reportEndDate);

  if (!endDate) {
    throw new Error(
      'Unable to create the quarter CSV because the report date is invalid.'
    );
  }

  const quarterStartMonth = Math.floor(endDate.getMonth() / 3) * 3;
  const quarterStart = new Date(
    endDate.getFullYear(),
    quarterStartMonth,
    1,
    12,
    0,
    0
  );
  const startDateText = formatDate_(quarterStart);
  const endDateText = formatDate_(endDate);
  const rows = (Array.isArray(inventoryRows) ? inventoryRows : [])
    .filter(function (row) {
      return row.date &&
        row.date >= startDateText &&
        row.date <= endDateText;
    })
    .sort(function (first, second) {
      const dateResult = String(first.date).localeCompare(String(second.date));
      if (dateResult !== 0) {
        return dateResult;
      }

      const facilityResult = String(first.facility).localeCompare(
        String(second.facility)
      );
      return facilityResult !== 0
        ? facilityResult
        : String(first.id).localeCompare(String(second.id));
    });

  const columns = [
    ['Facility', function (row) { return row.facility; }],
    ['Date', function (row) { return row.date; }],
    ['Rack', function (row) { return row.rack; }],
    ['SKU Code', function (row) { return row.skuCode; }],
    ['Item Name', function (row) { return row.itemName; }],
    ['Shelf', function (row) { return row.shelf; }],
    ['Batch', function (row) { return row.batch; }],
    ['Vendor Batch Number', function (row) {
      return row.vendorBatchNumber;
    }],
    ['Pack', function (row) { return row.pack; }],
    ['Box', function (row) { return row.box; }],
    ['Loose', function (row) { return row.loose; }],
    ['Physical Quantity', function (row) { return row.physicalQuantity; }],
    ['System Quantity', function (row) { return row.systemQuantity; }],
    ['Difference', function (row) { return row.difference; }],
    ['Remark', function (row) { return row.remark; }],
    ['Unit Cost', function (row) { return csvOptionalNumber_(row.unitCost); }],
    ['System Value', function (row) {
      return csvOptionalNumber_(row.systemValue);
    }],
    ['Physical Value', function (row) {
      return csvOptionalNumber_(row.physicalValue);
    }],
    ['Difference Value', function (row) {
      return csvOptionalNumber_(row.differenceValue);
    }],
    ['Source Row ID', function (row) { return row.id; }]
  ];
  const csvLines = [
    columns.map(function (column) {
      return csvCell_(column[0]);
    }).join(',')
  ];

  rows.forEach(function (row) {
    csvLines.push(columns.map(function (column) {
      return csvCell_(column[1](row));
    }).join(','));
  });

  const fileName =
    'Inventory_Transactions_QTD_' +
    startDateText +
    '_to_' +
    endDateText +
    '.csv';
  const csvText = '\uFEFF' + csvLines.join('\r\n');
  const blob = Utilities.newBlob(csvText, 'text/csv', fileName);
  const sizeBytes = blob.getBytes().length;

  if (sizeBytes > MAX_EMAIL_ATTACHMENT_BYTES) {
    throw new Error(
      'The quarter CSV is larger than 20 MB and cannot be emailed safely. ' +
      'Reduce the reporting data or export the quarter from the dashboard.'
    );
  }

  return {
    blob: blob,
    fileName: fileName,
    rowCount: rows.length,
    startDate: startDateText,
    endDate: endDateText,
    sizeBytes: sizeBytes
  };
}

/**
 * Creates or replaces the Gmail inventory-import trigger.
 *
 * The trigger checks Gmail at the configured interval. A Gmail Message ID is
 * stored in the hidden system sheet, so the same export is never imported
 * twice.
 */
function createInventoryImportTrigger() {
  const config = getConfig();
  const minutes = Number(config.inventoryImportMinutes);
  const supportedMinutes = [1, 5, 10, 15, 30, 60];

  if (supportedMinutes.indexOf(minutes) < 0) {
    throw new Error(
      'Inventory Import Minutes must be 1, 5, 10, 15, 30, or 60.'
    );
  }

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === INVENTORY_IMPORT_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const builder = ScriptApp
    .newTrigger(INVENTORY_IMPORT_HANDLER)
    .timeBased();
  const trigger = minutes === 60
    ? builder.everyHours(1).create()
    : builder.everyMinutes(minutes).create();

  return {
    handler: INVENTORY_IMPORT_HANDLER,
    importMinutes: minutes,
    triggerId: trigger.getUniqueId()
  };
}

/**
 * Builds compact quarter-to-date Top 5 SKU lists for the coverage drawer.
 *
 * Volume Level is ranked by total System Quantity. Variance Level is ranked
 * by the absolute net Difference quantity. Both tables expose System,
 * Physical, Variance, and COGS Value without sending every transaction row to
 * the browser. Missing or invalid ABC classes follow the dashboard rule and
 * are included in Class C.
 */
function calculateTopSkuInsights_(inventoryRows) {
  const rows = Array.isArray(inventoryRows) ? inventoryRows : [];
  const classOrder = ['A', 'B', 'C'];
  const classBuckets = {};

  classOrder.forEach(function (abcClass) {
    classBuckets[abcClass] = {};
  });

  rows.forEach(function (row) {
    const skuCode = cleanText_(row.skuCode);
    const skuKey = normalizeSku_(skuCode);
    if (!skuKey) {
      return;
    }

    const abcClass = normalizeAbcClass_(row.abcClass);
    const bucket = classBuckets[abcClass];
    const systemQuantity = toNumber_(row.systemQuantity);
    const ntfRow = isNtfRow_(row);
    const physicalQuantity = ntfRow
      ? 0
      : toNumber_(row.physicalQuantity);
    const varianceQuantity = ntfRow
      ? 0 - systemQuantity
      : toNumber_(row.difference);
    const unitCost = optionalNumber_(row.unitCost);

    if (!bucket[skuKey]) {
      bucket[skuKey] = {
        skuCode: skuCode,
        itemName: cleanText_(row.itemName) || skuCode,
        systemQuantity: 0,
        physicalQuantity: 0,
        varianceQuantity: 0,
        systemValue: 0,
        varianceValue: 0,
        missingCostRowCount: 0
      };
    }

    const sku = bucket[skuKey];
    if (!sku.itemName && row.itemName) {
      sku.itemName = cleanText_(row.itemName);
    }
    sku.systemQuantity += systemQuantity;
    sku.physicalQuantity += physicalQuantity;
    sku.varianceQuantity += varianceQuantity;

    if (unitCost !== null && unitCost >= 0) {
      sku.systemValue += systemQuantity * unitCost;
      sku.varianceValue += varianceQuantity * unitCost;
    } else {
      sku.missingCostRowCount += 1;
    }
  });

  return {
    classes: classOrder.map(function (abcClass) {
      const skuRows = Object.keys(classBuckets[abcClass]).map(function (key) {
        return classBuckets[abcClass][key];
      });
      const volumeRows = skuRows.slice().sort(function (first, second) {
        const quantityResult =
          second.systemQuantity - first.systemQuantity;
        return quantityResult !== 0
          ? quantityResult
          : first.skuCode.localeCompare(second.skuCode);
      }).slice(0, 5);
      const varianceRows = skuRows.slice().sort(function (first, second) {
        const varianceResult =
          Math.abs(second.varianceQuantity) -
          Math.abs(first.varianceQuantity);
        return varianceResult !== 0
          ? varianceResult
          : first.skuCode.localeCompare(second.skuCode);
      }).slice(0, 5);

      return {
        abcClass: abcClass,
        volume: volumeRows.map(function (sku) {
          return topSkuInsightRow_(sku, sku.systemValue);
        }),
        variance: varianceRows.map(function (sku) {
          return topSkuInsightRow_(sku, sku.varianceValue);
        })
      };
    })
  };
}

/** Converts one aggregated SKU into the small frontend Top 5 row. */
function topSkuInsightRow_(sku, value) {
  return {
    skuCode: sku.skuCode,
    itemName: sku.itemName || sku.skuCode,
    systemQuantity: round_(sku.systemQuantity, 2),
    physicalQuantity: round_(sku.physicalQuantity, 2),
    varianceQuantity: round_(sku.varianceQuantity, 2),
    value: sku.missingCostRowCount > 0 ? null : round_(value, 2)
  };
}

/** Ensures this production project owns the recurring coverage import trigger. */
function ensureCoverageAutomation() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = setupCycleCoverageSheet_(spreadsheet);
  const trigger = createInventoryImportTrigger();
  const abcOpeningRepaired = repairLatestCoverageAbcOpeningIfMissing_(
    spreadsheet,
    sheet
  );

  return {
    ready: true,
    trigger: trigger,
    abcOpeningRepaired: abcOpeningRepaired
  };
}

/**
 * Imports the latest unprocessed successful shelf-inventory export from Gmail.
 *
 * The email contains a CloudFront CSV link rather than a Gmail attachment.
 * This function downloads that link, keeps the seven approved facilities,
 * sums the Quantity column by Inventory Type, and stores one date row in the
 * hidden Cycle_Coverage_System sheet.
 */
function importLatestInventoryEmail() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {
    throw new Error('Another inventory import or refresh is already running.');
  }

  try {
    const config = getConfig();
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = setupCycleCoverageSheet_(spreadsheet);
    const processedMessageIds = coverageProcessedMessageIds_(sheet);
    const emailSearch = findLatestInventoryEmail_(
      config,
      processedMessageIds,
      false
    );
    const candidate = emailSearch.candidate;

    if (!candidate) {
      const abcOpeningRepaired = repairLatestCoverageAbcOpeningIfMissing_(
        spreadsheet,
        sheet
      );
      const skippedResult = {
        imported: false,
        skipped: true,
        message: 'No new successful inventory export email was found.',
        searchedMessageCount: emailSearch.searchedMessageCount,
        rejectionSummary: emailSearch.rejectionSummary,
        abcOpeningRepaired: abcOpeningRepaired
      };
      console.log(JSON.stringify(skippedResult, null, 2));
      return skippedResult;
    }

    const response = UrlFetchApp.fetch(candidate.sourceUrl, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true
    });
    const responseCode = response.getResponseCode();

    if (responseCode < 200 || responseCode >= 300) {
      throw new Error(
        'Inventory CSV download failed with status ' + responseCode + '.'
      );
    }

    const abcClassMap = readAbcClassMap_(spreadsheet);
    const parsed = parseInventoryExportCsv_(
      response.getContentText('UTF-8'),
      abcClassMap
    );
    const upsertResult = upsertCycleCoverageSnapshot_(sheet, {
      reportDate: candidate.reportDate,
      facilities: parsed.facilities,
      abcGoodQuantities: parsed.abcGoodQuantities,
      abcMappingSignature: abcClassMapSignature_(abcClassMap),
      sourceFile: candidate.sourceFile,
      sourceUrl: candidate.sourceUrl,
      messageId: candidate.messageId,
      importedAt: new Date().toISOString(),
      importStatus: 'IMPORTED'
    });
    const inventoryData = getAllInventoryData_();
    const coverage = refreshCycleCoverageSystem_(
      inventoryData.currentRows,
      sheet
    );
    const result = {
      imported: true,
      skipped: false,
      reportDate: candidate.reportDate,
      sourceFile: candidate.sourceFile,
      insertedNewDate: upsertResult.inserted,
      selectedRowCount: parsed.selectedRowCount,
      ignoredFacilityRowCount: parsed.ignoredFacilityRowCount,
      ignoredInventoryTypeRowCount: parsed.ignoredInventoryTypeRowCount,
      invalidQuantityRowCount: parsed.invalidQuantityRowCount,
      latestCoverage: coverage.latest
    };

    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Finds the newest eligible Gmail export and optionally returns diagnostics.
 * Email bodies and download URLs are never included in the diagnostic output.
 */
function findLatestInventoryEmail_(
  config,
  processedMessageIds,
  includeDiagnostics
) {
  const searchQuery = [
    'from:(' + config.inventoryEmailSender + ')',
    'subject:"' + gmailSearchText_(config.inventoryEmailSubject) + '"',
    '"' + gmailSearchText_(config.inventoryExportName) + '"',
    'after:' + gmailDateBefore_(config.coverageCycleStartDate)
  ].join(' ');
  const messages = [];

  GmailApp.search(
    searchQuery,
    0,
    INVENTORY_EMAIL_SEARCH_LIMIT
  ).forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      messages.push(message);
    });
  });

  messages.sort(function (first, second) {
    return second.getDate().getTime() - first.getDate().getTime();
  });

  const rejectionSummary = {
    alreadyProcessed: 0,
    senderMismatch: 0,
    subjectMismatch: 0,
    exportNameMissing: 0,
    successfulStatusMissing: 0,
    csvUrlMissing: 0,
    beforeCycleStart: 0
  };
  const diagnostics = [];
  let candidate = null;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const messageId = message.getId();
    const from = cleanText_(message.getFrom());
    const subject = cleanText_(message.getSubject());
    const plainBody = message.getPlainBody();
    const htmlBody = message.getBody();
    const combinedBody = plainBody + '\n' + htmlBody;
    const searchableBody = inventoryEmailSearchText_(
      plainBody,
      htmlBody
    );
    const alreadyProcessed = Boolean(processedMessageIds[messageId]);
    const senderMatches = from.toLowerCase().indexOf(
      config.inventoryEmailSender.toLowerCase()
    ) >= 0;
    const subjectMatches = subject ===
      cleanText_(config.inventoryEmailSubject);
    const exportMatches = searchableBody.toLowerCase().indexOf(
      config.inventoryExportName.toLowerCase()
    ) >= 0;
    const successful = inventoryEmailWasSuccessful_(searchableBody);
    const sourceUrl = extractInventoryCsvUrl_(combinedBody);
    const sourceFile = inventoryFileNameFromUrl_(sourceUrl);
    const reportDate = inventoryDateFromFileName_(sourceFile) ||
      Utilities.formatDate(
        message.getDate(),
        getTimeZone_(),
        'yyyy-MM-dd'
      );
    const onOrAfterCycleStart = Boolean(
      reportDate && reportDate >= config.coverageCycleStartDate
    );
    const rejectionReasons = [];

    if (alreadyProcessed) {
      rejectionSummary.alreadyProcessed += 1;
      rejectionReasons.push('alreadyProcessed');
    }
    if (!senderMatches) {
      rejectionSummary.senderMismatch += 1;
      rejectionReasons.push('senderMismatch');
    }
    if (!subjectMatches) {
      rejectionSummary.subjectMismatch += 1;
      rejectionReasons.push('subjectMismatch');
    }
    if (!exportMatches) {
      rejectionSummary.exportNameMissing += 1;
      rejectionReasons.push('exportNameMissing');
    }
    if (!successful) {
      rejectionSummary.successfulStatusMissing += 1;
      rejectionReasons.push('successfulStatusMissing');
    }
    if (!sourceUrl) {
      rejectionSummary.csvUrlMissing += 1;
      rejectionReasons.push('csvUrlMissing');
    }
    if (!onOrAfterCycleStart) {
      rejectionSummary.beforeCycleStart += 1;
      rejectionReasons.push('beforeCycleStart');
    }

    const accepted = rejectionReasons.length === 0;

    if (includeDiagnostics && diagnostics.length < 10) {
      diagnostics.push({
        emailDate: Utilities.formatDate(
          message.getDate(),
          getTimeZone_(),
          'yyyy-MM-dd HH:mm:ss'
        ),
        from: from,
        subject: subject,
        alreadyProcessed: alreadyProcessed,
        senderMatches: senderMatches,
        subjectMatches: subjectMatches,
        exportMatches: exportMatches,
        successfulStatusFound: successful,
        csvUrlFound: Boolean(sourceUrl),
        sourceFile: sourceFile,
        reportDate: reportDate,
        onOrAfterCycleStart: onOrAfterCycleStart,
        accepted: accepted,
        rejectionReasons: rejectionReasons
      });
    }

    if (accepted && !candidate) {
      candidate = {
        messageId: messageId,
        sourceUrl: sourceUrl,
        sourceFile: sourceFile,
        reportDate: reportDate
      };

      if (!includeDiagnostics) {
        break;
      }
    }
  }

  return {
    candidate: candidate,
    searchedMessageCount: messages.length,
    rejectionSummary: rejectionSummary,
    diagnostics: diagnostics
  };
}

/** Returns the MTD facility coverage response used by the V2 frontend. */
function getCycleCoverage(optionalMonth) {
  const config = getConfig();
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(CYCLE_COVERAGE_SHEET_NAME);
  if (sheet && !cycleCoverageHasAbcColumns_(sheet)) {
    sheet = setupCycleCoverageSheet_(spreadsheet);
  }
  const cycleEndDate = coverageCycleEndDate_(
    config.coverageCycleStartDate,
    config.coverageCycleMonths
  );

  if (!sheet || sheet.getLastRow() <= 1) {
    return {
      setupRequired: !sheet,
      cycleStartDate: config.coverageCycleStartDate,
      cycleEndDate: cycleEndDate,
      selectedMonth: validCoverageMonth_(optionalMonth) ||
        config.coverageCycleStartDate.slice(0, 7),
      availableMonths: [],
      facilities: COVERAGE_FACILITIES.slice(),
      rows: [],
      latest: null
    };
  }

  repairLatestCoverageAbcOpeningIfMissing_(spreadsheet, sheet);
  const records = readCycleCoverageRecords_(sheet);
  const availableMonths = uniqueSorted_(records.map(function (record) {
    return record.date.slice(0, 7);
  })).reverse();
  const selectedMonth = validCoverageMonth_(optionalMonth) ||
    (availableMonths.length > 0
      ? availableMonths[0]
      : config.coverageCycleStartDate.slice(0, 7));
  const monthRows = records.filter(function (record) {
    return record.date.slice(0, 7) === selectedMonth;
  });
  const latest = monthRows.length > 0
    ? monthRows[monthRows.length - 1]
    : null;

  return {
    setupRequired: false,
    cycleStartDate: config.coverageCycleStartDate,
    cycleEndDate: cycleEndDate,
    selectedMonth: selectedMonth,
    availableMonths: availableMonths,
    facilities: COVERAGE_FACILITIES.slice(),
    rows: monthRows,
    latest: latest
  };
}

/** Refreshes hidden counted quantities without interrupting the main KPI API. */
function refreshCycleCoverageSystemSafely_(inventoryRows) {
  try {
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = spreadsheet.getSheetByName(CYCLE_COVERAGE_SHEET_NAME);

    if (!sheet || sheet.getLastRow() <= 1) {
      return null;
    }

    if (!cycleCoverageHasAbcColumns_(sheet)) {
      sheet = setupCycleCoverageSheet_(spreadsheet);
    }

    return refreshCycleCoverageSystem_(inventoryRows, sheet);
  } catch (error) {
    console.error(
      'Cycle coverage refresh skipped: ' +
        (error && error.message ? error.message : error)
    );
    return null;
  }
}

/**
 * Recalculates daily and cumulative counted quantities for every stored date.
 *
 * The numerator is System Quantity from cycle-count rows. The denominator is
 * that date's emailed GOOD_INVENTORY Quantity. BAD and QC values stay stored
 * for audit but never enter the completion percentage.
 */
function refreshCycleCoverageSystem_(inventoryRows, optionalSheet) {
  const config = getConfig();
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = optionalSheet ||
    spreadsheet.getSheetByName(CYCLE_COVERAGE_SHEET_NAME);

  if (!sheet || sheet.getLastRow() <= 1) {
    return { updated: false, rowCount: 0, latest: null };
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  const indexes = headerIndexMap_(headers);
  const values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, headers.length)
    .getValues();
  const records = values
    .map(function (row) {
      return {
        row: row,
        date: normalizeDate_(row[indexes.Date], getTimeZone_())
      };
    })
    .filter(function (record) {
      return record.date &&
        record.date >= config.coverageCycleStartDate;
    })
    .sort(function (first, second) {
      return first.date.localeCompare(second.date);
    });
  const abcClassMap = readAbcClassMap_(spreadsheet);
  refreshLatestCoverageAbcOpening_(
    records,
    indexes,
    abcClassMap
  );
  const countedByDate = coverageCountedQuantitiesByDate_(
    inventoryRows,
    config.coverageCycleStartDate
  );
  const countedAbcByDate = coverageCountedAbcQuantitiesByDate_(
    inventoryRows,
    config.coverageCycleStartDate
  );
  const countDates = Object.keys(countedByDate).sort();
  const cumulative = emptyFacilityNumberMap_();
  const cumulativeAbc = emptyCoverageAbcNumberMap_();
  let countDateIndex = 0;
  let previousTotalGood = 0;
  let previousDate = '';

  records.forEach(function (record) {
    while (
      countDateIndex < countDates.length &&
      countDates[countDateIndex] <= record.date
    ) {
      const countDate = countDates[countDateIndex];
      COVERAGE_FACILITIES.forEach(function (facility) {
        cumulative[facility] +=
          countedByDate[countDate][facility] || 0;
      });
      COVERAGE_ABC_CLASSES.forEach(function (abcClass) {
        cumulativeAbc[abcClass] += countedAbcByDate[countDate]
          ? countedAbcByDate[countDate][abcClass] || 0
          : 0;
      });
      countDateIndex += 1;
    }

    let totalGood = 0;
    let totalBad = 0;
    let totalQc = 0;
    let totalDailyCounted = 0;
    let totalCumulativeCounted = 0;

    COVERAGE_FACILITIES.forEach(function (facility) {
      const good = toNumber_(
        record.row[indexes[facility + ' Good Qty']]
      );
      const bad = toNumber_(
        record.row[indexes[facility + ' Bad Qty']]
      );
      const qc = toNumber_(
        record.row[indexes[facility + ' QC Rejected Qty']]
      );
      const daily = countedByDate[record.date]
        ? countedByDate[record.date][facility] || 0
        : 0;
      const cumulativeCounted = cumulative[facility];
      const completion = good === 0 ? 0 : cumulativeCounted / good;

      record.row[indexes[facility + ' Daily Counted Qty']] =
        round_(daily, 2);
      record.row[indexes[facility + ' Cumulative Counted Qty']] =
        round_(cumulativeCounted, 2);
      record.row[indexes[facility + ' Completion %']] = completion;
      totalGood += good;
      totalBad += bad;
      totalQc += qc;
      totalDailyCounted += daily;
      totalCumulativeCounted += cumulativeCounted;
    });

    COVERAGE_ABC_CLASSES.forEach(function (abcClass) {
      const dailyAbc = countedAbcByDate[record.date]
        ? countedAbcByDate[record.date][abcClass] || 0
        : 0;
      record.row[indexes[abcClass + ' Daily Counted Qty']] = round_(
        dailyAbc,
        2
      );
      record.row[indexes[abcClass + ' Cumulative Counted Qty']] = round_(
        cumulativeAbc[abcClass],
        2
      );
    });

    const totalCompletion = totalGood === 0
      ? 0
      : totalCumulativeCounted / totalGood;
    const changeQuantity = previousDate
      ? totalGood - previousTotalGood
      : 0;
    const changePercent = previousDate && previousTotalGood !== 0
      ? changeQuantity / previousTotalGood
      : 0;
    const isAlert = previousDate &&
      Math.abs(changePercent * 100) >=
        config.inventoryChangeAlertPercent;
    const direction = changeQuantity >= 0 ? 'increased' : 'decreased';
    const sign = changePercent >= 0 ? '+' : '';
    const alertNote = isAlert
      ? 'Opening GOOD inventory ' +
        direction +
        ' by ' +
        formatPlainNumber_(Math.abs(changeQuantity)) +
        ' units (' +
        sign +
        round_(changePercent * 100, 2) +
        '%) compared with ' +
        previousDate +
        '.'
      : '';

    record.row[indexes['TOTAL Good Qty']] = round_(totalGood, 2);
    record.row[indexes['TOTAL Daily Counted Qty']] =
      round_(totalDailyCounted, 2);
    record.row[indexes['TOTAL Cumulative Counted Qty']] =
      round_(totalCumulativeCounted, 2);
    record.row[indexes['TOTAL Completion %']] = totalCompletion;
    record.row[indexes['TOTAL Bad Qty']] = round_(totalBad, 2);
    record.row[indexes['TOTAL QC Rejected Qty']] = round_(totalQc, 2);
    record.row[indexes['Previous Total Good Qty']] =
      round_(previousTotalGood, 2);
    record.row[indexes['Change Qty']] = round_(changeQuantity, 2);
    record.row[indexes['Change %']] = changePercent;
    record.row[indexes['Alert Note']] = alertNote;
    record.row[indexes.Date] = record.date;

    previousTotalGood = totalGood;
    previousDate = record.date;
  });

  if (records.length > 0) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length)
      .clearContent();
    sheet.getRange(2, 1, records.length, headers.length)
      .setValues(records.map(function (record) {
        return record.row;
      }));
  }

  const responseRecords = readCycleCoverageRecords_(sheet);
  return {
    updated: true,
    rowCount: responseRecords.length,
    latest: responseRecords.length > 0
      ? responseRecords[responseRecords.length - 1]
      : null
  };
}

/** Aggregates System Quantity from cycle-count rows by date and facility. */
function coverageCountedQuantitiesByDate_(inventoryRows, cycleStartDate) {
  const result = {};

  (inventoryRows || []).forEach(function (row) {
    const date = cleanText_(row.date);
    const facility = cleanText_(row.facility);

    if (
      !date ||
      date < cycleStartDate ||
      COVERAGE_FACILITIES.indexOf(facility) < 0
    ) {
      return;
    }

    if (!result[date]) {
      result[date] = emptyFacilityNumberMap_();
    }

    result[date][facility] += Math.max(
      0,
      toNumber_(row.systemQuantity)
    );
  });

  return result;
}

/**
 * Repairs a latest coverage row whose A/B/C opening quantities are blank.
 *
 * A Gmail trigger can occasionally finish writing the facility totals before
 * the newer ABC columns are populated. When that happens, the overall pending
 * percentage is still correct but each class pending quantity appears as zero.
 * This small self-heal reloads only the latest source CSV and writes the missing
 * A/B/C opening split before the API response is returned.
 */
function repairLatestCoverageAbcOpeningIfMissing_(spreadsheet, sheet) {
  if (!sheet || sheet.getLastRow() <= 1) {
    return false;
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  const indexes = headerIndexMap_(headers);
  const latestRowNumber = sheet.getLastRow();
  const latestRow = sheet
    .getRange(latestRowNumber, 1, 1, headers.length)
    .getValues()[0];
  const totalGoodQuantity = toNumber_(
    latestRow[indexes['TOTAL Good Qty']]
  );
  const storedAbcTotal = COVERAGE_ABC_CLASSES.reduce(
    function (total, abcClass) {
      return total + toNumber_(
        latestRow[indexes[abcClass + ' Good Qty']]
      );
    },
    0
  );
  const latestDate = normalizeDate_(
    latestRow[indexes.Date],
    getTimeZone_()
  );

  if (totalGoodQuantity <= 0) {
    return false;
  }

  if (Math.abs(storedAbcTotal - totalGoodQuantity) <= 0.01) {
    saveLatestCoverageAbcOpening_(
      latestDate,
      coverageAbcOpeningFromRow_(latestRow, indexes),
      totalGoodQuantity,
      latestRow[indexes['ABC Mapping Signature']]
    );
    return false;
  }

  const savedOpening = getSavedLatestCoverageAbcOpening_(
    latestDate,
    totalGoodQuantity
  );
  if (savedOpening) {
    applyCoverageAbcOpeningToRow_(latestRow, indexes, savedOpening.quantities);
    latestRow[indexes['ABC Mapping Signature']] = savedOpening.signature;
    sheet
      .getRange(latestRowNumber, 1, 1, headers.length)
      .setValues([latestRow]);
    console.log(
      'Restored the latest ABC opening split for ' + latestDate +
        ' from the protected copy.'
    );
    return true;
  }

  const abcClassMap = readAbcClassMap_(spreadsheet);
  const records = [{
    row: latestRow,
    date: latestDate
  }];
  const repaired = refreshLatestCoverageAbcOpening_(
    records,
    indexes,
    abcClassMap
  );

  if (!repaired) {
    return repairCoverageAbcOpeningFromPrevious_(
      sheet,
      latestRowNumber,
      latestRow,
      headers,
      indexes,
      latestDate,
      totalGoodQuantity
    );
  }

  const repairedAbcTotal = COVERAGE_ABC_CLASSES.reduce(
    function (total, abcClass) {
      return total + toNumber_(
        latestRow[indexes[abcClass + ' Good Qty']]
      );
    },
    0
  );

  if (Math.abs(repairedAbcTotal - totalGoodQuantity) > 0.01) {
    console.warn(
      'ABC opening repair was not saved because its total did not match ' +
      'the latest TOTAL Good Qty.'
    );
    return repairCoverageAbcOpeningFromPrevious_(
      sheet,
      latestRowNumber,
      latestRow,
      headers,
      indexes,
      latestDate,
      totalGoodQuantity
    );
  }

  sheet
    .getRange(latestRowNumber, 1, 1, headers.length)
    .setValues([latestRow]);
  saveLatestCoverageAbcOpening_(
    latestDate,
    coverageAbcOpeningFromRow_(latestRow, indexes),
    totalGoodQuantity,
    latestRow[indexes['ABC Mapping Signature']]
  );
  console.log(
    'Repaired the latest ABC opening split for ' + records[0].date + '.'
  );
  return true;
}

/**
 * Uses the latest earlier valid A/B/C opening mix when today's source split is
 * temporarily unavailable.
 *
 * The previous class proportions are scaled to today's TOTAL Good Qty. This is
 * safer than returning zero pending quantities and is automatically replaced
 * when a later refresh can read the exact emailed CSV split.
 */
function repairCoverageAbcOpeningFromPrevious_(
  sheet,
  latestRowNumber,
  latestRow,
  headers,
  indexes,
  latestDate,
  totalGoodQuantity
) {
  if (latestRowNumber <= 2 || totalGoodQuantity <= 0) {
    return false;
  }

  const priorRows = sheet
    .getRange(2, 1, latestRowNumber - 2, headers.length)
    .getValues();

  for (let index = priorRows.length - 1; index >= 0; index -= 1) {
    const priorRow = priorRows[index];
    const priorQuantities = coverageAbcOpeningFromRow_(priorRow, indexes);
    const priorTotal = COVERAGE_ABC_CLASSES.reduce(
      function (total, abcClass) {
        return total + toNumber_(priorQuantities[abcClass]);
      },
      0
    );

    if (priorTotal <= 0) {
      continue;
    }

    const scaledQuantities = scaleCoverageAbcOpening_(
      priorQuantities,
      totalGoodQuantity
    );
    const priorDate = normalizeDate_(
      priorRow[indexes.Date],
      getTimeZone_()
    );

    applyCoverageAbcOpeningToRow_(
      latestRow,
      indexes,
      scaledQuantities
    );
    latestRow[indexes['ABC Mapping Signature']] =
      'FALLBACK_FROM_' + (priorDate || 'PREVIOUS');
    sheet
      .getRange(latestRowNumber, 1, 1, headers.length)
      .setValues([latestRow]);
    saveLatestCoverageAbcOpening_(
      latestDate,
      scaledQuantities,
      totalGoodQuantity,
      latestRow[indexes['ABC Mapping Signature']]
    );
    console.warn(
      'Used the ABC opening mix from ' +
        (priorDate || 'the previous valid snapshot') +
        ' for ' + latestDate + ' because today\'s exact split was unavailable.'
    );
    return true;
  }

  return false;
}

/** Scales one A/B/C opening mix to a new TOTAL Good Qty without losing units. */
function scaleCoverageAbcOpening_(quantities, targetTotal) {
  const weights = COVERAGE_ABC_CLASSES.map(function (abcClass) {
    return Math.max(0, toNumber_(quantities && quantities[abcClass]));
  });
  const distributed = distributeCoverageQuantity_(targetTotal, weights);
  const scaled = emptyCoverageAbcNumberMap_();

  COVERAGE_ABC_CLASSES.forEach(function (abcClass, index) {
    scaled[abcClass] = distributed[index];
  });
  return scaled;
}

/** Returns the four stored opening quantities from one coverage row. */
function coverageAbcOpeningFromRow_(row, indexes) {
  const quantities = emptyCoverageAbcNumberMap_();
  COVERAGE_ABC_CLASSES.forEach(function (abcClass) {
    quantities[abcClass] = round_(
      toNumber_(row[indexes[abcClass + ' Good Qty']]),
      2
    );
  });
  return quantities;
}

/** Writes an A/B/C opening split into one in-memory coverage row. */
function applyCoverageAbcOpeningToRow_(row, indexes, quantities) {
  COVERAGE_ABC_CLASSES.forEach(function (abcClass) {
    row[indexes[abcClass + ' Good Qty']] = round_(
      toNumber_(quantities && quantities[abcClass]),
      2
    );
  });
}

/** Saves one small protected copy so a stale trigger cannot erase the split. */
function saveLatestCoverageAbcOpening_(
  date,
  quantities,
  totalGoodQuantity,
  signature
) {
  const safeDate = cleanText_(date);
  const safeTotal = round_(toNumber_(totalGoodQuantity), 2);
  const safeQuantities = emptyCoverageAbcNumberMap_();
  let splitTotal = 0;

  COVERAGE_ABC_CLASSES.forEach(function (abcClass) {
    safeQuantities[abcClass] = round_(
      toNumber_(quantities && quantities[abcClass]),
      2
    );
    splitTotal += safeQuantities[abcClass];
  });

  if (
    !safeDate ||
    safeTotal <= 0 ||
    Math.abs(splitTotal - safeTotal) > 0.01
  ) {
    return false;
  }

  PropertiesService.getScriptProperties().setProperty(
    LATEST_COVERAGE_ABC_PROPERTY,
    JSON.stringify({
      date: safeDate,
      totalGoodQuantity: safeTotal,
      quantities: safeQuantities,
      signature: cleanText_(signature),
      savedAt: new Date().toISOString()
    })
  );
  return true;
}

/** Reads the protected split only when its date and total match exactly. */
function getSavedLatestCoverageAbcOpening_(date, totalGoodQuantity) {
  const storedText = PropertiesService.getScriptProperties().getProperty(
    LATEST_COVERAGE_ABC_PROPERTY
  );
  if (!storedText) {
    return null;
  }

  try {
    const stored = JSON.parse(storedText);
    if (
      cleanText_(stored.date) !== cleanText_(date) ||
      Math.abs(
        toNumber_(stored.totalGoodQuantity) -
          toNumber_(totalGoodQuantity)
      ) > 0.01
    ) {
      return null;
    }
    return stored;
  } catch (error) {
    console.warn('The protected ABC opening copy could not be read.');
    return null;
  }
}

/** Aggregates counted System Quantity by transaction date and ABC class. */
function coverageCountedAbcQuantitiesByDate_(inventoryRows, cycleStartDate) {
  const result = {};

  (inventoryRows || []).forEach(function (row) {
    const date = cleanText_(row.date);
    const facility = cleanText_(row.facility);

    if (
      !date ||
      date < cycleStartDate ||
      COVERAGE_FACILITIES.indexOf(facility) < 0
    ) {
      return;
    }

    if (!result[date]) {
      result[date] = emptyCoverageAbcNumberMap_();
    }

    const abcClass = normalizeCoverageAbcClass_(row.abcClass);
    result[date][abcClass] += Math.max(
      0,
      toNumber_(row.systemQuantity)
    );
  });

  return result;
}

/**
 * Rebuilds the latest opening GOOD split when the SKU master mapping changes.
 *
 * The full emailed inventory file is fetched only when its stored ABC mapping
 * signature is blank or different. Normal dashboard loads therefore keep using
 * the compact quantities already saved in the hidden system sheet.
 */
function refreshLatestCoverageAbcOpening_(records, indexes, abcClassMap) {
  if (!records || records.length === 0) {
    return false;
  }

  const latestRecord = records[records.length - 1];
  const expectedSignature = abcClassMapSignature_(abcClassMap);
  const storedSignature = cleanText_(
    latestRecord.row[indexes['ABC Mapping Signature']]
  );
  const storedOpeningTotal = COVERAGE_ABC_CLASSES.reduce(
    function (total, abcClass) {
      return total + toNumber_(
        latestRecord.row[indexes[abcClass + ' Good Qty']]
      );
    },
    0
  );

  if (
    storedSignature === expectedSignature &&
    storedOpeningTotal > 0
  ) {
    return false;
  }

  const sourceUrl = cleanText_(latestRecord.row[indexes['Source URL']]);
  if (!sourceUrl) {
    return false;
  }

  try {
    const response = UrlFetchApp.fetch(sourceUrl, {
      method: 'get',
      followRedirects: true,
      muteHttpExceptions: true
    });
    const responseCode = response.getResponseCode();
    if (responseCode < 200 || responseCode >= 300) {
      console.warn(
        'ABC opening split refresh skipped because the source returned ' +
        String(responseCode) + '.'
      );
      return false;
    }

    const parsed = parseInventoryExportCsv_(
      response.getContentText('UTF-8'),
      abcClassMap
    );
    COVERAGE_ABC_CLASSES.forEach(function (abcClass) {
      latestRecord.row[indexes[abcClass + ' Good Qty']] = round_(
        parsed.abcGoodQuantities[abcClass],
        2
      );
    });
    latestRecord.row[indexes['ABC Mapping Signature']] = expectedSignature;
    return true;
  } catch (error) {
    console.error(
      'ABC opening split refresh failed: ' +
      (error && error.message ? error.message : error)
    );
    return false;
  }
}

/** Parses the emailed CSV without keeping all 90,000 source rows in memory. */
function parseInventoryExportCsv_(csvText, optionalAbcClassMap) {
  const abcClassMap = optionalAbcClassMap || {};
  let indexes = null;
  let skuIndex = -1;
  const facilities = emptyInventoryFacilityMap_();
  const abcGoodQuantities = emptyCoverageAbcNumberMap_();
  let selectedRowCount = 0;
  let ignoredFacilityRowCount = 0;
  let ignoredInventoryTypeRowCount = 0;
  let invalidQuantityRowCount = 0;

  forEachCsvRow_(csvText, function (row, rowNumber) {
    if (rowNumber === 1) {
      indexes = csvHeaderIndexes_(row, [
        'Facility',
        'Inventory Type',
        'Quantity'
      ]);
      skuIndex = row.map(normalizeHeader_).indexOf(
        normalizeHeader_('Item Type SKU Code')
      );
      return;
    }

    const sourceFacility = cleanText_(row[indexes.Facility])
      .toUpperCase()
      .replace(/\s+/g, ' ');
    const facility = INVENTORY_EXPORT_FACILITY_MAP[sourceFacility];

    if (!facility) {
      ignoredFacilityRowCount += 1;
      return;
    }

    const inventoryType = normalizeInventoryType_(
      row[indexes['Inventory Type']]
    );
    const quantity = optionalNumber_(row[indexes.Quantity]);

    if (quantity === null) {
      invalidQuantityRowCount += 1;
      return;
    }

    if (inventoryType === 'GOOD_INVENTORY') {
      facilities[facility].goodQuantity += quantity;
      const sku = skuIndex >= 0 ? normalizeSku_(row[skuIndex]) : '';
      const abcClass = sku && abcClassMap[sku]
        ? abcClassMap[sku]
        : 'C';
      abcGoodQuantities[abcClass] += quantity;
    } else if (inventoryType === 'BAD_INVENTORY') {
      facilities[facility].badQuantity += quantity;
    } else if (inventoryType === 'QC_REJECTED') {
      facilities[facility].qcRejectedQuantity += quantity;
    } else {
      ignoredInventoryTypeRowCount += 1;
      return;
    }

    selectedRowCount += 1;
  });

  return {
    facilities: facilities,
    abcGoodQuantities: abcGoodQuantities,
    selectedRowCount: selectedRowCount,
    ignoredFacilityRowCount: ignoredFacilityRowCount,
    ignoredInventoryTypeRowCount: ignoredInventoryTypeRowCount,
    invalidQuantityRowCount: invalidQuantityRowCount
  };
}

/** Iterates RFC-style CSV rows, including quoted commas and escaped quotes. */
function forEachCsvRow_(csvText, callback) {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  let row = [];
  let field = '';
  let quoted = false;
  let rowNumber = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);

    if (character === '"') {
      if (quoted && text.charAt(index + 1) === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text.charAt(index + 1) === '\n') {
        index += 1;
      }
      row.push(field);
      field = '';
      rowNumber += 1;
      if (row.some(function (value) { return cleanText_(value); })) {
        callback(row, rowNumber);
      }
      row = [];
    } else {
      field += character;
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rowNumber += 1;
    if (row.some(function (value) { return cleanText_(value); })) {
      callback(row, rowNumber);
    }
  }
}

/** Validates and maps required emailed CSV columns. */
function csvHeaderIndexes_(headerRow, requiredHeaders) {
  const normalizedHeaders = headerRow.map(normalizeHeader_);
  const indexes = {};

  requiredHeaders.forEach(function (header) {
    const index = normalizedHeaders.indexOf(normalizeHeader_(header));
    if (index < 0) {
      throw new Error(
        'Inventory export is missing the required column "' +
          header +
          '".'
      );
    }
    indexes[header] = index;
  });

  return indexes;
}

/** Inserts or replaces the stored opening snapshot for one reporting date. */
function upsertCycleCoverageSnapshot_(sheet, snapshot) {
  const headers = cycleCoverageHeaders_();
  const indexes = headerIndexMap_(headers);
  const row = new Array(headers.length).fill('');
  let totalGood = 0;
  let totalBad = 0;
  let totalQc = 0;

  row[indexes.Date] = snapshot.reportDate;
  COVERAGE_FACILITIES.forEach(function (facility) {
    const values = snapshot.facilities[facility] ||
      emptyInventoryFacilityTotals_();
    row[indexes[facility + ' Good Qty']] =
      round_(values.goodQuantity, 2);
    row[indexes[facility + ' Bad Qty']] =
      round_(values.badQuantity, 2);
    row[indexes[facility + ' QC Rejected Qty']] =
      round_(values.qcRejectedQuantity, 2);
    totalGood += values.goodQuantity;
    totalBad += values.badQuantity;
    totalQc += values.qcRejectedQuantity;
  });
  row[indexes['TOTAL Good Qty']] = round_(totalGood, 2);
  row[indexes['TOTAL Bad Qty']] = round_(totalBad, 2);
  row[indexes['TOTAL QC Rejected Qty']] = round_(totalQc, 2);
  row[indexes['Source File']] = snapshot.sourceFile;
  row[indexes['Source URL']] = snapshot.sourceUrl;
  row[indexes['Imported At']] = snapshot.importedAt;
  row[indexes['Import Status']] = snapshot.importStatus;
  COVERAGE_ABC_CLASSES.forEach(function (abcClass) {
    row[indexes[abcClass + ' Good Qty']] = round_(
      toNumber_(
        snapshot.abcGoodQuantities &&
        snapshot.abcGoodQuantities[abcClass]
      ),
      2
    );
  });
  row[indexes['ABC Mapping Signature']] = cleanText_(
    snapshot.abcMappingSignature
  );

  let targetRow = sheet.getLastRow() + 1;
  let inserted = true;
  let priorMessageIds = '';
  let existingRow = null;

  if (sheet.getLastRow() > 1) {
    const existingValues = sheet
      .getRange(2, 1, sheet.getLastRow() - 1, headers.length)
      .getValues();

    for (let index = 0; index < existingValues.length; index += 1) {
      const existingDate = normalizeDate_(
        existingValues[index][indexes.Date],
        getTimeZone_()
      );
      if (existingDate === snapshot.reportDate) {
        targetRow = index + 2;
        inserted = false;
        existingRow = existingValues[index];
        priorMessageIds = cleanText_(
          existingValues[index][indexes['Gmail Message ID']]
        );
        break;
      }
    }
  }

  const incomingAbcTotal = COVERAGE_ABC_CLASSES.reduce(
    function (total, abcClass) {
      return total + toNumber_(row[indexes[abcClass + ' Good Qty']]);
    },
    0
  );
  if (existingRow && incomingAbcTotal <= 0 && totalGood > 0) {
    const existingAbcTotal = COVERAGE_ABC_CLASSES.reduce(
      function (total, abcClass) {
        return total + toNumber_(
          existingRow[indexes[abcClass + ' Good Qty']]
        );
      },
      0
    );
    if (Math.abs(existingAbcTotal - totalGood) <= 0.01) {
      applyCoverageAbcOpeningToRow_(
        row,
        indexes,
        coverageAbcOpeningFromRow_(existingRow, indexes)
      );
      row[indexes['ABC Mapping Signature']] = cleanText_(
        existingRow[indexes['ABC Mapping Signature']]
      );
    }
  }

  const messageIds = priorMessageIds
    ? priorMessageIds.split(',').map(cleanText_)
    : [];
  if (messageIds.indexOf(snapshot.messageId) < 0) {
    messageIds.push(snapshot.messageId);
  }
  row[indexes['Gmail Message ID']] = messageIds.filter(Boolean).join(',');
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
  saveLatestCoverageAbcOpening_(
    snapshot.reportDate,
    coverageAbcOpeningFromRow_(row, indexes),
    totalGood,
    row[indexes['ABC Mapping Signature']]
  );

  if (sheet.getLastRow() > 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length)
      .sort({ column: 1, ascending: true });
  }

  if (!sheet.isSheetHidden()) {
    sheet.hideSheet();
  }

  return { inserted: inserted, targetRow: targetRow };
}

/** Reads all imported message IDs so repeated trigger runs are idempotent. */
function coverageProcessedMessageIds_(sheet) {
  const ids = {};

  if (!sheet || sheet.getLastRow() <= 1) {
    return ids;
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  const indexes = headerIndexMap_(headers);
  const values = sheet
    .getRange(2, indexes['Gmail Message ID'] + 1, sheet.getLastRow() - 1, 1)
    .getDisplayValues();

  values.forEach(function (row) {
    cleanText_(row[0]).split(',').forEach(function (id) {
      const messageId = cleanText_(id);
      if (messageId) {
        ids[messageId] = true;
      }
    });
  });

  return ids;
}

/** Converts hidden sheet rows into a compact API response. */
function readCycleCoverageRecords_(sheet) {
  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0];
  const indexes = headerIndexMap_(headers);
  const values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, headers.length)
    .getValues();

  return values.map(function (row) {
    const facilities = {};

    COVERAGE_FACILITIES.forEach(function (facility) {
      facilities[facility] = {
        goodQuantity: round_(
          toNumber_(row[indexes[facility + ' Good Qty']]),
          2
        ),
        dailyCountedQuantity: round_(
          toNumber_(row[indexes[facility + ' Daily Counted Qty']]),
          2
        ),
        cumulativeCountedQuantity: round_(
          toNumber_(row[indexes[facility + ' Cumulative Counted Qty']]),
          2
        ),
        completionPercent: round_(
          toNumber_(row[indexes[facility + ' Completion %']]) * 100,
          2
        )
      };
    });

    const totalGoodQuantity = round_(
      toNumber_(row[indexes['TOTAL Good Qty']]),
      2
    );
    const totalCumulativeCountedQuantity = round_(
      toNumber_(row[indexes['TOTAL Cumulative Counted Qty']]),
      2
    );

    const recordDate = normalizeDate_(row[indexes.Date], getTimeZone_());

    return {
      date: recordDate,
      facilities: facilities,
      totalGoodQuantity: totalGoodQuantity,
      totalDailyCountedQuantity: round_(
        toNumber_(row[indexes['TOTAL Daily Counted Qty']]),
        2
      ),
      totalCumulativeCountedQuantity: totalCumulativeCountedQuantity,
      totalCompletionPercent: round_(
        toNumber_(row[indexes['TOTAL Completion %']]) * 100,
        2
      ),
      changeQuantity: round_(
        toNumber_(row[indexes['Change Qty']]),
        2
      ),
      changePercent: round_(
        toNumber_(row[indexes['Change %']]) * 100,
        2
      ),
      alertNote: cleanText_(row[indexes['Alert Note']]),
      sourceFile: cleanText_(row[indexes['Source File']]),
      importedAt: cleanText_(row[indexes['Imported At']]),
      importStatus: cleanText_(row[indexes['Import Status']]),
      abcCoverage: buildCoverageAbcBreakdown_(
        row,
        indexes,
        totalGoodQuantity,
        totalCumulativeCountedQuantity,
        recordDate
      )
    };
  }).filter(function (record) {
    return record.date;
  }).sort(function (first, second) {
    return first.date.localeCompare(second.date);
  });
}

/** Builds the A/B/C completed and pending contribution view for one snapshot. */
function buildCoverageAbcBreakdown_(
  row,
  indexes,
  totalGoodQuantity,
  totalCumulativeCountedQuantity,
  recordDate
) {
  let classTotals = COVERAGE_ABC_CLASSES.map(function (abcClass) {
    return {
      abcClass: abcClass,
      openingGoodQuantity: round_(
        toNumber_(row[indexes[abcClass + ' Good Qty']]),
        2
      ),
      dailyCountedQuantity: round_(
        toNumber_(row[indexes[abcClass + ' Daily Counted Qty']]),
        2
      ),
      cumulativeCountedQuantity: round_(
        toNumber_(row[indexes[abcClass + ' Cumulative Counted Qty']]),
        2
      )
    };
  });
  const storedOpeningTotal = classTotals.reduce(function (total, item) {
    return total + item.openingGoodQuantity;
  }, 0);

  if (storedOpeningTotal <= 0 && totalGoodQuantity > 0) {
    const protectedOpening = getSavedLatestCoverageAbcOpening_(
      recordDate,
      totalGoodQuantity
    );
    if (protectedOpening) {
      classTotals = classTotals.map(function (item) {
        item.openingGoodQuantity = round_(
          toNumber_(protectedOpening.quantities[item.abcClass]),
          2
        );
        return item;
      });
    }
  }

  // Older snapshots may still contain an Unclassified column. The current
  // business rule treats it as C, including opening, counted, and pending qty.
  const cClass = classTotals.filter(function (item) {
    return item.abcClass === 'C';
  })[0];
  const unclassified = classTotals.filter(function (item) {
    return item.abcClass === 'Unclassified';
  })[0];
  if (cClass && unclassified) {
    cClass.openingGoodQuantity = round_(
      cClass.openingGoodQuantity + unclassified.openingGoodQuantity,
      2
    );
    cClass.dailyCountedQuantity = round_(
      cClass.dailyCountedQuantity + unclassified.dailyCountedQuantity,
      2
    );
    cClass.cumulativeCountedQuantity = round_(
      cClass.cumulativeCountedQuantity +
        unclassified.cumulativeCountedQuantity,
      2
    );
  }
  classTotals = classTotals.filter(function (item) {
    return item.abcClass !== 'Unclassified';
  });

  return calculateCoverageAbcBreakdown_(
    classTotals,
    totalGoodQuantity,
    totalCumulativeCountedQuantity
  );
}

/**
 * Converts class quantities into percentages of the overall opening inventory.
 * Completed class contributions add to the banner completion percentage;
 * pending class contributions add to the remaining percentage, so the complete
 * A/B/C view always reconciles to 100%.
 */
function calculateCoverageAbcBreakdown_(
  classTotals,
  totalGoodQuantity,
  totalCumulativeCountedQuantity
) {
  const safeGood = Math.max(0, toNumber_(totalGoodQuantity));
  const safeCounted = Math.max(
    0,
    toNumber_(totalCumulativeCountedQuantity)
  );
  const completedPercent = safeGood === 0
    ? 0
    : Math.min(100, safeCounted / safeGood * 100);
  const pendingPercent = Math.max(0, 100 - completedPercent);
  const countedWeights = classTotals.map(function (item) {
    return Math.max(0, toNumber_(item.cumulativeCountedQuantity));
  });
  const storedOpeningTotal = classTotals.reduce(function (total, item) {
    return total + Math.max(0, toNumber_(item.openingGoodQuantity));
  }, 0);

  // A stale importer can occasionally store the overall GOOD total before its
  // A/B/C split. Never publish zero pending quantities in that state. Allocate
  // the opening total by the completed class mix until the exact split is
  // restored from the source CSV or a previous valid snapshot.
  if (safeGood > 0 && storedOpeningTotal <= 0) {
    const fallbackWeights = countedWeights.some(function (value) {
      return value > 0;
    })
      ? countedWeights
      : classTotals.map(function (item) {
          return item.abcClass === 'C' ? 1 : 0;
        });
    const fallbackOpenings = distributeCoverageQuantity_(
      safeGood,
      fallbackWeights
    );

    classTotals.forEach(function (item, index) {
      item.openingGoodQuantity = fallbackOpenings[index];
    });
  }

  const pendingWeights = classTotals.map(function (item) {
    return Math.max(
      0,
      toNumber_(item.openingGoodQuantity) -
        toNumber_(item.cumulativeCountedQuantity)
    );
  });
  const completedContributions = distributeCoveragePercent_(
    completedPercent,
    countedWeights
  );
  const pendingContributions = distributeCoveragePercent_(
    pendingPercent,
    pendingWeights.some(function (value) { return value > 0; })
      ? pendingWeights
      : classTotals.map(function (item) {
          return Math.max(0, toNumber_(item.openingGoodQuantity));
        })
  );

  return {
    classes: classTotals.map(function (item, index) {
      return {
        abcClass: item.abcClass,
        openingGoodQuantity: round_(item.openingGoodQuantity, 2),
        dailyCountedQuantity: round_(item.dailyCountedQuantity, 2),
        cumulativeCountedQuantity: round_(
          item.cumulativeCountedQuantity,
          2
        ),
        completedContributionPercent: completedContributions[index],
        pendingQuantity: round_(pendingWeights[index], 2),
        pendingContributionPercent: pendingContributions[index]
      };
    }),
    completedPercent: round_(completedPercent, 2),
    pendingPercent: round_(pendingPercent, 2),
    totalPercent: safeGood > 0 ? 100 : 0
  };
}

/** Distributes one quantity across weights and corrects the rounding balance. */
function distributeCoverageQuantity_(targetQuantity, weights) {
  const target = round_(Math.max(0, toNumber_(targetQuantity)), 2);
  const safeWeights = (weights || []).map(function (value) {
    return Math.max(0, toNumber_(value));
  });
  const totalWeight = safeWeights.reduce(function (total, value) {
    return total + value;
  }, 0);
  const result = safeWeights.map(function (value) {
    return totalWeight === 0 ? 0 : round_(target * value / totalWeight, 2);
  });

  if (target > 0 && totalWeight > 0) {
    const currentTotal = result.reduce(function (total, value) {
      return total + value;
    }, 0);
    const correction = round_(target - currentTotal, 2);
    let correctionIndex = safeWeights.length - 1;

    while (correctionIndex > 0 && safeWeights[correctionIndex] === 0) {
      correctionIndex -= 1;
    }
    result[correctionIndex] = round_(
      result[correctionIndex] + correction,
      2
    );
  }

  return result;
}

/** Spreads a target percentage across weights and fixes rounding to reconcile. */
function distributeCoveragePercent_(targetPercent, weights) {
  const target = round_(Math.max(0, toNumber_(targetPercent)), 2);
  const safeWeights = (weights || []).map(function (value) {
    return Math.max(0, toNumber_(value));
  });
  const totalWeight = safeWeights.reduce(function (total, value) {
    return total + value;
  }, 0);
  const result = safeWeights.map(function (value) {
    return totalWeight === 0 ? 0 : round_(target * value / totalWeight, 2);
  });

  if (target > 0 && totalWeight > 0) {
    const currentTotal = result.reduce(function (total, value) {
      return total + value;
    }, 0);
    const correction = round_(target - currentTotal, 2);
    let correctionIndex = safeWeights.length - 1;
    while (correctionIndex > 0 && safeWeights[correctionIndex] === 0) {
      correctionIndex -= 1;
    }
    result[correctionIndex] = round_(
      result[correctionIndex] + correction,
      2
    );
  }

  return result;
}

/** Creates a header-to-column-index lookup. */
function headerIndexMap_(headers) {
  const indexes = {};
  headers.forEach(function (header, index) {
    indexes[cleanText_(header)] = index;
  });
  return indexes;
}

/** Initializes numeric facility totals for one CSV snapshot. */
function emptyInventoryFacilityMap_() {
  const result = {};
  COVERAGE_FACILITIES.forEach(function (facility) {
    result[facility] = emptyInventoryFacilityTotals_();
  });
  return result;
}

/** Initializes GOOD, BAD, and QC quantities for one facility. */
function emptyInventoryFacilityTotals_() {
  return {
    goodQuantity: 0,
    badQuantity: 0,
    qcRejectedQuantity: 0
  };
}

/** Initializes a facility-to-number map. */
function emptyFacilityNumberMap_() {
  const result = {};
  COVERAGE_FACILITIES.forEach(function (facility) {
    result[facility] = 0;
  });
  return result;
}

/** Initializes A, B, C, and Unclassified quantity totals. */
function emptyCoverageAbcNumberMap_() {
  const result = {};
  COVERAGE_ABC_CLASSES.forEach(function (abcClass) {
    result[abcClass] = 0;
  });
  return result;
}

/** Parks unexpected or blank master values in C by default. */
function normalizeCoverageAbcClass_(value) {
  const abcClass = cleanText_(value).toUpperCase();
  return ['A', 'B', 'C'].indexOf(abcClass) >= 0
    ? abcClass
    : 'C';
}

/** Creates a stable signature so master changes refresh the saved ABC split. */
function abcClassMapSignature_(abcClassMap) {
  const text = Object.keys(abcClassMap || {})
    .sort()
    .map(function (sku) {
      return sku + '=' + abcClassMap[sku];
    })
    .join('|');
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    text,
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest);
}

/** Extracts the first CSV hyperlink from the inventory email. */
function extractInventoryCsvUrl_(emailBody) {
  const decodedBody = String(emailBody || '').replace(/&amp;/g, '&');
  const match = decodedBody.match(
    /https?:\/\/[^"'\s<>]+\.csv(?:\?[^"'\s<>]*)?/i
  );
  return match ? match[0] : '';
}

/** Returns the decoded CSV filename from a download URL. */
function inventoryFileNameFromUrl_(sourceUrl) {
  if (!sourceUrl) {
    return '';
  }
  const withoutQuery = sourceUrl.split('?')[0];
  const encodedName = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(encodedName);
  } catch (error) {
    return encodedName;
  }
}

/**
 * Converts the plain and HTML email bodies into searchable readable text.
 * This removes Gmail formatting tags while retaining labels and values.
 */
function inventoryEmailSearchText_(plainBody, htmlBody) {
  return (String(plainBody || '') + '\n' + String(htmlBody || ''))
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|tr|td|li)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|#160|#xA0);/gi, ' ')
    .replace(/&(?:colon|#58|#x3A);/gi, ':')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Accepts a SUCCESSFUL value shown beside the Status label. */
function inventoryEmailWasSuccessful_(searchableBody) {
  return /\bstatus\b.{0,40}\bsuccessful\b/i.test(
    String(searchableBody || '')
  );
}

/** Reads ddMMyyyy from the standard export filename. */
function inventoryDateFromFileName_(fileName) {
  const match = cleanText_(fileName).match(
    /_(\d{2})(\d{2})(\d{4})(?:\d{6})?\.csv$/i
  );

  if (!match) {
    return '';
  }

  return [match[3], match[2], match[1]].join('-');
}

/** Normalizes GOOD, BAD, and QC source values. */
function normalizeInventoryType_(value) {
  return cleanText_(value)
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
}

/** Escapes a Config subject for the Gmail search query. */
function gmailSearchText_(value) {
  return cleanText_(value).replace(/"/g, ' ');
}

/** Returns the day before yyyy-MM-dd in Gmail's yyyy/MM/dd format. */
function gmailDateBefore_(dateText) {
  const date = parseIsoDate_(dateText);
  if (!date) {
    throw new Error('Coverage Cycle Start Date must be yyyy-MM-dd.');
  }

  return Utilities.formatDate(
    addDays_(date, -1),
    getTimeZone_(),
    'yyyy/MM/dd'
  );
}

/** Returns a valid yyyy-MM filter or blank. */
function validCoverageMonth_(value) {
  const month = cleanText_(value);
  return /^\d{4}-\d{2}$/.test(month) ? month : '';
}

/** Calculates the final date of a configured multi-month coverage cycle. */
function coverageCycleEndDate_(startDate, months) {
  const start = parseIsoDate_(startDate);
  if (!start) {
    return '';
  }
  const end = new Date(start.getTime());
  end.setMonth(end.getMonth() + Number(months));
  end.setDate(end.getDate() - 1);
  return Utilities.formatDate(end, getTimeZone_(), 'yyyy-MM-dd');
}

/** Formats a plain number for inventory-change notes. */
function formatPlainNumber_(value) {
  return Number(value || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2
  });
}

/** Returns sorted unique non-blank strings. */
function uniqueSorted_(values) {
  const seen = {};
  (values || []).forEach(function (value) {
    const text = cleanText_(value);
    if (text) {
      seen[text] = true;
    }
  });
  return Object.keys(seen).sort();
}

/**
 * Escapes one value so commas, quotes, and line breaks remain valid in CSV.
 */
function csvCell_(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text)
    ? '"' + text.replace(/"/g, '""') + '"'
    : text;
}

/**
 * Keeps missing COGS values blank instead of writing a misleading zero.
 */
function csvOptionalNumber_(value) {
  const number = optionalNumber_(value);
  return number === null ? '' : number;
}

/**
 * Tests the read-only Q1-AMJ26 history and the four dashboard periods.
 *
 * Run this after pasting Version 2. It does not change any sheet.
 */
function testQuarterData() {
  const inventoryData = getAllInventoryData_();
  const dashboard = buildDashboard_();
  const historicalDates = inventoryData.historicalRows
    .map(function (row) {
      return row.date;
    })
    .filter(Boolean)
    .sort();
  const result = {
    passed: true,
    historicalSheetName: HISTORICAL_SHEET_NAME,
    currentRowCount: inventoryData.currentRows.length,
    historicalRowCount: inventoryData.historicalRows.length,
    totalTransactionRowCount: inventoryData.allRows.length,
    firstHistoricalDate:
      historicalDates.length > 0 ? historicalDates[0] : '',
    lastHistoricalDate:
      historicalDates.length > 0
        ? historicalDates[historicalDates.length - 1]
        : '',
    periods: dashboard.periods
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Tests KPI formulas with known sample data.
 *
 * Expected:
 * Inventory Accuracy 57.2
 * Value Accuracy 48
 * Bin Accuracy 0
 * Net Difference -103
 * Short 105
 * Excess 2
 * Total Inventory Value 2,000
 * Physical Value 1,040
 * Net Difference Value -960
 * Short Value 1,000
 * Excess Value 40
 * Cost Coverage 66.67
 * Actual Bins 2
 * NTF Physical Quantity 0
 * NTF Difference -100
 */
function testKpiCalculations() {
  const sampleRows = [
    {
      facility: 'TEST',
      rack: 'R1',
      shelf: 'S1',
      skuCode: 'SKU-1',
      systemQuantity: 100,
      physicalQuantity: 98,
      difference: -2,
      unitCost: 10,
      remark: 'NTF found'
    },
    {
      facility: 'TEST',
      rack: 'R1',
      shelf: 'S1',
      skuCode: 'SKU-2',
      systemQuantity: 50,
      physicalQuantity: 52,
      difference: 2,
      unitCost: 20,
      remark: ''
    },
    {
      facility: 'TEST',
      rack: 'R2',
      shelf: 'S2',
      skuCode: 'SKU-MISSING',
      systemQuantity: 100,
      physicalQuantity: 95,
      difference: -5,
      unitCost: null,
      remark: ''
    }
  ];

  const result = calculateKpis(sampleRows, {
    periodKey: 'yesterday',
    startDate: '2026-07-22',
    endDate: '2026-07-22',
    config: {
      dailyPlannedBinCount: 100,
      workingDays: 26
    }
  });
  const normalizedNtf = normalizeNtfShortage_(
    Object.assign({}, sampleRows[0])
  );

  assertEqual_(result.inventoryAccuracy, 57.2, 'Inventory Accuracy');
  assertEqual_(result.valueAccuracy, 48, 'Value Accuracy');
  assertEqual_(
    result.absoluteDifferenceValue,
    1040,
    'Absolute Difference Value'
  );
  assertEqual_(result.binAccuracy, 0, 'Bin Accuracy');
  assertEqual_(result.netDifference, -103, 'Net Difference');
  assertEqual_(result.shortQuantity, 105, 'Short Quantity');
  assertEqual_(result.excessQuantity, 2, 'Excess Quantity');
  assertEqual_(result.systemValue, 2000, 'System Value');
  assertEqual_(result.physicalValue, 1040, 'Physical Value');
  assertEqual_(
    result.totalInventoryValue,
    2000,
    'Total Inventory Value'
  );
  assertEqual_(
    result.netDifferenceValue,
    -960,
    'Net Difference Value'
  );
  assertEqual_(result.shortValue, 1000, 'Short Value');
  assertEqual_(result.excessValue, 40, 'Excess Value');
  assertEqual_(result.costCoverage, 66.67, 'Cost Coverage');
  assertEqual_(result.costedRowCount, 2, 'Costed Row Count');
  assertEqual_(result.missingCostRowCount, 1, 'Missing Cost Row Count');
  assertEqual_(result.missingCostSkuCount, 1, 'Missing Cost SKU Count');
  assertEqual_(result.actualBinCount, 2, 'Actual Bin Count');
  assertEqual_(result.plannedBinCount, 100, 'Planned Bin Count');
  assertEqual_(result.cycleCountCompletion, 2, 'Completion');
  assertEqual_(
    normalizedNtf.physicalQuantity,
    0,
    'NTF Physical Quantity'
  );
  assertEqual_(normalizedNtf.difference, -100, 'NTF Difference');

  const output = {
    passed: true,
    message: 'All sample KPI tests passed.',
    kpis: result,
    normalizedNtf: normalizedNtf
  };

  console.log(JSON.stringify(output, null, 2));
  return output;
}

/**
 * Tests Phase 1 against the real spreadsheet and prints a compact result.
 *
 * Run setupApplication() before running this test.
 */
function testPhase1() {
  const config = getConfig();
  const rows = getCombinedData();
  const dashboard = refreshDashboardCache();

  const output = {
    passed: true,
    dashboardName: config.dashboardName,
    combinedRowCount: rows.length,
    rowsByFacility: dashboard.sourceSummary.rowsByFacility,
    skippedSourceSheets: dashboard.sourceSummary.skippedSourceSheets,
    periods: dashboard.periods,
    lastRefreshTime: getLastRefreshTime_()
  };

  console.log(JSON.stringify(output, null, 2));
  return output;
}

/**
 * Tests the real COGS join and Version 2 value KPI coverage.
 *
 * This function is read-only. It prints missing SKUs so they can be corrected
 * directly in COGS without hiding their value impact.
 */
function testValueKpis() {
  const rows = getCombinedData();
  const dashboard = refreshDashboardCache();
  const missingCostSkus = {};

  rows.forEach(function (row) {
    if (optionalNumber_(row.unitCost) === null) {
      const sku = normalizeSku_(row.skuCode);
      if (sku) {
        missingCostSkus[sku] = true;
      }
    }
  });

  const output = {
    passed: true,
    costSheetName: COST_SHEET_NAME,
    currency: 'INR',
    includesGst: false,
    combinedRowCount: rows.length,
    costSummary: dashboard.sourceSummary.costSummary,
    missingCostSkus: Object.keys(missingCostSkus).sort(),
    periods: dashboard.periods,
    lastRefreshTime: getLastRefreshTime_()
  };

  console.log(JSON.stringify(output, null, 2));
  return output;
}

/**
 * Verifies the live NTF-as-shortage rule and prints the recalculated periods.
 *
 * This test is read-only. It confirms that current NTF rows expose Physical
 * Quantity as zero, Difference as zero minus System Quantity, and that current
 * undated NTF rows are included in Month to Date.
 */
function testNtfRecalculation() {
  const inventoryData = getAllInventoryData_();
  const currentNtfRows = inventoryData.currentRows.filter(isNtfRow_);
  const currentUndatedNtfRows = currentNtfRows.filter(function (row) {
    return !row.date;
  });
  const invalidRows = currentNtfRows.filter(function (row) {
    return Math.abs(toNumber_(row.physicalQuantity)) > 0.000001 ||
      Math.abs(
        toNumber_(row.difference) +
        toNumber_(row.systemQuantity)
      ) > 0.000001;
  });
  const dashboard = refreshDashboardCache();
  const output = {
    passed: invalidRows.length === 0,
    rule: 'NTF Physical Quantity = 0; Difference = 0 - System Quantity',
    currentNtfRowCount: currentNtfRows.length,
    currentUndatedNtfRowCount: currentUndatedNtfRows.length,
    currentUndatedNtfSystemQuantity: round_(
      currentUndatedNtfRows.reduce(function (total, row) {
        return total + toNumber_(row.systemQuantity);
      }, 0),
      2
    ),
    invalidNtfRowCount: invalidRows.length,
    periods: dashboard.periods,
    lastRefreshTime: getLastRefreshTime_()
  };

  if (!output.passed) {
    throw new Error(
      'NTF normalization failed for ' +
        String(invalidRows.length) +
        ' row(s).'
    );
  }

  console.log(JSON.stringify(output, null, 2));
  return output;
}

/**
 * Tests both read-only master APIs and prints a compact result.
 *
 * This function never writes to either master sheet.
 */
function testMasters() {
  const binMaster = getBinMaster();
  const skuMaster = getSkuMaster();
  const output = {
    passed: true,
    binMasterRowCount: binMaster.length,
    skuMasterRowCount: skuMaster.length,
    firstBin: binMaster.length > 0 ? binMaster[0] : null,
    firstSku: skuMaster.length > 0 ? skuMaster[0] : null
  };

  console.log(JSON.stringify(output, null, 2));
  return output;
}

/**
 * Builds the four banner periods plus the current quarter-to-date summary.
 */
function buildDashboard_(optionalInventoryData, optionalFilters) {
  const config = getConfig();
  const inventoryData = optionalInventoryData || getAllInventoryData_();
  const dashboardFilters = optionalFilters || {};
  const requestedFacility = cleanText_(dashboardFilters.facility);
  const rows = requestedFacility
    ? inventoryData.allRows.filter(function (row) {
        return row.facility === requestedFacility;
      })
    : inventoryData.allRows;
  const ranges = reportingRanges_();
  const periods = {};

  Object.keys(ranges).forEach(function (periodKey) {
    const range = ranges[periodKey];
    const periodRows = rows.filter(function (row) {
      const isDatedPeriodRow = row.date &&
        row.date >= range.startDate &&
        row.date <= range.endDate;
      const isCurrentUndatedNtf =
        (periodKey === 'monthToDate' ||
          periodKey === 'currentQuarterToDate') &&
        row.sourceType === 'current' &&
        !row.date &&
        isNtfRow_(row);

      return isDatedPeriodRow || isCurrentUndatedNtf;
    });

    const periodData = {
      label: range.label,
      startDate: range.startDate,
      endDate: range.endDate,
      rowCount: periodRows.length,
      kpis: calculateKpis(periodRows, {
        periodKey: periodKey,
        startDate: range.startDate,
        endDate: range.endDate,
        config: config
      }),
      abcBreakdown: calculateAbcBreakdown(periodRows),
      zeroActivity: periodRows.length === 0
        ? zeroActivityMessage_(range)
        : null
    };

    // The coverage banner needs only one compact QTD Top 5 summary. Building
    // it during the existing refresh avoids a second heavy source-sheet read.
    if (periodKey === 'currentQuarterToDate') {
      periodData.topSkuInsights = calculateTopSkuInsights_(periodRows);
    }

    periods[periodKey] = periodData;
  });

  return {
    dashboardName: config.dashboardName,
    theme: config.theme,
    periods: periods,
    sourceSummary: sourceSummary_(
      inventoryData.currentRows,
      inventoryData.historicalRows
    )
  };
}

/**
 * Creates the simple view model consumed by EmailTemplate.html.
 */
function buildEmailReport_(config, period, periods, cycleCoverage) {
  const kpis = period.kpis;
  const inventoryStyle = getAccuracyStyle(kpis.inventoryAccuracy);
  const valueAccuracyStyle = getAccuracyStyle(kpis.valueAccuracy);
  const binStyle = getAccuracyStyle(kpis.binAccuracy);
  const standardStyle = {
    text: '#1e3a8a',
    background: '#eff6ff',
    indicator: '#2563eb'
  };
  const warningStyle = {
    text: '#9a3412',
    background: '#fff7ed',
    indicator: '#ea580c'
  };
  const valueStyle = {
    text: '#166534',
    background: '#ecfdf5',
    indicator: '#16a34a'
  };
  const coverageStyle = kpis.costCoverage >= 100
    ? valueStyle
    : warningStyle;

  return {
    dashboardName: config.dashboardName,
    dashboardUrl: config.dashboardUrl,
    reportingDate: formatEmailDate_(period.endDate),
    generatedAt: Utilities.formatDate(
      new Date(),
      getTimeZone_(),
      'dd MMM yyyy, hh:mm a'
    ),
    hasActivity: period.rowCount > 0,
    zeroActivity: period.rowCount === 0
      ? {
          message: 'No cycle count was performed.',
          reason:
            period.zeroActivity && period.zeroActivity.reason
              ? period.zeroActivity.reason
              : 'Not entered',
          remark:
            period.zeroActivity && period.zeroActivity.remark
              ? period.zeroActivity.remark
              : ''
        }
      : null,
    cycleCoverage: buildEmailCoverage_(config, cycleCoverage),
    periodSummary: [
      periods.lastQuarter,
      periods.lastMonth,
      periods.monthToDate,
      periods.yesterday
    ].map(function (summaryPeriod) {
      const style = getAccuracyStyle(
        summaryPeriod.kpis.inventoryAccuracy
      );
      return {
        label: summaryPeriod.label,
        value: formatEmailPercent_(
          summaryPeriod.kpis.inventoryAccuracy
        ),
        systemQuantity: formatEmailNumber_(
          summaryPeriod.kpis.systemQuantity
        ),
        physicalQuantity: formatEmailNumber_(
          summaryPeriod.kpis.physicalQuantity
        ),
        dateRange:
          formatEmailDate_(summaryPeriod.startDate) +
          ' - ' +
          formatEmailDate_(summaryPeriod.endDate),
        textColor: style.text,
        backgroundColor: style.background,
        indicatorColor: style.indicator
      };
    }),
    valuePeriodSummary: [
      periods.lastQuarter,
      periods.lastMonth,
      periods.monthToDate,
      periods.yesterday
    ].map(function (summaryPeriod) {
      const style = getAccuracyStyle(
        summaryPeriod.kpis.valueAccuracy
      );
      return {
        label: summaryPeriod.label,
        value: formatEmailPercent_(
          summaryPeriod.kpis.valueAccuracy
        ),
        systemValue: formatEmailCurrency_(
          summaryPeriod.kpis.systemValue
        ),
        physicalValue: formatEmailCurrency_(
          summaryPeriod.kpis.physicalValue
        ),
        costCoverage: formatEmailPercent_(
          summaryPeriod.kpis.costCoverage
        ),
        textColor: style.text,
        backgroundColor: style.background,
        indicatorColor: style.indicator
      };
    }),
    metrics: [
      emailMetric_(
        'Bin Accuracy',
        formatEmailPercent_(kpis.binAccuracy),
        binStyle
      ),
      emailMetric_(
        'Planned Bin Count',
        formatEmailNumber_(kpis.plannedBinCount),
        standardStyle
      ),
      emailMetric_(
        'Actual Bin Count',
        formatEmailNumber_(kpis.actualBinCount),
        standardStyle
      ),
      emailMetric_(
        'Cycle Count Completion',
        formatEmailPercent_(kpis.cycleCountCompletion),
        standardStyle
      ),
      emailMetric_(
        'Inventory Accuracy',
        formatEmailPercent_(kpis.inventoryAccuracy),
        inventoryStyle
      ),
      emailMetric_(
        'Value Accuracy (COGS)',
        formatEmailPercent_(kpis.valueAccuracy),
        valueAccuracyStyle
      ),
      emailMetric_(
        'System Qty / Value',
        formatEmailNumber_(kpis.systemQuantity) +
          ' | ' +
          formatEmailCurrency_(kpis.systemValue),
        valueStyle
      ),
      emailMetric_(
        'Physical Qty / Value',
        formatEmailNumber_(kpis.physicalQuantity) +
          ' | ' +
          formatEmailCurrency_(kpis.physicalValue),
        valueStyle
      ),
      emailMetric_(
        'Net Difference Qty / Value',
        formatEmailNumber_(kpis.netDifference) +
          ' | ' +
          formatEmailCurrency_(kpis.netDifferenceValue),
        kpis.netDifference < 0 ? warningStyle : standardStyle
      ),
      emailMetric_(
        'Cost Coverage',
        formatEmailPercent_(kpis.costCoverage),
        coverageStyle
      )
    ]
  };
}

/**
 * Creates one email metric card object.
 */
function emailMetric_(label, value, style) {
  return {
    label: label,
    value: value,
    textColor: style.text,
    backgroundColor: style.background,
    indicatorColor: style.indicator
  };
}

/**
 * Renders EmailTemplate.html with the supplied report object.
 */
function renderEmailTemplate_(report) {
  const template = HtmlService.createTemplateFromFile('EmailTemplate');
  template.report = report;
  return template.evaluate().getContent();
}

/**
 * Creates the plain-text fallback used when HTML email is unavailable.
 */
function buildPlainTextEmail_(report) {
  const lines = [
    report.dashboardName,
    'Reporting date: ' + report.reportingDate
  ];

  if (report.cycleCoverage) {
    const coverage = report.cycleCoverage;
    lines.push(coverage.title);
    lines.push('Cycle: ' + coverage.dateRange);
    lines.push('As of: ' + coverage.asOfDate);
    lines.push('Overall coverage: ' + coverage.completionPercent);
    lines.push('Opening GOOD Qty: ' + coverage.openingGoodQuantity);
    lines.push(
      'Cumulative Counted: ' + coverage.cumulativeCountedQuantity
    );
    lines.push('Counted Today: ' + coverage.countedTodayQuantity);
    lines.push(
      'Inventory Change: ' + coverage.inventoryChangePercent +
      ' (' + coverage.inventoryChangeQuantity + ' units)'
    );
    lines.push(coverage.alertNote);
    lines.push('Facility Coverage');
    coverage.facilities.forEach(function (facility) {
      lines.push(
        facility.name + ': ' + facility.completionPercent +
        ' | Opening ' + facility.openingGoodQuantity +
        ' | Counted ' + facility.cumulativeCountedQuantity
      );
    });
  }

  lines.push('Inventory Accuracy Summary');
  report.periodSummary.forEach(function (period) {
    lines.push(period.label + ': ' + period.value);
    lines.push('  System Qty: ' + period.systemQuantity);
    lines.push('  Physical Qty: ' + period.physicalQuantity);
  });

  lines.push('Value Accuracy Summary');
  report.valuePeriodSummary.forEach(function (period) {
    lines.push(period.label + ': ' + period.value);
    lines.push('  System Value: ' + period.systemValue);
    lines.push('  Physical Value: ' + period.physicalValue);
    lines.push('  Cost Coverage: ' + period.costCoverage);
  });

  if (!report.hasActivity && report.zeroActivity) {
    lines.push(report.zeroActivity.message);
    lines.push('Reason: ' + report.zeroActivity.reason);
    if (report.zeroActivity.remark) {
      lines.push('Remark: ' + report.zeroActivity.remark);
    }
  } else {
    report.metrics.forEach(function (metric) {
      lines.push(metric.label + ': ' + metric.value);
    });
  }

  if (report.quarterAttachment) {
    lines.push('Quarter-to-date CSV attached:');
    lines.push('  File: ' + report.quarterAttachment.fileName);
    lines.push(
      '  Transactions: ' + report.quarterAttachment.rowCount
    );
    lines.push(
      '  Period: ' +
        report.quarterAttachment.startDate +
        ' - ' +
        report.quarterAttachment.endDate
    );
  }

  lines.push('Generated: ' + report.generatedAt);
  lines.push('Dashboard: ' + report.dashboardUrl);
  return lines.join('\n');
}

/**
 * Formats an ISO reporting date for the email heading.
 */
function formatEmailDate_(dateText) {
  const date = parseIsoDate_(dateText);
  return date
    ? Utilities.formatDate(date, getTimeZone_(), 'dd MMM yyyy')
    : cleanText_(dateText);
}

/**
 * Formats an email quantity with Indian digit grouping.
 */
function formatEmailNumber_(value) {
  const number = Number(round_(toNumber_(value), 2));
  const formatted = Math.abs(number).toLocaleString('en-IN', {
    maximumFractionDigits: 2
  });
  return number < 0 ? '(' + formatted + ')' : formatted;
}

/**
 * Formats a COGS-based value in Indian rupees.
 */
function formatEmailCurrency_(value) {
  const number = Number(round_(toNumber_(value), 2));
  const formatted = Math.abs(number).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  });
  return number < 0 ? '(' + formatted + ')' : formatted;
}

/**
 * Formats an email percentage.
 */
function formatEmailPercent_(value) {
  return formatEmailNumber_(value) + '%';
}

/** Formats an email percentage with an explicit plus sign when positive. */
function formatSignedEmailPercent_(value) {
  const number = Number(round_(toNumber_(value), 2));
  if (number > 0) {
    return '+' + formatEmailPercent_(number);
  }
  return formatEmailPercent_(number);
}

/**
 * Creates the dashboard reporting date ranges using the script time zone.
 */
function reportingRanges_() {
  const todayText = Utilities.formatDate(
    new Date(),
    getTimeZone_(),
    'yyyy-MM-dd'
  );
  const today = parseIsoDate_(todayText);
  const yesterday = addDays_(today, -1);
  const monthStart = new Date(
    today.getFullYear(),
    today.getMonth(),
    1,
    12,
    0,
    0
  );
  const lastMonthStart = new Date(
    today.getFullYear(),
    today.getMonth() - 1,
    1,
    12,
    0,
    0
  );
  const lastMonthEnd = new Date(
    today.getFullYear(),
    today.getMonth(),
    0,
    12,
    0,
    0
  );
  const currentQuarterStartMonth =
    Math.floor(today.getMonth() / 3) * 3;
  const currentQuarterStart = new Date(
    today.getFullYear(),
    currentQuarterStartMonth,
    1,
    12,
    0,
    0
  );
  const lastQuarterStart = new Date(
    today.getFullYear(),
    currentQuarterStartMonth - 3,
    1,
    12,
    0,
    0
  );
  const lastQuarterEnd = new Date(
    today.getFullYear(),
    currentQuarterStartMonth,
    0,
    12,
    0,
    0
  );

  return {
    lastQuarter: {
      label: 'Last Quarter',
      startDate: formatDate_(lastQuarterStart),
      endDate: formatDate_(lastQuarterEnd)
    },
    lastMonth: {
      label: 'Last Month',
      startDate: formatDate_(lastMonthStart),
      endDate: formatDate_(lastMonthEnd)
    },
    currentQuarterToDate: {
      label: 'Current Quarter to Date',
      startDate: formatDate_(currentQuarterStart),
      endDate: formatDate_(today)
    },
    monthToDate: {
      label: 'Month to Date',
      startDate: formatDate_(monthStart),
      endDate: formatDate_(today)
    },
    yesterday: {
      label: 'Yesterday',
      startDate: formatDate_(yesterday),
      endDate: formatDate_(yesterday)
    }
  };
}

/**
 * Calculates planned bins for one reporting period.
 */
function plannedBinCount_(options, config) {
  const dailyPlan = toNumber_(config.dailyPlannedBinCount);
  const workingDays = toNumber_(config.workingDays);
  const periodKey = options.periodKey || 'custom';

  if (periodKey === 'yesterday') {
    return dailyPlan;
  }

  if (periodKey === 'lastMonth') {
    return dailyPlan * workingDays;
  }

  if (periodKey === 'lastQuarter') {
    return dailyPlan * workingDays * 3;
  }

  const completedDays = countWorkingDays_(
    options.startDate,
    options.endDate
  );

  return dailyPlan * (
    periodKey === 'monthToDate'
      ? Math.min(completedDays, workingDays)
      : completedDays
  );
}

/**
 * Counts Monday through Saturday as working days.
 */
function countWorkingDays_(startText, endText) {
  let current = parseIsoDate_(startText);
  const end = parseIsoDate_(endText);
  let count = 0;

  if (!current || !end || current > end) {
    return 0;
  }

  while (current <= end) {
    if (current.getDay() !== 0) {
      count += 1;
    }
    current = addDays_(current, 1);
  }

  return count;
}

/**
 * Returns a zero-activity message and, for a single date, its reason.
 */
function zeroActivityMessage_(range) {
  const statuses = range.startDate === range.endDate
    ? getActivityStatus(range.endDate)
    : [];
  const status = statuses.length > 0 ? statuses[0] : null;

  return {
    message: 'No cycle count was performed.',
    reason: status ? status.reason : '',
    remark: status ? status.remark : ''
  };
}

/**
 * Summarizes rows by source sheet.
 */
function sourceSummary_(rows, historicalRows) {
  const history = Array.isArray(historicalRows) ? historicalRows : [];
  const rowsByFacility = {};
  const rowsBySourceSheet = {};
  const missingCostSkus = {};
  let costedRowCount = 0;
  let missingCostRowCount = 0;

  rows.forEach(function (row) {
    rowsByFacility[row.facility] =
      (rowsByFacility[row.facility] || 0) + 1;
    const sourceSheet = cleanText_(row.sourceSheet) || row.facility;
    rowsBySourceSheet[sourceSheet] =
      (rowsBySourceSheet[sourceSheet] || 0) + 1;

    if (optionalNumber_(row.unitCost) !== null) {
      costedRowCount += 1;
    } else {
      missingCostRowCount += 1;
      const missingSku = normalizeSku_(row.skuCode);
      if (missingSku) {
        missingCostSkus[missingSku] = true;
      }
    }
  });

  return {
    combinedRowCount: rows.length,
    historicalRowCount: history.length,
    totalTransactionRowCount: rows.length + history.length,
    rowsByFacility: rowsByFacility,
    costSummary: {
      costSheetName: COST_SHEET_NAME,
      currency: 'INR',
      includesGst: false,
      costedRowCount: costedRowCount,
      missingCostRowCount: missingCostRowCount,
      missingCostSkuCount: Object.keys(missingCostSkus).length,
      costCoverage: rows.length === 0
        ? 0
        : round_((costedRowCount / rows.length) * 100, 2)
    },
    skippedSourceSheets: SOURCE_SHEETS.filter(function (sheetName) {
      return !Object.prototype.hasOwnProperty.call(
        rowsBySourceSheet,
        sheetName
      );
    })
  };
}

/**
 * Creates the Config sheet structure and adds missing settings.
 */
function setupConfigSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('Config') ||
    spreadsheet.insertSheet('Config');

  ensureHeader_(sheet, ['Setting', 'Value']);

  const existingNames = {};
  if (sheet.getLastRow() > 1) {
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getValues()
      .forEach(function (row) {
        const name = cleanText_(row[0]);
        if (name) {
          existingNames[name] = true;
        }
      });
  }

  const allDefaults = CONFIG_DEFAULTS.concat(
    CYCLE_COVERAGE_CONFIG_DEFAULTS
  );
  const missingRows = allDefaults.filter(function (row) {
    return !existingNames[row[0]];
  });

  if (missingRows.length > 0) {
    sheet
      .getRange(sheet.getLastRow() + 1, 1, missingRows.length, 2)
      .setValues(missingRows);
  }

  styleSetupSheet_(sheet, 2);

  const configValues = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 2)
    .getValues();

  configValues.forEach(function (row, index) {
    const valueCell = sheet.getRange(index + 2, 2);
    const settingName = cleanText_(row[0]);

    if (settingName === 'Email Enabled') {
      valueCell.setDataValidation(
        listValidation_(['Yes', 'No'])
      );
    } else if (settingName === 'Theme') {
      valueCell.setDataValidation(
        listValidation_(['Light', 'Dark'])
      );
    } else if (settingName === 'Auto Refresh Minutes') {
      valueCell.setDataValidation(
        listValidation_(['1', '5', '10', '15', '30', '60'])
      );
    } else if (settingName === 'Inventory Import Minutes') {
      valueCell.setDataValidation(
        listValidation_(['1', '5', '10', '15', '30', '60'])
      );
    }
  });

  return sheet;
}

/**
 * Creates the Activity_Status sheet structure and reason dropdown.
 */
function setupActivityStatusSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('Activity_Status') ||
    spreadsheet.insertSheet('Activity_Status');

  ensureHeader_(sheet, ['Date', 'Reason', 'Remark']);
  styleSetupSheet_(sheet, 3);
  sheet
    .getRange(2, 2, Math.max(sheet.getMaxRows() - 1, 1), 1)
    .setDataValidation(listValidation_(ACTIVITY_REASONS));
}

/**
 * Creates the hidden Version 2 cycle-coverage system sheet.
 *
 * Dates are stored in rows. Each facility has opening GOOD quantity, daily
 * counted quantity, cumulative counted quantity, completion percentage, BAD
 * quantity, and QC rejected quantity columns. Users do not enter data here.
 */
function setupCycleCoverageSheet_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CYCLE_COVERAGE_SHEET_NAME) ||
    spreadsheet.insertSheet(CYCLE_COVERAGE_SHEET_NAME);
  const headers = cycleCoverageHeaders_();

  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length - sheet.getMaxColumns()
    );
  }

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  styleSetupSheet_(sheet, headers.length);
  sheet.getRange('A:A').setNumberFormat('yyyy-mm-dd');

  headers.forEach(function (header, index) {
    if (/Completion %$|Change %$/.test(header)) {
      sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1)
        .setNumberFormat('0.00%');
    } else if (/Qty$/.test(header)) {
      sheet.getRange(2, index + 1, sheet.getMaxRows() - 1, 1)
        .setNumberFormat('#,##0.00');
    }
  });

  const hasCoverageProtection = sheet
    .getProtections(SpreadsheetApp.ProtectionType.SHEET)
    .some(function (protection) {
      return protection.getDescription() ===
        'Managed automatically by Inventory Health Dashboard V2';
    });

  if (!hasCoverageProtection) {
    sheet.protect()
      .setDescription(
        'Managed automatically by Inventory Health Dashboard V2'
      )
      .setWarningOnly(true);
  }

  if (!sheet.isSheetHidden()) {
    sheet.hideSheet();
  }

  return sheet;
}

/** Checks whether the hidden sheet has the Version 2 ABC coverage columns. */
function cycleCoverageHasAbcColumns_(sheet) {
  if (!sheet || sheet.getLastColumn() === 0) {
    return false;
  }
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(cleanText_);
  return headers.indexOf('A Good Qty') >= 0 &&
    headers.indexOf('ABC Mapping Signature') >= 0;
}

/** Updates one Config setting, adding it only when it does not exist. */
function setConfigValue_(sheet, settingName, value) {
  const lastRow = sheet.getLastRow();
  const names = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues()
    : [];

  for (let index = 0; index < names.length; index += 1) {
    if (cleanText_(names[index][0]) === settingName) {
      sheet.getRange(index + 2, 2).setValue(value);
      return index + 2;
    }
  }

  const targetRow = lastRow + 1;
  sheet.getRange(targetRow, 1, 1, 2).setValues([
    [settingName, value]
  ]);
  return targetRow;
}

/** Builds the stable column layout for the hidden coverage sheet. */
function cycleCoverageHeaders_() {
  const headers = ['Date'];
  const groups = COVERAGE_FACILITIES.concat(['TOTAL']);

  groups.forEach(function (facility) {
    headers.push(facility + ' Good Qty');
    headers.push(facility + ' Daily Counted Qty');
    headers.push(facility + ' Cumulative Counted Qty');
    headers.push(facility + ' Completion %');
    headers.push(facility + ' Bad Qty');
    headers.push(facility + ' QC Rejected Qty');
  });

  const completeHeaders = headers.concat([
    'Previous Total Good Qty',
    'Change Qty',
    'Change %',
    'Alert Note',
    'Source File',
    'Source URL',
    'Gmail Message ID',
    'Imported At',
    'Import Status'
  ]);

  COVERAGE_ABC_CLASSES.forEach(function (abcClass) {
    completeHeaders.push(abcClass + ' Good Qty');
    completeHeaders.push(abcClass + ' Daily Counted Qty');
    completeHeaders.push(abcClass + ' Cumulative Counted Qty');
  });
  completeHeaders.push('ABC Mapping Signature');

  return completeHeaders;
}

/**
 * Adds the expected header without deleting existing rows.
 */
function ensureHeader_(sheet, expectedHeaders) {
  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(1, 1, 1, expectedHeaders.length)
      .setValues([expectedHeaders]);
    return;
  }

  const currentHeaders = sheet
    .getRange(1, 1, 1, expectedHeaders.length)
    .getValues()[0]
    .map(cleanText_);
  const matches = expectedHeaders.every(function (header, index) {
    return currentHeaders[index] === header;
  });

  if (!matches) {
    sheet.insertRowBefore(1);
    sheet
      .getRange(1, 1, 1, expectedHeaders.length)
      .setValues([expectedHeaders]);
  }
}

/**
 * Applies a simple blue header style.
 */
function styleSetupSheet_(sheet, columnCount) {
  sheet
    .getRange(1, 1, 1, columnCount)
    .setBackground('#1d4ed8')
    .setFontColor('#ffffff')
    .setFontWeight('bold');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, columnCount);
}

/**
 * Creates a strict dropdown validation rule.
 */
function listValidation_(allowedValues) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(allowedValues, true)
    .setAllowInvalid(false)
    .build();
}

/**
 * Maps source headers to column indexes.
 */
function inventoryHeaderIndexes_(headerRow, sheetName) {
  const normalizedHeaders = headerRow.map(normalizeHeader_);
  const indexes = {};

  INVENTORY_HEADERS.forEach(function (requiredHeader) {
    let index = normalizedHeaders.indexOf(
      normalizeHeader_(requiredHeader)
    );

    // SL_RX uses alternate export labels for these descriptive columns.
    // Map them to the dashboard names without changing the source sheet.
    const alternateHeaders = {
      'Item Name': 'Item Type Name',
      'Batch': 'Batch Code',
      'Vendor Batch Number': 'Vendor Batch Code'
    };
    if (index < 0 && alternateHeaders[requiredHeader]) {
      index = normalizedHeaders.indexOf(
        normalizeHeader_(alternateHeaders[requiredHeader])
      );
    }

    if (index < 0) {
      throw new Error(
        'Sheet "' +
          sheetName +
          '" is missing the required column "' +
          requiredHeader +
          '".'
      );
    }

    indexes[requiredHeader] = index;
  });

  let facilityIndex = normalizedHeaders.indexOf(
    normalizeHeader_('Facility')
  );

  if (facilityIndex < 0) {
    facilityIndex = normalizedHeaders.indexOf(
      normalizeHeader_('Facility Name')
    );
  }

  if (sheetName === 'B2C' && facilityIndex < 0) {
    throw new Error(
      'Sheet "B2C" must contain the Facility column for ' +
        'SL_MM, SL_LJ, and SL_BW.'
    );
  }

  if (facilityIndex >= 0) {
    indexes.Facility = facilityIndex;
  }

  return indexes;
}

/**
 * Maps the separate B2C workbook layout to the dashboard's logical columns.
 * Total is deliberately mapped to Sys; non-coverage columns are optional.
 */
function b2cHeaderIndexes_(headerRow) {
  const normalizedHeaders = headerRow.map(normalizeHeader_);
  const indexes = {};
  const requiredHeaders = [
    'Date',
    'Shelf',
    'Phy'
  ];

  requiredHeaders.forEach(function (header) {
    const index = normalizedHeaders.indexOf(normalizeHeader_(header));
    if (index < 0) {
      throw new Error(
        'External B2C sheet is missing the required column "' +
          header +
          '".'
      );
    }
    indexes[header] = index;
  });

  let facilityIndex = normalizedHeaders.indexOf(normalizeHeader_('Facility'));
  if (facilityIndex < 0) {
    facilityIndex = normalizedHeaders.indexOf(
      normalizeHeader_('Facility Name')
    );
  }
  if (facilityIndex < 0) {
    throw new Error(
      'External B2C sheet must contain Facility or Facility Name.'
    );
  }
  indexes.Facility = facilityIndex;

  let systemIndex = normalizedHeaders.indexOf(normalizeHeader_('Sys'));
  if (systemIndex < 0) {
    systemIndex = normalizedHeaders.indexOf(normalizeHeader_('Total'));
  }
  if (systemIndex < 0) {
    throw new Error(
      'External B2C sheet must contain Total or Sys for System Quantity.'
    );
  }
  indexes.Sys = systemIndex;

  [
    'Sku Code',
    'Item Name',
    'Batch',
    'Vendor Batch Number',
    'Pack',
    'Box',
    'Loose',
    'Diff',
    'Rack'
  ].forEach(function (header) {
    const index = normalizedHeaders.indexOf(normalizeHeader_(header));
    indexes[header] = index >= 0 ? index : null;
  });

  let remarkIndex = normalizedHeaders.indexOf(normalizeHeader_('Remark'));
  if (remarkIndex < 0) {
    remarkIndex = normalizedHeaders.indexOf(normalizeHeader_('Remarks'));
  }
  indexes.Remark = remarkIndex >= 0 ? remarkIndex : null;

  return indexes;
}

/**
 * Audits every configured facility and the two dates relevant to email.
 *
 * This endpoint is read-only. It reports aggregate row/quantity totals and
 * data-quality counts without returning SKU, item, batch, or shelf details.
 */
function getFacilitySourceAudit(optionalDate) {
  const inventoryData = getAllInventoryData_();
  const rows = inventoryData.currentRows;
  const ranges = reportingRanges_();
  const today = ranges.monthToDate.endDate;
  const requestedDate = cleanText_(optionalDate) || today;

  if (!parseIsoDate_(requestedDate)) {
    throw new Error('Audit date must use yyyy-MM-dd.');
  }

  const config = getConfig();
  const requestedDateAudit = facilityAuditSummary_(rows, requestedDate);
  const currentEmailDate = ranges.yesterday.endDate;
  const nextEmailDate = today;

  return {
    generatedAt: new Date().toISOString(),
    requestedDate: requestedDate,
    currentEmailReportDate: currentEmailDate,
    nextEmailReportDate: nextEmailDate,
    allCurrentRows: facilityAuditSummary_(rows, ''),
    requestedDateRows: requestedDateAudit,
    currentEmailRows: currentEmailDate === requestedDate
      ? requestedDateAudit
      : facilityAuditSummary_(rows, currentEmailDate),
    nextEmailRows: nextEmailDate === requestedDate
      ? requestedDateAudit
      : facilityAuditSummary_(rows, nextEmailDate),
    sourceSummary: sourceSummary_(rows, []),
    b2cSource: getB2cSourceAudit(),
    ownSource: getOwnSourceAudit(),
    emailReadiness: {
      enabled: config.emailEnabled,
      sendHour: config.emailSendHour,
      toConfigured: Boolean(config.emailTo),
      ccConfigured: Boolean(config.emailCC),
      bccConfigured: Boolean(config.emailBCC),
      subject: config.emailSubject,
      nextReportHasRows: facilityAuditSummary_(rows, nextEmailDate).rowCount > 0,
      dataReadSucceeded: true,
      note: 'The scheduled email reads source sheets again before rendering.'
    }
  };
}

/** Builds aggregate facility checks for all rows or one ISO date. */
function facilityAuditSummary_(rows, optionalDate) {
  const date = cleanText_(optionalDate);
  const facilities = {};

  COVERAGE_FACILITIES.forEach(function (facility) {
    facilities[facility] = {
      rowCount: 0,
      datedRowCount: 0,
      undatedRowCount: 0,
      earliestDate: '',
      latestDate: '',
      sourceSheets: {},
      uniqueSkus: {},
      uniqueBins: {},
      systemQuantity: 0,
      physicalQuantity: 0,
      netDifference: 0,
      inconsistentDifferenceRowCount: 0
    };
  });

  rows.forEach(function (row) {
    if (date && row.date !== date) {
      return;
    }

    const facility = cleanText_(row.facility);
    if (!facilities[facility]) {
      return;
    }

    const summary = facilities[facility];
    const systemQuantity = toNumber_(row.systemQuantity);
    const physicalQuantity = toNumber_(row.physicalQuantity);
    const difference = toNumber_(row.difference);
    const sourceSheet = cleanText_(row.sourceSheet) || facility;
    const sku = normalizeSku_(row.skuCode);
    const bin = binKey_(row);
    summary.rowCount += 1;
    summary.systemQuantity += systemQuantity;
    summary.physicalQuantity += physicalQuantity;
    summary.netDifference += difference;
    summary.sourceSheets[sourceSheet] = true;
    if (sku) {
      summary.uniqueSkus[sku] = true;
    }
    if (bin) {
      summary.uniqueBins[bin] = true;
    }
    if (row.date) {
      summary.datedRowCount += 1;
      if (!summary.earliestDate || row.date < summary.earliestDate) {
        summary.earliestDate = row.date;
      }
      if (!summary.latestDate || row.date > summary.latestDate) {
        summary.latestDate = row.date;
      }
    } else {
      summary.undatedRowCount += 1;
    }
    if (
      Math.abs((physicalQuantity - systemQuantity) - difference) > 0.000001
    ) {
      summary.inconsistentDifferenceRowCount += 1;
    }
  });

  let rowCount = 0;
  let systemQuantity = 0;
  let physicalQuantity = 0;
  let netDifference = 0;
  let inconsistentDifferenceRowCount = 0;
  const finishedFacilities = {};

  COVERAGE_FACILITIES.forEach(function (facility) {
    const summary = facilities[facility];
    rowCount += summary.rowCount;
    systemQuantity += summary.systemQuantity;
    physicalQuantity += summary.physicalQuantity;
    netDifference += summary.netDifference;
    inconsistentDifferenceRowCount += summary.inconsistentDifferenceRowCount;
    finishedFacilities[facility] = {
      rowCount: summary.rowCount,
      datedRowCount: summary.datedRowCount,
      undatedRowCount: summary.undatedRowCount,
      earliestDate: summary.earliestDate,
      latestDate: summary.latestDate,
      sourceSheets: Object.keys(summary.sourceSheets),
      uniqueSkuCount: Object.keys(summary.uniqueSkus).length,
      uniqueBinCount: Object.keys(summary.uniqueBins).length,
      systemQuantity: round_(summary.systemQuantity, 2),
      physicalQuantity: round_(summary.physicalQuantity, 2),
      netDifference: round_(summary.netDifference, 2),
      inconsistentDifferenceRowCount:
        summary.inconsistentDifferenceRowCount
    };
  });

  return {
    date: date,
    rowCount: rowCount,
    systemQuantity: round_(systemQuantity, 2),
    physicalQuantity: round_(physicalQuantity, 2),
    netDifference: round_(netDifference, 2),
    inconsistentDifferenceRowCount: inconsistentDifferenceRowCount,
    facilities: finishedFacilities
  };
}

/** Safely reads an optional B2C cell without treating null as column zero. */
function b2cCell_(row, index) {
  return index === null || index === undefined ? '' : row[index];
}

/** Resolves a reporting facility without exposing B2C as a facility. */
function sourceFacilityName_(sheetName, enteredFacility) {
  if (sheetName !== 'B2C') {
    return sheetName;
  }

  const key = cleanText_(enteredFacility)
    .toUpperCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');

  return B2C_SOURCE_FACILITY_MAP[key] || '';
}

/**
 * Maps the Q1-AMJ26 historical headers to column indexes.
 */
function historicalHeaderIndexes_(headerRow, sheetName) {
  const normalizedHeaders = headerRow.map(normalizeHeader_);
  const indexes = {};

  HISTORICAL_HEADERS.forEach(function (requiredHeader) {
    const index = normalizedHeaders.indexOf(
      normalizeHeader_(requiredHeader)
    );

    if (index < 0) {
      throw new Error(
        'Sheet "' +
          sheetName +
          '" is missing the required historical column "' +
          requiredHeader +
          '".'
      );
    }

    indexes[requiredHeader] = index;
  });

  return indexes;
}

/**
 * Reads the COGS sheet into a SKU-keyed cost map without changing the sheet.
 *
 * The first valid row for a SKU is used. Blank, invalid, or negative unit
 * rates are treated as missing costs so they are visible in Cost Coverage.
 */
function readCostMap_(spreadsheet) {
  const sheet = findSheetIgnoreCase_(spreadsheet, COST_SHEET_NAME);
  const costMap = {};

  if (!sheet || sheet.getLastRow() <= 1 || sheet.getLastColumn() === 0) {
    return costMap;
  }

  const values = sheet
    .getRange(1, 1, sheet.getLastRow(), COST_HEADERS.length)
    .getValues();
  const normalizedHeaders = values[0].map(normalizeHeader_);
  const indexes = {};

  COST_HEADERS.forEach(function (requiredHeader) {
    const index = normalizedHeaders.indexOf(
      normalizeHeader_(requiredHeader)
    );

    if (index < 0) {
      throw new Error(
        'Sheet "' +
          sheet.getName() +
          '" is missing the required column "' +
          requiredHeader +
          '".'
      );
    }

    indexes[requiredHeader] = index;
  });

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const sku = normalizeSku_(row[indexes['SKU']]);
    const unitCost = optionalNumber_(
      row[indexes['Unit Rate (Excluding Gst)']]
    );

    if (
      !sku ||
      unitCost === null ||
      unitCost < 0 ||
      Object.prototype.hasOwnProperty.call(costMap, sku)
    ) {
      continue;
    }

    costMap[sku] = {
      sku: sku,
      productName: cleanText_(row[indexes['Product Name']]),
      unitCost: unitCost,
      gstRate: optionalNumber_(row[indexes['GST Rate']])
    };
  }

  return costMap;
}

/**
 * Reads SKU_MASTER into a SKU-to-ABC-class map without changing the sheet.
 *
 * The dashboard remains available while the new column is being prepared. If
 * SKU_MASTER or ABC Class is missing, an empty map is returned and inventory
 * is reported under C by default.
 */
function readAbcClassMap_(spreadsheet) {
  const sheet = findSheetIgnoreCase_(
    spreadsheet,
    SKU_MASTER_SHEET_NAME
  );
  const abcClassMap = {};

  if (!sheet || sheet.getLastRow() <= 1 || sheet.getLastColumn() === 0) {
    return abcClassMap;
  }

  const values = sheet
    .getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn())
    .getDisplayValues();
  const normalizedHeaders = values[0].map(normalizeHeader_);
  const skuIndex = normalizedHeaders.indexOf(normalizeHeader_('SKU'));
  const abcClassIndex = normalizedHeaders.indexOf(
    normalizeHeader_('ABC Class')
  );

  if (skuIndex < 0 || abcClassIndex < 0) {
    console.warn(
      'SKU_MASTER needs SKU and ABC Class columns. ' +
        'All SKUs currently default to C.'
    );
    return abcClassMap;
  }

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const sku = normalizeSku_(values[rowIndex][skuIndex]);
    const enteredClass = cleanText_(values[rowIndex][abcClassIndex])
      .toUpperCase();

    if (
      sku &&
      ['A', 'B', 'C'].indexOf(enteredClass) >= 0 &&
      !Object.prototype.hasOwnProperty.call(abcClassMap, sku)
    ) {
      abcClassMap[sku] = enteredClass;
    }
  }

  return abcClassMap;
}

/** Creates an internal accumulator for one ABC class. */
function newAbcBucket_(abcClass) {
  return {
    abcClass: abcClass,
    skus: {},
    costedSkus: {},
    rowCount: 0,
    costedRowCount: 0,
    systemQuantity: 0,
    physicalQuantity: 0,
    absoluteDifference: 0,
    shortQuantity: 0,
    excessQuantity: 0,
    systemValue: 0,
    physicalValue: 0,
    absoluteDifferenceValue: 0,
    shortValue: 0,
    excessValue: 0
  };
}

/**
 * Converts the latest hidden coverage snapshot into an email-friendly model.
 *
 * Completion uses cumulative counted System Quantity divided by that day's
 * opening GOOD inventory. The progress bar is capped visually at 100%, while
 * the displayed percentage may exceed 100% when stock has been counted again.
 */
function buildEmailCoverage_(config, cycleCoverage) {
  if (!cycleCoverage || !cycleCoverage.latest) {
    return null;
  }

  const latest = cycleCoverage.latest;
  const completion = toNumber_(latest.totalCompletionPercent);
  const progressWidth = Math.max(0, Math.min(100, completion));
  const changePercent = toNumber_(latest.changePercent);
  const threshold = toNumber_(config.inventoryChangeAlertPercent);
  const thresholdReached = Math.abs(changePercent) >= threshold;
  const facilityLabels = {
    SL_AMBIENT: 'SL Ambient',
    SL_MH: 'SL Mother Hub',
    SL_RX: 'SL Rx',
    SL_MM: 'SL MM',
    SL_LJ: 'SLLJ',
    SL_BW: 'SL BW',
    OWN: 'OWN'
  };

  return {
    title: 'Overall Quantity Coverage',
    asOfDate: formatEmailDate_(latest.date),
    dateRange:
      formatEmailDate_(cycleCoverage.cycleStartDate) +
      ' - ' +
      formatEmailDate_(cycleCoverage.cycleEndDate),
    completionPercent: formatEmailPercent_(completion),
    openingGoodQuantity: formatEmailNumber_(latest.totalGoodQuantity),
    cumulativeCountedQuantity: formatEmailNumber_(
      latest.totalCumulativeCountedQuantity
    ),
    countedTodayQuantity: formatEmailNumber_(
      latest.totalDailyCountedQuantity
    ),
    inventoryChangePercent: formatSignedEmailPercent_(changePercent),
    inventoryChangeQuantity: formatEmailNumber_(latest.changeQuantity),
    changeThreshold: formatEmailPercent_(threshold),
    thresholdReached: thresholdReached,
    changeTextColor: thresholdReached ? '#92400e' : '#1e3a8a',
    changeBackgroundColor: thresholdReached ? '#fef3c7' : '#eff6ff',
    alertNote: latest.alertNote ||
      'No material inventory movement detected.',
    progressWidth: round_(progressWidth, 2),
    remainingWidth: round_(100 - progressWidth, 2),
    facilities: COVERAGE_FACILITIES.map(function (facility) {
      const values = latest.facilities[facility] || {};
      const facilityCompletion = toNumber_(values.completionPercent);
      return {
        name: facilityLabels[facility] || facility,
        openingGoodQuantity: formatEmailNumber_(values.goodQuantity),
        cumulativeCountedQuantity: formatEmailNumber_(
          values.cumulativeCountedQuantity
        ),
        completionPercent: formatEmailPercent_(facilityCompletion),
        textColor: getAccuracyStyle(facilityCompletion).text
      };
    })
  };
}

/** Returns the Indian financial-year quarter label used by the dashboard. */
function fiscalQuarterLabel_(dateText) {
  const date = parseIsoDate_(dateText);
  if (!date) {
    return 'Quarter';
  }
  const month = date.getMonth() + 1;
  if (month >= 4 && month <= 6) {
    return 'Q1';
  }
  if (month >= 7 && month <= 9) {
    return 'Q2';
  }
  if (month >= 10) {
    return 'Q3';
  }
  return 'Q4';
}

/** Adds one ABC accumulator into another, including unique SKU sets. */
function mergeAbcBucket_(target, source) {
  Object.keys(source.skus).forEach(function (sku) {
    target.skus[sku] = true;
  });
  Object.keys(source.costedSkus).forEach(function (sku) {
    target.costedSkus[sku] = true;
  });
  target.rowCount += source.rowCount;
  target.costedRowCount += source.costedRowCount;
  target.systemQuantity += source.systemQuantity;
  target.physicalQuantity += source.physicalQuantity;
  target.absoluteDifference += source.absoluteDifference;
  target.shortQuantity += source.shortQuantity;
  target.excessQuantity += source.excessQuantity;
  target.systemValue += source.systemValue;
  target.physicalValue += source.physicalValue;
  target.absoluteDifferenceValue += source.absoluteDifferenceValue;
  target.shortValue += source.shortValue;
  target.excessValue += source.excessValue;
}

/** Converts an internal ABC accumulator into the small API response row. */
function finishAbcBucket_(bucket) {
  const quantityAccuracy = bucket.systemQuantity === 0
    ? 0
    : 100 -
      (bucket.absoluteDifference / bucket.systemQuantity) * 100;
  const valueAccuracy = bucket.systemValue === 0
    ? 0
    : 100 -
      (bucket.absoluteDifferenceValue / bucket.systemValue) * 100;
  const costCoverage = bucket.rowCount === 0
    ? 0
    : (bucket.costedRowCount / bucket.rowCount) * 100;

  return {
    abcClass: bucket.abcClass,
    uniqueSkuCount: Object.keys(bucket.skus).length,
    costedSkuCount: Object.keys(bucket.costedSkus).length,
    rowCount: bucket.rowCount,
    costedRowCount: bucket.costedRowCount,
    systemQuantity: round_(bucket.systemQuantity, 2),
    physicalQuantity: round_(bucket.physicalQuantity, 2),
    shortQuantity: round_(bucket.shortQuantity, 2),
    excessQuantity: round_(bucket.excessQuantity, 2),
    absoluteDifferenceQuantity: round_(bucket.absoluteDifference, 2),
    differenceQuantity: round_(
      bucket.physicalQuantity - bucket.systemQuantity,
      2
    ),
    quantityAccuracy: round_(quantityAccuracy, 2),
    quantityAccuracyStyle: getAccuracyStyle(quantityAccuracy),
    systemValue: round_(bucket.systemValue, 2),
    physicalValue: round_(bucket.physicalValue, 2),
    shortValue: round_(bucket.shortValue, 2),
    excessValue: round_(bucket.excessValue, 2),
    absoluteDifferenceValue: round_(bucket.absoluteDifferenceValue, 2),
    differenceValue: round_(
      bucket.physicalValue - bucket.systemValue,
      2
    ),
    valueAccuracy: round_(valueAccuracy, 2),
    valueAccuracyStyle: getAccuracyStyle(valueAccuracy),
    costCoverage: round_(costCoverage, 2)
  };
}

/** Returns A, B, and C unique SKU count without Unclassified. */
function countMappedAbcSkus_(classRows) {
  return classRows.reduce(function (total, row) {
    return row.abcClass === 'Unclassified'
      ? total
      : total + row.uniqueSkuCount;
  }, 0);
}

/** Keeps only A, B, and C; every other value defaults to C. */
function normalizeAbcClass_(value) {
  const abcClass = cleanText_(value).toUpperCase();
  return ['A', 'B', 'C'].indexOf(abcClass) >= 0
    ? abcClass
    : 'C';
}

/**
 * Reads a master sheet into simple named objects without changing the sheet.
 */
function readMasterSheet_(sheetName, expectedHeaders, outputKeys) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = findSheetIgnoreCase_(spreadsheet, sheetName);

  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  const values = sheet
    .getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn())
    .getDisplayValues();
  const normalizedHeaders = values[0].map(normalizeHeader_);
  const indexes = {};

  expectedHeaders.forEach(function (expectedHeader) {
    const index = normalizedHeaders.indexOf(
      normalizeHeader_(expectedHeader)
    );

    if (index < 0) {
      throw new Error(
        'Sheet "' +
          sheet.getName() +
          '" is missing the required column "' +
          expectedHeader +
          '".'
      );
    }

    indexes[expectedHeader] = index;
  });

  const rows = [];

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const sourceRow = values[rowIndex];

    if (sourceRow.every(isBlank_)) {
      continue;
    }

    const outputRow = {};
    expectedHeaders.forEach(function (header, index) {
      outputRow[outputKeys[index]] = cleanText_(
        sourceRow[indexes[header]]
      );
    });
    rows.push(outputRow);
  }

  return rows;
}

/**
 * Finds a tab without requiring exact upper/lower-case spelling.
 */
function findSheetIgnoreCase_(spreadsheet, requestedName) {
  const requested = cleanText_(requestedName).toLowerCase();
  const sheets = spreadsheet.getSheets();

  for (let index = 0; index < sheets.length; index += 1) {
    if (sheets[index].getName().toLowerCase() === requested) {
      return sheets[index];
    }
  }

  return null;
}

/**
 * Ignores case, repeated spaces, and periods when comparing headers.
 */
function normalizeHeader_(value) {
  return cleanText_(value)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Creates a stable, case-insensitive key for joining inventory and COGS SKUs.
 */
function normalizeSku_(value) {
  return cleanText_(value).toUpperCase();
}

/**
 * Normalizes the historical SL_AMB label to the live facility name.
 */
function normalizeFacility_(value) {
  const facility = cleanText_(value).toUpperCase();
  return facility === 'SL_AMB' ? 'SL_AMBIENT' : facility;
}

/**
 * Checks only the required inventory cells when deciding if a row is blank.
 */
function inventoryRowIsBlank_(row, indexes) {
  return INVENTORY_HEADERS.every(function (header) {
    return isBlank_(row[indexes[header]]);
  });
}

/**
 * Builds Facility + Rack + Shelf.
 */
function binKey_(row) {
  const facility = cleanText_(row.facility);
  const rack = cleanText_(row.rack);
  const shelf = cleanText_(row.shelf);

  if (!rack && !shelf) {
    return '';
  }

  return [facility, rack, shelf].join('||');
}

/**
 * Reads a required text Config value.
 */
function requiredTextSetting_(settings, name) {
  const value = cleanText_(settings[name]);

  if (!value) {
    throw new Error('Config value "' + name + '" cannot be blank.');
  }

  return value;
}

/**
 * Reads and validates a numeric Config value.
 */
function requiredNumberSetting_(settings, name, minimum, maximum) {
  const rawValue = settings[name];

  if (isBlank_(rawValue) || isNaN(Number(rawValue))) {
    throw new Error('Config value "' + name + '" must be a number.');
  }

  const value = Number(rawValue);

  if (minimum !== null && value < minimum) {
    throw new Error(
      'Config value "' + name + '" must be at least ' + minimum + '.'
    );
  }

  if (maximum !== null && value > maximum) {
    throw new Error(
      'Config value "' + name + '" must not be above ' + maximum + '.'
    );
  }

  return value;
}

/** Reads an optional Config text value and applies a safe default. */
function optionalTextSetting_(settings, name, defaultValue) {
  const value = cleanText_(settings[name]);
  return value || defaultValue;
}

/**
 * Reads an optional Config date and always returns yyyy-MM-dd.
 *
 * Google Sheets can return the same cell as either text or a Date object,
 * depending on the cell format. Normalizing here keeps email-date comparisons
 * and month filters reliable in both cases.
 */
function optionalDateSetting_(
  settings,
  name,
  defaultValue,
  timeZone
) {
  if (isBlank_(settings[name])) {
    return defaultValue;
  }

  const value = normalizeDate_(
    settings[name],
    timeZone || 'Asia/Kolkata'
  );

  if (!value) {
    throw new Error(
      'Config value "' + name + '" must be a valid date.'
    );
  }

  return value;
}

/** Reads an optional Config number and validates it when entered. */
function optionalNumberSetting_(
  settings,
  name,
  defaultValue,
  minimum,
  maximum
) {
  if (isBlank_(settings[name])) {
    return defaultValue;
  }

  return requiredNumberSetting_(settings, name, minimum, maximum);
}

/**
 * Converts an optional sheet value to a number.
 *
 * Unlike toNumber_(), this returns null for blank or invalid values so a
 * missing cost is never silently treated as a valid zero cost.
 */
function optionalNumber_(value) {
  if (isBlank_(value)) {
    return null;
  }

  if (typeof value === 'number') {
    return isFinite(value) ? value : null;
  }

  const text = String(value).trim().replace(/,/g, '');
  const isAccountingNegative = /^\(.*\)$/.test(text);
  const number = Number(text.replace(/[()]/g, ''));

  if (!isFinite(number)) {
    return null;
  }

  return isAccountingNegative ? -number : number;
}

/**
 * Converts sheet values such as "1,250" and "(5)" into numbers.
 */
function toNumber_(value) {
  if (typeof value === 'number') {
    return isFinite(value) ? value : 0;
  }

  if (isBlank_(value)) {
    return 0;
  }

  const text = String(value).trim().replace(/,/g, '');
  const isAccountingNegative = /^\(.*\)$/.test(text);
  const number = Number(text.replace(/[()]/g, ''));

  if (!isFinite(number)) {
    return 0;
  }

  return isAccountingNegative ? -number : number;
}

/** Converts the local part of an email into a readable display name. */
function sessionDisplayName_(email) {
  const localPart = cleanText_(email).split('@')[0];
  const words = localPart.replace(/[._-]+/g, ' ').trim().split(/\s+/);

  return words
    .filter(Boolean)
    .map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ') || 'Authorized Google user';
}

/**
 * Converts a value to trimmed text.
 */
function cleanText_(value) {
  return value === null || value === undefined
    ? ''
    : String(value).trim();
}

/**
 * Checks if a value is empty.
 */
function isBlank_(value) {
  return value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '');
}

/**
 * Converts a Sheets date, yyyy-MM-dd, or dd/MM/yyyy to yyyy-MM-dd.
 */
function normalizeDate_(value, timeZone) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  }

  if (typeof value === 'number' && isFinite(value)) {
    const serialDate = new Date(
      Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000
    );
    return Utilities.formatDate(serialDate, timeZone, 'yyyy-MM-dd');
  }

  const text = cleanText_(value);
  if (!text) {
    return '';
  }

  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    return [
      match[1],
      twoDigits_(match[2]),
      twoDigits_(match[3])
    ].join('-');
  }

  match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    return [
      match[3],
      twoDigits_(match[2]),
      twoDigits_(match[1])
    ].join('-');
  }

  const parsed = new Date(text);
  return isNaN(parsed.getTime())
    ? ''
    : Utilities.formatDate(parsed, timeZone, 'yyyy-MM-dd');
}

/**
 * Pads a date number with a leading zero.
 */
function twoDigits_(value) {
  return ('0' + String(Number(value))).slice(-2);
}

/**
 * Parses yyyy-MM-dd at local noon.
 */
function parseIsoDate_(dateText) {
  const match = cleanText_(dateText).match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (!match) {
    return null;
  }

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
    0,
    0
  );

  return isNaN(date.getTime()) ? null : date;
}

/**
 * Adds calendar days without changing the original Date.
 */
function addDays_(date, days) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Formats a Date as yyyy-MM-dd.
 */
function formatDate_(date) {
  return Utilities.formatDate(date, getTimeZone_(), 'yyyy-MM-dd');
}

/**
 * Reads the spreadsheet time zone once per execution.
 */
function getTimeZone_() {
  if (!TIME_ZONE_CACHE) {
    TIME_ZONE_CACHE =
      SpreadsheetApp.openById(SPREADSHEET_ID).getSpreadsheetTimeZone() ||
      Session.getScriptTimeZone() ||
      'Asia/Kolkata';
  }

  return TIME_ZONE_CACHE;
}

/**
 * Rounds a number safely.
 */
function round_(value, decimalPlaces) {
  if (!isFinite(value)) {
    return 0;
  }

  const multiplier = Math.pow(10, decimalPlaces);
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

/**
 * Reads the last successful refresh time.
 */
function getLastRefreshTime_() {
  return PropertiesService
    .getScriptProperties()
    .getProperty(LAST_REFRESH_PROPERTY) || '';
}

/**
 * Creates a JSON Web App response.
 */
function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Compares test numbers and stops the test when a value is wrong.
 */
function assertEqual_(actual, expected, label) {
  if (Math.abs(Number(actual) - Number(expected)) > 0.001) {
    throw new Error(
      label +
        ' test failed. Expected ' +
        expected +
        ' but received ' +
        actual +
        '.'
    );
  }
}
