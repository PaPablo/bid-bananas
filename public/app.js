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
let scoreSnapshot = null;

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

  const isResult = round.phase === "result";
  if (!isResult) {
    if (isAnimatingResult) cancelReveal(); // empezó otra ronda
    // puntajes previos al resultado, para no arruinar el suspenso
    scoreSnapshot = state.players.map((p) => ({ ...p }));
  }

  const biddingCard = $("biddingCard");
  const resultCard = $("resultCard");
  const gameOverCard = $("gameOverCard");

  if (isResult) {
    biddingCard.classList.add("hidden");
    resultCard.classList.remove("hidden");
    if (animatedRound !== state.roundNumber) {
      gameOverCard.classList.add("hidden");
      animateOffers(state, round);
    } else if (!isAnimatingResult) {
      renderResult(state, round);
      if (state.gameOver) showGameOver(state, false);
    }
    // si se está animando, no se toca el develado en curso
  } else if (state.gameOver) {
    // fin de partida sin ronda que develar (ej.: abandonos)
    biddingCard.classList.add("hidden");
    resultCard.classList.add("hidden");
    showGameOver(state, false);
  } else {
    gameOverCard.classList.add("hidden");
    biddingCard.classList.remove("hidden");
    resultCard.classList.add("hidden");
    renderBidding(state, round);
  }

  renderScores(state);
}

function renderScores(state) {
  // durante el develado se muestran los puntajes de antes de la ronda
  const source =
    isAnimatingResult && scoreSnapshot ? scoreSnapshot : state.players;
  const su = $("scoreList");
  su.innerHTML = "";
  state.players.forEach((cur) => {
    const p = source.find((x) => x.id === cur.id) || cur;
    const li = document.createElement("li");
    li.innerHTML = `<span>${escape(cur.nick)} ${cur.id === myId ? "(vos)" : ""} ${p.alive === false ? "👻" : ""}</span><span><strong>${p.bananas}</strong> 🍌 ${cur.connected ? "" : "⚠️"}</span>`;
    su.appendChild(li);
  });
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

// ---------- Develado de ofertas ----------

const REVEAL = {
  start: 500, // antes de la primera oferta
  step: 1000, // entre ofertas
  drumroll: 1600, // suspenso antes de la oferta más alta
  pause: 1200, // entre el develado y el desenlace
  outcome: 1300, // entre cada bloque del desenlace
  gameOver: 1800, // antes de anunciar al ganador de la partida
};

let revealTimers = [];

function at(ms, fn) {
  revealTimers.push(setTimeout(fn, ms));
}

function cancelReveal() {
  revealTimers.forEach(clearTimeout);
  revealTimers = [];
  isAnimatingResult = false;
}

function nickOf(state, id) {
  const p = state.players.find((x) => x.id === id);
  return p ? p.nick : id;
}

function names(state, ids) {
  return (ids || []).map((id) => escape(nickOf(state, id))).join(" y ");
}

// Agrega un elemento al develado; con animate aparece con fade-in.
function addItem(container, html, cls, animate) {
  const d = document.createElement("div");
  d.className = "reveal-item " + (cls || "");
  d.innerHTML = html;
  container.appendChild(d);
  if (animate) void d.offsetWidth; // reflow para que la transición se dispare
  d.classList.add("in");
  return d;
}

function sortedBids(state, r) {
  const bids = r.bids || {};
  return Object.keys(bids)
    .map((id) => ({ id, nick: nickOf(state, id), val: Number(bids[id]) || 0 }))
    .sort((a, b) => a.val - b.val);
}

function bidRow(container, e, cls, animate) {
  const row = addItem(
    container,
    `<span>${escape(e.nick)}</span><span class="bid-val">${e.val}</span>`,
    "bid-row " + (cls || ""),
    animate,
  );
  row.dataset.id = e.id;
  return row;
}

// Desenlace en orden: eliminados, ganador del pozo, pago al segundo.
function outcomeBlocks(state, r) {
  const blocks = [];
  const elim = r.eliminated || [];
  if (elim.length) {
    const many = elim.length > 1;
    blocks.push({
      cls: "out-msg",
      html: `❌ <strong>${names(state, elim)}</strong> ${many ? "quedaron eliminados" : "quedó eliminado"}: no ${many ? "podían" : "podía"} pagar el impuesto.`,
    });
  }
  if (r.type === "win") {
    blocks.push({
      cls: "win-msg",
      html: `🏆 <strong>${names(state, [r.winner])}</strong> se lleva el pozo de <strong>${r.pot}</strong> 🍌`,
    });
    blocks.push({
      cls: "pay-msg",
      html: r.second
        ? `💸 Le paga <strong>${r.tariff}</strong> 🍌 a <strong>${names(state, [r.second])}</strong> (${r.maxVal} − ${r.secondVal})`
        : "💸 No hay segundo: no paga impuesto.",
    });
  } else if (r.type === "tie") {
    const leaders = r.leaders || [];
    const share = (r.shares || {})[leaders[0]] || 0;
    blocks.push({
      cls: "win-msg",
      html: `🤝 Empate entre <strong>${names(state, leaders)}</strong> con ${r.maxVal}: se reparten el pozo de <strong>${r.pot}</strong> 🍌 (${share} c/u)`,
    });
    const pays = leaders.map((id) => (r.payments || {})[id] || 0).join(" + ");
    blocks.push({
      cls: "pay-msg",
      html:
        r.second && r.tariff
          ? `💸 Le pagan <strong>${r.tariff}</strong> 🍌 a <strong>${names(state, [r.second])}</strong> (${pays})`
          : "💸 Sin impuesto.",
    });
  } else {
    blocks.push({
      cls: "out-msg",
      html: `📦 Nadie se lleva el pozo de <strong>${r.pot}</strong> 🍌`,
    });
  }
  return blocks;
}

function gameWinnerHtml(state, r) {
  return `🎉 <strong>${escape(nickOf(state, r.gameWinner))}</strong> ganó la partida!`;
}

function highlightRows(container, r) {
  const mark = (id, cls) => {
    const row = container.querySelector(
      `.bid-row[data-id="${CSS.escape(id)}"]`,
    );
    if (row) row.classList.add(cls);
  };
  (r.eliminated || []).forEach((id) => mark(id, "out"));
  if (r.type === "win") mark(r.winner, "top");
  if (r.type === "tie") (r.leaders || []).forEach((id) => mark(id, "top"));
  if ((r.type === "win" || r.type === "tie") && r.second)
    mark(r.second, "second");
}

function showGameOver(state, animate) {
  const card = $("gameOverCard");
  const winner = state.players.find((p) => p.id === state.winnerId);
  const name = winner ? winner.nick : "Alguien";
  $("winnerText").textContent =
    winner && winner.bananas >= state.config.target
      ? `${name} alcanzó ${state.config.target} bananas y ganó la partida.`
      : `${name} es el último en pie y ganó la partida.`;
  card.classList.remove("hidden", "pop");
  if (animate) {
    void card.offsetWidth;
    card.classList.add("pop");
  }
}

// Develado con suspenso: ofertas de menor a mayor y después el desenlace.
function animateOffers(state, round) {
  cancelReveal();
  isAnimatingResult = true;
  animatedRound = state.roundNumber;
  const r = round.result || {};
  const el = $("resultText");
  el.innerHTML = "";
  const header = addItem(el, "🎬 Develando ofertas...", "reveal-title", true);
  const entries = sortedBids(state, r);

  let t = REVEAL.start;
  entries.forEach((e, i) => {
    const isLast = i === entries.length - 1;
    if (isLast && entries.length > 1) {
      at(t, () =>
        addItem(el, "🥁 Y la oferta más alta es...", "drumroll", true),
      );
      t += REVEAL.drumroll;
    }
    at(t, () => bidRow(el, e, isLast ? "last" : "", true));
    if (!isLast) t += REVEAL.step;
  });

  t += REVEAL.pause;
  at(t, () => {
    const dr = el.querySelector(".drumroll");
    if (dr) dr.remove();
    header.textContent = "📊 Ofertas";
    highlightRows(el, r);
  });

  outcomeBlocks(state, r).forEach((b) => {
    t += REVEAL.outcome;
    at(t, () => addItem(el, b.html, "outcome " + b.cls, true));
  });

  // los puntajes se actualizan recién al terminar el desenlace de la ronda
  at(t + 300, () => {
    isAnimatingResult = false;
    renderScores(lastState || state);
  });

  if (r.gameWinner) {
    t += REVEAL.gameOver;
    at(t, () => {
      addItem(el, gameWinnerHtml(state, r), "outcome game-msg", true);
      showGameOver(lastState || state, true);
    });
  }
}

// Versión sin animación (por ejemplo al reconectar durante un resultado).
function renderResult(state, round) {
  const r = round.result || {};
  const el = $("resultText");
  el.innerHTML = "";
  addItem(el, "📊 Ofertas", "reveal-title", false);
  sortedBids(state, r).forEach((e) => bidRow(el, e, "", false));
  highlightRows(el, r);
  outcomeBlocks(state, r).forEach((b) =>
    addItem(el, b.html, "outcome " + b.cls, false),
  );
  if (r.gameWinner)
    addItem(el, gameWinnerHtml(state, r), "outcome game-msg", false);
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
