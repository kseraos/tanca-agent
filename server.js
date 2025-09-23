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
const PRINTER = (process.env.PRINTER_NAME || "TANCA_Label").trim();
const PORT = parseInt(process.env.PORT || "9317", 10);
const API_TOKEN = (process.env.API_TOKEN || "").trim();

const ALLOWED = new Set(
  (process.env.ALLOWED_ORIGINS || "http://localhost,http://127.0.0.1")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
);

const isWin = process.platform === "win32";

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
  if (!API_TOKEN) return next();
  const hAuth = req.headers.authorization || "";
  const hTok  = req.headers["x-api-token"] || "";
  let ok = false;

  if (hAuth.startsWith("Bearer ")) ok = hAuth.slice(7).trim() === API_TOKEN;
  if (!ok && hTok) ok = String(hTok).trim() === API_TOKEN;

  if (!ok) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

// ---- Helpers de rede ----
function getLocalIPv4Info() {
  const ifaces = os.networkInterfaces();
  const interfaces = [];
  for (const name of Object.keys(ifaces)) {
    for (const it of ifaces[name] || []) {
      interfaces.push({
        name,
        address: it.address,
        family: it.family,
        internal: it.internal === true,
      });
    }
  }
  const cand = interfaces.find(it =>
    /^IPv4$/i.test(it.family) &&
    !it.internal &&
    (it.address.startsWith("192.168.") ||
     it.address.startsWith("10.") ||
     /^172\.(1[6-9]|2\d|3[0-1])\./.test(it.address))
  );
  return { ipv4_local: cand ? cand.address : "", interfaces };
}

// ---- Print helper ----
function sendToPrinter(tmpFile, cb) {
  if (!isWin) {
    // Linux/macOS → CUPS
    return execFile("lpr", ["-P", PRINTER, "-o", "raw", tmpFile], (err, so, se) => {
      if (err) err.message = `[lpr] ${err.message} :: ${se || ""}`;
      cb(err || null);
    });
  }

  // Windows → NÃO usar lpr. Tentar PowerShell; se falhar, copy /b para \\localhost\PRINTER
  const psArgs = [
    "-NoProfile",
    "-Command",
    "$ErrorActionPreference='Stop';" +
    `Get-Printer -Name '${PRINTER}' | Out-Null;` +
    `Get-Content -LiteralPath '${tmpFile.replace(/'/g,"''")}' -Raw | Out-Printer -Name '${PRINTER}';`
  ];

  execFile("powershell", psArgs, (psErr, so, se) => {
    if (!psErr) return cb(null);

    const share = `\\\\localhost\\${PRINTER}`;
    execFile("cmd", ["/c", "copy", "/b", tmpFile, share], (copyErr, so2, se2) => {
      if (!copyErr && /1 arquivo\(s\) copiado\(s\)|1 file\(s\) copied/i.test(so2 || "")) {
        return cb(null);
      }
      const errMsg = copyErr ? copyErr.message : (se2 || "falha no copy /b");
      cb(new Error(`[ps:${se?.trim()||psErr?.message}] [copy:${errMsg}]`));
    });
  });
}

// ---- Rotas ----
app.get("/health", (req, res) => {
  const net = getLocalIPv4Info();
  res.json({
    ok: true,
    printer: PRINTER,
    authRequired: Boolean(API_TOKEN),
    origins: [...ALLOWED],
    ipv4_local: net.ipv4_local,
    interfaces: net.interfaces
  });
});

// compatibilidade opcional com seu front
app.get("/whoami", (req, res) => {
  res.json(getLocalIPv4Info());
});

app.post("/print", checkAuth, (req, res) => {
  try {
    const { tspl, client_ip } = req.body || {};
    if (!tspl || typeof tspl !== "string") {
      return res.status(400).send("Faltou o campo 'tspl' (string).");
    }
    const tmpFile = path.join(os.tmpdir(), `tspl-${Date.now()}.tspl`);
    fs.writeFileSync(tmpFile, tspl, "utf8");

    console.log(`[print] destino="${PRINTER}" ip_cliente="${client_ip || req.ip}" file=${tmpFile}`);

    sendToPrinter(tmpFile, (err) => {
      fs.unlink(tmpFile, () => {});
      if (err) {
        console.error("[print] erro:", err.message || err);
        return res.status(500).send("Erro ao imprimir: " + (err.message || err));
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
    console.log(`Agente na porta ${PORT}. Impressora: ${PRINTER}. TOKEN: ${hint}`);
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

// ==== Handlers globais ====
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
