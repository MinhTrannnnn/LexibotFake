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
    const taskType = safeText(body.taskType || "IELTS Writing Task 2", 80);
    const aiLanguage = safeText(body.aiLanguage || "Vietnamese - Tiếng Việt", 80);
    const prompt = safeText(body.prompt || "", 3000);
    const rawEssay = safeText(body.essay || "", 12000);
    const normalizedEssay = normalizeEssayInput(rawEssay);
    const essay = normalizedEssay.essay;
    const options = {
      aiReasoning: Boolean(body.aiReasoning),
      improveWordChoice: Boolean(body.improveWordChoice),
      detailedFeedback: Boolean(body.detailedFeedback),
      sampleEssays: Boolean(body.sampleEssays)
    };

    if (essay.trim().split(/\s+/).filter(Boolean).length < 40) {
      sendJson(res, 400, {
        error: "Bài viết quá ngắn. Hãy nhập ít nhất khoảng 40 từ để chấm chính xác hơn."
      });
      return;
    }

    const result = await gradeWriting({
      apiKey,
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      taskType,
      aiLanguage,
      prompt,
      essay,
      inputNote: normalizedEssay.note,
      options
    });

    sendJson(res, 200, {
      ...result,
      requestId: createRequestId(),
      essayHash: hashText(essay)
    });
  } catch (error) {
    const message = error && error.message ? error.message : "Unexpected error";
    const status = message.includes("OpenAI") ? 502 : 500;
    sendJson(res, status, { error: message });
  }
};

async function gradeWriting({ apiKey, model, taskType, aiLanguage, prompt, essay, inputNote, options }) {
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
          content: buildSystemPrompt(aiLanguage)
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              taskType,
              prompt,
              inputNote,
              essay,
              essayHash: hashText(essay),
              requestedOptions: options
            },
            null,
            2
          )
        }
      ],
      temperature: 0.2,
      text: {
        format: {
          type: "json_schema",
          name: "ielts_writing_assessment",
          strict: true,
          schema: assessmentSchema()
        }
      },
      max_output_tokens: 5000
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error && payload.error.message ? payload.error.message : response.statusText;
    throw new Error(`OpenAI request failed: ${detail}`);
  }

  const text = extractOutputText(payload);
  if (!text) throw new Error("OpenAI did not return a readable assessment.");

  const parsed = parseJson(text);
  return normalizeAssessment(parsed);
}

function buildSystemPrompt(aiLanguage) {
  return [
    "You are a strict but helpful certified IELTS Writing examiner.",
    "Assess only writing. Do not evaluate speaking, listening, or reading.",
    "Grade the exact essay text from the user payload for this request. Never reuse or infer from any previous essay.",
    "Be sensitive to real quality differences: frequent grammar, word form, collocation, agreement, awkward phrasing, or copied correction markup must reduce LR and GRA.",
    "If the essay contains correction markup such as wrongright joined together, duplicated alternatives, labels, or non-essay notes, treat those as submitted text unless the inputNote says a cleaned corrected section was extracted.",
    "Use IELTS public band descriptors for Task Response/Task Achievement, Coherence and Cohesion, Lexical Resource, and Grammatical Range and Accuracy.",
    "For each of the four IELTS criteria, give criterion-specific feedback instead of generic advice. Mention concrete evidence from this essay and explain why that evidence affects the band.",
    "Break each criterion into its most relevant subcriteria and mark which subcriteria are strongest or weakest. Examples: position, idea development, prompt coverage, paragraphing, logical progression, referencing, vocabulary range, collocation, word form, sentence variety, agreement, tense, punctuation, and error density.",
    "Identify the single weakest IELTS criterion, then list the 2-4 weakest subcriteria inside it. The weakest criterion must be based on the score and the evidence, not on a generic preference.",
    "Return practical feedback in the requested feedback language: " + aiLanguage + ".",
    "Keep scores realistic. Use half-band increments from 0 to 9.",
    "For Task 1, label the first criterion as Task Achievement (TA). For Task 2, label it as Task Response (TR).",
    "If the prompt is missing, still assess the essay, but include a warning that task response accuracy is less certain.",
    "Return inline corrections for the most important grammar, lexical, spelling, collocation, and cohesion issues. Each correction must quote a short exact substring from the essay in original and a concise replacement in suggestion.",
    "Prefer corrections that can be found directly in the essay text. Do not invent corrections for text that is not present.",
    "Do not mention that you are an AI model. Do not include markdown."
  ].join("\n");
}

function assessmentSchema() {
  const criterion = {
    type: "object",
    additionalProperties: false,
    required: ["score", "title", "summary", "subcriteria", "strengths", "improvements"],
    properties: {
      score: { type: "number", minimum: 0, maximum: 9 },
      title: { type: "string" },
      summary: { type: "string" },
      subcriteria: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "status", "evidence", "impact"],
          properties: {
            name: { type: "string" },
            status: { type: "string", enum: ["strong", "mixed", "weak"] },
            evidence: { type: "string" },
            impact: { type: "string" }
          }
        },
        minItems: 3,
        maxItems: 5
      },
      strengths: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
      improvements: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 }
    }
  };

  const criterionLabel = { type: "string", enum: ["TR", "TA", "CC", "LR", "GRA"] };

  return {
    type: "object",
    additionalProperties: false,
    required: [
      "overallBand",
      "confidence",
      "wordCount",
      "estimatedLevel",
      "warnings",
      "diagnostics",
      "criteria",
      "criterionAnalysis",
      "corrections",
      "priorityFixes",
      "detailedFeedback",
      "wordChoice",
      "improvedEssay",
      "sampleEssay"
    ],
    properties: {
      overallBand: { type: "number", minimum: 0, maximum: 9 },
      confidence: { type: "string" },
      wordCount: { type: "integer", minimum: 0 },
      estimatedLevel: { type: "string" },
      warnings: { type: "array", items: { type: "string" }, maxItems: 4 },
      diagnostics: {
        type: "object",
        additionalProperties: false,
        required: ["grammarIssueCount", "lexicalIssueCount", "cohesionIssueCount", "taskIssueCount"],
        properties: {
          grammarIssueCount: { type: "integer", minimum: 0 },
          lexicalIssueCount: { type: "integer", minimum: 0 },
          cohesionIssueCount: { type: "integer", minimum: 0 },
          taskIssueCount: { type: "integer", minimum: 0 }
        }
      },
      criteria: {
        type: "object",
        additionalProperties: false,
        required: ["TR", "CC", "LR", "GRA"],
        properties: {
          TR: criterion,
          CC: criterion,
          LR: criterion,
          GRA: criterion
        }
      },
      criterionAnalysis: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "weakestCriterion", "weakestSubcriteria", "ranking"],
        properties: {
          summary: { type: "string" },
          weakestCriterion: criterionLabel,
          weakestSubcriteria: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["criterion", "name", "evidence", "whyItHurts", "fix"],
              properties: {
                criterion: criterionLabel,
                name: { type: "string" },
                evidence: { type: "string" },
                whyItHurts: { type: "string" },
                fix: { type: "string" }
              }
            },
            minItems: 2,
            maxItems: 4
          },
          ranking: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["criterion", "score", "reason"],
              properties: {
                criterion: criterionLabel,
                score: { type: "number", minimum: 0, maximum: 9 },
                reason: { type: "string" }
              }
            },
            minItems: 4,
            maxItems: 4
          }
        }
      },
      corrections: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["original", "suggestion", "type", "reason"],
          properties: {
            original: { type: "string" },
            suggestion: { type: "string" },
            type: {
              type: "string",
              enum: ["grammar", "lexis", "cohesion", "task", "spelling", "punctuation"]
            },
            reason: { type: "string" }
          }
        },
        maxItems: 16
      },
      priorityFixes: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 6 },
      detailedFeedback: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["issue", "whyItMatters", "howToFix"],
          properties: {
            issue: { type: "string" },
            whyItMatters: { type: "string" },
            howToFix: { type: "string" }
          }
        },
        minItems: 3,
        maxItems: 8
      },
      wordChoice: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["original", "suggestion", "reason"],
          properties: {
            original: { type: "string" },
            suggestion: { type: "string" },
            reason: { type: "string" }
          }
        },
        maxItems: 8
      },
      improvedEssay: { type: "string" },
      sampleEssay: { type: "string" }
    }
  };
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

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Assessment was not valid JSON.");
    return JSON.parse(match[0]);
  }
}

function normalizeAssessment(assessment) {
  const keys = ["TR", "CC", "LR", "GRA"];
  for (const key of keys) {
    assessment.criteria[key].score = roundBand(assessment.criteria[key].score);
  }

  const average =
    keys.reduce((sum, key) => sum + Number(assessment.criteria[key].score || 0), 0) / keys.length;
  assessment.overallBand = roundBand(assessment.overallBand || average);
  assessment.confidence = assessment.confidence || "+/- 0.5";
  assessment.criterionAnalysis = normalizeCriterionAnalysis(assessment);
  assessment.corrections = normalizeCorrections(assessment.corrections);
  assessment.generatedAt = new Date().toISOString();
  return assessment;
}

function normalizeCriterionAnalysis(assessment) {
  const criteria = assessment.criteria || {};
  const keys = ["TR", "CC", "LR", "GRA"];
  const ranking = keys
    .map(key => ({
      criterion: key,
      score: roundBand(criteria[key] && criteria[key].score),
      reason: safeText(criteria[key] && criteria[key].summary, 260).trim()
    }))
    .sort((a, b) => a.score - b.score);

  const existing = assessment.criterionAnalysis || {};
  const weakestCriterion = safeCriterion(existing.weakestCriterion) || (ranking[0] && ranking[0].criterion) || "TR";
  const weakestSubcriteria = Array.isArray(existing.weakestSubcriteria)
    ? existing.weakestSubcriteria
        .map(item => ({
          criterion: safeCriterion(item && item.criterion) || weakestCriterion,
          name: safeText(item && item.name, 120).trim(),
          evidence: safeText(item && item.evidence, 320).trim(),
          whyItHurts: safeText(item && item.whyItHurts, 420).trim(),
          fix: safeText(item && item.fix, 420).trim()
        }))
        .filter(item => item.name && item.whyItHurts)
        .slice(0, 4)
    : [];

  return {
    summary: safeText(existing.summary, 600).trim() || "The lowest criterion needs the most urgent work.",
    weakestCriterion,
    weakestSubcriteria,
    ranking: Array.isArray(existing.ranking) && existing.ranking.length === 4
      ? existing.ranking.map(item => ({
          criterion: safeCriterion(item && item.criterion) || "TR",
          score: roundBand(item && item.score),
          reason: safeText(item && item.reason, 260).trim()
        }))
      : ranking
  };
}

function safeCriterion(value) {
  const key = String(value || "").trim().toUpperCase();
  return ["TR", "TA", "CC", "LR", "GRA"].includes(key) ? key : "";
}

function normalizeCorrections(corrections) {
  if (!Array.isArray(corrections)) return [];
  return corrections
    .map(item => ({
      original: safeText(item && item.original, 180).trim(),
      suggestion: safeText(item && item.suggestion, 180).trim(),
      type: safeText(item && item.type, 24).trim() || "grammar",
      reason: safeText(item && item.reason, 500).trim()
    }))
    .filter(item => item.original && item.suggestion && item.original !== item.suggestion)
    .slice(0, 16);
}

function normalizeEssayInput(rawEssay) {
  const text = String(rawEssay || "").trim();
  const correctedMatch = text.match(/(?:^|\n)\s*Correcting paragraph:\s*\n([\s\S]+)$/i);
  if (!correctedMatch) {
    return { essay: text, note: "The submitted text is a normal essay." };
  }

  return {
    essay: correctedMatch[1].trim(),
    note: "The user pasted both an original paragraph and a correcting paragraph. Only the correcting paragraph was extracted and assessed."
  };
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function createRequestId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function roundBand(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(9, Math.round(number * 2) / 2));
}

function safeText(value, maxLength) {
  return String(value || "").slice(0, maxLength);
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
