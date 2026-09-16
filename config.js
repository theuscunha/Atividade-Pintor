/* ============================================================
   ORÇAMENTO NA HORA — Pintor autônomo | Configuração
   1) Preços EXATOS do cliente — NÃO ALTERAR:
      parede lisa = 120 | parede com textura = 180 | teto = 100
   2) Supabase: preencha para sair do modo demonstração.
   ============================================================ */
const CONFIG = {
  pintorNome: "Pintor — Orçamento na Hora",

  // Preços oficiais por cômodo (espelho da tabela `precos`)
  precos: {
    "parede lisa": 120,
    "parede com textura": 180,
    "teto": 100,
  },
  tiposServico: ["parede lisa", "parede com textura", "teto"],

  // --- Supabase (projeto linkado via `supabase link`: Atividade Pintor) ---
  supabaseUrl: "https://ybjqbblhmvvxtczeqpyb.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlianFiYmxobXZ2eHRjemVxcHliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk0OTU1MTgsImV4cCI6MjEwNTA3MTUxOH0.KwpXCvUWFI7kUd219uNYxPUjfsKVohwpJ4h0ZCM5U_I",
  tabelaOrcamentos: "orcamentos",

  // --- Edge Functions (deploy feito: ver Dashboard > Functions) ---
  edgeCalcularUrl: "https://ybjqbblhmvvxtczeqpyb.supabase.co/functions/v1/calcular-orcamento",
  edgeSalvarUrl: "https://ybjqbblhmvvxtczeqpyb.supabase.co/functions/v1/salvar-orcamento",

  // --- IA Groq via Edge Function chatbot-ai (item e da atividade) ---
  edgeChatUrl: "https://ybjqbblhmvvxtczeqpyb.supabase.co/functions/v1/chatbot-ai",
  groqModel: "openai/gpt-oss-20b",
};
