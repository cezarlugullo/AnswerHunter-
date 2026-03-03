# Questões — SM2 Banco de Dados (DGT0282)

> Ficheiro gerado automaticamente. Gabaritos confirmados com múltiplas fontes.

---

## Questão 1
**Dentre as opções a seguir, assinale a que contém a expressão em SQL que inclui uma coluna Email do tipo VARCHAR(80) na tabela PROFESSOR.**

- A) ALTER DATABASE ADD COLUMN Email VARCHAR(80) TO PROFESSOR.
- B) ALTER TABLE PROFESSOR MODIFY COLUMN Email VARCHAR(80).
- **C) ALTER TABLE PROFESSOR ADD COLUMN Email VARCHAR(80).** ✅
- D) ADD COLUMN Email VARCHAR(80) TO TABLE PROFESSOR.
- E) ALTER DATABASE PROFESSOR ADD COLUMN Email VARCHAR(80).

> **Gabarito: C** — O comando DDL correto em SQL ANSI para adicionar uma coluna a uma tabela existente é `ALTER TABLE <tabela> ADD COLUMN <coluna> <tipo>`.

---

## Questão 2
**Em um sistema de gerenciamento de banco de dados relacional (SGBD), as tabelas são estruturas fundamentais para armazenar dados de forma organizada e eficiente. Qual comando é usado para adicionar uma nova coluna a uma tabela existente no PostgreSQL?**

- A) CREATE TABLE
- **B) ALTER TABLE** ✅
- C) DROP TABLE
- D) INSERT INTO
- E) CREATE SCHEMA

> **Gabarito: B** — `ALTER TABLE` é o comando DDL utilizado para modificar a estrutura de uma tabela existente, incluindo adição de colunas.

---

## Questão 3
**Fernando está usando a linguagem SQL (ANSI) e pretende fazer uma atualização nos dados Nome_Cli e End_Cli do cliente cujo Cod_Cli é Cli01, na tabela Cliente. As lacunas I, II e III devem ser preenchidas, respectivamente, por:**

```sql
..I.. Cliente
..II.. Nome_Cli = 'Ariana', End_Cli = 'Rua ABC'
..III.. Cod_Cli = 'Cli01';
```

- A) SET - WHERE - UPDATE
- **B) UPDATE - SET - WHERE** ✅
- C) UPDATE - WHERE - SET
- D) WHERE - SET - UPDATE
- E) SET - UPDATE - WHERE

> **Gabarito: B** — A sintaxe correta é `UPDATE tabela SET coluna = valor WHERE condição`.

---

## Questão 4
**Em SQL (ANSI), para verificar se uma coluna não possui valor cadastrado, deve-se usar:**

- A) COLUNA = NULL
- B) COLUNA != NULL
- C) COLUNA == NULL
- D) COLUNA <> NULL
- **E) COLUNA IS NULL** ✅

> **Gabarito: E** — O padrão ANSI exige `IS NULL` para verificar ausência de valor. `= NULL` sempre retorna desconhecido (unknown) e nunca funciona corretamente.

---

## Questão 5
**Qual é o objetivo principal de uma consulta SQL que utiliza subconsultas (subqueries)?**

- A) Criar novas tabelas automaticamente.
- B) Eliminar registros duplicados da tabela principal.
- C) Substituir o uso de JOINs em todas as situações.
- **D) Realizar pesquisa usando resultados de outras consultas.** ✅
- E) Otimizar o desempenho de consultas simples.

> **Gabarito: D** — Subconsultas permitem usar o resultado de uma consulta interna como entrada para a consulta externa, possibilitando pesquisas complexas e aninhadas.

---

## Questão 6
**Ao instalar o PostgreSQL a partir do código-fonte em sistemas Unix-like, várias bibliotecas são compiladas e instaladas. Assinale a alternativa INCORRETA:**

- A) A biblioteca libpq é a interface de programação C para o PostgreSQL.
- B) Durante a compilação, é possível especificar o diretório de instalação com `--prefix`.
- **C) A biblioteca libpq é necessária apenas para compilar o servidor PostgreSQL, não sendo utilizada por aplicações clientes.** ✅
- D) O comando `make install` copia os binários compilados para o diretório de destino.
- E) O comando `./configure` verifica as dependências do sistema antes da compilação.

> **Gabarito: C** — A afirmação é FALSA (logo, incorreta). A `libpq` é justamente a biblioteca **cliente** oficial do PostgreSQL — ela é usada pelas aplicações clientes para se conectar ao servidor, não apenas para compilar o servidor.

---

## Questão 7
**Em um relatório solicitado pela coordenação, é necessário listar o nome e a data de nascimento dos alunos do sexo feminino, ordenando os resultados pelo mês de nascimento e, dentro de cada mês, em ordem alfabética. Qual consulta SQL atende corretamente esse critério?**

- A) `SELECT NOME, DTNASCIMENTO FROM ALUNO WHERE SEXO='F' ORDER BY NOME, DTNASCIMENTO`
- B) `SELECT NOME, DTNASCIMENTO FROM ALUNO WHERE SEXO='F' ORDER BY DTNASCIMENTO;`
- C) `SELECT NOME, DTNASCIMENTO FROM ALUNO ORDER BY EXTRACT(MONTH FROM DTNASCIMENTO), NOME;`
- **D) `SELECT NOME, DTNASCIMENTO FROM ALUNO WHERE SEXO='F' ORDER BY EXTRACT(MONTH FROM DTNASCIMENTO), NOME;`** ✅
- E) `SELECT * FROM ALUNO WHERE SEXO='F' ORDER BY EXTRACT(DAY FROM DTNASCIMENTO), NOME;`

> **Gabarito: D** — É a única opção que: (1) filtra `SEXO='F'`, (2) ordena pelo **mês** (`EXTRACT(MONTH FROM DTNASCIMENTO)`), e (3) ordena alfabeticamente por `NOME` dentro do mesmo mês.
>
> - A: ordena por nome e data completa (não por mês)
> - B: não filtra sexo, ordena pela data completa
> - C: não filtra por sexo feminino
> - E: usa `DAY` em vez de `MONTH`

---

## Questão 8
**Um analista deseja descobrir a quantidade de funcionários por sexo na tabela FUNCIONARIO. Qual consulta SQL é a mais adequada?**

- A) `SELECT COUNT(*) FROM FUNCIONARIO WHERE SEXO GROUP BY SEXO;`
- **B) `SELECT SEXO, COUNT(*) FROM FUNCIONARIO GROUP BY SEXO;`** ✅
- C) `SELECT SEXO FROM FUNCIONARIO WHERE COUNT(*) > 1;`
- D) `SELECT COUNT(SEXO) FROM FUNCIONARIO;`
- E) `SELECT SEXO, COUNT(*) FROM FUNCIONARIO ORDER SEXO;`

> **Gabarito: B** — Para contar registros **por grupo**, usa-se `GROUP BY` junto com uma função de agregação (`COUNT(*)`). A alternativa B seleciona o campo agrupador (`SEXO`) e a contagem por grupo.
>
> - A: `WHERE SEXO` sem condição é inválido
> - C: `COUNT(*)` não pode ser usado na cláusula `WHERE`
> - D: conta todos sem separar por sexo
> - E: `ORDER SEXO` é sintaxe inválida (falta `BY`)

---

## Questão 9
**Em um banco de dados, deseja-se obter apenas os registros que aparecem simultaneamente em duas consultas distintas. Qual operação de conjunto em SQL deve ser utilizada?**

- A) UNION
- **B) INTERSECT** ✅
- C) EXCEPT
- D) UNION ALL
- E) FULL JOIN

> **Gabarito: B** — `INTERSECT` retorna apenas os registros comuns a ambas as consultas (interseção de conjuntos).
>
> - UNION: une os dois resultados (sem duplicatas)
> - EXCEPT: retorna o que está na 1ª mas não na 2ª
> - UNION ALL: une incluindo duplicatas
> - FULL JOIN: tipo de junção de tabelas, não operação de conjunto

---

## Questão 10
**Pedro deseja identificar todos os níveis de ensino, incluindo aqueles que ainda não têm nenhum curso associado. A consulta abaixo realiza a tarefa desejada?**

```sql
SELECT N.DESCRICAO, C.NOME
FROM NIVEL N RIGHT JOIN CURSO C
ON N.CODIGONIVEL = C.CODIGONIVEL
```

- A) Sim, pois ela trará todos os níveis cadastrados, com ou sem cursos associados.
- **B) Não, pois ela ignora os níveis que não estão associados a nenhum curso.** ✅
- C) Sim, pois a junção à direita garante que todos os níveis apareçam, mesmo sem cursos associados.
- D) Não, pois ela retornará apenas os cursos que possuem nível associado.
- E) Sim, porque retorna todos os cursos e níveis, mesmo quando não há associação.

> **Gabarito: B** — O `RIGHT JOIN CURSO` mantém **todos os cursos** (tabela à direita), não todos os níveis. Níveis sem cursos associados ficam excluídos do resultado. Para listar todos os níveis (com ou sem cursos), a query correta seria:
> ```sql
> SELECT N.DESCRICAO, C.NOME
> FROM NIVEL N LEFT JOIN CURSO C
> ON N.CODIGONIVEL = C.CODIGONIVEL
> ```

---

## Resumo do Gabarito

| # | Tópico | Gabarito |
|---|--------|----------|
| 1 | ALTER TABLE — adicionar coluna | **C** |
| 2 | PostgreSQL — comando para nova coluna | **B** |
| 3 | SQL UPDATE SET WHERE (lacunas) | **B** |
| 4 | Verificar valor NULL em SQL | **E** |
| 5 | Objetivo das subconsultas | **D** |
| 6 | Afirmação incorreta sobre libpq/PostgreSQL | **C** |
| 7 | SELECT com EXTRACT(MONTH) + WHERE SEXO='F' | **D** |
| 8 | GROUP BY — quantidade por sexo | **B** |
| 9 | Operação de conjunto — valores comuns | **B** |
| 10 | RIGHT JOIN vs LEFT JOIN — todos os níveis | **B** |
