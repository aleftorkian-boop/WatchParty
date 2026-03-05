import http from "node:http";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { buildProxyConfig, streamHandler, streamPreflightHandler } from "./proxy";
import { registerResolveRoute } from "./resolve";
import { buildSocketServer } from "./socket";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const corsOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";
const proxyConfig = buildProxyConfig(process.env);

app.use(
  cors({
    origin: corsOrigin,
    credentials: false,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, now: Date.now() });
});

registerResolveRoute(app);
app.options("/stream", streamPreflightHandler(proxyConfig));
app.get("/stream", streamHandler(proxyConfig));

const server = http.createServer(app);
buildSocketServer(server, corsOrigin);

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});

