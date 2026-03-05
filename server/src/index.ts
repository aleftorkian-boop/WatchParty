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

const allowedOrigins = [
  "https://partywatchme.netlify.app",
  "http://localhost:3000",
];

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
};

// Keep socket server startup behavior unchanged.
const corsOrigin = process.env.CORS_ORIGIN || "*";

const proxyConfig = buildProxyConfig(process.env);

app.use(cors(corsOptions));

app.options("*", cors(corsOptions));

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
  console.log(`Server listening on http://localhost:${port}`);
});
