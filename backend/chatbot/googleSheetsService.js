const { parse } = require("csv-parse/sync");
const { google } = require("googleapis");

/**
 * Adds a cache-busting query parameter so each public fallback request asks
 * Google for a fresh representation instead of reusing the same URL.
 */
function withCacheBuster(csvUrl) {
  const separator = csvUrl.includes("?") ? "&" : "?";
  return `${csvUrl}${separator}_ts=${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

function getGoogleSpreadsheetId(sheetUrl) {
  if (!sheetUrl || typeof sheetUrl !== "string") {
    throw new Error("A valid Google Sheets URL is required.");
  }

  const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);

  if (!match) {
    throw new Error("Unable to determine the Google Spreadsheet ID.");
  }

  return match[1];
}

function cleanRows(rows) {
  return rows.map((row) => {
    const cleanedRow = {};

    for (const [columnName, value] of Object.entries(row || {})) {
      const cleanedColumnName = String(columnName || "").trim();

      if (!cleanedColumnName) {
        continue;
      }

      cleanedRow[cleanedColumnName] =
        typeof value === "string" ? value.trim() : value;
    }

    return cleanedRow;
  });
}

function valuesToObjects(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const headers = (values[0] || []).map((value) =>
    String(value ?? "").trim()
  );

  const rows = [];

  for (const sourceRow of values.slice(1)) {
    if (!Array.isArray(sourceRow)) {
      continue;
    }

    const hasValue = sourceRow.some(
      (value) => String(value ?? "").trim() !== ""
    );

    if (!hasValue) {
      continue;
    }

    const row = {};

    headers.forEach((header, index) => {
      if (!header) {
        return;
      }

      const value = sourceRow[index];
      row[header] = value == null ? "" : String(value).trim();
    });

    rows.push(row);
  }

  return cleanRows(rows);
}

function createExistingOAuthClient() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const refreshToken = String(process.env.GOOGLE_REFRESH_TOKEN || "").trim();

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const oauthClient = new google.auth.OAuth2(clientId, clientSecret);
  oauthClient.setCredentials({ refresh_token: refreshToken });

  return oauthClient;
}

/**
 * Preferred live reader.
 *
 * Reuses the Google OAuth credentials that the existing backend already uses
 * for Google Drive. No new login page or per-dashboard hardcoding is needed.
 * The configured worksheet name is used dynamically as the Sheets API range.
 */
async function loadWorksheetViaSheetsApi({ csvUrl, worksheetName }) {
  const auth = createExistingOAuthClient();

  if (!auth) {
    throw new Error(
      "Existing Google OAuth environment variables are not fully configured."
    );
  }

  const spreadsheetId = getGoogleSpreadsheetId(csvUrl);
  const safeSheetName = String(worksheetName || "").replace(/'/g, "''");

  if (!safeSheetName) {
    throw new Error("Worksheet name is required for the live Sheets API reader.");
  }

  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${safeSheetName}'`,
    majorDimension: "ROWS",
    valueRenderOption: "FORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const rows = valuesToObjects(response.data.values || []);

  console.log(
    `[Google Sheets] LIVE API loaded "${worksheetName}" with ${rows.length} row(s).`
  );

  return rows;
}

/**
 * Public fallback reader. This keeps existing dashboards working when the
 * authenticated Google account cannot access a particular spreadsheet.
 */
async function loadPublishedWorksheet(csvUrl) {
  if (!csvUrl || typeof csvUrl !== "string") {
    throw new Error("A valid Google Sheets CSV URL is required.");
  }

  if (!csvUrl.startsWith("https://")) {
    throw new Error("The Google Sheets CSV URL must start with https://");
  }

  const freshUrl = withCacheBuster(csvUrl);

  console.log(
    `[Google Sheets] Public fallback fetch started at ${new Date().toISOString()}`
  );

  const response = await fetch(freshUrl, {
    method: "GET",
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Unable to download Google Sheet. HTTP status: ${response.status}`
    );
  }

  const csvText = await response.text();

  if (
    csvText.toLowerCase().includes("<!doctype html") ||
    csvText.toLowerCase().includes("<html")
  ) {
    throw new Error(
      "Google returned a webpage instead of CSV data. The sheet may not be publicly readable."
    );
  }

  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  });

  const cleaned = cleanRows(rows);

  console.log(
    `[Google Sheets] PUBLIC fallback loaded ${cleaned.length} row(s).`
  );

  return cleaned;
}

/**
 * Loads every worksheet configured for one division.
 *
 * Priority:
 *   1. Google Sheets API using the backend's EXISTING Google OAuth token.
 *   2. Existing public CSV reader as a compatibility fallback.
 *
 * Nothing is hardcoded to a division, report, spreadsheet ID, GID, field,
 * municipality, or worksheet. The existing report configuration remains the
 * source of truth.
 */
async function loadDivisionData(divisionConfig) {
  if (!divisionConfig) {
    throw new Error("Division configuration is missing.");
  }

  if (!Array.isArray(divisionConfig.sheets)) {
    throw new Error("The selected division has no configured sheets.");
  }

  const divisionData = {};

  for (const sheet of divisionConfig.sheets) {
    if (!sheet.name || !sheet.csvUrl) {
      console.warn("Skipping an invalid sheet configuration.");
      continue;
    }

    try {
      let rows;

      try {
        rows = await loadWorksheetViaSheetsApi({
          csvUrl: sheet.csvUrl,
          worksheetName: sheet.name,
        });

        console.log(
          `[Google Sheets] Source for "${sheet.name}": google-sheets-api`
        );
      } catch (apiError) {
        console.warn(
          `[Google Sheets] LIVE API unavailable for "${sheet.name}": ${apiError.message}`
        );
        console.warn(
          `[Google Sheets] Falling back to public CSV for "${sheet.name}".`
        );

        rows = await loadPublishedWorksheet(sheet.csvUrl);

        console.log(
          `[Google Sheets] Source for "${sheet.name}": public-csv-fallback`
        );
      }

      console.log(
        `[Google Sheets] Loaded "${sheet.name}" with ${rows.length} row(s).`
      );

      divisionData[sheet.name] = rows;
    } catch (error) {
      console.error(
        `Failed to load sheet "${sheet.name}":`,
        error.message
      );

      divisionData[sheet.name] = {
        error: error.message,
        rows: [],
      };
    }
  }

  return divisionData;
}

module.exports = {
  withCacheBuster,
  getGoogleSpreadsheetId,
  valuesToObjects,
  loadWorksheetViaSheetsApi,
  loadPublishedWorksheet,
  loadDivisionData,
};
