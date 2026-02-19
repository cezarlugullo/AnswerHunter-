<div align="center">

<img src="icons/icon128.png" alt="AnswerHunter Logo" width="96" />

# AnswerHunter

**AI-powered Chrome extension that finds and explains answers to multiple-choice questions on educational platforms.**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Languages](https://img.shields.io/badge/Languages-PT--BR%20%7C%20EN-orange)](src/i18n/translations.js)

🇧🇷 [Leia em Português](README.pt-BR.md)

</div>

---

## What is AnswerHunter?

AnswerHunter is a Chrome extension that helps you understand multiple-choice questions on educational platforms like **Estácio SIA/AVA**. It:

- 🔍 **Extracts** the question and all alternatives directly from the page
- 🌐 **Searches Google** for relevant academic content
- 🤖 **Uses AI** to analyze sources and identify the most likely correct answer
- 📖 **Explains** the reasoning step by step

> AnswerHunter is a **learning aid** — it helps you understand *why* an answer is correct, not just what the answer is.

---

## Features

| Feature | Description |
|---|---|
| **Smart Extraction** | Captures questions from complex DOM structures including iframes |
| **Web Search** | Searches Google via Serper API for academic evidence |
| **AI Analysis** | Uses Groq/Gemini LLMs to evaluate each alternative |
| **Step-by-step reasoning** | Shows full analysis in a collapsible section |
| **Answer Override** | Manually correct the answer if needed |
| **Study Binder** | Save questions and answers for later review |
| **Bilingual** | Full support for Portuguese (pt-BR) and English |

---

## Requirements

You need free API keys from:

| Service | Purpose | Required? | Free tier |
|---|---|---|---|
| [Groq](https://console.groq.com) | AI inference (LLM) | ✅ Yes | 14,400 requests/day |
| [Serper](https://serper.dev) | Google Search API | Optional | 2,500 searches/month |
| [Google AI Studio](https://aistudio.google.com) | Gemini AI (backup) | Optional | Generous free tier |

---

## Installation

### Step 1 — Download the extension

Click **Code → Download ZIP** on this page and extract it to a **permanent folder** on your computer.

> ⚠️ Do not delete the folder after installing — Chrome loads the extension from it.

---

### Step 2 — Open Chrome Extensions

Open a new tab and type in the address bar:

```
chrome://extensions
```

Enable **Developer mode** using the toggle in the top-right corner.

```
┌─────────────────────────────────────────────────┐
│  Extensions                    Developer mode ●  │
│                                                  │
│  [ Load unpacked ]  [ Pack extension ]  [ ↺ ]   │
└─────────────────────────────────────────────────┘
```

---

### Step 3 — Load the extension

Click **"Load unpacked"** and select the folder where you extracted the ZIP.

The AnswerHunter icon ( 🔍 ) will appear in your Chrome toolbar. Click the puzzle piece icon and pin it for easy access.

---

### Step 4 — Get your free Groq API key

1. Go to **[console.groq.com](https://console.groq.com)** and create a free account
2. In the left menu, click **"API Keys"**
3. Click **"Create API Key"**, give it a name (e.g. `AnswerHunter`)
4. **Copy the key** — it looks like `gsk_xxxxxxxxxxxxxxxxxxxx`

> 💡 The Groq free plan gives you 14,400 AI requests per day — more than enough for daily use.

---

### Step 5 — Configure the extension

1. Click the AnswerHunter icon in the Chrome toolbar
2. The **setup wizard** opens automatically on first use
3. Paste your Groq key into the field
4. Click **"Test Connection"** — you should see ✅ Connection OK
5. Click **"Next"** then **"Save & Start"**

```
┌──────────────────────────────────────────┐
│  🔑  Configure Groq API                  │
│                                          │
│  API Key: [ gsk_xxxx...          ] 👁    │
│                                          │
│  [ ✓ Test Connection ]                   │
│  ✅ Connection OK!                        │
│                                          │
│            [ Next → ]                    │
└──────────────────────────────────────────┘
```

---

### Step 6 — (Optional) Add Serper for Google Search

With a Serper key the extension searches Google for academic evidence, significantly improving answer accuracy.

1. Go to **[serper.dev](https://serper.dev)** and create a free account
2. Copy your API key from the dashboard
3. Open the extension, click the **⚙️ settings icon**, and paste the key in the Serper field

> The free Serper plan includes 2,500 Google searches per month.

---

## How to Use

1. **Go to a question page** on your educational platform (e.g. Estácio SIA)
2. **Click** the AnswerHunter icon in the toolbar
3. Choose an action:

```
┌─────────────────────────────────────────┐
│  [ 🔍 Search ]    [ 📄 Extract ]        │
│                                         │
│  Search = Google + AI  (most accurate)  │
│  Extract = AI only     (faster)         │
└─────────────────────────────────────────┘
```

4. The result card appears with:
   - ✅ The **suggested answer letter** (e.g. **E**)
   - 📝 The **answer text**
   - 🎯 A **confidence score** (0–100%)
   - 🧠 A collapsible **"View AI reasoning"** section

---

## Supported Platforms

Primarily tested on:
- **Estácio SIA** (Virtual Learning Environment)
- **Estácio AVA**

May also work on other LMS platforms with standard HTML structure.

---

## Privacy & Security

- ✅ **No data is stored on external servers** — all processing uses your own API keys
- ✅ **Your keys are stored locally** in Chrome's encrypted storage
- ✅ **No tracking, no analytics, no accounts**
- ✅ **Fully open source** — every line of code is readable here

---

## Contributing

Pull requests are welcome! Please open an issue first to discuss what you'd like to change.

---

## License

MIT © AnswerHunter Contributors
