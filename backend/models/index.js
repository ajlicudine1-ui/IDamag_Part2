const Office = require("./Office");
const Division = require("./Division");
const Report = require("./Report");
const DashboardWorksheet = require("./DashboardWorksheet");
const User = require("./User");
const ActivityLog = require("./ActivityLog");
const DashboardFeedback = require("./DashboardFeedback");
const WebsiteFeedback = require("./WebsiteFeedback");

const sequelize = require("../config/database");


// =====================================================
// RELATIONSHIPS
// =====================================================


// -----------------------------------------------------
// Office -> Many Divisions
// -----------------------------------------------------

Office.hasMany(Division, {
  foreignKey: "officeId",
  as: "divisions",
});

Division.belongsTo(Office, {
  foreignKey: "officeId",
  as: "office",
});


// -----------------------------------------------------
// Division -> Many Reports
// -----------------------------------------------------

Division.hasMany(Report, {
  foreignKey: "divisionId",
  as: "reports",
});

Report.belongsTo(Division, {
  foreignKey: "divisionId",
  as: "division",
});


// -----------------------------------------------------
// Report -> Many Dashboard Worksheets
// -----------------------------------------------------

Report.hasMany(DashboardWorksheet, {
  foreignKey: "dashboardId",
  sourceKey: "id",
  as: "worksheets",
  onDelete: "CASCADE",
});

DashboardWorksheet.belongsTo(Report, {
  foreignKey: "dashboardId",
  targetKey: "id",
  as: "dashboard",
});


// -----------------------------------------------------
// Office -> Many Users
// -----------------------------------------------------

Office.hasMany(User, {
  foreignKey: "officeId",
  as: "users",
});

User.belongsTo(Office, {
  foreignKey: "officeId",
  as: "office",
});


// -----------------------------------------------------
// Division -> Many Users
// -----------------------------------------------------

Division.hasMany(User, {
  foreignKey: "divisionId",
  as: "users",
});

User.belongsTo(Division, {
  foreignKey: "divisionId",
  as: "division",
});


// -----------------------------------------------------
// User -> Many ActivityLogs
// -----------------------------------------------------

User.hasMany(ActivityLog, {
  foreignKey: "userId",
  as: "activityLogs",
});

ActivityLog.belongsTo(User, {
  foreignKey: "userId",
  as: "user",
});


// =====================================================
// EXPORT MODELS
// =====================================================

module.exports = {
  sequelize,
  Office,
  Division,
  Report,
  DashboardWorksheet,
  User,
  ActivityLog,
  DashboardFeedback,
  WebsiteFeedback,
};