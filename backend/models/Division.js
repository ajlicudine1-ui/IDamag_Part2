const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Division = sequelize.define(
  'Division',
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    acronym: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    officeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'offices', // Match the actual Railway table name
        key: 'id',
      },
    },
  },
  {
    tableName: 'divisions',
    freezeTableName: true,
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['name', 'officeId'],
      },
    ],
  }
);

module.exports = Division;