const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Report = sequelize.define(
  'Report',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    reportId: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    sheetUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    divisionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'divisions', // Match Railway table name
        key: 'id',
      },
    },
  },
  {
    tableName: 'reports',
    freezeTableName: true,
    timestamps: true,
  }
);

module.exports = Report;