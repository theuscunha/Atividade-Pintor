-- ============================================================
-- ATIVIDADE: O ORÇAMENTO NA HORA — Pintor autônomo
-- Como rodar: Supabase Dashboard > SQL Editor > New query > colar tudo > Run
-- ============================================================
-- VALORES EXATOS informados pelo cliente na mensagem (seção 2.1):
--   parede lisa ......... R$ 120 por cômodo
--   parede com textura ... R$ 180 por cômodo (dá mais trabalho)
--   teto ................ R$ 100 por cômodo
-- Taxa de visita R$ 30 fica PARA DEPOIS (desafio extra, não entra aqui).
-- NÃO inventar nem arredondar números.
-- ============================================================

-- ---------- a) TABELA DE PREÇOS ----------
create table if not exists public.precos (
  id bigint generated always as identity primary key,
  tipo_servico text not null unique,
  preco_por_comodo numeric(10,2) not null,
  observacao text not null default '',
  criado_em timestamptz not null default now()
);

alter table public.precos enable row level security;

drop policy if exists "precos select publico" on public.precos;
create policy "precos select publico"
on public.precos for select
to anon
using (true);

-- Seed com os 3 valores EXATOS do cliente (idempotente via upsert)
insert into public.precos (tipo_servico, preco_por_comodo, observacao) values
  ('parede lisa', 120.00, 'valor informado pelo cliente (exemplo de preenchimento)'),
  ('parede com textura', 180.00, 'dá mais trabalho — valor informado pelo cliente'),
  ('teto', 100.00, 'valor informado pelo cliente')
on conflict (tipo_servico) do update set
  preco_por_comodo = excluded.preco_por_comodo,
  observacao = excluded.observacao;

-- ---------- b) TABELA DE ORÇAMENTOS (LEADS) ----------
-- Guarda nome, telefone, tipo de serviço, quantidade de cômodos e valor calculado.
create table if not exists public.orcamentos (
  id bigint generated always as identity primary key,
  nome text not null,
  telefone text not null,
  tipo_servico text not null,
  quantidade_comodos integer not null check (quantidade_comodos > 0),
  valor_calculado numeric(10,2) not null,
  criado_em timestamptz not null default now()
);

alter table public.orcamentos enable row level security;

drop policy if exists "orcamentos select publico" on public.orcamentos;
drop policy if exists "orcamentos insert publico" on public.orcamentos;

-- Leitura pública: permite ao pintor ver os leads no painel simples
create policy "orcamentos select publico"
on public.orcamentos for select
to anon
using (true);

-- Insert público: o visitante do site salva o orçamento sem login
create policy "orcamentos insert publico"
on public.orcamentos for insert
to anon
with check (true);

-- ---------- Conferência rápida ----------
-- select * from public.precos order by preco_por_comodo;
-- Cálculo esperado: 2 cômodos parede lisa = 2 x 120 = 240
--                   3 cômodos textura    = 3 x 180 = 540
--                   1 cômodo teto        = 1 x 100 = 100
