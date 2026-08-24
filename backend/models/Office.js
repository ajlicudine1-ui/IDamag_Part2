const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Office = sequelize.define(
  'Office',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    acronym: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  },
  {
    tableName: 'offices',
    freezeTableName: true,
    timestamps: true,
  }
);

module.exports = Office;