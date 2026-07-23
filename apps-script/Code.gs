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
 * 4. Calculates Last Month, Month to Date, and Yesterday KPIs.
 * 5. Exposes a small JSON API.
 * 6. Creates a cloud refresh trigger.
 * 7. Provides test functions that print results in Apps Script logs.
 * 8. Sends the daily HTML email report from Google's cloud.
 * 9. Joins the read-only COGS sheet and calculates Version 2 value KPIs.
 */

const SPREADSHEET_ID = '1uB9hiqI8z46_fYxiB1syRwNNw0TM_ZV2NCYZcAVmWIk';

const SOURCE_SHEETS = [
  'SL_AMBIENT',
  'SL_MH',
  'SL_RX',
  'OWN',
  'SL_B2C'
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
const COST_HEADERS = [
  'SKU',
  'Product Name',
  'Unit Rate (Excluding Gst)',
  'GST Rate'
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

const ACTIVITY_REASONS = [
  'Sunday',
  'Public Holiday',
  'Inventory Freeze',
  'System Issue',
  'Other'
];

const DASHBOARD_CACHE_KEY = 'inventory_dashboard_v2_value_kpis_v1';
const LAST_REFRESH_PROPERTY = 'INVENTORY_LAST_REFRESH_TIME';
const LAST_EMAIL_SENT_PROPERTY = 'INVENTORY_LAST_EMAIL_SENT_TIME';
const REFRESH_HANDLER = 'refreshDashboardCache';
const EMAIL_HANDLER = 'sendInventoryEmail';

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

    if (action === 'dashboard') {
      data = getDashboardData();
    } else if (action === 'transactions') {
      data = getTransactions();
    } else if (action === 'binmaster') {
      data = getBinMaster();
    } else if (action === 'skumaster') {
      data = getSkuMaster();
    } else if (action === 'config') {
      data = getConfig();
    } else if (action === 'activitystatus') {
      data = getActivityStatus(parameters.date || '');
    } else {
      throw new Error(
        'Unknown action. Use dashboard, transactions, binMaster, skuMaster, config, or activityStatus.'
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
 * It does not edit SL_AMBIENT, SL_MH, SL_RX, OWN, or SL_B2C.
 */
function setupApplication() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

  setupConfigSheet_(spreadsheet);
  setupActivityStatusSheet_(spreadsheet);

  const triggerResult = createRefreshTrigger();
  const emailTriggerResult = createDailyEmailTrigger();
  const dashboard = refreshDashboardCache();

  const result = {
    message: 'Application setup completed successfully.',
    spreadsheetName: spreadsheet.getName(),
    refreshTrigger: triggerResult,
    dailyEmailTrigger: emailTriggerResult,
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
    theme: requiredTextSetting_(settings, 'Theme')
  };
}

/**
 * Combines the five source sheets into one in-memory array.
 *
 * Rules:
 * - Missing, empty, and header-only sheets are skipped.
 * - The first row is treated as the header.
 * - Blank rows are ignored.
 * - Facility is added from the source sheet name.
 * - The existing physical Combine sheet is not read or changed.
 *
 * The live source sheets use "Diff." while the requested logical name is
 * "Diff". Header matching ignores case, extra spaces, and periods so both work.
 */
function getCombinedData() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const combinedRows = [];
  const costMap = readCostMap_(spreadsheet);
  const timeZone = getTimeZone_();

  SOURCE_SHEETS.forEach(function (sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);

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

      combinedRows.push({
        id: sheetName + '-' + String(rowIndex + 1),
        facility: sheetName,
        date: normalizeDate_(row[indexes['Date']], timeZone),
        rack: cleanText_(row[indexes['Rack']]),
        skuCode: skuCode,
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
      });
    }
  });

  return combinedRows;
}

/**
 * Returns combined transactions with the newest dates first.
 */
function getTransactions() {
  const rows = getCombinedData();

  rows.sort(function (first, second) {
    const dateResult = String(second.date).localeCompare(String(first.date));
    return dateResult !== 0
      ? dateResult
      : String(first.facility).localeCompare(String(second.facility));
  });

  return rows;
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
 * SKU, Item Name, Brand, Category, Pack Size
 *
 * Sheet-name matching is case-insensitive so SKU_MASTER and SKU_Master work.
 */
function getSkuMaster() {
  return readMasterSheet_(
    'SKU_Master',
    ['SKU', 'Item Name', 'Brand', 'Category', 'Pack Size'],
    ['sku', 'itemName', 'brand', 'category', 'packSize']
  );
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
  let ntfCount = 0;
  const binDifferences = {};
  const missingCostSkus = {};

  rows.forEach(function (row) {
    const system = toNumber_(row.systemQuantity);
    const physical = toNumber_(row.physicalQuantity);
    const difference = toNumber_(row.difference);
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

    if (/NTF/i.test(cleanText_(row.remark))) {
      ntfCount += 1;
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

  return {
    inventoryAccuracy: round_(inventoryAccuracy, 2),
    inventoryAccuracyStyle: getAccuracyStyle(inventoryAccuracy),
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
    shortValue: round_(shortValue, 2),
    excessValue: round_(excessValue, 2),
    costCoverage: round_(costCoverage, 2),
    costedRowCount: costedRowCount,
    missingCostRowCount: missingCostRowCount,
    missingCostSkuCount: Object.keys(missingCostSkus).length,
    plannedBinCount: round_(plannedBinCount, 2),
    actualBinCount: actualBinCount,
    cycleCountCompletion: round_(completion, 2),
    ntfCount: ntfCount
  };
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
    const dashboard = buildDashboard_();
    const refreshTime = new Date().toISOString();

    CacheService.getScriptCache().put(
      DASHBOARD_CACHE_KEY,
      JSON.stringify(dashboard),
      21600
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
 * Apps Script runs an atHour() trigger during that hour rather than at an
 * exact minute. For example, hour 9 means the trigger runs between 9:00-10:00.
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
    .everyDays(1)
    .inTimezone(getTimeZone_())
    .create();

  return {
    handler: EMAIL_HANDLER,
    sendHour: sendHour,
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

  const dashboard = buildDashboard_();
  const period = dashboard.periods.yesterday;
  const report = buildEmailReport_(config, period);
  const htmlBody = renderEmailTemplate_(report);
  const mailOptions = {
    to: config.emailTo,
    subject: config.emailSubject + ' - ' + report.reportingDate,
    body: buildPlainTextEmail_(report),
    htmlBody: htmlBody,
    name: config.dashboardName
  };

  if (config.emailCC) {
    mailOptions.cc = config.emailCC;
  }

  if (config.emailBCC) {
    mailOptions.bcc = config.emailBCC;
  }

  MailApp.sendEmail(mailOptions);

  const sentTime = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(
    LAST_EMAIL_SENT_PROPERTY,
    sentTime
  );

  const result = {
    sent: true,
    skipped: false,
    reportDate: period.endDate,
    emailTo: config.emailTo,
    emailCC: config.emailCC,
    emailBCC: config.emailBCC,
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
  const dashboard = buildDashboard_();
  const period = dashboard.periods.yesterday;
  const report = buildEmailReport_(config, period);
  const html = renderEmailTemplate_(report);
  const result = {
    passed: true,
    sent: false,
    reportDate: period.endDate,
    hasActivity: report.hasActivity,
    zeroActivity: report.zeroActivity,
    metricCount: report.metrics.length,
    dashboardUrl: report.dashboardUrl,
    htmlLength: html.length
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Tests KPI formulas with known sample data.
 *
 * Expected:
 * Inventory Accuracy 96.4
 * Bin Accuracy 50
 * Net Difference -5
 * Short 7
 * Excess 2
 * Total Inventory Value 2,000
 * Physical Value 2,020
 * Net Difference Value 20
 * Short Value 20
 * Excess Value 40
 * Cost Coverage 66.67
 * Actual Bins 2
 * NTF Count 1
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

  assertEqual_(result.inventoryAccuracy, 96.4, 'Inventory Accuracy');
  assertEqual_(result.binAccuracy, 50, 'Bin Accuracy');
  assertEqual_(result.netDifference, -5, 'Net Difference');
  assertEqual_(result.shortQuantity, 7, 'Short Quantity');
  assertEqual_(result.excessQuantity, 2, 'Excess Quantity');
  assertEqual_(result.systemValue, 2000, 'System Value');
  assertEqual_(result.physicalValue, 2020, 'Physical Value');
  assertEqual_(
    result.totalInventoryValue,
    2000,
    'Total Inventory Value'
  );
  assertEqual_(
    result.netDifferenceValue,
    20,
    'Net Difference Value'
  );
  assertEqual_(result.shortValue, 20, 'Short Value');
  assertEqual_(result.excessValue, 40, 'Excess Value');
  assertEqual_(result.costCoverage, 66.67, 'Cost Coverage');
  assertEqual_(result.costedRowCount, 2, 'Costed Row Count');
  assertEqual_(result.missingCostRowCount, 1, 'Missing Cost Row Count');
  assertEqual_(result.missingCostSkuCount, 1, 'Missing Cost SKU Count');
  assertEqual_(result.actualBinCount, 2, 'Actual Bin Count');
  assertEqual_(result.plannedBinCount, 100, 'Planned Bin Count');
  assertEqual_(result.cycleCountCompletion, 2, 'Completion');
  assertEqual_(result.ntfCount, 1, 'NTF Count');

  const output = {
    passed: true,
    message: 'All sample KPI tests passed.',
    kpis: result
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
 * Builds the Last Month, Month to Date, and Yesterday summary.
 */
function buildDashboard_() {
  const config = getConfig();
  const rows = getCombinedData();
  const ranges = reportingRanges_();
  const periods = {};

  Object.keys(ranges).forEach(function (periodKey) {
    const range = ranges[periodKey];
    const periodRows = rows.filter(function (row) {
      return row.date &&
        row.date >= range.startDate &&
        row.date <= range.endDate;
    });

    periods[periodKey] = {
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
      zeroActivity: periodRows.length === 0
        ? zeroActivityMessage_(range)
        : null
    };
  });

  return {
    dashboardName: config.dashboardName,
    theme: config.theme,
    periods: periods,
    sourceSummary: sourceSummary_(rows)
  };
}

/**
 * Creates the simple view model consumed by EmailTemplate.html.
 */
function buildEmailReport_(config, period) {
  const kpis = period.kpis;
  const inventoryStyle = getAccuracyStyle(kpis.inventoryAccuracy);
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
    metrics: [
      emailMetric_(
        'Inventory Accuracy',
        formatEmailPercent_(kpis.inventoryAccuracy),
        inventoryStyle
      ),
      emailMetric_(
        'Bin Accuracy',
        formatEmailPercent_(kpis.binAccuracy),
        binStyle
      ),
      emailMetric_(
        'System Quantity',
        formatEmailNumber_(kpis.systemQuantity),
        standardStyle
      ),
      emailMetric_(
        'Physical Quantity',
        formatEmailNumber_(kpis.physicalQuantity),
        standardStyle
      ),
      emailMetric_(
        'Net Difference',
        formatEmailNumber_(kpis.netDifference),
        standardStyle
      ),
      emailMetric_(
        'Total Inventory Value',
        formatEmailCurrency_(kpis.totalInventoryValue),
        valueStyle
      ),
      emailMetric_(
        'Physical Inventory Value',
        formatEmailCurrency_(kpis.physicalValue),
        valueStyle
      ),
      emailMetric_(
        'Net Difference Value',
        formatEmailCurrency_(kpis.netDifferenceValue),
        kpis.netDifferenceValue < 0 ? warningStyle : standardStyle
      ),
      emailMetric_(
        'Short Value',
        formatEmailCurrency_(kpis.shortValue),
        warningStyle
      ),
      emailMetric_(
        'Excess Value',
        formatEmailCurrency_(kpis.excessValue),
        warningStyle
      ),
      emailMetric_(
        'Cost Coverage',
        formatEmailPercent_(kpis.costCoverage),
        coverageStyle
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
        'Short Quantity',
        formatEmailNumber_(kpis.shortQuantity),
        warningStyle
      ),
      emailMetric_(
        'Excess Quantity',
        formatEmailNumber_(kpis.excessQuantity),
        warningStyle
      ),
      emailMetric_(
        'NTF Count',
        formatEmailNumber_(kpis.ntfCount),
        warningStyle
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
  return Number(round_(toNumber_(value), 2)).toLocaleString('en-IN', {
    maximumFractionDigits: 2
  });
}

/**
 * Formats a COGS-based value in Indian rupees.
 */
function formatEmailCurrency_(value) {
  return Number(round_(toNumber_(value), 2)).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  });
}

/**
 * Formats an email percentage.
 */
function formatEmailPercent_(value) {
  return formatEmailNumber_(value) + '%';
}

/**
 * Creates the three reporting date ranges using the script time zone.
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

  return {
    lastMonth: {
      label: 'Last Month',
      startDate: formatDate_(lastMonthStart),
      endDate: formatDate_(lastMonthEnd)
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
function sourceSummary_(rows) {
  const rowsByFacility = {};
  const missingCostSkus = {};
  let costedRowCount = 0;
  let missingCostRowCount = 0;

  rows.forEach(function (row) {
    rowsByFacility[row.facility] =
      (rowsByFacility[row.facility] || 0) + 1;

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
        rowsByFacility,
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

  const missingRows = CONFIG_DEFAULTS.filter(function (row) {
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
    }
  });
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
    const index = normalizedHeaders.indexOf(
      normalizeHeader_(requiredHeader)
    );

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
    .getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn())
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
