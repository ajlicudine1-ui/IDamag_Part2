const { Sequelize } = require("sequelize");

require("dotenv").config();

let sequelize;

const commonOptions = {
  dialect: "postgres",

  logging: false,

  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },

  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
};

if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(
    process.env.DATABASE_URL,
    commonOptions
  );
} else {
  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      ...commonOptions,

      host: process.env.DB_HOST,
      port: Number(
        process.env.DB_PORT || 5432
      ),
    }
  );
}

module.exports = sequelize;