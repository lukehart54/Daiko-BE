// src/app.ts
import express, { Application } from "express";
import indexRouter from "./routes";

const app: Application = express();

app.use(express.json());
app.use("/api", indexRouter);
//app.use(cors());

export default app;
