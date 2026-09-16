// supabase/functions/salvar-orcamento/index.ts
// d) Edge Function que salva o orçamento como lead na tabela `orcamentos`.
//    Nunca inventa dado: exige nome, telefone, tipo, qtd e valor.
//    Recalcula o valor no servidor a partir da tabela oficial de preços.
//    Deploy: supabase functions deploy salvar-orcamento

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PRECOS: Record<string, number> = {
  "parede lisa": 120,
  "parede com textura": 180,
  "teto": 100,
};

// Desafio extra: taxa de visita de R$ 30, só quando `longe === true`.

function normalizarTipo(raw: string): string | null {
  const t = (raw || "").toLowerCase().trim();
  if (t.includes("textura")) return "parede com textura";
  if (t.includes("lisa")) return "parede lisa";
  if (t === "teto" || t.includes("teto")) return "teto";
  return (Object.keys(PRECOS) as string[]).find((k) => k === t) ?? null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ erro: "Use POST." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const body = await req.json();
    const nome = String(body.nome ?? "").trim();
    const telefone = String(body.telefone ?? "").trim();
    const tipo = normalizarTipo(String(body.tipo_servico ?? ""));
    const qtd = Number(body.quantidade_comodos);
    const longe = body.longe === true;

    if (nome.length < 2) {
      return new Response(JSON.stringify({ erro: "Informe o nome do cliente." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const digitos = telefone.replace(/\D/g, "");
    if (digitos.length < 10 || digitos.length > 11) {
      return new Response(
        JSON.stringify({ erro: "Informe um telefone/WhatsApp válido com DDD." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!tipo) {
      return new Response(
        JSON.stringify({
          erro:
            'tipo_servico inválido. Use: "parede lisa", "parede com textura" ou "teto".',
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!Number.isInteger(qtd) || qtd <= 0) {
      return new Response(
        JSON.stringify({ erro: "quantidade_comodos deve ser inteiro maior que 0." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Recalcula no servidor — o valor que vale é o da tabela oficial
    // (+ R$ 30 de visita somente se longe === true).
    const valor_calculado = PRECOS[tipo] * qtd + (longe ? 30 : 0);

    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!url || (!serviceKey && !anonKey)) {
      // Sem banco linkado (teste local): devolve o payload validado sem inserir.
      return new Response(
        JSON.stringify({
          ok: true,
          modo: "sem-banco",
          aviso: "SUPABASE_URL / chave não configurada — nada foi inserido.",
          lead: { nome, telefone, tipo_servico: tipo, quantidade_comodos: qtd, longe, valor_calculado },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const key = serviceKey ?? anonKey!;
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
      const txt = await resp.text();
      console.error("Insert orcamentos falhou:", txt);
      return new Response(
        JSON.stringify({ erro: "Não consegui salvar o orçamento no banco.", detalhe: txt }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rows = await resp.json();
    return new Response(
      JSON.stringify({ ok: true, lead: rows?.[0] ?? null, valor_calculado }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ erro: "Erro interno ao salvar." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
