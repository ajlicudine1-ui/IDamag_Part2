const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DashboardWorksheet = sequelize.define(
  'DashboardWorksheet',
  {
    worksheetId: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    dashboardId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },

    worksheetName: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    gid: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
  },
  {
    tableName: 'dashboard_worksheets',
    timestamps: true,
  }
);

module.exports = DashboardWorksheet;