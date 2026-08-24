const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const WebsiteFeedback = sequelize.define(
  "WebsiteFeedback",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    websiteSuggestion: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "website_suggestion",
    },
  },
  {
    tableName: "website_feedback",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  }
);

module.exports = WebsiteFeedback;