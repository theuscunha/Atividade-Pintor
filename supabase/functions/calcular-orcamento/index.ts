// supabase/functions/calcular-orcamento/index.ts
// c) Edge Function que calcula o orçamento a partir do tipo de serviço
//    e da quantidade de cômodos. Valores EXATOS do cliente — nunca mudar.
//    Deploy: supabase functions deploy calcular-orcamento
//    Teste:  supabase functions serve calcular-orcamento

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Desafio extra: taxa de visita de R$ 30, aplicada SOMENTE quando
// o cliente confirma que o local é muito longe (flag `longe`).
// Padrão: false → cálculo básico exato (critério crítico b intacto).
const TAXA_VISITA = 30;
// Desafio extra: desconto automático de 10% a partir de 5 cômodos,
// aplicado sobre o subtotal do serviço (a taxa de visita não tem desconto).
const DESCONTO_QTD_MIN = 5;
const DESCONTO_PCT = 10;
const PRECOS: Record<string, number> = {
  "parede lisa": 120,
  "parede com textura": 180,
  "teto": 100,
};

export function normalizarTipo(raw: string): string | null {
  const t = (raw || "").toLowerCase().trim();
  if (!t) return null;
  if (t.includes("textura")) return "parede com textura";
  if (t.includes("lisa")) return "parede lisa";
  if (t === "teto" || t.includes("teto")) return "teto";
  // "parede" sozinho é ambíguo (lisa x textura) → retorna null p/ o chat perguntar, nunca chutar.
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
    const tipo = normalizarTipo(String(body.tipo_servico ?? ""));
    const qtd = Number(body.quantidade_comodos);
    const longe = body.longe === true;

    if (!tipo) {
      return new Response(
        JSON.stringify({
          erro:
            'Tipo de serviço inválido. Use exatamente: "parede lisa", "parede com textura" ou "teto".',
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

    const preco_unitario = PRECOS[tipo];
    const subtotal = preco_unitario * qtd;
    const desconto = qtd >= DESCONTO_QTD_MIN ? subtotal * (DESCONTO_PCT / 100) : 0;
    const taxa_visita = longe ? TAXA_VISITA : 0;
    const valor_total = subtotal - desconto + taxa_visita;

    return new Response(
      JSON.stringify({ tipo_servico: tipo, preco_unitario, quantidade_comodos: qtd, subtotal, desconto, longe, taxa_visita, valor_total }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch {
    return new Response(JSON.stringify({ erro: "JSON inválido." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
