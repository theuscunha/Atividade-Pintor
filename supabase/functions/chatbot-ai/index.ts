// supabase/functions/chatbot-ai/index.ts
// e) A IA decide SOZINHA quando calcular e quando salvar (function calling).
//    Regra de ouro: sempre perguntar o que faltar antes de agir — NUNCA inventar dado.
//
//    Tools disponíveis para o modelo Groq:
//      - calcular_orcamento { tipo_servico, quantidade_comodos }
//      - salvar_orcamento   { nome, telefone, tipo_servico, quantidade_comodos }
//
//    Deploy:
//      supabase secrets set GROQ_API_KEY=gsk_...
//      supabase functions deploy chatbot-ai
//    Teste local:
//      GROQ_API_KEY=gsk_... SUPABASE_URL=... SUPABASE_ANON_KEY=... supabase functions serve chatbot-ai

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GROQ_MODEL = "openai/gpt-oss-120b";

// Preços oficiais — espelho da tabela `precos` e do SQL seed.
// A function calcular usa exatamente estes números.
const PRECOS: Record<string, number> = {
  "parede lisa": 120,
  "parede com textura": 180,
  "teto": 100,
};

const SYSTEM_PROMPT = `Você é o atendente virtual de um pintor autônomo. Fale português do Brasil, de forma curta e simpática.

TABELA DE PREÇOS (por cômodo — NUNCA mude estes valores):
- parede lisa: R$ 120
- parede com textura: R$ 180 (dá mais trabalho)
- teto: R$ 100
NÃO existe desconto. Cálculo básico = preço unitário x quantidade de cômodos.
TAXA DE VISITA (desafio extra): R$ 30, aplicada SOMENTE se o cliente confirmar que o local é muito longe. Padrão: sem taxa. Se o cliente não disser nada sobre distância, calcule sem a taxa e pergunte se o local é longe antes de salvar — nunca assuma.
DESCONTO AUTOMÁTICO (desafio extra): 10% sobre o subtotal do serviço a partir de 5 cômodos (a taxa de visita não tem desconto). Aplique sempre, sem perguntar, e avise o cliente. Ex.: 5 × parede lisa = 600 − 60 = 540.

COMO AGIR (use as ferramentas, nunca calcule de cabeça no texto):
1. Para ORÇAR você precisa de 2 dados: tipo_servico (um dos 3 acima) e quantidade_comodos (inteiro > 0).
   Faltando qualquer um, PERGUNTE antes de chamar qualquer ferramenta. Nunca chute.
2. Quando tiver os 2, chame calcular_orcamento e apresente o valor em R$ com 2 casas.
3. Depois do valor, ofereça salvar: peça nome e telefone/WhatsApp com DDD.
   Só chame salvar_orcamento quando tiver nome + telefone + tipo + quantidade.
   Telefone precisa ter DDD (10 ou 11 dígitos); se inválido, peça de novo.
4. Após salvar, confirme com o valor e diga que o pintor vai ligar.
5. Se o cliente falar de outro serviço (ex: porta, muro, parte elétrica), diga que você só orça os 3 serviços da tabela e pergunte qual deles ele quer.
6. Nunca invente nome, telefone, tipo ou quantidade.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "calcular_orcamento",
      description:
        "Calcula o valor do serviço. Chame SOMENTE quando souber tipo_servico e quantidade_comodos. Passe longe=true SOMENTE se o cliente confirmou que o local é muito longe (adiciona R$ 30).",
      parameters: {
        type: "object",
        properties: {
          tipo_servico: {
            type: "string",
            enum: ["parede lisa", "parede com textura", "teto"],
          },
          quantidade_comodos: { type: "integer", minimum: 1 },
          longe: { type: "boolean", description: "true só se o cliente confirmou local muito longe" },
        },
        required: ["tipo_servico", "quantidade_comodos"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "salvar_orcamento",
      description:
        "Salva o orçamento como lead. Chame SOMENTE com nome, telefone, tipo_servico e quantidade_comodos já informados pelo cliente. Repasse longe=true se a taxa de visita foi aplicada.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string" },
          telefone: { type: "string" },
          tipo_servico: {
            type: "string",
            enum: ["parede lisa", "parede com textura", "teto"],
          },
          quantidade_comodos: { type: "integer", minimum: 1 },
          longe: { type: "boolean" },
        },
        required: ["nome", "telefone", "tipo_servico", "quantidade_comodos"],
        additionalProperties: false,
      },
    },
  },
];

function normalizarTipo(raw: string): string | null {
  const t = (raw || "").toLowerCase().trim();
  if (t.includes("textura")) return "parede com textura";
  if (t.includes("lisa")) return "parede lisa";
  if (t === "teto" || t.includes("teto")) return "teto";
  return Object.keys(PRECOS).find((k) => k === t) ?? null;
}

async function salvarLead(
  args: { nome: string; telefone: string; tipo_servico: string; quantidade_comodos: number; longe?: boolean },
): Promise<Record<string, unknown>> {
  const tipo = normalizarTipo(args.tipo_servico);
  const qtd = Math.trunc(Number(args.quantidade_comodos));
  const nome = String(args.nome || "").trim();
  const telefone = String(args.telefone || "").trim();
  const longe = args.longe === true;
  if (!tipo || !Number.isInteger(qtd) || qtd <= 0 || nome.length < 2) {
    return { ok: false, erro: "Dados incompletos para salvar." };
  }
  const dig = telefone.replace(/\D/g, "");
  if (dig.length < 10 || dig.length > 11) {
    return { ok: false, erro: "Telefone inválido — peça o WhatsApp com DDD." };
  }
  const subtotalLead = PRECOS[tipo] * qtd;
  const valor_calculado = subtotalLead - (qtd >= 5 ? subtotalLead * 0.10 : 0) + (longe ? 30 : 0);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) {
    return {
      ok: true,
      modo: "sem-banco",
      lead: { nome, telefone, tipo_servico: tipo, quantidade_comodos: qtd, valor_calculado },
    };
  }
  const resp = await fetch(`${url}/rest/v1/orcamentos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify([{
      nome,
      telefone,
      tipo_servico: tipo,
      quantidade_comodos: qtd,
      valor_calculado,
    }]),
  });
  if (!resp.ok) {
    return { ok: false, erro: "Falha ao inserir no banco: " + (await resp.text()) };
  }
  const rows = await resp.json();
  return { ok: true, lead: rows?.[0] ?? null, valor_calculado };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { messages, model } = await req.json();
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("Campo 'messages' (array) é obrigatório.");
    }
    const groqKey = Deno.env.get("GROQ_API_KEY");
    if (!groqKey) throw new Error("GROQ_API_KEY não configurada no servidor.");

    const historico = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.filter((m) =>
        m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
      ).slice(-12),
    ];

    let valor_calculado: number | null = null;
    let lead_salvo: Record<string, unknown> | null = null;

    // Loop agente: modelo -> tool -> executa -> devolve -> modelo (máx 5 turnos)
    for (let i = 0; i < 5; i++) {
      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: model || GROQ_MODEL,
          temperature: 0,
          messages: historico,
          tools: TOOLS,
          tool_choice: "auto",
        }),
      });
      const data = await groqRes.json();
      if (!groqRes.ok || data?.error) {
        throw new Error(data?.error?.message || `Groq status ${groqRes.status}`);
      }
      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error("IA sem resposta.");
      historico.push(msg);

      const calls = msg.tool_calls || [];
      if (calls.length === 0) {
        return new Response(
          JSON.stringify({
            resposta: msg.content || "",
            valor_calculado,
            lead_salvo,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      for (const call of calls) {
        const nome = call.function?.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }
        let result: Record<string, unknown>;
        if (nome === "calcular_orcamento") {
          const tipo = normalizarTipo(String(args.tipo_servico ?? ""));
          const qtd = Math.trunc(Number(args.quantidade_comodos));
          const longe = args.longe === true;
          if (!tipo || !Number.isInteger(qtd) || qtd <= 0) {
            result = { ok: false, erro: "Faltam tipo_servico válido e quantidade_comodos > 0." };
          } else {
            const subtotal = PRECOS[tipo] * qtd;
            const desconto = qtd >= 5 ? subtotal * 0.10 : 0;
            valor_calculado = subtotal - desconto + (longe ? 30 : 0);
            result = {
              ok: true,
              tipo_servico: tipo,
              preco_unitario: PRECOS[tipo],
              quantidade_comodos: qtd,
              subtotal,
              desconto,
              longe,
              taxa_visita: longe ? 30 : 0,
              valor_total: valor_calculado,
            };
          }
        } else if (nome === "salvar_orcamento") {
          result = await salvarLead({
            nome: String(args.nome ?? ""),
            telefone: String(args.telefone ?? ""),
            tipo_servico: String(args.tipo_servico ?? ""),
            quantidade_comodos: Number(args.quantidade_comodos),
            longe: args.longe === true,
          });
          if ((result as { ok?: boolean }).ok) {
            lead_salvo = result.lead as Record<string, unknown>;
            if (typeof result.valor_calculado === "number") {
              valor_calculado = result.valor_calculado as number;
            }
          }
        } else {
          result = { ok: false, erro: `Ferramenta desconhecida: ${nome}` };
        }
        historico.push({
          role: "tool",
          tool_call_id: call.id,
          name: nome,
          content: JSON.stringify(result),
        });
      }
    }

    const last = historico[historico.length - 1];
    return new Response(
      JSON.stringify({
        resposta: typeof last?.content === "string"
          ? last.content
          : "Calculei aqui — me diga seu nome e WhatsApp para eu salvar o orçamento! 🙂",
        valor_calculado,
        lead_salvo,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
