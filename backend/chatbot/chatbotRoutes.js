const express = require("express");

const {
  Report,
  Division,
  Office,
  DashboardWorksheet,
} = require("../models/index");

const {
  loadDivisionData,
} = require("./googleSheetsService");

const {
  answerQuestion,
} = require("../chatbotEngine/chatbotService");

const router = express.Router();

/**
 * ============================================================
 * GOOGLE SHEETS HELPERS
 * ============================================================
 */

/**
 * Extract the Google Spreadsheet ID from the URL stored
 * in reports.sheetUrl.
 *
 * Example:
 * https://docs.google.com/spreadsheets/d/ABC123/edit?usp=sharing
 *
 * Returns:
 * ABC123
 */
function getGoogleSpreadsheetId(sheetUrl) {
  if (!sheetUrl || typeof sheetUrl !== "string") {
    throw new Error(
      "No Google Sheets URL is configured for this report."
    );
  }

  const trimmedUrl = sheetUrl.trim();

  if (!trimmedUrl.startsWith("https://")) {
    throw new Error(
      "The configured Google Sheets URL is invalid."
    );
  }

  const match = trimmedUrl.match(
    /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/
  );

  if (!match) {
    throw new Error(
      "The configured link is not a valid Google Sheets URL."
    );
  }

  return match[1];
}

/**
 * Build the CSV URL for ONE worksheet.
 *
 * The Google Sheet URL itself comes from:
 *
 * reports.sheetUrl
 *
 * The worksheet GID comes from:
 *
 * dashboard_worksheets.gid
 */
function buildWorksheetCsvUrl(sheetUrl, gid) {
  const spreadsheetId =
    getGoogleSpreadsheetId(sheetUrl);

  const worksheetGid = String(
    gid ?? ""
  ).trim();

  if (!worksheetGid) {
    throw new Error(
      "A worksheet does not have a configured GID."
    );
  }

  return (
    `https://docs.google.com/spreadsheets/d/` +
    `${spreadsheetId}/export?format=csv&gid=` +
    `${encodeURIComponent(worksheetGid)}`
  );
}

/**
 * ============================================================
 * REPORT DATASET
 * ============================================================
 *
 * Loads:
 *
 * reports
 *      +
 * dashboard_worksheets
 *
 * reports.id
 *      ↓
 * dashboard_worksheets.dashboardId
 */
async function getReportDataset(reportId) {
  const numericReportId = Number(reportId);

  if (!Number.isInteger(numericReportId)) {
    const error = new Error(
      "A valid report ID is required."
    );

    error.statusCode = 400;
    throw error;
  }

  /**
   * Get the dashboard/report.
   */
  const report = await Report.findByPk(
    numericReportId,
    {
      include: [
        {
          model: Division,
          as: "division",
          include: [
            {
              model: Office,
              as: "office",
            },
          ],
        },
      ],
    }
  );

  if (!report) {
    const error = new Error(
      "Report not found."
    );

    error.statusCode = 404;
    throw error;
  }

  /**
   * Google Spreadsheet URL is still stored
   * in the reports table.
   */
  if (!report.sheetUrl) {
    const error = new Error(
      `No Google Sheet is configured for "${report.title}".`
    );

    error.statusCode = 400;
    throw error;
  }

  /**
   * Get ALL worksheet tabs belonging to this dashboard.
   *
   * dashboard_worksheets.dashboardId
   * points to:
   *
   * reports.id
   */
  const worksheets =
    await DashboardWorksheet.findAll({
      where: {
        dashboardId: numericReportId,
      },

      order: [
        ["worksheetId", "ASC"],
      ],
    });

  if (!worksheets.length) {
    const error = new Error(
      `No worksheets are configured for "${report.title}".`
    );

    error.statusCode = 400;
    throw error;
  }

  /**
   * Build the configuration expected by
   * googleSheetsService.js.
   *
   * Example:
   *
   * {
   *   name: "CSM Analytics Dashboard 2025",
   *   sheets: [
   *      {
   *         name: "FIRST",
   *         csvUrl: "...gid=0"
   *      },
   *      {
   *         name: "Second",
   *         csvUrl: "...gid=123456"
   *      }
   *   ]
   * }
   */
  const reportConfig = {
    name: report.title,

    sheets: worksheets.map(
      (worksheet) => ({
        name:
          worksheet.worksheetName,

        csvUrl:
          buildWorksheetCsvUrl(
            report.sheetUrl,
            worksheet.gid
          ),
      })
    ),
  };

  return {
    report,
    worksheets,
    reportConfig,
  };
}

/**
 * ============================================================
 * GET DIVISIONS
 * ============================================================
 *
 * GET /api/chatbot/divisions
 */
router.get("/divisions", async (req, res) => {
  try {
    const offices = await Office.findAll({
      order: [["name", "ASC"]],
    });

    return res.json({
      success: true,

      divisions: offices.map(
        (office) => ({
          id: Number(office.id),

          code:
            office.acronym || "",

          acronym:
            office.acronym || "",

          name:
            office.name,
        })
      ),
    });
  } catch (error) {
    console.error(
      "Unable to load chatbot divisions:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        error.message ||
        "Unable to load divisions.",
    });
  }
});

/**
 * ============================================================
 * GET OFFICES / SECTIONS
 * ============================================================
 *
 * GET /api/chatbot/offices?divisionId=1
 */
router.get("/offices", async (req, res) => {
  try {
    const divisionId = Number(
      req.query.divisionId
    );

    if (!Number.isInteger(divisionId)) {
      return res.status(400).json({
        success: false,

        message:
          "A valid division ID is required.",
      });
    }

    const parentOffice =
      await Office.findByPk(
        divisionId
      );

    if (!parentOffice) {
      return res.status(404).json({
        success: false,

        message:
          "The selected division was not found.",
      });
    }

    const sections =
      await Division.findAll({
        where: {
          officeId: divisionId,
        },

        order: [["name", "ASC"]],
      });

    return res.json({
      success: true,

      division: {
        id: Number(
          parentOffice.id
        ),

        code:
          parentOffice.acronym || "",

        acronym:
          parentOffice.acronym || "",

        name:
          parentOffice.name,
      },

      offices: sections.map(
        (section) => ({
          id: Number(
            section.id
          ),

          code:
            section.acronym || "",

          acronym:
            section.acronym || "",

          name:
            section.name,

          divisionId: Number(
            section.officeId
          ),
        })
      ),
    });
  } catch (error) {
    console.error(
      "Unable to load chatbot offices:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        error.message ||
        "Unable to load offices.",
    });
  }
});

/**
 * ============================================================
 * GET REPORTS
 * ============================================================
 *
 * GET /api/chatbot/reports?officeId=8
 */
router.get("/reports", async (req, res) => {
  try {
    const officeId = Number(
      req.query.officeId
    );

    if (!Number.isInteger(officeId)) {
      return res.status(400).json({
        success: false,

        message:
          "A valid office ID is required.",
      });
    }

    const selectedDivision =
      await Division.findByPk(
        officeId
      );

    if (!selectedDivision) {
      return res.status(404).json({
        success: false,

        message:
          "The selected office or section was not found.",
      });
    }

    /**
     * Include the worksheets so the frontend can know
     * whether this dashboard actually has chatbot data.
     */
    const reports =
      await Report.findAll({
        where: {
          divisionId: officeId,
        },

        include: [
          {
            model:
              DashboardWorksheet,

            as: "worksheets",

            required: false,

            attributes: [
              "worksheetId",
              "worksheetName",
              "gid",
            ],
          },
        ],

        order: [["title", "ASC"]],
      });

    return res.json({
      success: true,

      office: {
        id: Number(
          selectedDivision.id
        ),

        code:
          selectedDivision.acronym ||
          "",

        acronym:
          selectedDivision.acronym ||
          "",

        name:
          selectedDivision.name,

        divisionId: Number(
          selectedDivision.officeId
        ),
      },

      reports: reports.map(
        (report) => ({
          id: Number(
            report.id
          ),

          title:
            report.title,

          description:
            report.description || "",

          /**
           * hasSheet is TRUE only when:
           *
           * 1. reports.sheetUrl exists
           * 2. at least one worksheet is configured
           */
          hasSheet:
            Boolean(report.sheetUrl) &&
            Array.isArray(
              report.worksheets
            ) &&
            report.worksheets.length >
              0,

          worksheetCount:
            Array.isArray(
              report.worksheets
            )
              ? report.worksheets
                  .length
              : 0,

          worksheets:
            Array.isArray(
              report.worksheets
            )
              ? report.worksheets.map(
                  (worksheet) => ({
                    id: Number(
                      worksheet.worksheetId
                    ),

                    name:
                      worksheet.worksheetName,

                    gid:
                      worksheet.gid,
                  })
                )
              : [],
        })
      ),
    });
  } catch (error) {
    console.error(
      "Unable to load chatbot reports:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        error.message ||
        "Unable to load reports.",
    });
  }
});

/**
 * ============================================================
 * INSPECT REPORT DATA
 * ============================================================
 *
 * GET /api/chatbot/reports/:reportId/inspect
 *
 * This now loads ALL worksheets configured in:
 *
 * dashboard_worksheets
 */
router.get(
  "/reports/:reportId/inspect",
  async (req, res) => {
    try {
      const {
        report,
        reportConfig,
      } =
        await getReportDataset(
          req.params.reportId
        );

      /**
       * googleSheetsService.js already knows how
       * to loop through reportConfig.sheets.
       *
       * Therefore ALL configured worksheets
       * are downloaded here.
       */
      const reportData =
        await loadDivisionData(
          reportConfig
        );

      const worksheets =
        Object.entries(
          reportData
        ).map(
          ([
            worksheetName,
            sheetData,
          ]) => {
            let rows = [];
            let error = null;

            if (
              Array.isArray(
                sheetData
              )
            ) {
              rows =
                sheetData;
            } else {
              rows =
                sheetData?.rows ||
                [];

              error =
                sheetData?.error ||
                null;
            }

            const columnNames =
              new Set();

            /**
             * Inspect up to 20 rows to discover
             * the worksheet columns.
             */
            for (
              const row of rows.slice(
                0,
                20
              )
            ) {
              Object.keys(
                row
              ).forEach(
                (columnName) => {
                  columnNames.add(
                    columnName
                  );
                }
              );
            }

            return {
              worksheetName,

              rowCount:
                rows.length,

              columns:
                Array.from(
                  columnNames
                ),

              error,
            };
          }
        );

      return res.json({
        success: true,

        report: {
          id: Number(
            report.id
          ),

          title:
            report.title,

          divisionId: Number(
            report.divisionId
          ),

          office:
            report.division
              ?.name || null,

          division:
            report.division
              ?.office?.name ||
            null,
        },

        worksheetCount:
          worksheets.length,

        worksheets,
      });
    } catch (error) {
      console.error(
        "Chatbot inspection error:",
        error
      );

      return res
        .status(
          error.statusCode ||
            500
        )
        .json({
          success: false,

          message:
            error.message ||
            "Unable to inspect the Google Sheet.",
        });
    }
  }
);

/**
 * ============================================================
 * CHAT
 * ============================================================
 *
 * POST /api/chatbot/chat
 *
 * Request:
 *
 * {
 *   "reportId": 1,
 *   "question": "What is the total expected yield?"
 * }
 *
 * The reportId here is reports.id,
 * NOT reports.reportId.
 */
router.post("/chat", async (req, res) => {
  try {
    const question = String(
      req.body.question || ""
    ).trim();

    const reportId = Number(
      req.body.reportId
    );

    const sessionId = String(
      req.body.sessionId || ""
    ).trim();

    if (!question) {
      return res.status(400).json({
        success: false,
        message:
          "Question is required.",
      });
    }

    if (!Number.isInteger(reportId)) {
      return res.status(400).json({
        success: false,
        message:
          "A valid report ID is required.",
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message:
          "A chatbot session ID is required.",
      });
    }

    const {
      report,
      reportConfig,
    } =
      await getReportDataset(
        reportId
      );

    const reportData =
      await loadDivisionData(
        reportConfig
      );

    const availableSheets =
      Object.keys(
        reportData
      );

    if (
      availableSheets.length === 0
    ) {
      return res.status(500).json({
        success: false,
        message:
          "The selected report did not return any Google Sheets data.",
      });
    }

    const totalRows =
      Object.values(
        reportData
      ).reduce(
        (total, sheet) => {
          if (
            Array.isArray(sheet)
          ) {
            return (
              total +
              sheet.length
            );
          }

          return (
            total +
            (
              sheet?.rows
                ?.length || 0
            )
          );
        },
        0
      );

    if (totalRows === 0) {
      return res.status(400).json({
        success: false,
        message:
          "The connected Google Sheets contain no readable rows.",
      });
    }

    const result =
      await answerQuestion(
        reportData,
        question,
        sessionId
      );

    return res.json({
      ...result,

      success:
        typeof result?.success ===
        "boolean"
          ? result.success
          : true,

      question,

      sessionId,

      report: {
        id: Number(
          report.id
        ),

        title:
          report.title,

        divisionId: Number(
          report.divisionId
        ),

        office:
          report.division
            ?.name || null,

        division:
          report.division
            ?.office?.name ||
          null,
      },

      worksheetCount:
        availableSheets.length,

      worksheets:
        availableSheets,

      totalRows,
    });
  } catch (error) {
    console.error(
      "Chatbot question error:",
      error
    );

    return res
      .status(
        error.statusCode ||
        500
      )
      .json({
        success: false,

        message:
          error.message ||
          "The chatbot was unable to answer the question.",
      });
  }
});

module.exports = router;
module.exports.default = router;