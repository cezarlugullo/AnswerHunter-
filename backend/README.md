# AnswerHunter Backend (Optional)

Optional resolver service for stronger extraction from external sources.

## What it does

- Receives question/options on `POST /resolve`
- Runs multi-query search on Serper
- Fetches and parses source HTML server-side
- Extracts evidence (`gabarito`, `resposta correta`, etc.)
- Computes consensus + confidence
- Uses Groq only as fallback when explicit evidence is weak
- Caches by canonical question hash

## Setup

```bash
cd backend
npm install
cp .env.example .env
```

Set at minimum:

- `SERPER_API_KEY`

Optional:

- `GROQ_API_KEY` (fallback inference)

Run:

```bash
npm start
```

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Resolve example:

```bash
curl -X POST http://127.0.0.1:8787/resolve ^
  -H "Content-Type: application/json" ^
  -d "{\"question_text\":\"Assinale a alternativa correta: a) ... b) ... c) ...\"}"
```

## Enable in extension

Set `backendApiUrl` in extension settings storage:

```js
chrome.storage.sync.get(['settings'], (r) => {
  chrome.storage.sync.set({
    settings: {
      ...(r.settings || {}),
      backendApiUrl: 'http://127.0.0.1:8787'
    }
  });
});
```
