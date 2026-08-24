const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const DashboardFeedback = sequelize.define(
  "DashboardFeedback",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    // Dashboard selected by the user
    dashboardName: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "dashboard_name",
    },

    // User Interface rating: 1-5
    userInterface: {
      type: DataTypes.TINYINT,
      allowNull: false,
      field: "user_interface",
      validate: {
        min: 1,
        max: 5,
      },
    },

    // User Experience rating: 1-5
    userExperience: {
      type: DataTypes.TINYINT,
      allowNull: false,
      field: "user_experience",
      validate: {
        min: 1,
        max: 5,
      },
    },

    // Data Completeness rating: 1-5
    dataCompleteness: {
      type: DataTypes.TINYINT,
      allowNull: false,
      field: "data_completeness",
      validate: {
        min: 1,
        max: 5,
      },
    },

    // Data Accuracy rating: 1-5
    dataAccuracy: {
      type: DataTypes.TINYINT,
      allowNull: false,
      field: "data_accuracy",
      validate: {
        min: 1,
        max: 5,
      },
    },

    // Accessibility rating: 1-5
    accessibility: {
      type: DataTypes.TINYINT,
      allowNull: false,
      field: "accessibility",
      validate: {
        min: 1,
        max: 5,
      },
    },

    // Dashboard suggestions/comments
    additionalComments: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "additional_comments",
    },

    // Optional user name
    fullName: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "full_name",
    },

    // Optional email
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    tableName: "dashboard_feedback",

    // Sequelize will automatically handle created_at
    timestamps: true,

    createdAt: "created_at",

    // We don't need updated_at for submitted feedback
    updatedAt: false,
  }
);

module.exports = DashboardFeedback;