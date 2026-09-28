import { Sequelize } from "sequelize";
import { env } from "../config/env";

const connectionString =
  env.NODE_ENV === "test" && env.DATABASE_URL_TEST ? env.DATABASE_URL_TEST : env.DATABASE_URL;

export const sequelize = new Sequelize(connectionString, {
  dialect: "postgres",
  logging: false,
  pool: {
    max: env.DB_POOL_MAX,
    min: env.DB_POOL_MIN,
    acquire: env.DB_POOL_ACQUIRE_MS,
    idle: env.DB_POOL_IDLE_MS,
  },
  ...(env.DB_SSL ? { dialectOptions: { ssl: { require: true, rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED } } } : {}),
});
