import type { Request, Response, NextFunction } from "express";

const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  // In development mode, allow all requests (skip auth entirely)
  if (IS_DEVELOPMENT) {
    next();
    return;
  }

  // In production, require API key via header
  const apiKey = req.headers["x-admin-api-key"] as string;

  if (!ADMIN_API_KEY) {
    res.status(503).json({ error: "Admin authentication not configured" });
    return;
  }

  if (!apiKey || apiKey !== ADMIN_API_KEY) {
    res.status(401).json({ error: "Unauthorized - Invalid or missing API key" });
    return;
  }

  next();
}
