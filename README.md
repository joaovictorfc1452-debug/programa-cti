# Planta Elétrica BIM

Ambiente online para projetos elétricos residenciais no método BIM. Você desenha a planta uma vez e o programa gera desse mesmo modelo a vista 3D, a previsão de cargas, o quadro de cargas, o diagrama unifilar, a entrada CPFL, o SPDA, a NR-10, a lista de materiais e o relatório técnico.

Normas usadas: ABNT NBR 5410:2004, ABNT NBR 5419:2026, NR-10 e CPFL GED-13 (127/220 V).

## Estrutura do repositório

```
planta-eletrica-bim/
├── index.html              página do programa
├── assets/
│   ├── css/style.css       estilos (tema claro e escuro)
│   ├── js/engine.js        motor de cálculo (normas, circuitos, demanda, SPDA)
│   ├── js/app.js           interface (planta, 3D, abas, relatório, exportação)
│   └── img/favicon.svg     ícone da aba do navegador
├── render.yaml             configuração opcional do Render (Blueprint)
├── .gitignore
└── README.md
```

É um site estático: não tem servidor, banco de dados nem etapa de build. Fontes e a biblioteca 3D (three.js r128) vêm de CDN.

## Testar no seu computador

Abra o `index.html` com dois cliques no Chrome ou no Edge. Para simular o site publicado, rode na pasta do projeto:

```
python -m http.server 8000
```

e acesse `http://localhost:8000`.

## Publicar no GitHub

**Pelo site do GitHub (sem instalar nada):**

1. Em github.com, clique em **New repository**. Nome sugerido: `planta-eletrica-bim`. Deixe **Public** ou **Private** e clique em **Create repository**.
2. Na página do repositório vazio, clique em **uploading an existing file**.
3. Arraste para a janela **o conteúdo** da pasta `planta-eletrica-bim` (o `index.html`, a pasta `assets` e os demais arquivos), não a pasta em si. O `index.html` precisa ficar na raiz do repositório.
4. Clique em **Commit changes**.

**Pelo terminal (Git):**

```
cd planta-eletrica-bim
git init
git add .
git commit -m "Planta Elétrica BIM"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/planta-eletrica-bim.git
git push -u origin main
```

## Publicar no Render

1. Em dashboard.render.com, clique em **New → Static Site**.
2. Conecte sua conta do GitHub e escolha o repositório `planta-eletrica-bim`.
3. Preencha:
   - **Name:** `planta-eletrica-bim` (vira o endereço `planta-eletrica-bim.onrender.com`)
   - **Branch:** `main`
   - **Build Command:** deixe em branco
   - **Publish Directory:** `.` (um ponto)
4. Opcional: em **Environment Variables**, adicione `SKIP_INSTALL_DEPS` = `true`.
5. Clique em **Create Static Site**. Em cerca de um minuto o site está no ar.

Alternativa: **New → Blueprint**, escolha o repositório e o Render lê o `render.yaml`.

A cada novo commit na branch `main`, o Render publica a versão nova sozinho.

## Onde ficam os projetos

Os projetos são salvos no navegador de quem usa o site (armazenamento local). Cada pessoa vê só os próprios projetos, e nada vai para o servidor. Por isso:

- Projetos não passam de um computador para outro sozinhos. Use **Exportar → Projeto BIM (.json)** e depois **Projetos → Importar .json**.
- Limpar os dados do navegador apaga os projetos dele. Exporte o .json ao fim de cada etapa importante.

## Atualizar o programa

Substitua os arquivos alterados no GitHub (**Add file → Upload files**, ou `git add`, `git commit` e `git push`). O Render publica a mudança em seguida. Os projetos salvos nos navegadores continuam lá.

## Limites e responsabilidade técnica

- Ambientes retangulares, um quadro por projeto, sistema 127/220 V.
- Iluminação pela carga mínima da NBR 5410, sem cálculo luminotécnico.
- Não calcula corrente de curto-circuito.
- O SPDA é uma pré-avaliação do risco R1; a análise formal segue a NBR 5419-2:2026.
- Os disjuntores da Tabela 1A foram conferidos na GED-13 v2.24; confirme na revisão vigente antes do pedido de ligação.

O programa é uma ferramenta de apoio. O projeto final precisa da revisão e da ART de um profissional habilitado.
