mkdir model-parliament && cd model-parliament
npm init -y
npm install express cors axios dotenv
npm install -D nodemon
mkdir client  # React app will live here laterPORT=4000
OPENAI_KEY=sk-xxxxxxxx
GEMINI_KEY=xxxxxxxx
AZURE_OPENAI_ENDPOINT=https://xxxx.openai.azure.com
AZURE_OPENAI_KEY=xxxxxxxx
PERPLEXITY_KEY=pplx-xxxxxxxx
KIMI_KEY=xxxxxxxx   # get from https://kimi.moonshot.cn (session token)import express from 'express';
import cors from 'cors';
import axios from 'axios';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

const timeout = 18_000; // 18 s – Perplexity can be slow

/* ---------- helpers ---------- */
const openaiAsk = (q) =>
  axios.post('https://api.openai.com/v1/chat/completions',
    { model: 'gpt-4-turbo', messages: [{ role: 'user', content: q }], temperature: 0.7 },
    { headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}` }, timeout }
  ).then(r => r.data.choices[0].message.content);

const geminiAsk = async (q) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${process.env.GEMINI_KEY}`;
  const body = { contents: [{ parts: [{ text: q }] }] };
  const res = await axios.post(url, body, { timeout });
  return res.data.candidates[0].content.parts[0].text;
};

const copilotAsk = async (q) => {
  // Azure OpenAI is the easiest stable route for “Copilot”
  const url = `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/gpt-4/chat/completions?api-version=2024-02-15-preview`;
  const body = { messages: [{ role: 'user', content: q }], temperature: 0.7 };
  const res = await axios.post(url, body, { headers: { 'api-key': process.env.AZURE_OPENAI_KEY }, timeout });
  return res.data.choices[0].message.content;
};

const perplexityAsk = (q) =>
  axios.post('https://api.perplexity.ai/chat/completions',
    { model: 'pplx-70b-online', messages: [{ role: 'user', content: q }], temperature: 0.7 },
    { headers: { Authorization: `Bearer ${process.env.PERPLEXITY_KEY}` }, timeout }
  ).then(r => r.data.choices[0].message.content);

// Kimi reverse-engineered endpoint (may break; use at own risk)
const kimiAsk = async (q) => {
  const res = await axios.post('https://kimi.moonshot.cn/api/chat/cmp',
    { messages: [{ role: 'user', content: q }], model: 'moonshot-v1-8k' },
    { headers: { Authorization: `Bearer ${process.env.KIMI_KEY}` }, timeout }
  );
  return res.data.choices[0].message.content;
};

/* ---------- parliament route ---------- */
app.post('/parliament', async (req, res) => {
  const question = req.body.question;
  if (!question) return res.status(400).json({ error: 'missing question' });

  const jobs = [
    { name: 'ChatGPT',  fn: () => openaiAsk(question)   },
    { name: 'Gemini',   fn: () => geminiAsk(question)   },
    { name: 'Copilot',  fn: () => copilotAsk(question)  },
    { name: 'Perplexity', fn: () => perplexityAsk(question) },
    { name: 'Kimi',     fn: () => kimiAsk(question)     }
  ];

  const raw = await Promise.allSettled(jobs.map(j => j.fn()));
  const answers = jobs.map((j, i) => ({
    model: j.name,
    answer: raw[i].status === 'fulfilled' ? raw[i].value : `Error: ${raw[i].reason.message}`
  }));

  // quick consensus: feed all answers back into GPT-4 as judge
  const judgePrompt = `
You are a neutral scientific referee.  
Five AI models gave separate answers to the question:
"${question}"

Answers:
${answers.map(a => `\n${a.model}: ${a.answer}`).join('\n')}

Produce a concise 3-paragraph final answer that:
1. Highlights the strongest points each model made.
2. Points out any contradictions.
3. Gives the user the most reliable takeaway.
`;
  let consensus;
  try {
    consensus = await openaiAsk(judgePrompt);
  } catch (e) {
    consensus = 'Consensus engine failed – see individual answers below.';
  }

  res.json({ question, answers, consensus });
});

app.listen(process.env.PORT, () => console.log(`Parliament on :${process.env.PORT}`));npx nodemon server.jscurl -X POST localhost:4000/parliament \
  -H "Content-Type: application/json" \
  -d '{"question":"Is quantum tunnelling the same as quantum teleportation?"}'import { useState } from 'react';
import axios from 'axios';

function App() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    setLoading(true);
    const { data } = await axios.post('http://localhost:4000/parliament', { question: q });
    setRes(data);
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 800, margin: 'auto', padding: 32 }}>
      <h1>Model Parliament</h1>
      <textarea value={q} onChange={e => setQ(e.target.value)} rows={3} style={{ width: '100%' }} />
      <button onClick={ask} disabled={loading}>{loading ? 'Thinking…' : 'Ask all 5 →'}</button>

      {res && (
        <>
          <h2>Consensus</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{res.consensus}</p>
          <h2>Individual answers</h2>
          {res.answers.map(a => (
            <details key={a.model}>
              <summary>{a.model}</summary>
              <p style={{ whiteSpace: 'pre-wrap' }}>{a.answer}</p>
            </details>
          ))}
        </>
      )}
    </div>
  );
}
export default App;
