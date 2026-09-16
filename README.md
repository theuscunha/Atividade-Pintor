# 🎨 Orçamento na Hora — Pintor autônomo

Chat que dá o valor aproximado na hora e salva o contato (lead) para o pintor ligar depois.

## Ficha de Especificação da Tabela de Preços (Quadro 2 — preenchida antes de programar)

Valores **exatos** da mensagem do cliente (seção 2.1). Nada inventado, nada arredondado.

| Tipo de Serviço      | Preço por Cômodo (R$) | Observação                                        |
|----------------------|----------------------:|---------------------------------------------------|
| Parede lisa          | 120,00                | valor informado pelo cliente (exemplo de preenchimento) |
| Parede com textura   | 180,00                | dá mais trabalho — valor informado pelo cliente   |
| Teto                 | 100,00                | valor informado pelo cliente                      |

> Taxa de visita de R$ 30 fica **para depois** (desafio extra) — o cálculo básico é `preço × cômodos`.
> Ex.: 2× lisa = 240 | 3× textura = 540 | 1× teto = 100.

## O que foi entregue (itens a–f)

- **a)** `supabase_orcamento_na_hora.sql` → tabela `precos` com os 3 serviços e seed idempotente (upsert) nos valores exatos.
- **b)** mesmo SQL → tabela `orcamentos` (leads): `nome, telefone, tipo_servico, quantidade_comodos, valor_calculado` + RLS (select/insert público).
- **c)** `supabase/functions/calcular-orcamento/index.ts` → POST `{tipo_servico, quantidade_comodos}` → `{preco_unitario, valor_total}`. Valida tipo exato e qtd inteira > 0.
- **d)** `supabase/functions/salvar-orcamento/index.ts` → POST `{nome, telefone, tipo_servico, quantidade_comodos}` → **recalcula no servidor** e insere em `orcamentos`. Sem `SUPABASE_URL` devolve `modo: sem-banco` (teste local).
- **e)** `supabase/functions/chatbot-ai/index.ts` → a IA (Groq `openai/gpt-oss-20b`) decide sozinha via **function calling** (`calcular_orcamento` / `salvar_orcamento`). System prompt manda **perguntar o que faltar e nunca inventar dado**.
- **f)** `index.html` + `chatbot.js` → mostra o **valor em destaque** (`.msg.valor`) e a **confirmação de lead salvo** (`.msg.sucesso` + protocolo #id).

## Como rodar (2 min, sem banco)

Só abrir o `index.html` no navegador (duplo clique) ou servir a pasta:

```powershell
cd "C:\Users\Aluno\Desktop\Jogo da Velha\Atividade Pintor"
python -m http.server 8000
# abrir http://localhost:8000
```

Funciona em **modo demonstração** (cálculo local + leads em `localStorage`). Roteiro de teste:

1. Clique em `parede lisa` → digite `2` → deve mostrar **R$ 240,00**.
2. Digite nome (ex.: `Maria Silva`) → WhatsApp (ex.: `(11) 99999-8888`).
3. Deve mostrar **✅ Salvo! … Protocolo #1**.
4. Teste os outros: `parede com textura × 3 = R$ 540,00` | `teto × 1 = R$ 100,00`.
5. Teste anti-invenção: digite `porta` no tipo ou `abc` na quantidade → o chat **pergunta de novo**, não chuta.

## Como ligar o banco + IA (Supabase + Groq)

```powershell
# 1) SQL: Dashboard > SQL Editor > colar supabase_orcamento_na_hora.sql > Run
# 2) Secrets + deploy:
supabase secrets set GROQ_API_KEY=gsk_SUA_CHAVE
supabase functions deploy calcular-orcamento
supabase functions deploy salvar-orcamento
supabase functions deploy chatbot-ai
# 3) config.js: preencher supabaseUrl, supabaseAnonKey e as 3 URLs das functions
```

Aí o chat passa a calcular/salvar **no servidor**, e com `edgeChatUrl` preenchida a **IA assume** (modo IA 🤖 no topo).

## Desafios extras (até onde cheguei)

- [ ] Segunda mensagem de outra IA para testar — **não feito** (roteiro pronto acima, é só colar outra mensagem e conferir os 3 valores).
- [x] Taxa de visita R$ 30 — **implementada** (opt-in): `longe: true` soma R$ 30 no `calcular-orcamento`, `salvar-orcamento` e na tool da IA; o chat pergunta "o local é muito longe?" antes de aplicar, nunca assume. Padrão sem taxa = cálculo básico exato.
- [ ] Desconto 10% a partir de 5 cômodos — **não implementado** (opcional).
- [ ] Painel admin — **parcial**: `select * from orcamentos order by criado_em desc;` no SQL Editor já lista os leads; leads demo ficam em `localStorage.orcamentos_demo`.
- [ ] Notificação Discord — **não implementada** (webhook no `salvar-orcamento` após insert).

## Estrutura

```
Atividade Pintor/
├── index.html / styles.css / config.js / chatbot.js
├── supabase_orcamento_na_hora.sql      (tabelas precos + orcamentos)
└── supabase/functions/
    ├── calcular-orcamento/index.ts
    ├── salvar-orcamento/index.ts
    └── chatbot-ai/index.ts             (Groq + tools)
```
