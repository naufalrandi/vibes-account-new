import { Sequelize } from "sequelize";
import { env } from "../config/env";

const connectionString =
  env.NODE_ENV === "test" && env.DATABASE_URL_TEST ? env.DATABASE_URL_TEST : env.DATABASE_URL;

export const sequelize = new Sequelize(connectionString, {
  dialect: "postgres",
  logging: false,
});
