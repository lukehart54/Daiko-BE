// src/routes/index.ts
import { Router, Request, Response } from "express";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  res.send("Welcome to the Personal Finance App API");
});

router.get("/ava", (req: Request, res: Response) => {
  res.send("YOU PINGED AVA");
});

export default router;
