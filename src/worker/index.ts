import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { accountRoutes, publicAuthRoutes, requireAuth } from "./auth";
import type { AppEnv } from "./env";
import { HttpError } from "./http";
import { auditRoutes } from "./routes/audit";
import { counterRoutes } from "./routes/counter";
import { dashboardRoutes } from "./routes/dashboard";
import { reportRoutes } from "./routes/reports";
import { saleRoutes } from "./routes/sales";
import { setRoutes } from "./routes/sets";
import { userRoutes } from "./routes/users";

const app = new Hono<AppEnv>().basePath("/api");

app.use(csrf());

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ error: err.message, code: err.code, ...err.extra }, err.status);
  }
  console.error(err);
  return c.json({ error: "伺服器發生錯誤", code: "internal" }, 500);
});

app.notFound((c) => c.json({ error: "找不到這個 API", code: "not_found" }, 404));

app.route("/", publicAuthRoutes);
app.use("*", requireAuth);
app.route("/", accountRoutes);
app.route("/", dashboardRoutes);
app.route("/", counterRoutes);
app.route("/", setRoutes);
app.route("/", saleRoutes);
app.route("/", reportRoutes);
app.route("/", auditRoutes);
app.route("/", userRoutes);

export default app;
