// server.js
const express = require("express");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
require("dotenv").config(); // ✅ carrega .env antes de ler variáveis
const bonjourLib = require("bonjour");

// ==== Configurações (.env) ====
const PORT = parseInt(process.env.PORT || "9317", 10);
const PRINTER = (process.env.PRINTER_NAME || "TANCA_Label").trim();
const API_TOKEN = (process.env.API_TOKEN || "").trim();
const BRIDGE_NAME = (process.env.BRIDGE_NAME || "icomanda-bridge").trim(); // ✅ agora lê do .env
const HOSTNAME = os.hostname();
const ALLOWED = new Set(
  (process.env.ALLOWED_ORIGINS || "http://localhost,http://127.0.0.1")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
);
const isWin = process.platform === "win32";

// ==== Inicializa app ====
const app = express();
app.use(express.json({ limit: "256kb" }));

// ---- Middleware CORS global ----
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ||
      "Content-Type, Authorization, X-API-Token"
  );
  // Safari / iOS Private Network Access
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  next();
});

// ---- Rota OPTIONS / Preflight ----
app.options("/print", (req, res) => {
  console.log(
    `[preflight] /print origin=${req.headers.origin || ""} acrpn=${
      req.headers["access-control-request-private-network"] || ""
    } req-headers=${req.headers["access-control-request-headers"] || ""}`
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ||
      "Content-Type, Authorization, X-API-Token"
  );
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Access-Control-Max-Age", "600");
  return res.sendStatus(204);
});

// ---- Autenticação ----
function checkAuth(req, res, next) {
  if (!API_TOKEN) return next();
  const hAuth = req.headers.authorization || "";
  const hTok = req.headers["x-api-token"] || "";
  const ok =
    (hAuth.startsWith("Bearer ") && hAuth.slice(7).trim() === API_TOKEN) ||
    (hTok && String(hTok).trim() === API_TOKEN);
  if (!ok) return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

// ---- Função de envio para impressora ----
function sendToPrinter(tmpFile, cb) {
  if (!isWin) {
    return execFile("lpr", ["-P", PRINTER, "-o", "raw", tmpFile], (err, so, se) => {
      if (err) return cb(new Error(`[lpr] ${se || err.message || so || "falha"}`));
      cb(null);
    });
  }

  const share = (process.env.PRINTER_SHARE || "").trim() || PRINTER;
  const uncLocalhost = `\\\\localhost\\${share}`;
  const uncLoopback = `\\\\127.0.0.1\\${share}`;

  // 1) print
  execFile("print", ["/D:" + uncLocalhost, tmpFile], { windowsHide: true }, (err1, so1, se1) => {
    if (!err1) return cb(null);

    // 2) copy localhost
    execFile("cmd", ["/c", "copy", "/b", tmpFile, uncLocalhost], { windowsHide: true }, (err2, so2, se2) => {
      if (!err2) return cb(null);

      // 3) copy 127.0.0.1
      execFile("cmd", ["/c", "copy", "/b", tmpFile, uncLoopback], { windowsHide: true }, (err3, so3, se3) => {
        const msg =
          `[print] ${se1 || so1 || err1?.message || ""} | ` +
          `[copy localhost] ${se2 || so2 || err2?.message || ""} | ` +
          `[copy 127.0.0.1] ${se3 || so3 || err3?.message || ""}`;
        cb(new Error(msg || "falha ao enviar para a impressora"));
      });
    });
  });
}

// ---- Logs resumidos ----
app.use((req, res, next) => {
  if (req.method === "OPTIONS" || req.path === "/print") {
    console.log(
      `[req] ${req.method} ${req.path} origin=${req.headers.origin || ""} acrpn=${
        req.headers["access-control-request-private-network"] || ""
      } auth=${(req.headers.authorization || "").slice(0, 14)}…`
    );
  }
  next();
});

// ---- Bridge de Impressão (token do .env injetado) ----
app.get("/bridge.html", (req, res) => {
  const html = `
<!doctype html>
<meta charset="utf-8" />
<title>iComanda – Bridge de Impressão</title>
<style>
  body{font:14px/1.4 system-ui,sans-serif;margin:24px}
  .ok{color:#0a0}.err{color:#a00}
</style>
<h3>Bridge de Impressão</h3>
<div id="status">Aguardando dados…</div>
<script>
  const API_TOKEN = ${JSON.stringify(API_TOKEN)};
  const statusEl = document.getElementById('status');

  async function imprimir(tspl, clientIp){
    statusEl.textContent = "Enviando para impressora…";
    try{
      const r = await fetch("/print", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + API_TOKEN
        },
        body: JSON.stringify({ tspl, client_ip: clientIp || "" })
      });
      const text = await r.text();
      if(!r.ok) throw new Error(text || "Falha");
      statusEl.innerHTML = '<span class="ok">Impressão enviada ✔</span>';
      try{ window.opener && window.opener.postMessage({ok:true, from:"bridge"}, "*"); }catch(e){}
      setTimeout(()=> window.close(), 800);
    }catch(err){
      statusEl.innerHTML = '<span class="err">Erro: ' + (err.message||err) + '</span>';
      try{ window.opener && window.opener.postMessage({ok:false, error:String(err), from:"bridge"}, "*"); }catch(e){}
    }
  }

  window.addEventListener("message", (ev)=>{
    const d = ev.data || {};
    if(d && d.type === "PRINT" && d.tspl){
      imprimir(d.tspl, d.clientIp);
    }
  });

  (function(){
    const h = location.hash || "";
    const m = h.match(/b64=([^&]+)/);
    if(m){
      try{
        const json = atob(decodeURIComponent(m[1]));
        const obj = JSON.parse(json);
        if(obj && obj.tspl) imprimir(obj.tspl, obj.clientIp||"");
      }catch(e){}
    }
  })();
</script>
  `;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store"); // evita cache do token
  res.send(html);
});

// ---- Arquivos estáticos ----
app.use(express.static(path.join(__dirname, "public")));

// ---- Rota de saúde ----
app.get("/health", (req, res) => {
  const ipv4 = Object.values(os.networkInterfaces())
    .flat()
    .find(it => it.family === "IPv4" && !it.internal);
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.json({
    ok: true,
    printer: PRINTER,
    authRequired: !!API_TOKEN,
    ipv4_local: ipv4 ? ipv4.address : "",
    origins: [...ALLOWED]
  });
});

// ---- Rota de impressão ----
app.post("/print", checkAuth, (req, res) => {
  const { tspl, client_ip } = req.body || {};
  if (!tspl || typeof tspl !== "string") {
    return res.status(400).json({ error: "Faltou o campo 'tspl' (string)." });
  }

  const tmpFile = path.join(os.tmpdir(), `tspl-${Date.now()}.tspl`);
  fs.writeFileSync(tmpFile, tspl, "utf8");

  console.log(`[print] cliente=${client_ip || req.ip}, impressora=${PRINTER}`);
  sendToPrinter(tmpFile, err => {
    fs.unlink(tmpFile, () => {});
    if (err) {
      console.error("[print] erro:", err.message);
      return res.status(500).json({ error: err.message });
    }
    console.log(`[print] etiqueta enviada para ${PRINTER}`);
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.json({ ok: true, message: "Enviado para impressão." });
  });
});

// ---- Inicializa servidor + mDNS/Bonjour ----
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor ativo na porta ${PORT} (impressora: ${PRINTER})`);

  // mDNS/Bonjour: anuncia o bridge na rede local
  const bonjour = bonjourLib();
  const service = bonjour.publish({
    name: BRIDGE_NAME,  // ex.: "icomanda-bridge"
    type: "http",       // _http._tcp
    port: PORT,         // 9317
    host: HOSTNAME,     // opcional
    txt: {
      path: "/",
      printer: PRINTER,
      auth: API_TOKEN ? "required" : "none"
    }
  });

  service.on("up", () => {
    console.log(`[mDNS] Serviço divulgado como: ${BRIDGE_NAME}.local:${PORT}`);
  });

  // Encerramento limpo
  const shutdown = () => {
    console.log("\nEncerrando bridge...");
    try { service.stop(() => console.log("[mDNS] Serviço removido.")); } catch {}
    try { bonjour.destroy(); } catch {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
});
