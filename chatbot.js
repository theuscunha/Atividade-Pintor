/* ==========================================================================
   ORÇAMENTO NA HORA — Pintor | chat que calcula e salva o lead
   - Preços EXATOS do cliente: lisa 120 | textura 180 | teto 100 (por cômodo)
   - 2 modos: (1) IA via Edge Function chatbot-ai (decide sozinha quando
     calcular/salvar); (2) fluxo guiado local (mesmas regras, sem IA).
   - Cálculo básico: valor = preço_unitário x qtd. Sem taxa de visita.
   - Nunca inventa dado: pergunta o que faltar antes de agir.
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const els = {
  messages: $("chat-messages"),
  quick: $("quick-replies"),
  form: $("chat-form"),
  input: $("chat-input"),
  badge: $("modo-badge"),
};

const TIPOS = CONFIG.tiposServico;
const TAXA_VISITA = 30; // desafio extra: só quando o local é muito longe
const DESCONTO_QTD_MIN = 5, DESCONTO_PCT = 10; // desafio extra: 10% a partir de 5 cômodos
const state = { tipo: "", qtd: 0, longe: false, valor: 0, nome: "", telefone: "" };
let etapa = "tipo";           // tipo -> qtd -> longe -> nome -> telefone -> fim
let historicoIA = [];         // usado só no modo IA
let supabaseClient = null;

const MODO_IA = Boolean(CONFIG.edgeChatUrl);
const TEM_EDGE_CALC = Boolean(CONFIG.edgeCalcularUrl);
const TEM_EDGE_SAVE = Boolean(CONFIG.edgeSalvarUrl);

if (CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && window.supabase) {
  supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
}

function atualizarBadge() {
  if (MODO_IA) { els.badge.textContent = "IA ativa 🤖"; els.badge.classList.add("on"); }
  else if (supabaseClient || TEM_EDGE_CALC) { els.badge.textContent = "banco conectado"; els.badge.classList.add("on"); }
  else { els.badge.textContent = "modo demonstração"; els.badge.classList.remove("on"); }
}

// ---------- UI ----------
function scrollBottom() { els.messages.scrollTop = els.messages.scrollHeight; }
function addMsg(text, who = "bot", cls = "", isHTML = false) {
  const div = document.createElement("div");
  div.className = `msg ${who} ${cls}`.trim();
  if (isHTML) div.innerHTML = text;
  else div.textContent = text;
  els.messages.appendChild(div);
  scrollBottom();
  return div;
}
function showTyping() {
  const t = document.createElement("div");
  t.className = "typing"; t.id = "typing-ind";
  t.innerHTML = "<i></i><i></i><i></i>";
  els.messages.appendChild(t); scrollBottom();
}
function hideTyping() { $("typing-ind")?.remove(); }
function botSay(text, quick = []) {
  showTyping();
  return new Promise((res) => setTimeout(() => {
    hideTyping(); addMsg(text, "bot"); setQuick(quick); res();
  }, 450));
}
function setQuick(options) {
  els.quick.innerHTML = "";
  (options || []).forEach((opt) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "qr-btn"; b.textContent = opt;
    b.onclick = () => { els.input.value = opt; els.form.requestSubmit(); };
    els.quick.appendChild(b);
  });
}
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const reais = (v) => "R$ " + Number(v).toFixed(2).replace(".", ",");

// ---------- Regras de negócio (iguais no local e no servidor) ----------
function detectarTipo(texto) {
  const t = texto.toLowerCase();
  if (t.includes("textura")) return "parede com textura";
  if (t.includes("lisa")) return "parede lisa";
  if (t.includes("teto")) return "teto";
  return null;
}
function detectarQtd(texto) {
  const m = texto.match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isInteger(n) && n > 0 && n <= 100 ? n : null;
}
function calcularLocal(tipo, qtd) {
  return CONFIG.precos[tipo] * qtd; // ex: 2 x 120 = 240
}

async function calcularOrcamento(tipo, qtd, longe = false) {
  if (TEM_EDGE_CALC) {
    const r = await fetch(CONFIG.edgeCalcularUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.supabaseAnonKey || "",
        Authorization: `Bearer ${CONFIG.supabaseAnonKey || ""}`,
      },
      body: JSON.stringify({ tipo_servico: tipo, quantidade_comodos: qtd, longe }),
    });
    const j = await r.json();
    if (j.erro) throw new Error(j.erro);
    return j.valor_total;
  }
  const subtotal = calcularLocal(tipo, qtd);
  return subtotal - (qtd >= DESCONTO_QTD_MIN ? subtotal * (DESCONTO_PCT / 100) : 0) + (longe ? TAXA_VISITA : 0);
}

function salvarDemo(lead) {
  const todos = JSON.parse(localStorage.getItem("orcamentos_demo") || "[]");
  lead.id = todos.length + 1;
  lead.criado_em = new Date().toISOString();
  todos.push(lead);
  localStorage.setItem("orcamentos_demo", JSON.stringify(todos));
  return lead;
}

async function salvarOrcamento() {
  const payload = {
    nome: state.nome,
    telefone: state.telefone,
    tipo_servico: state.tipo,
    quantidade_comodos: state.qtd,
    longe: state.longe,
    valor_calculado: state.valor,
  };
  if (TEM_EDGE_SAVE) {
    const r = await fetch(CONFIG.edgeSalvarUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.supabaseAnonKey || "",
        Authorization: `Bearer ${CONFIG.supabaseAnonKey || ""}`,
      },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (j.erro) throw new Error(j.erro);
    return j.lead || payload;
  }
  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from(CONFIG.tabelaOrcamentos)
      .insert([payload])
      .select();
    if (error) throw error;
    return data[0];
  }
  return salvarDemo(payload); // modo demonstração
}

// ---------- Modo IA (item e): a IA decide quando calcular/salvar ----------
async function responderViaIA(texto) {
  historicoIA.push({ role: "user", content: texto });
  const r = await fetch(CONFIG.edgeChatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.supabaseAnonKey || "",
      Authorization: `Bearer ${CONFIG.supabaseAnonKey || ""}`,
    },
    body: JSON.stringify({ messages: historicoIA, model: CONFIG.groqModel }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  historicoIA.push({ role: "assistant", content: j.resposta || "" });
  // f) mostra valor calculado e confirmação de lead salvo em destaque
  if (j.valor_calculado != null) {
    addMsg(`💰 Orçamento: <strong>${esc(reais(j.valor_calculado))}</strong>`, "bot", "valor", true);
  }
  addMsg(j.resposta || "(sem resposta)", "bot");
  if (j.lead_salvo) {
    addMsg(`✅ Orçamento salvo! O pintor vai ligar para <strong>${esc(j.lead_salvo.telefone || "")}</strong> para fechar.`, "bot", "sucesso", true);
    setQuick(["🔄 Novo orçamento"]);
  }
}

// ---------- Fluxo guiado (sem IA): mesma regra, passo a passo ----------
async function boasVindas() {
  etapa = "tipo";
  await botSay(
    `Oi! Sou o assistente do pintor 🎨\nParede lisa R$ 120 • Textura R$ 180 • Teto R$ 100 (por cômodo).\nQual serviço você quer?`,
    ["parede lisa", "parede com textura", "teto"]
  );
}

async function tratarGuiado(textoOriginal) {
  const texto = textoOriginal.trim();
  if (!texto) return;
  const low = texto.toLowerCase();
  if (/^🔄|recome|reinic|novo|outro/.test(low)) return restart();

  if (etapa === "tipo") {
    const tipo = detectarTipo(texto);
    if (!tipo) {
      await botSay("Aqui eu orço só 3 serviços 🙂 Qual deles: parede lisa, parede com textura ou teto?", TIPOS);
      return;
    }
    state.tipo = tipo;
    etapa = "qtd";
    await botSay(`Boa! ${tipo} = ${reais(CONFIG.precos[tipo])} por cômodo.\nQuantos cômodos são? (ex.: 2)`);
    return;
  }

  if (etapa === "qtd") {
    const qtd = detectarQtd(texto);
    if (!qtd) {
      await botSay("Me diz a quantidade de cômodos com um número maior que 0? Ex.: 3");
      return;
    }
    state.qtd = qtd;
    try {
      showTyping();
      state.valor = await calcularOrcamento(state.tipo, state.qtd);
      hideTyping();
    } catch (e) {
      hideTyping();
      await botSay("Não consegui calcular agora: " + (e.message || "erro") + "\nTenta de novo?");
      return;
    }
    // f) mostra o valor calculado em destaque
    addMsg(
      `💰 Orçamento: <strong>${esc(reais(state.valor))}</strong><br><span style="font-size:.85rem">${esc(String(state.qtd))} × ${esc(state.tipo)} (${esc(reais(CONFIG.precos[state.tipo]))}/cômodo)${state.qtd >= DESCONTO_QTD_MIN ? ` — com ${DESCONTO_PCT}% de desconto` : ""}</span>`,
      "bot", "valor", true
    );
    etapa = "longe";
    await botSay("O local do serviço é muito longe? (taxa de visita: R$ 30,00)", ["É longe (+R$ 30)", "É perto"]);
    return;
  }

  if (etapa === "longe") {
    const low = texto.toLowerCase();
    if (/longe|distante/i.test(texto)) state.longe = true;
    else if (/perto|pr[oó]ximo|n[aã]o\b/i.test(low)) state.longe = false;
    else {
      await botSay("Só me diga: o local é longe ou perto?", ["É longe (+R$ 30)", "É perto"]);
      return;
    }
    if (state.longe) {
      try {
        showTyping();
        state.valor = await calcularOrcamento(state.tipo, state.qtd, true);
        hideTyping();
      } catch (e) {
        hideTyping();
        state.valor = calcularLocal(state.tipo, state.qtd) + TAXA_VISITA;
      }
      addMsg(
        `💰 Orçamento atualizado: <strong>${esc(reais(state.valor))}</strong><br><span style="font-size:.85rem">inclui taxa de visita de ${esc(reais(TAXA_VISITA))}</span>`,
        "bot", "valor", true
      );
    }
    etapa = "nome";
    await botSay("Quer que o pintor ligue para fechar? Qual seu nome?");
    return;
  }

  if (etapa === "nome") {
    const nome = texto.replace(/^(meu nome é|me chamo|sou|aqui é)\s+/i, "").trim();
    if (nome.length < 2 || /^\d+$/.test(nome)) {
      await botSay("Me diz seu nome para eu anotar? 🙂");
      return;
    }
    state.nome = nome;
    etapa = "telefone";
    await botSay(`Prazer, ${esc(nome.split(" ")[0])}! Qual seu WhatsApp com DDD? (ex.: (11) 99999-8888)`);
    return;
  }

  if (etapa === "telefone") {
    const m = texto.match(/\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}|\d{10,11}/);
    const dig = (m ? m[0] : texto).replace(/\D/g, "");
    if (dig.length < 10 || dig.length > 11) {
      await botSay("Esse número não parece válido 🥺 Manda com DDD? Ex.: (11) 99999-8888");
      return;
    }
    state.telefone = m ? m[0].trim() : texto.trim();
    await botSay("Salvando seu orçamento… ⏳");
    try {
      const lead = await salvarOrcamento();
      etapa = "fim";
      // f) confirmação de que o lead foi salvo
      addMsg(
        `✅ Salvo! <strong>${esc(state.nome)}</strong>, seu orçamento de <strong>${esc(reais(state.valor))}</strong> (${esc(state.qtd)} × ${esc(state.tipo)}${state.longe ? " + taxa de visita" : ""}) foi anotado.<br>O pintor vai ligar para <strong>${esc(state.telefone)}</strong> para fechar. ${lead && lead.id ? `<br><small>Protocolo #${esc(String(lead.id))}</small>` : ""}`,
        "bot", "sucesso", true
      );
      setQuick(["🔄 Novo orçamento"]);
    } catch (e) {
      addMsg("❌ Não consegui salvar agora: " + esc(e.message || "erro") + ". Tenta de novo?", "bot");
      setQuick(["🔁 Tentar de novo"]);
    }
    return;
  }

  if (etapa === "fim") {
    await botSay("Quer fazer outro orçamento? Clique abaixo 🙂", ["🔄 Novo orçamento"]);
  }
}

// ---------- Entrada ----------
async function onMessage(raw) {
  const texto = raw.trim();
  if (!texto || $("btn-send").disabled) return;
  addMsg(texto, "user");
  setQuick([]);
  els.input.value = "";
  try {
    if (MODO_IA) await responderViaIA(texto);
    else await tratarGuiado(texto);
  } catch (e) {
    hideTyping();
    addMsg("❌ Erro: " + (e.message || "desconhecido") + "\nVerifique a configuração (config.js) ou tente de novo.", "bot");
  }
}

function restart() {
  state.tipo = ""; state.qtd = 0; state.longe = false; state.valor = 0; state.nome = ""; state.telefone = "";
  historicoIA = [];
  els.messages.innerHTML = "";
  boasVindas();
}

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  onMessage(els.input.value);
});
$("btn-recomecar").addEventListener("click", restart);

document.addEventListener("DOMContentLoaded", () => {
  atualizarBadge();
  boasVindas();
  // Layout de referência: rolagem suave até as seções
  document.querySelectorAll("[data-scroll]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelector(b.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });
      if (b.dataset.scroll === "#orcamento") setTimeout(() => els.input.focus(), 500);
    });
  });
  // Botões "Quero este" dos 3 cards: rolam até o chat e já mandam o serviço
  document.querySelectorAll("[data-service]").forEach((b) => {
    b.addEventListener("click", () => {
      document.querySelector("#orcamento")?.scrollIntoView({ behavior: "smooth" });
      if (/^🔄|recome|reinic|novo|outro/.test((els.input.value || "").toLowerCase()) || etapa === "fim") restart();
      setTimeout(() => onMessage(b.dataset.service || ""), 400);
    });
  });
});
