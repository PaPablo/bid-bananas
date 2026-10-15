const socket = io();

const STARTINGBANANASINCRATE = 10;
const BANANASTOWIN = 200;
const MAXBID = 100;
const STARTINGBANANASPERPERSON = 0;

let myId = null;
let roomCode = null;
let lastState = null;
let isAnimatingResult = false;
let animatedRound = 0;

const $ = (id) => document.getElementById(id);

function show(screen) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById("screen-" + screen).classList.add("active");
}

function msg(el, text) {
  el.textContent = text || "";
}

function nickVal() {
  return ($("nick").value || "").trim() || "Jugador";
}

socket.on("joined", (d) => {
  myId = d.playerId;
  roomCode = d.code;
  localStorage.setItem("bananas_nick", nickVal());
  localStorage.setItem("bananas_code", d.code);
});

socket.on("error", (d) => {
  if (d && d.msg === "Sala no encontrada.")
    localStorage.removeItem("bananas_code");
  msg($("homeMsg"), d.msg);
  msg($("lobbyMsg"), d.msg);
});

socket.on("roomState", (state) => {
  lastState = state;
  if (!state.started) {
    renderLobby(state);
    show("lobby");
  } else {
    renderGame(state);
    show("game");
  }
});

function renderLobby(state) {
  $("lobbyCode").textContent = state.code;
  const ul = $("playerList");
  ul.innerHTML = "";
  state.players.forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escape(p.nick)} ${p.connected ? "" : "(desconectado)"}</span><span>${p.id === state.hostId ? "👑" : ""}</span>`;
    ul.appendChild(li);
  });
  const isHost = myId === state.hostId;
  $("btnStart").classList.toggle("hidden", !isHost);
  msg(
    $("lobbyMsg"),
    state.players.length < 2
      ? "Esperando jugadores (mínimo 2)..."
      : "Listo para comenzar.",
  );
}

$("btnCreate").addEventListener("click", () => {
  msg($("homeMsg"), "");
  const nick = nickVal();
  const config = {
    bananasPerCrate:
      parseInt($("cfgCrate").value, 10) || STARTINGBANANASINCRATE,
    target: parseInt($("cfgTarget").value, 10) || BANANASTOWIN,
    maxBid: parseInt($("cfgMaxBid").value, 10) || MAXBID,
    startingBananas:
      parseInt($("cfgStart").value, 10) || STARTINGBANANASPERPERSON,
  };
  socket.emit("createRoom", { nick, config });
});

$("btnJoin").addEventListener("click", () => {
  msg($("homeMsg"), "");
  const code = ($("roomCode").value || "").trim().toUpperCase();
  if (!code) {
    msg($("homeMsg"), "Ingresá un código de sala.");
    return;
  }
  socket.emit("joinRoom", { code, nick: nickVal() });
});

$("btnStart").addEventListener("click", () => {
  if (roomCode) socket.emit("startGame", { code: roomCode });
});

function renderGame(state) {
  $("gameCode").textContent = state.code;
  $("roundNum").textContent = state.roundNumber;
  $("targetAmt").textContent = state.config.target;
  const round = state.round || {};
  $("crateAmt").textContent = round.pot != null ? round.pot : 0;

  // scores
  const su = $("scoreList");
  su.innerHTML = "";
  state.players.forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${escape(p.nick)} ${p.id === myId ? "(vos)" : ""} ${p.alive === false ? "👻" : ""}</span><span><strong>${p.bananas}</strong> 🍌 ${p.connected ? "" : "⚠️"}</span>`;
    su.appendChild(li);
  });

  const isResult = round.phase === "result";
  // bidding card
  const biddingCard = $("biddingCard");
  const resultCard = $("resultCard");
  const gameOverCard = $("gameOverCard");

  if (state.gameOver) {
    biddingCard.classList.add("hidden");
    resultCard.classList.add("hidden");
    gameOverCard.classList.remove("hidden");
    const winner = state.players.find((p) => p.id === state.winnerId);
    $("winnerText").textContent =
      (winner ? winner.nick : "Alguien") +
      " alcanzó " +
      state.config.target +
      " bananas y ganó la partida.";
    return;
  } else {
    gameOverCard.classList.add("hidden");
  }

  if (isResult) {
    biddingCard.classList.add("hidden");
    resultCard.classList.remove("hidden");
    if (animatedRound !== state.roundNumber) {
      animateOffers(state, round);
    } else {
      renderResult(state, round);
    }
  } else {
    biddingCard.classList.remove("hidden");
    resultCard.classList.add("hidden");
    renderBidding(state, round);
  }
}

function renderBidding(state, round) {
  const acted = round.actions || {};
  const myAction = acted[myId];
  const statusEl = $("bidStatus");
  const me = state.players.find((p) => p.id === myId);
  if (me && me.alive === false) {
    statusEl.textContent = "Fuiste eliminado. Estás observando la partida.";
    $("bidValue").disabled = true;
    $("btnBid").disabled = true;
  } else if (myAction) {
    statusEl.textContent = "Ya enviaste tu oferta. Esperando a los demás...";
    $("bidValue").disabled = true;
    $("btnBid").disabled = true;
  } else {
    statusEl.textContent = "Elegí un número y ofrecé, o esperá.";
    $("bidValue").disabled = false;
    $("btnBid").disabled = false;
  }
  // action list
  const al = $("actionList");
  al.innerHTML = "";
  state.players.forEach((p) => {
    const a = acted[p.id];
    const li = document.createElement("li");
    let t = "⏳ sin acción";
    if (p.alive === false) t = "👻 eliminado";
    else if (a) t = "✔ ofreció";
    li.innerHTML = `<span>${escape(p.nick)}</span><span>${t}</span>`;
    al.appendChild(li);
  });
}

$("btnBid").addEventListener("click", () => {
  const v = parseInt($("bidValue").value, 10);
  if (isNaN(v)) {
    alert("Ingresá un número.");
    return;
  }
  socket.emit("submitBid", { code: roomCode, value: v });
  $("bidValue").value = "";
});

$("btnAbandon").addEventListener("click", () => {
  if (!confirm("¿Abandonar la partida? Vas a salir y quedar eliminado."))
    return;
  socket.emit("abandonGame", { code: roomCode });
  localStorage.removeItem("bananas_code");
  roomCode = null;
  show("home");
});

$("btnHome").addEventListener("click", () => {
  localStorage.removeItem("bananas_code");
  roomCode = null;
  show("home");
});

function animateOffers(state, round) {
  if (isAnimatingResult) return;
  isAnimatingResult = true;
  animatedRound = state.roundNumber;
  const r = round.result || {};
  const bids = r.bids || {};
  const entries = Object.keys(bids)
    .map((id) => {
      const p = state.players.find((x) => x.id === id);
      return { id, nick: p ? p.nick : id, val: bids[id] };
    })
    .sort((a, b) => {
      const va = typeof a.val === "number" ? a.val : 0;
      const vb = typeof b.val === "number" ? b.val : 0;
      return va - vb;
    });
  const el = $("resultText");
  const revealed = [];
  el.textContent = "🎬 Revelando ofertas...";
  let delay = 500;
  entries.forEach((e) => {
    setTimeout(() => {
      revealed.push(e);
      const txt = ["🎬 Revelando ofertas...", ""];
      revealed.forEach((x) => {
        txt.push("  " + x.nick + ": " + x.val);
      });
      el.textContent = txt.join("\n");
    }, delay);
    delay += 700;
  });
  setTimeout(() => {
    isAnimatingResult = false;
    renderResult(state, round);
  }, delay + 400);
}

function renderResult(state, round) {
  const r = round.result || {};
  const bids = r.bids || {};
  let lines = [];
  lines.push("📊 Ofertas reveladas:");
  state.players.forEach((p) => {
    const b = bids[p.id];
    const val = b === "DIVIDIR" ? "DIVIDIR" : b == null ? "-" : b;
    lines.push(`  ${p.nick}: ${val}`);
  });
  lines.push("");
  if (r.type === "split") {
    lines.push("🤝 La caja se dividió entre todos.");
    lines.push("Bananas de la caja: " + r.pot);
    state.players.forEach((p) => {
      lines.push(`  ${p.nick} recibió ${r.shares[p.id] || 0}`);
    });
  } else if (r.type === "tie") {
    const names = (r.leaders || [])
      .map((id) => {
        const p = state.players.find((x) => x.id === id);
        return p ? p.nick : id;
      })
      .join(" y ");
    if (r.tariff) {
      lines.push(`🤝 Empate entre ${names} con ${r.maxVal}.`);
      lines.push(
        `Impuesto total ${r.tariff} dividido entre ambos (${Object.values(r.payments || {}).join(" y ")}).`,
      );
      if (r.second) {
        const sp = state.players.find((x) => x.id === r.second);
        lines.push(`Pagado a ${sp ? sp.nick : r.second} (${r.secondVal}).`);
      }
      lines.push(
        `Se llevó la caja (${r.pot}): ${Math.floor(r.pot / 2)} cada uno.`,
      );
      (r.leaders || []).forEach((id) => {
        const p = state.players.find((x) => x.id === id);
        lines.push(`  🏆 ${p ? p.nick : id} recibió ${r.shares[id] || 0}`);
      });
    } else {
      lines.push(`🤝 Empate entre ${names} con ${r.maxVal}.`);
      lines.push(`Se dividió la caja (${r.pot}) entre los empatados.`);
      (r.leaders || []).forEach((id) => {
        const p = state.players.find((x) => x.id === id);
        lines.push(`  🏆 ${p ? p.nick : id} recibió ${r.shares[id] || 0}`);
      });
    }
  } else if (r.type === "win") {
    const w = state.players.find((p) => p.id === r.winner);
    const s = state.players.find((p) => p.id === r.second);
    lines.push(
      `🏆 GANÓ EL CRATE: ${w ? w.nick : r.winner} (ofreció ${r.maxVal})`,
    );
    lines.push(`Se llevó ${r.pot} bananas de la caja.`);
    if (r.second) {
      lines.push(
        `Impuesto ${r.tariff}: ${w ? w.nick : r.winner} pagó ${r.tariff} a ${s ? s.nick : r.second} (ofreció ${r.secondVal}).`,
      );
    } else {
      lines.push(`Impuesto ${r.tariff}.`);
    }
    const winners = [r.winner];
    const outside = state.players.filter((p) => !winners.includes(p.id));
    if (outside.length) {
      lines.push(
        "⛔ Se quedaron fuera del crate: " +
          outside.map((p) => p.nick).join(", "),
      );
    }
  } else if (r.type === "nocapacity") {
    const w = Array.isArray(r.winner) ? r.winner : [r.winner];
    const wn = state.players
      .filter((p) => w.includes(p.id))
      .map((p) => p.nick)
      .join(" y ");
    lines.push(
      `⚠️ ${wn} ofreció ${r.maxVal} pero no pudo pagar el impuesto de ${r.tariff}.`,
    );
    lines.push(`No ganó el crate (${r.pot}); queda para la próxima ronda.`);
    if (r.second) {
      const s = state.players.find((p) => p.id === r.second);
      lines.push(`Segundo: ${s ? s.nick : r.second} (ofreció ${r.secondVal}).`);
    }
    const outside = state.players.filter((p) => !w.includes(p.id));
    if (outside.length) {
      lines.push(
        "⛔ Se quedaron fuera: " + outside.map((p) => p.nick).join(", "),
      );
    }
  }
  if (r.eliminated && r.eliminated.length) {
    const en = r.eliminated
      .map((id) => {
        const p = state.players.find((x) => x.id === id);
        return p ? p.nick : id;
      })
      .join(", ");
    lines.push("❌ Eliminados esta ronda: " + en);
  }
  if (r.gameWinner) {
    const gw = state.players.find((p) => p.id === r.gameWinner);
    lines.push("");
    lines.push("🎉 " + (gw ? gw.nick : r.gameWinner) + " ganó la partida!");
  }
  $("resultText").textContent = lines.join("\n");
}

function escape(s) {
  return String(s).replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  );
}

// load saved nick
const saved = localStorage.getItem("bananas_nick");
if (saved) $("nick").value = saved;

socket.on("connect", () => {
  const sn = localStorage.getItem("bananas_nick");
  const sc = localStorage.getItem("bananas_code");
  if (sn && sc) {
    socket.emit("joinRoom", { code: sc, nick: sn });
  }
});
