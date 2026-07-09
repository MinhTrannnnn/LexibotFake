const OPENAI_BASE_URL = "https://api.openai.com/v1";

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, {
      error: "Missing OPENAI_API_KEY. Add it in .env locally or Vercel Environment Variables."
    });
    return;
  }

  try {
    const body = await readJson(req);
    const correction = body.correction || {};
    const original = safeText(correction.original, 220).trim();
    const suggestion = safeText(correction.suggestion, 220).trim();
    const reason = safeText(correction.reason, 900).trim();

    if (!original || !suggestion) {
      sendJson(res, 400, { error: "Missing correction original or suggestion." });
      return;
    }

    const explanation = await explainCorrection({
      apiKey,
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      aiLanguage: "Vietnamese - Tiếng Việt",
      prompt: safeText(body.prompt || "", 2500),
      essay: safeText(body.essay || "", 12000),
      correction: {
        original,
        suggestion,
        type: safeText(correction.type || "grammar", 40),
        reason
      }
    });

    sendJson(res, 200, { explanation });
  } catch (error) {
    const message = error && error.message ? error.message : "Unexpected error";
    const status = message.includes("OpenAI") ? 502 : 500;
    sendJson(res, status, { error: message });
  }
};

async function explainCorrection({ apiKey, model, aiLanguage, prompt, essay, correction }) {
  const baseUrl = (process.env.OPENAI_BASE_URL || OPENAI_BASE_URL).replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [
            "You are a concise IELTS Writing tutor.",
            "Explain only the requested correction in Vietnamese.",
            "Be specific, practical, and student-friendly.",
            "Do not use markdown. Do not mention that you are an AI model."
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              feedbackLanguage: aiLanguage,
              taskPrompt: prompt,
              essay,
              correction,
              instruction:
                "Explain why the original is wrong or weak, why the suggestion is better, and give one short reusable rule. Keep it under 120 words."
            },
            null,
            2
          )
        }
      ],
      temperature: 0.2,
      max_output_tokens: 500
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error && payload.error.message ? payload.error.message : response.statusText;
    throw new Error(`OpenAI request failed: ${detail}`);
  }

  const text = extractOutputText(payload);
  if (!text) throw new Error("OpenAI did not return a readable explanation.");
  return safeText(text, 1200).trim();
}

function extractOutputText(payload) {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) return "";

  const chunks = [];
  for (const item of payload.output) {
    if (!Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") return Promise.resolve(JSON.parse(req.body || "{}"));

  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 20000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function safeText(value, maxLength) {
  return String(value || "").slice(0, maxLength);
}
