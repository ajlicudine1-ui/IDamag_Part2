const express = require("express");

const corsModule = require("cors");
const cors = corsModule.default || corsModule;

const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");

// Load environment variables before database/model modules.
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================================
// CHATBOT ROUTER LOADER
// ============================================================

function resolveRouter(moduleValue) {
  let current = moduleValue;

  for (let i = 0; i < 5; i++) {
    if (typeof current === "function") {
      return current;
    }

    if (current && typeof current.router === "function") {
      return current.router;
    }

    if (current && current.default) {
      current = current.default;
      continue;
    }

    break;
  }

  return current;
}

let chatbotRoutes = null;

try {
  const chatbotRoutesModule = require("./chatbot/chatbotRoutes");
  chatbotRoutes = resolveRouter(chatbotRoutesModule);

  console.log(
    "chatbotRoutes module keys:",
    Object.keys(chatbotRoutesModule || {})
  );
} catch (error) {
  console.error("Unable to load chatbot routes:", error);
}

// ============================================================
// DATABASE MODELS
// ============================================================

function unwrapModel(mod) {
  if (!mod) {
    return mod;
  }

  // Already a Sequelize model
  if (
    typeof mod.findAll === "function" ||
    typeof mod.findOne === "function" ||
    typeof mod.create === "function"
  ) {
    return mod;
  }

  // Wrapped as default export
  if (
    mod.default &&
    (
      typeof mod.default.findAll === "function" ||
      typeof mod.default.findOne === "function" ||
      typeof mod.default.create === "function"
    )
  ) {
    return mod.default;
  }

  return mod.default || mod;
}

const modelsModule = require("./models/index");

const sequelize =
  modelsModule.sequelize?.default ||
  modelsModule.sequelize ||
  require("./config/database");

const Office = unwrapModel(
  modelsModule.Office ||
  require("./models/Office")
);

const Division = unwrapModel(
  modelsModule.Division ||
  require("./models/Division")
);

const Report = unwrapModel(
  modelsModule.Report ||
  require("./models/Report")
);

const DashboardWorksheet = unwrapModel(
  modelsModule.DashboardWorksheet ||
  require("./models/DashboardWorksheet")
);

const User = unwrapModel(
  modelsModule.User ||
  require("./models/User")
);

const ActivityLog = unwrapModel(
  modelsModule.ActivityLog ||
  require("./models/ActivityLog")
);

const DashboardFeedback = unwrapModel(
  modelsModule.DashboardFeedback ||
  require("./models/DashboardFeedback")
);

const WebsiteFeedback = unwrapModel(
  modelsModule.WebsiteFeedback ||
  require("./models/WebsiteFeedback")
);

const ChatbotConversation = unwrapModel(
  modelsModule.ChatbotConversation ||
  require("./models/ChatbotConversation")
);

const {
  sendWelcomeEmail,
  generateSecurePassword,
} = require("./utils/emailService");

console.log(
  "models/index keys:",
  Object.keys(modelsModule || {})
);

console.log(
  "typeof sequelize.define:",
  typeof sequelize?.define
);

console.log(
  "typeof Office.findAll:",
  typeof Office?.findAll
);

console.log(
  "typeof Division.findAll:",
  typeof Division?.findAll
);

console.log("typeof cors:", typeof cors);

console.log(
  "typeof chatbotRoutes:",
  typeof chatbotRoutes
);

// ============================================================
// MIDDLEWARE
// ============================================================

const allowedOrigins = [
  "http://localhost:5173",
  "http://192.168.56.1:5173",
  "https://i-damag-part2.vercel.app",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      console.log("Request origin:", origin);

      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.warn("Blocked CORS origin:", origin);

      return callback(
        new Error(`Not allowed by CORS: ${origin}`)
      );
    },

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-user-id",
    ],
  })
);


app.use(express.json());

// Mount chatbot only if the router loaded correctly.
// A chatbot bundling issue must not crash the rest of the API.
if (typeof chatbotRoutes === "function") {
  app.use("/api/chatbot", chatbotRoutes);

  console.log(
    "Chatbot routes loaded successfully."
  );
} else {
  console.warn(
    "Chatbot routes were not loaded. Other API routes will continue working."
  );
}

// ============================================================
// LOGGING HELPER
// ============================================================

const logActivity = async (
  userId,
  action,
  description,
  metadata = null,
  req = null
) => {
  try {
    let effectiveUserId = userId;
    let ipAddress = null;

    if (req) {
      ipAddress =
        req.headers["x-forwarded-for"] ||
        req.socket.remoteAddress ||
        req.ip;

      if (
        !effectiveUserId &&
        req.headers["x-user-id"]
      ) {
        const headerId = parseInt(
          req.headers["x-user-id"]
        );

        if (!isNaN(headerId)) {
          effectiveUserId = headerId;
        }
      }
    }

    await ActivityLog.create({
      userId: effectiveUserId,
      action,
      description,
      metadata,
      ipAddress,
    });
  } catch (error) {
    console.error("Logging Error:", error);
  }
};

// ============================================================
// AUTH
// ============================================================

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({
      where: { email },
      include: ["office", "division"],
    });

    if (!user) {
      await logActivity(
        null,
        "LOGIN_ATTEMPT",
        `Failed login attempt for email: ${email}`,
        { email },
        req
      );

      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    let isMatch = false;

    if (
      user.password.startsWith("$2a$") ||
      user.password.startsWith("$2b$")
    ) {
      isMatch = await bcrypt.compare(
        password,
        user.password
      );
    } else {
      isMatch = user.password === password;
    }

    if (!isMatch) {
      await logActivity(
        user.id,
        "LOGIN_FAIL",
        `Incorrect password for ${user.email}`,
        null,
        req
      );

      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (!user.isActive) {
      if (user.requiresPasswordChange) {
        await user.update({
          isActive: true,
        });

        await logActivity(
          user.id,
          "ACTIVATE_USER",
          `Account activated on first login: ${user.email}`,
          null,
          req
        );
      } else {
        await logActivity(
          user.id,
          "LOGIN_BLOCKED",
          `Login blocked for inactive account: ${user.email}`,
          null,
          req
        );

        return res.status(403).json({
          message:
            "Account Pending Activation. Your registration is still awaiting approval from an administrator.",
        });
      }
    }

    await logActivity(
      user.id,
      "LOGIN_SUCCESS",
      `User logged in: ${user.email}`,
      null,
      req
    );

    const userResponse = user.toJSON();

    delete userResponse.password;

    res.json(userResponse);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// ============================================================
// TEST CONNECTION
// ============================================================

app.get("/api/test", async (req, res) => {
  try {
    await sequelize.authenticate();

    res.json({
      success: true,
      message: "Backend is connected to Supabase PostgreSQL!",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================================
// OFFICES
// ============================================================

app.get("/api/offices", async (req, res) => {
  try {
    const offices = await Office.findAll({
      include: "divisions",
    });

    res.json(offices);
  } catch (error) {
    res.status(500).json({
      error: error.message,
    });
  }
});

app.post("/api/offices", async (req, res) => {
  try {
    const office = await Office.create(
      req.body
    );

    await logActivity(
      null,
      "ADD_OFFICE",
      `New office created: ${office.name}`,
      {
        officeId: office.id,
      },
      req
    );

    res.status(201).json(office);
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

app.put(
  "/api/offices/:id",
  async (req, res) => {
    try {
      const { id } = req.params;

      const [updated] =
        await Office.update(
          req.body,
          {
            where: { id },
          }
        );

      if (updated) {
        const updatedOffice =
          await Office.findByPk(id);

        await logActivity(
          null,
          "EDIT_OFFICE",
          `Office updated: ${updatedOffice.name}`,
          {
            officeId: id,
          },
          req
        );

        return res
          .status(200)
          .json(updatedOffice);
      }

      throw new Error(
        "Office not found"
      );
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.delete(
  "/api/offices/:id",
  async (req, res) => {
    try {
      const { id } = req.params;

      const office =
        await Office.findByPk(id);

      const deleted =
        await Office.destroy({
          where: { id },
        });

      if (deleted) {
        await logActivity(
          null,
          "DELETE_OFFICE",
          `Office removed: ${
            office?.name || id
          }`,
          {
            deletedId: id,
          },
          req
        );

        return res
          .status(204)
          .send("Office deleted");
      }

      throw new Error(
        "Office not found"
      );
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

// ============================================================
// DIVISIONS
// ============================================================

app.get(
  "/api/divisions",
  async (req, res) => {
    try {
      const { officeId } = req.query;

      const filter = officeId
        ? {
            where: {
              officeId,
            },
          }
        : {};

      const divisions =
        await Division.findAll(filter);

      res.json(divisions);
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.post(
  "/api/divisions",
  async (req, res) => {
    try {
      const division =
        await Division.create(
          req.body
        );

      await logActivity(
        null,
        "ADD_SECTION",
        `New section created: ${division.name}`,
        {
          sectionId: division.id,
        },
        req
      );

      res.status(201).json(division);
    } catch (error) {
      res.status(400).json({
        error: error.message,
      });
    }
  }
);

app.put(
  "/api/divisions/:id",
  async (req, res) => {
    try {
      const { id } = req.params;

      const [updated] =
        await Division.update(
          req.body,
          {
            where: { id },
          }
        );

      if (updated) {
        const updatedDivision =
          await Division.findByPk(id);

        await logActivity(
          null,
          "EDIT_SECTION",
          `Section updated: ${updatedDivision.name}`,
          {
            sectionId: id,
          },
          req
        );

        return res
          .status(200)
          .json(updatedDivision);
      }

      throw new Error(
        "Division not found"
      );
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.delete(
  "/api/divisions/:id",
  async (req, res) => {
    try {
      const { id } = req.params;

      const division =
        await Division.findByPk(id);

      const deleted =
        await Division.destroy({
          where: { id },
        });

      if (deleted) {
        await logActivity(
          null,
          "DELETE_SECTION",
          `Section removed: ${
            division?.name || id
          }`,
          {
            deletedId: id,
          },
          req
        );

        return res
          .status(204)
          .send("Division deleted");
      }

      throw new Error(
        "Division not found"
      );
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

// ============================================================
// REPORTS
// ============================================================

app.get(
  "/api/reports",
  async (req, res) => {
    try {
      const {
        divisionId,
        officeId,
      } = req.query;

      let include = [
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
      ];

      let where = {};

      if (divisionId) {
        where.divisionId =
          divisionId;
      }

      if (officeId) {
        include[0].where = {
          officeId,
        };
      }

      const reports =
        await Report.findAll({
          where,
          include,
        });

      res.json(reports);
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

// ============================================================
// CREATE REPORT
// ============================================================

app.post(
  "/api/reports",
  async (req, res) => {
    try {
      const {
        title,
        reportId,
        description,
        divisionId,
        sheetUrl,
      } = req.body;

      const report =
        await Report.create({
          title,
          reportId,
          description,
          divisionId,

          // Existing column
          sheetUrl:
            sheetUrl || null,
        });

      await logActivity(
        null,
        "ADD_REPORT",
        `New report added: ${title}`,
        {
          reportId: report.id,
        },
        req
      );

      res.status(201).json(report);
    } catch (error) {
      res.status(400).json({
        error: error.message,
      });
    }
  }
);

// ============================================================
// UPDATE REPORT
// ============================================================

app.put(
  "/api/reports/:id",
  async (req, res) => {
    try {
      const { id } = req.params;

      const [updated] =
        await Report.update(
          req.body,
          {
            where: { id },
          }
        );

      if (updated) {
        const updatedReport =
          await Report.findByPk(id);

        await logActivity(
          null,
          "EDIT_REPORT",
          `Report updated: ${updatedReport.title}`,
          {
            reportId: id,
          },
          req
        );

        return res
          .status(200)
          .json(updatedReport);
      }

      throw new Error(
        "Report not found"
      );
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

// ============================================================
// DELETE REPORT
// ============================================================

app.delete(
  "/api/reports/:id",
  async (req, res) => {
    try {
      const { id } = req.params;

      const report =
        await Report.findByPk(id);

      const deleted =
        await Report.destroy({
          where: { id },
        });

      if (deleted) {
        await logActivity(
          null,
          "DELETE_REPORT",
          `Report removed: ${
            report?.title || id
          }`,
          {
            deletedId: id,
          },
          req
        );

        return res
          .status(204)
          .send(
            "Report deleted"
          );
      }

      throw new Error(
        "Report not found"
      );
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

// ============================================================
// WORKSHEETS
// Uses your EXISTING database structure:
// reports.sheetUrl
//
// worksheets:
// worksheetId
// dashboardId
// worksheetName
// gid
// createdAt
// updatedAt
// ============================================================

// ============================================================
// GET WORKSHEETS
// GET /api/worksheets
// GET /api/worksheets?dashboardId=1
// ============================================================

app.get(
  "/api/worksheets",
  async (req, res) => {
    try {
      const { dashboardId } =
        req.query;

      const where = {};

      if (dashboardId) {
        where.dashboardId =
          Number(dashboardId);
      }

      const worksheets =
        await DashboardWorksheet.findAll({
          where,

          order: [
            [
              "worksheetId",
              "ASC",
            ],
          ],
        });

      res.json(worksheets);
    } catch (error) {
      console.error(
        "GET WORKSHEETS ERROR:",
        error
      );

      res.status(500).json({
        error: error.message,
      });
    }
  }
);

// ============================================================
// CREATE WORKSHEET(S)
// POST /api/worksheets
//
// Supports BOTH:
//
// 1. One worksheet:
//
// {
//   "dashboardId": 4,
//   "sheetUrl": "...",
//   "worksheetName": "Main",
//   "gid": "0"
// }
//
// 2. Multiple:
//
// {
//   "dashboardId": 4,
//   "sheetUrl": "...",
//   "worksheets": [
//      {
//        "worksheetName": "Main",
//        "gid": "0"
//      },
//      {
//        "worksheetName": "Members",
//        "gid": "1234"
//      }
//   ]
// }
// ============================================================

app.post(
  "/api/worksheets",
  async (req, res) => {
    const transaction =
      await sequelize.transaction();

    try {
      const {
        dashboardId,
        sheetUrl,
        worksheetName,
        gid,
        worksheets,
      } = req.body;

      // ------------------------------------------------------
      // VALIDATE DASHBOARD / REPORT
      // ------------------------------------------------------

      if (!dashboardId) {
        await transaction.rollback();

        return res
          .status(400)
          .json({
            message:
              "Please select a Power BI report.",
          });
      }

      const report =
        await Report.findByPk(
          Number(dashboardId),
          {
            transaction,
          }
        );

      if (!report) {
        await transaction.rollback();

        return res
          .status(404)
          .json({
            message:
              "The selected Power BI report could not be found.",
          });
      }

      // ------------------------------------------------------
      // SAVE PUBLISHED GOOGLE SHEET URL
      // INTO EXISTING reports.sheetUrl
      // ------------------------------------------------------

      if (
        sheetUrl &&
        String(
          sheetUrl
        ).trim()
      ) {
        await report.update(
          {
            sheetUrl:
              String(
                sheetUrl
              ).trim(),
          },
          {
            transaction,
          }
        );
      }

      // ------------------------------------------------------
      // MULTIPLE WORKSHEETS
      // ------------------------------------------------------

      if (
        Array.isArray(
          worksheets
        )
      ) {
        if (
          worksheets.length ===
          0
        ) {
          await transaction.rollback();

          return res
            .status(400)
            .json({
              message:
                "Please add at least one worksheet.",
            });
        }

        const rows = [];

        for (
          const worksheet of
          worksheets
        ) {
          const name =
            String(
              worksheet
                ?.worksheetName ||
                ""
            ).trim();

          const worksheetGid =
            String(
              worksheet?.gid ??
                ""
            ).trim();

          if (
            !name ||
            worksheetGid ===
              ""
          ) {
            await transaction.rollback();

            return res
              .status(400)
              .json({
                message:
                  "Every worksheet must have a Sheet/Page Name and GID.",
              });
          }

          rows.push({
            dashboardId:
              Number(
                dashboardId
              ),

            worksheetName:
              name,

            gid:
              worksheetGid,
          });
        }

        const created =
          await DashboardWorksheet.bulkCreate(
            rows,
            {
              transaction,
            }
          );

        await transaction.commit();

        await logActivity(
          null,
          "ADD_WORKSHEETS",
          `${created.length} worksheet(s) added to report: ${report.title}`,
          {
            dashboardId:
              report.id,

            reportTitle:
              report.title,

            worksheetCount:
              created.length,
          },
          req
        );

        return res
          .status(201)
          .json({
            message: `${created.length} worksheet(s) saved successfully.`,

            report: {
              id: report.id,

              title:
                report.title,

              sheetUrl:
                report.sheetUrl,
            },

            worksheets:
              created,
          });
      }

      // ------------------------------------------------------
      // SINGLE WORKSHEET
      // This matches your current frontend loop.
      // ------------------------------------------------------

      const cleanName =
        String(
          worksheetName || ""
        ).trim();

      const cleanGid =
        String(
          gid ?? ""
        ).trim();

      if (
        !cleanName ||
        cleanGid === ""
      ) {
        await transaction.rollback();

        return res
          .status(400)
          .json({
            message:
              "worksheetName and gid are required.",
          });
      }

      const createdWorksheet =
        await DashboardWorksheet.create(
          {
            dashboardId:
              Number(
                dashboardId
              ),

            worksheetName:
              cleanName,

            gid:
              cleanGid,
          },
          {
            transaction,
          }
        );

      await transaction.commit();

      await logActivity(
        null,
        "ADD_WORKSHEET",
        `Worksheet added: ${cleanName} to report: ${report.title}`,
        {
          worksheetId:
            createdWorksheet.worksheetId,

          dashboardId:
            report.id,

          reportTitle:
            report.title,

          gid:
            cleanGid,
        },
        req
      );

      return res
        .status(201)
        .json({
          message:
            "Worksheet saved successfully.",

          report: {
            id: report.id,

            title:
              report.title,

            sheetUrl:
              report.sheetUrl,
          },

          worksheet:
            createdWorksheet,
        });
    } catch (error) {
      try {
        if (
          !transaction.finished
        ) {
          await transaction.rollback();
        }
      } catch (
        rollbackError
      ) {
        console.error(
          "WORKSHEET TRANSACTION ROLLBACK ERROR:",
          rollbackError
        );
      }

      console.error(
        "POST WORKSHEET ERROR:",
        error
      );

      res.status(500).json({
        message:
          "Unable to save worksheet.",

        error:
          error.message,
      });
    }
  }
);

// ============================================================
// UPDATE WORKSHEET
// PUT /api/worksheets/:id
// ============================================================

app.put(
  "/api/worksheets/:id",
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const {
        dashboardId,
        worksheetName,
        gid,
        sheetUrl,
      } = req.body;

      const worksheet =
        await DashboardWorksheet.findByPk(
          id
        );

      if (!worksheet) {
        return res
          .status(404)
          .json({
            message:
              "Worksheet not found.",
          });
      }

      // If report changes or Sheet URL
      // changes, update reports table too.
      const targetDashboardId =
        dashboardId !==
        undefined
          ? Number(
              dashboardId
            )
          : worksheet.dashboardId;

      const report =
        await Report.findByPk(
          targetDashboardId
        );

      if (!report) {
        return res
          .status(404)
          .json({
            message:
              "Associated Power BI report not found.",
          });
      }

      if (
        sheetUrl !==
          undefined &&
        String(
          sheetUrl
        ).trim()
      ) {
        await report.update({
          sheetUrl:
            String(
              sheetUrl
            ).trim(),
        });
      }

      await worksheet.update({
        dashboardId:
          targetDashboardId,

        worksheetName:
          worksheetName !==
          undefined
            ? String(
                worksheetName
              ).trim()
            : worksheet.worksheetName,

        gid:
          gid !== undefined
            ? String(
                gid
              ).trim()
            : worksheet.gid,
      });

      await logActivity(
        null,
        "EDIT_WORKSHEET",
        `Worksheet updated: ${worksheet.worksheetName}`,
        {
          worksheetId:
            worksheet.worksheetId,

          dashboardId:
            worksheet.dashboardId,
        },
        req
      );

      res.json({
        message:
          "Worksheet updated successfully.",

        worksheet,

        sheetUrl:
          report.sheetUrl,
      });
    } catch (error) {
      console.error(
        "UPDATE WORKSHEET ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

// ============================================================
// DELETE WORKSHEET
// DELETE /api/worksheets/:id
// ============================================================

app.delete(
  "/api/worksheets/:id",
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const worksheet =
        await DashboardWorksheet.findByPk(
          id
        );

      if (!worksheet) {
        return res
          .status(404)
          .json({
            message:
              "Worksheet not found.",
          });
      }

      const worksheetName =
        worksheet.worksheetName;

      const dashboardId =
        worksheet.dashboardId;

      await worksheet.destroy();

      await logActivity(
        null,
        "DELETE_WORKSHEET",
        `Worksheet removed: ${worksheetName}`,
        {
          worksheetId: id,
          dashboardId,
        },
        req
      );

      res.status(200).json({
        message:
          "Worksheet deleted successfully.",
      });
    } catch (error) {
      console.error(
        "DELETE WORKSHEET ERROR:",
        error
      );

      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

// ============================================================
// USERS
// ============================================================

app.get(
  "/api/users",
  async (req, res) => {
    try {
      const users =
        await User.findAll({
          include: [
            "office",
            "division",
          ],
        });

      res.json(users);
    } catch (error) {
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

app.post(
  "/api/users",
  async (req, res) => {
    try {
      const {
        officeId,
        divisionId,
      } = req.body;

      const division =
        await Division.findByPk(
          divisionId
        );

      if (
        !division ||
        division.officeId !==
          parseInt(officeId)
      ) {
        return res
          .status(400)
          .json({
            message:
              "Invalid data integrity: The selected division does not belong to the selected office.",
          });
      }

      let plainPassword =
        req.body.password;

      let isAdminCreated =
        false;

      if (!plainPassword) {
        plainPassword =
          generateSecurePassword();

        req.body.requiresPasswordChange =
          true;

        isAdminCreated =
          true;
      }

      const salt =
        await bcrypt.genSalt(
          10
        );

      req.body.password =
        await bcrypt.hash(
          plainPassword,
          salt
        );

      const user =
        await User.create(
          req.body
        );

      if (isAdminCreated) {
        await logActivity(
          null,
          "ADD_USER",
          `Admin added new user: ${user.email}`,
          {
            userId: user.id,
          },
          req
        );

        sendWelcomeEmail(
          user.email,
          plainPassword
        );
      } else {
        await logActivity(
          user.id,
          "REGISTRATION",
          `New user self-registered: ${user.email}`,
          null,
          req
        );
      }

      const userResponse =
        user.toJSON();

      delete userResponse.password;

      res
        .status(201)
        .json(userResponse);
    } catch (error) {
      res.status(400).json({
        error: error.message,
      });
    }
  }
);

app.put(
  "/api/users/:id",
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const {
        officeId,
        divisionId,
      } = req.body;

      if (
        officeId &&
        divisionId
      ) {
        const division =
          await Division.findByPk(
            divisionId
          );

        if (
          !division ||
          division.officeId !==
            parseInt(
              officeId
            )
        ) {
          return res
            .status(400)
            .json({
              message:
                "Invalid data integrity: The selected division does not belong to the selected office.",
            });
        }
      }

      if (req.body.password) {
        if (
          !req.body.password.startsWith(
            "$2a$"
          ) &&
          !req.body.password.startsWith(
            "$2b$"
          )
        ) {
          const salt =
            await bcrypt.genSalt(
              10
            );

          req.body.password =
            await bcrypt.hash(
              req.body.password,
              salt
            );
        }
      }

      const [updated] =
        await User.update(
          req.body,
          {
            where: { id },
          }
        );

      if (updated) {
        const updatedUser =
          await User.findByPk(
            id,
            {
              include: [
                "office",
                "division",
              ],
            }
          );

        await logActivity(
          null,
          "EDIT_USER",
          `User details updated for: ${updatedUser.email}`,
          {
            userId: id,
          },
          req
        );

        const userResponse =
          updatedUser.toJSON();

        delete userResponse.password;

        return res
          .status(200)
          .json(userResponse);
      }

      throw new Error(
        "User not found"
      );
    } catch (error) {
      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.delete(
  "/api/users/:id",
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const user =
        await User.findByPk(id);

      const deleted =
        await User.destroy({
          where: { id },
        });

      if (deleted) {
        await logActivity(
          null,
          "REMOVE_USER",
          `User removed: ${
            user?.email || id
          }`,
          {
            deletedId: id,
          },
          req
        );

        return res
          .status(204)
          .send(
            "User deleted"
          );
      }

      throw new Error(
        "User not found"
      );
    } catch (error) {
      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.patch(
  "/api/users/:id/status",
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const { isActive } =
        req.body;

      const [updated] =
        await User.update(
          {
            isActive,
          },
          {
            where: { id },
          }
        );

      if (updated) {
        const updatedUser =
          await User.findByPk(
            id,
            {
              include: [
                "office",
                "division",
              ],
            }
          );

        await logActivity(
          null,
          isActive
            ? "ACTIVATE_USER"
            : "DEACTIVATE_USER",
          `${
            isActive
              ? "Activated"
              : "Deactivated"
          } user: ${updatedUser.email}`,
          {
            targetId: id,
          },
          req
        );

        const userResponse =
          updatedUser.toJSON();

        delete userResponse.password;

        return res
          .status(200)
          .json(userResponse);
      }

      throw new Error(
        "User not found"
      );
    } catch (error) {
      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

app.put(
  "/api/users/:id/password",
  async (req, res) => {
    try {
      const { id } =
        req.params;

      const {
        currentPassword,
        newPassword,
      } = req.body;

      const user =
        await User.findByPk(id);

      if (!user) {
        return res
          .status(404)
          .json({
            message:
              "User not found",
          });
      }

      let isMatch = false;

      if (
        user.password.startsWith(
          "$2a$"
        ) ||
        user.password.startsWith(
          "$2b$"
        )
      ) {
        isMatch =
          await bcrypt.compare(
            currentPassword,
            user.password
          );
      } else {
        isMatch =
          user.password ===
          currentPassword;
      }

      if (!isMatch) {
        return res
          .status(401)
          .json({
            message:
              "Incorrect current password",
          });
      }

      const salt =
        await bcrypt.genSalt(
          10
        );

      const hashedPassword =
        await bcrypt.hash(
          newPassword,
          salt
        );

      await User.update(
        {
          password:
            hashedPassword,

          requiresPasswordChange:
            false,
        },
        {
          where: { id },
        }
      );

      await logActivity(
        id,
        "CHANGE_PASSWORD",
        `User changed password: ${user.email}`,
        null,
        req
      );

      res.status(200).json({
        message:
          "Password updated successfully",
      });
    } catch (error) {
      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);

// ============================================================
// LOGOUT
// ============================================================

app.post(
  "/api/logout",
  async (req, res) => {
    const {
      userId,
      email,
    } = req.body;

    await logActivity(
      userId,
      "LOGOUT",
      `User logged out: ${email}`,
      null,
      req
    );

    res.status(200).json({
      message:
        "Logout logged",
    });
  }
);

// ============================================================
// ACTIVITY LOGS
// ============================================================

app.get(
  "/api/activity-logs",
  async (req, res) => {
    try {
      const page =
        parseInt(
          req.query.page
        ) || 1;

      const limit =
        parseInt(
          req.query.limit
        ) || 10;

      const offset =
        (page - 1) *
        limit;

      const {
        count,
        rows,
      } =
        await ActivityLog.findAndCountAll(
          {
            include: [
              {
                model: User,
                as: "user",

                attributes: [
                  "firstName",
                  "lastName",
                  "email",
                ],
              },
            ],

            order: [
              [
                "createdAt",
                "DESC",
              ],
            ],

            limit,
            offset,
          }
        );

      res.json({
        logs: rows,

        totalPages:
          Math.ceil(
            count / limit
          ),

        currentPage:
          page,

        totalCount:
          count,
      });
    } catch (error) {
      res.status(500).json({
        error:
          error.message,
      });
    }
  }
);


// ============================================================
// DASHBOARD FEEDBACK
// ============================================================

// ------------------------------------------------------------
// GET ALL DASHBOARD FEEDBACK
// GET /api/dashboard-feedback
// ------------------------------------------------------------

app.get("/api/dashboard-feedback", async (req, res) => {
  try {
    const feedback = await DashboardFeedback.findAll({
      order: [["created_at", "DESC"]],
    });

    res.status(200).json(feedback);
  } catch (error) {
    console.error("GET DASHBOARD FEEDBACK ERROR:", error);

    res.status(500).json({
      message: "Unable to load dashboard feedback.",
      error: error.message,
    });
  }
});


// ------------------------------------------------------------
// CREATE DASHBOARD FEEDBACK
// POST /api/dashboard-feedback
// ------------------------------------------------------------

app.post("/api/dashboard-feedback", async (req, res) => {
  try {
    const {
      fullName,
      email,
      dashboardName,
      userInterface,
      userExperience,
      dataCompleteness,
      dataAccuracy,
      accessibility,
      additionalComments,
    } = req.body;

    // Dashboard is required
    if (!dashboardName || !String(dashboardName).trim()) {
      return res.status(400).json({
        message: "Dashboard name is required.",
      });
    }

    // Convert ratings to numbers
    const ratings = {
      userInterface: Number(userInterface),
      userExperience: Number(userExperience),
      dataCompleteness: Number(dataCompleteness),
      dataAccuracy: Number(dataAccuracy),
      accessibility: Number(accessibility),
    };

    // Validate ratings
    for (const [field, value] of Object.entries(ratings)) {
      if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > 5
      ) {
        return res.status(400).json({
          message: `${field} must be a rating from 1 to 5.`,
        });
      }
    }

    const feedback = await DashboardFeedback.create({
      fullName:
        fullName && String(fullName).trim()
          ? String(fullName).trim()
          : null,

      email:
        email && String(email).trim()
          ? String(email).trim()
          : null,

      dashboardName: String(dashboardName).trim(),

      userInterface: ratings.userInterface,
      userExperience: ratings.userExperience,
      dataCompleteness: ratings.dataCompleteness,
      dataAccuracy: ratings.dataAccuracy,
      accessibility: ratings.accessibility,

      additionalComments:
        additionalComments && String(additionalComments).trim()
          ? String(additionalComments).trim()
          : null,
    });

    res.status(201).json({
      message: "Dashboard feedback submitted successfully.",
      feedback,
    });
  } catch (error) {
    console.error("CREATE DASHBOARD FEEDBACK ERROR:", error);

    res.status(500).json({
      message: "Unable to submit dashboard feedback.",
      error: error.message,
    });
  }
});


// ============================================================
// WEBSITE FEEDBACK
// ============================================================

app.get("/api/website-feedback", async (req, res) => {
  try {
    const feedback = await WebsiteFeedback.findAll({
      order: [["created_at", "DESC"]],
    });

    res.status(200).json(feedback);
  } catch (error) {
    console.error("GET WEBSITE FEEDBACK ERROR:", error);

    res.status(500).json({
      message: "Unable to load website feedback.",
      error: error.message,
    });
  }
});

app.post("/api/website-feedback", async (req, res) => {
  try {
    const { websiteSuggestion } = req.body;

    if (
      !websiteSuggestion ||
      !String(websiteSuggestion).trim()
    ) {
      return res.status(400).json({
        message: "Website suggestion is required.",
      });
    }

    const feedback = await WebsiteFeedback.create({
      websiteSuggestion:
        String(websiteSuggestion).trim(),
    });

    return res.status(201).json({
      success: true,
      message: "Website feedback submitted successfully.",
      feedback,
    });
  } catch (error) {
    console.error("WEBSITE FEEDBACK ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to save website feedback.",
      error: error.message,
    });
  }
});


// ============================================================
// FEEDBACK MANAGEMENT API ALIASES
// Used by the Admin Feedback Management page
// ============================================================

app.get("/api/feedback/dashboard", async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT
        user_interface,
        user_experience,
        data_completeness,
        data_accuracy,
        accessibility,
        additional_comments,
        full_name,
        email,
        created_at
      FROM dashboard_feedback
      ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error("Dashboard feedback error:", error);

    res.status(500).json({
      message: "Unable to load dashboard feedback.",
    });
  }
});

app.get("/api/feedback/website", async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT
        id,
        website_suggestion,
        created_at
      FROM website_feedback
      ORDER BY created_at DESC
    `);

    res.status(200).json(rows);
  } catch (error) {
    console.error("GET FEEDBACK MANAGEMENT WEBSITE ERROR:", error);

    res.status(500).json({
      message: "Unable to load website feedback.",
      error: error.message,
    });
  }
});


// ============================================================
// PRIVACY POLICY
// IMPORTANT: Vercel routes only /api/* requests to this backend.
// Therefore the public Google OAuth privacy-policy URL is /api/privacy.
// ============================================================

function renderPrivacyPolicyPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>I-DAMAG Privacy Policy</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Arial, Helvetica, sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: #f5f7f6;
      color: #1f2937;
      line-height: 1.65;
    }

    main {
      width: min(920px, calc(100% - 32px));
      margin: 48px auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      padding: 40px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
    }

    h1 {
      margin-top: 0;
      color: #176b3a;
      font-size: 2rem;
    }

    h2 {
      margin-top: 2rem;
      color: #245c3a;
      font-size: 1.2rem;
    }

    p, li { font-size: 1rem; }

    .updated {
      color: #6b7280;
      margin-top: -8px;
    }

    .notice {
      padding: 16px 18px;
      background: #f0f8f3;
      border-left: 4px solid #2f855a;
      border-radius: 8px;
    }

    a { color: #176b3a; }

    @media (max-width: 640px) {
      main {
        margin: 16px auto;
        padding: 24px;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>I-DAMAG Privacy Policy</h1>
    <p class="updated">Last updated: September 2, 2026</p>

    <p>
      I-DAMAG is an information and dashboard management system used to
      organize, retrieve, and present report data. This Privacy Policy explains
      how I-DAMAG handles information when Google services are connected to the
      application.
    </p>

    <div class="notice">
      I-DAMAG requests read-only access to Google Sheets only when that access
      is required to retrieve spreadsheet data that the authorized Google
      account is already permitted to view.
    </div>

    <h2>Information I-DAMAG accesses</h2>
    <p>
      When Google Sheets access is authorized, I-DAMAG may read spreadsheet
      contents and worksheet metadata needed to provide dashboard and chatbot
      features. I-DAMAG does not request permission to edit, delete, or modify
      Google Sheets through the read-only Google Sheets permission.
    </p>

    <h2>How Google Sheets data is used</h2>
    <p>
      Spreadsheet data is used only to provide I-DAMAG features such as report
      retrieval, dashboard support, data analysis, and answers generated by the
      application's chatbot. Access is limited to data required for these
      functions.
    </p>

    <h2>Google account permissions</h2>
    <p>
      I-DAMAG cannot access a spreadsheet that the authorized Google account
      does not have permission to view. Google authorization does not bypass
      Google Drive or Google Sheets sharing permissions.
    </p>

    <h2>Data sharing</h2>
    <p>
      I-DAMAG does not sell Google user data. Google Sheets information is not
      shared with third parties for advertising purposes. Data may be processed
      only as necessary to operate the application's requested features and
      supporting services.
    </p>

    <h2>Data storage and security</h2>
    <p>
      Authentication credentials and tokens used by the server are intended to
      be stored securely in server-side environment variables or protected
      server-side storage and are not intentionally exposed in the browser.
      Reasonable technical measures are used to protect application data and
      credentials from unauthorized access.
    </p>

    <h2>Revoking access</h2>
    <p>
      Users may revoke I-DAMAG's Google account access at any time through
      their Google Account security settings. Revoking access prevents future
      authenticated requests that depend on that authorization.
    </p>

    <h2>Changes to this policy</h2>
    <p>
      This policy may be updated when I-DAMAG's features or data-handling
      practices change. The latest version will be available on this page.
    </p>

    <h2>Contact</h2>
    <p>
      Questions about this Privacy Policy or I-DAMAG's handling of Google data
      may be sent to
      <a href="mailto:ajlicudine1@gmail.com">ajlicudine1@gmail.com</a>.
    </p>
  </main>
</body>
</html>`;
}

const sendPrivacyPolicy = (req, res) => {
  res.status(200).type("html").send(renderPrivacyPolicyPage());
};

// Production/Vercel route: /api/* is routed to the backend service.
app.get("/api/privacy", sendPrivacyPolicy);
app.get("/api/privacy-policy", sendPrivacyPolicy);

// Local-development aliases.
app.get("/privacy", sendPrivacyPolicy);
app.get("/privacy-policy", sendPrivacyPolicy);


// ============================================================
// ROOT
// ============================================================

app.get("/", (req, res) => {
  res.send(
    "DA-RFO I Office Report Management System API is running..."
  );
});

// ============================================================
// DATABASE INITIALIZATION
// ============================================================

const initializeDatabase =
  async () => {
    try {
      await sequelize.authenticate();

      /**
       * Create the chatbot conversation-state table if it does
       * not exist yet.
       *
       * We sync ONLY this model. Existing application tables are
       * not altered.
       */
      await ChatbotConversation.sync();

      console.log(
        "Chatbot conversation storage ready."
      );

      console.log(
        "Database connected successfully."
      );

      console.log(
        "Database ready."
      );
    } catch (error) {
      console.error(
        "Unable to connect to the database:",
        error
      );

      throw error;
    }
  };

// ============================================================
// LOCAL DEVELOPMENT
// ============================================================

const startServer = async () => {
  try {
    await initializeDatabase();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {
        console.log(
          `Server running on port ${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      "Server startup failed:",
      error
    );

    process.exit(1);
  }
};

/**
 * ============================================================
 * RUNTIME BOOTSTRAP
 * ============================================================
 *
 * Local / traditional Node hosting:
 *   - Start the HTTP server ourselves with app.listen().
 *
 * Vercel Functions / Vercel Services:
 *   - DO NOT call app.listen().
 *   - Vercel imports and invokes the exported Express app.
 *
 * VERCEL is automatically provided by Vercel during deployment.
 */
if (!process.env.VERCEL) {
  startServer();
}

module.exports = app;
