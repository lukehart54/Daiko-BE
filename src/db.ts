// src/db.ts
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool();

pool.on("connect", () => {
  console.log("Connected to the PostgreSQL database or pool?");
});

pool.on("error", (err: any) => {
  console.error("Error connecting to the PostgreSQL database", err);
  process.exit(-1);
});

export default pool;
