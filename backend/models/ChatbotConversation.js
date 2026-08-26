const {
  DataTypes,
} = require("sequelize");

const sequelize =
  require("../config/database");

/**
 * Persistent chatbot conversation state.
 *
 * Why this exists:
 * Vercel/container requests are not guaranteed to hit the same
 * Node.js process, so an in-memory Map alone cannot reliably
 * preserve chatbot follow-up context.
 *
 * The actual conversation state remains schema/dataset agnostic
 * and is stored as JSONB.
 */
const ChatbotConversation =
  sequelize.define(
    "ChatbotConversation",
    {
      id: {
        type:
          DataTypes.BIGINT,
        autoIncrement:
          true,
        primaryKey:
          true,
      },

      sessionKey: {
        type:
          DataTypes.STRING(300),
        allowNull:
          false,
        unique:
          true,
        field:
          "session_key",
      },

      sessionId: {
        type:
          DataTypes.STRING(150),
        allowNull:
          false,
        field:
          "session_id",
      },

      reportId: {
        type:
          DataTypes.INTEGER,
        allowNull:
          false,
        field:
          "report_id",
      },

      state: {
        type:
          DataTypes.JSONB,
        allowNull:
          false,
        defaultValue:
          {},
      },

      expiresAt: {
        type:
          DataTypes.DATE,
        allowNull:
          true,
        field:
          "expires_at",
      },
    },
    {
      tableName:
        "chatbot_conversations",

      timestamps:
        true,

      underscored:
        true,

      indexes: [
        {
          unique:
            true,
          fields: [
            "session_key",
          ],
        },
        {
          fields: [
            "report_id",
          ],
        },
        {
          fields: [
            "expires_at",
          ],
        },
      ],
    }
  );

module.exports =
  ChatbotConversation;

module.exports.default =
  ChatbotConversation;
