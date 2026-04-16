import { Hono } from "hono";
import { ErrorCodes } from "@vd/shared";
import { AppError } from "../errors.js";

const app = new Hono();

app.get("/", () => {
  throw new AppError(
    ErrorCodes.DOWNLOAD_FAILED,
    "Download endpoint not yet implemented",
    { status: 501 },
  );
});

export { app as downloadRoute };
