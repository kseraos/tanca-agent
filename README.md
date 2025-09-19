# 🖨️ Agente de Impressão iComanda (TANCA)

Este agente permite que o sistema **iComanda** envie comandos **TSPL/ZPL** diretamente para impressoras **TANCA** conectadas a um computador cliente.

---

## 📑 Índice
- [📌 Pré-requisitos](#-pré-requisitos)
- [🖨️ Configuração da Impressora](#️-configuração-da-impressora)
- [⚙️ Instalação do Agente](#️-instalação-do-agente)
- [✅ Teste](#-teste)
- [🚀 Execução Contínua](#-execução-contínua)
  - [Windows](#windows)
  - [Linux (Systemd)](#linux-systemd)
- [🎯 Conclusão](#-conclusão)

---

## 📌 Pré-requisitos

- Computador cliente conectado à impressora TANCA  
- Impressora instalada no sistema (Windows ou Linux)  
- Node.js 18+ instalado  
- Acesso de rede entre o sistema web e o cliente (IP fixo ou hostname)  

---

## 🖨️ Configuração da Impressora

### Windows
1. Conecte a impressora TANCA via **USB** ou **Ethernet**.  
2. Vá em **Painel de Controle > Dispositivos e Impressoras**.  
3. Clique com o botão direito na impressora → **Preferências da Impressora**.  
4. Anote o nome da impressora (ex.: `TANCA_Label`).  
   - Esse nome deve ser idêntico no arquivo `.env`.  
5. Faça um teste de impressão pelo próprio Windows para validar.  

### Linux (Ubuntu/Debian)
1. Conecte a impressora TANCA via **USB** ou **Ethernet**.  
2. Instale o **CUPS** (se ainda não tiver):  
   ```bash
   sudo apt update
   sudo apt install cups -y
   ```
3. Liste as impressoras instaladas:  
   ```bash
   lpstat -a
   ```
4. Anote o nome exato (ex.: `TANCA_Label`).  

---

## ⚙️ Instalação do Agente

### Passos comuns (Windows e Linux)
1. Baixe o pacote do agente:  
   👉 [Download](http://icomanda.com/tanca-agent/agent.zip)  
2. Extraia em uma pasta (ex.: `C:\tanca-agent` ou `~/tanca-agent`).  
3. Abra **terminal/cmd** dentro da pasta.  
4. Instale as dependências:  
   ```bash
   npm install
   ```
5. Configure o arquivo `.env` (crie se não existir):  
   ```ini
   PRINTER_NAME=TANCA_Label
   PORT=9317
   ALLOWED_ORIGINS=http://localhost,http://127.0.0.1,http://seu-dominio.com
   API_TOKEN=/seu-token-aqui
   PULL_INTERVAL_MS=4000
   ```

---

## 🚀 Execução Contínua

### Windows
1. Na pasta `C:\tanca-agent`, crie o arquivo **start.bat**:
   ```bat
   @echo off
   cd /d C:\tanca-agent
   node server.js
   ```
2. Crie também **start.vbs**:
   ```vbscript
   Set WshShell = CreateObject("WScript.Shell")
   WshShell.Run chr(34) & "C:\tanca-agent\start.bat" & Chr(34), 0
   Set WshShell = Nothing
   ```
3. Coloque o `start.vbs` na **Inicialização do Windows**:
   - Pressione `Win + R`  
   - Digite: `shell:startup`  
   - Pressione Enter  
   - Copie o arquivo para essa pasta  
4. Reinicie o Windows.  
   - O agente será iniciado automaticamente em segundo plano.  
   - Confirme acessando: [http://localhost:9317/health](http://localhost:9317/health)  

---

### Linux (Systemd)

1. Crie o serviço systemd:
   ```bash
   sudo nano /etc/systemd/system/tanca-agent.service
   ```
2. Cole o conteúdo abaixo (substitua `SEU_USUARIO` pelo usuário do sistema):
   ```ini
   [Unit]
   Description=Tanca Agent (TSPL -> CUPS)
   After=network.target

   [Service]
   ExecStart=/usr/bin/node /home/SEU_USUARIO/tanca-agent/server.js
   WorkingDirectory=/home/SEU_USUARIO/tanca-agent
   Restart=always
   User=SEU_USUARIO
   Environment=NODE_ENV=production
   StandardOutput=journal
   StandardError=journal

   [Install]
   WantedBy=multi-user.target
   ```
3. Recarregue e habilite o serviço:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now tanca-agent
   ```
4. Verifique se está rodando:
   ```bash
   systemctl status tanca-agent --no-pager
   ```
5. Teste o agente:
   ```bash
   curl -s http://127.0.0.1:9317/health
   ```
6. Envie um teste de impressão:
   ```bash
   curl -X POST http://127.0.0.1:9317/print      -H "Content-Type: application/json"      -H "Authorization: Bearer /seu-token-aqui"      --data-binary '{"tspl":"SIZE 40 mm,30 mm\r\nGAP 3 mm,0\r\nCLS\r\nTEXT 10,10,\"3\",0,1,1,\"Teste OK\"\r\nPRINT 1\r\n"}'
   ```

---

## ✅ Teste

Verifique a saúde do agente acessando no navegador:  

👉 [http://127.0.0.1:9317/health](http://127.0.0.1:9317/health)  

Resposta esperada:
```json
{ 
  "ok": true, 
  "printer": "TANCA_Label", 
  "authRequired": true, 
  "origins": ["http://localhost"]
}
```

## 🎯 Conclusão

O agente estará rodando em **segundo plano**, pronto para receber comandos de impressão do sistema iComanda e enviar diretamente para a impressora TANCA.
