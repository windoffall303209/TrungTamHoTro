import { config as loadEnvironment } from "dotenv";
import { defineConfig } from "prisma/config";
import { buildDatabaseUrl } from "./src/config/database-connection.js";

loadEnvironment({ path: "../../.env" });
loadEnvironment();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: buildDatabaseUrl(process.env),
  },
});
