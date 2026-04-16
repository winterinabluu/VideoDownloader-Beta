import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => {
  return c.json({
    ok: true,
    version: "0.1.0",
  });
});

export { app as healthRoute };
