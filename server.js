// server.js
const express = require("express");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ==== .env ====
try {
  require("dotenv").config({ debug: true });
} catch (e) {
  console.error("[dotenv] falhou ao carregar .env:", e?.message || e);
}

// ==== ENV ====
const PRINTER = process.env.PRINTER_NAME || "TANCA_Label";
const PORT = parseInt(process.env.PORT || "9317", 10);
const API_TOKEN = (process.env.API_TOKEN || "").trim();

const ALLOWED = new Set(
  (process.env.ALLOWED_ORIGINS || "http://localhost,http://127.0.0.1")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
);

// ==== APP ====
const app = express();

// ---- CORS ----
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  const acrh = req.headers["access-control-request-headers"];
  res.setHeader(
    "Access-Control-Allow-Headers",
    acrh ? acrh : "Content-Type, Authorization, X-API-Token"
  );
  res.setHeader("Access-Control-Max-Age", "600");

  if (
    req.method === "OPTIONS" &&
    req.headers["access-control-request-private-network"] === "true"
  ) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "256kb" }));

// ---- Auth helper ----
function checkAuth(req, res, next) {
  if (!API_TOKEN) return next(); // sem token -> não exige
  const hAuth = req.headers.authorization || "";
  const hTok  = req.headers["x-api-token"] || "";
  let ok = false;

  if (hAuth.startsWith("Bearer ")) {
    const token = hAuth.slice(7).trim();
    ok = token === API_TOKEN;
  }
  if (!ok && hTok) ok = String(hTok).trim() === API_TOKEN;

  if (!ok) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  return next();
}

// ---- Rotas ----
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    printer: PRINTER,
    authRequired: Boolean(API_TOKEN),
    origins: [...ALLOWED]
  });
});

app.post("/print", checkAuth, (req, res) => {
  try {
    const { tspl } = req.body || {};
    if (!tspl || typeof tspl !== "string") {
      return res.status(400).send("Faltou o campo 'tspl' (string).");
    }

    const tmpFile = path.join(os.tmpdir(), `tspl-${Date.now()}.tspl`);
    fs.writeFileSync(tmpFile, tspl, "utf8");

    execFile("lpr", ["-P", PRINTER, "-o", "raw", tmpFile], (err) => {
      fs.unlink(tmpFile, () => {});
      if (err) {
        console.error("[lpr] erro:", err.message);
        return res.status(500).send("Erro ao imprimir: " + err.message);
      }
      console.log(`[print] enviado para ${PRINTER}`);
      res.send("Enviado para impressão.");
    });
  } catch (e) {
    console.error("[print] exceção:", e);
    res.status(500).send("Falha inesperada.");
  }
});

// ==== Startup/diagnóstico ====
let server;
try {
  server = app.listen(PORT, "0.0.0.0");
  server.on("listening", () => {
    const hint = API_TOKEN ? `${API_TOKEN.slice(0,4)}…${API_TOKEN.slice(-3)}` : "(sem token)";
    console.log(`Agente rodando na porta ${PORT}. Impressora: ${PRINTER}. TOKEN: ${hint}`);
  });
  server.on("error", (err) => {
    console.error("[server] erro no listen:", err.code, err.message);
    process.exitCode = 1;
  });
  server.on("close", () => {
    console.error("[server] servidor foi fechado (close).");
  });
} catch (e) {
  console.error("[listen] exceção:", e);
  process.exit(1);
}

// ==== Handlers globais p/ ver motivo da saída ====
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});
process.on("unhandledRejection", (reason, p) => {
  console.error("[unhandledRejection] em Promise:", p, "razão:", reason);
});
process.on("SIGINT", () => {
  console.error("[signal] SIGINT recebido. Encerrando…");
  server?.close(() => process.exit(0));
});
process.on("SIGTERM", () => {
  console.error("[signal] SIGTERM recebido. Encerrando…");
  server?.close(() => process.exit(0));
});
process.on("beforeExit", (code) => {
  console.error("[beforeExit] código:", code);
});
process.on("exit", (code) => {
  console.error("[exit] código:", code);
});
