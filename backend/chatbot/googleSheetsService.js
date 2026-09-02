const { parse } = require("csv-parse/sync");

/**
 * Adds a cache-busting query parameter so each request asks Google
 * for the latest published CSV instead of reusing a stale cached URL.
 */
function withCacheBuster(csvUrl) {
  const separator = csvUrl.includes("?") ? "&" : "?";
  return `${csvUrl}${separator}_ts=${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
}

/**
 * Converts a normal Google Sheets export CSV URL into the gviz CSV
 * endpoint. The gviz endpoint reads the current worksheet values and is
 * less prone to serving an older generated export snapshot.
 *
 * This is generic: spreadsheet ID and worksheet GID are extracted from
 * the configured URL at runtime.
 */
function buildLiveCsvUrl(csvUrl) {
  const spreadsheetMatch = String(csvUrl).match(
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/
  );

  const gidMatch = String(csvUrl).match(
    /[?&]gid=([^&]+)/
  );

  if (!spreadsheetMatch || !gidMatch) {
    return withCacheBuster(csvUrl);
  }

  const spreadsheetId = spreadsheetMatch[1];
  const gid = decodeURIComponent(gidMatch[1]);

  return withCacheBuster(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(
      gid
    )}`
  );
}

/**
 * Downloads and converts one public Google Sheets CSV link
 * into an array of JavaScript objects.
 */
async function loadPublishedWorksheet(csvUrl) {
  if (!csvUrl || typeof csvUrl !== "string") {
    throw new Error("A valid Google Sheets CSV URL is required.");
  }

  if (!csvUrl.startsWith("https://")) {
    throw new Error("The Google Sheets CSV URL must start with https://");
  }

  const freshUrl = buildLiveCsvUrl(csvUrl);

  const requestedAt = new Date().toISOString();

  console.log(
    `[Google Sheets] Fresh fetch started at ${requestedAt}`
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

  console.log(
    `[Google Sheets] Fresh response received: ${csvText.length} CSV character(s).`
  );

  if (
    csvText.toLowerCase().includes("<!doctype html") ||
    csvText.toLowerCase().includes("<html")
  ) {
    throw new Error(
      "Google returned a webpage instead of CSV data. Make sure the sheet is set to 'Anyone with the link can view'."
    );
  }

  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  });

  const cleanedRows = rows.map((row) => {
    const cleanedRow = {};

    for (const [columnName, value] of Object.entries(row)) {
      const cleanedColumnName = String(columnName || "").trim();

      if (!cleanedColumnName) {
        continue;
      }

      cleanedRow[cleanedColumnName] =
        typeof value === "string" ? value.trim() : value;
    }

    return cleanedRow;
  });

  console.log(
    `[Google Sheets] Parsed ${cleanedRows.length} current row(s).`
  );

  return cleanedRows;
}

/**
 * Loads every worksheet configured for one division.
 *
 * Every call reloads the configured public CSVs.
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
      const rows = await loadPublishedWorksheet(sheet.csvUrl);

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
  buildLiveCsvUrl,
  loadPublishedWorksheet,
  loadDivisionData,
};
