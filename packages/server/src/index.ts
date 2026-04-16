import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from packages/server/ regardless of cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { errorHandler, logger } from "./middleware/common.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { healthRoute } from "./routes/health.js";
import { parseRoute } from "./routes/parse.js";
import { downloadRoute } from "./routes/download.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: config.frontendUrl,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type"],
  }),
);

// Apply rate limit to parse and download endpoints (not health)
app.use(
  "/api/parse",
  rateLimit({ windowMs: 60_000, max: 20 }),
);
app.use(
  "/api/download",
  rateLimit({ windowMs: 60_000, max: 10 }),
);

app.route("/api/health", healthRoute);
app.route("/api/parse", parseRoute);
app.route("/api/download", downloadRoute);

app.onError(errorHandler);

app.notFound((c) =>
  c.json(
    {
      ok: false,
      error: { code: "NOT_FOUND", message: "Route not found" },
    },
    404,
  ),
);

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`Server listening on http://localhost:${info.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
  },
);
