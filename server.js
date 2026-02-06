const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const rooms = new Map();

// Serve static files
const server = http.createServer((req, res) => {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath);
  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".png": "image/png",
    ".ico": "image/x-icon",
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function checkWin(state, player) {
  const wins = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  return wins.some((c) => c.every((i) => state[i] === player));
}

wss.on("connection", (ws) => {
  ws.roomCode = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, { type: "error", message: "Invalid JSON" });
    }

    if (msg.type === "create") {
      const code = generateRoomCode();
      rooms.set(code, {
        players: [ws],
        gameState: ["", "", "", "", "", "", "", "", ""],
        currentPlayer: "X",
      });
      ws.roomCode = code;
      ws.playerSymbol = "X";
      send(ws, { type: "created", code });
    }

    else if (msg.type === "join") {
      const code = (msg.code || "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) {
        return send(ws, { type: "error", message: "Room not found" });
      }
      if (room.players.length >= 2) {
        return send(ws, { type: "error", message: "Room is full" });
      }
      room.players.push(ws);
      ws.roomCode = code;
      ws.playerSymbol = "O";
      send(ws, { type: "joined", code, symbol: "O" });
      send(room.players[0], { type: "start", symbol: "X" });
      send(room.players[1], { type: "start", symbol: "O" });
    }

    else if (msg.type === "move") {
      const room = rooms.get(ws.roomCode);
      if (!room || room.players.length < 2) {
        return send(ws, { type: "error", message: "Game not ready" });
      }
      const index = msg.index;
      if (typeof index !== "number" || index < 0 || index > 8) {
        return send(ws, { type: "error", message: "Invalid move" });
      }
      if (room.gameState[index] !== "") {
        return send(ws, { type: "error", message: "Cell already taken" });
      }
      if (room.currentPlayer !== ws.playerSymbol) {
        return send(ws, { type: "error", message: "Not your turn" });
      }

      room.gameState[index] = ws.playerSymbol;
      const won = checkWin(room.gameState, ws.playerSymbol);
      const draw = !won && !room.gameState.includes("");
      room.currentPlayer = ws.playerSymbol === "X" ? "O" : "X";

      room.players.forEach((p) => {
        send(p, {
          type: "moved",
          index,
          symbol: ws.playerSymbol,
          winner: won ? ws.playerSymbol : null,
          draw,
        });
      });
    }

    else if (msg.type === "reset") {
      const room = rooms.get(ws.roomCode);
      if (!room || room.players.length < 2) return;
      room.gameState = ["", "", "", "", "", "", "", "", ""];
      room.currentPlayer = "X";
      room.players.forEach((p) => {
        send(p, { type: "reset" });
      });
    }
  });

  ws.on("close", () => {
    const code = ws.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const opponent = room.players.find((p) => p !== ws);
    if (opponent) {
      send(opponent, { type: "opponent_left" });
      opponent.roomCode = null;
    }
    rooms.delete(code);
  });
});

server.listen(PORT, () => {
  console.log(`Tic Tac Toe server running on http://localhost:${PORT}`);
});
