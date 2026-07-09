const form = document.querySelector("#checkerForm");
const essayInput = document.querySelector("#essay");
const promptInput = document.querySelector("#prompt");
const wordCount = document.querySelector("#wordCount");
const scoreButton = document.querySelector("#scoreButton");
const statusMessage = document.querySelector("#statusMessage");
const timerButton = document.querySelector("#timerButton");
const timerLabel = document.querySelector("#timerLabel");
const acceptButton = document.querySelector("#acceptButton");
const rejectButton = document.querySelector("#rejectButton");
const correctionPreview = document.querySelector("#correctionPreview");
const essayShell = document.querySelector(".essay-shell");

const demoPrompt = `One of the consequences of improved medical care is that people are living longer and life expectancy is increasing.

Do you think the advantages of this development outweigh the disadvantages?`;

const demoEssay = `Thanks to improvements in healthcare, people are now living significantly longer than the past. While this trend has certain drawbacks, I believe its advantages far outweight the disadvantages.

On the one hand, the longer life expectancy brings numerous benefits to both individuals and society. Firstly, old workforce are the one that hold important knowledge of their domain. Their contribution can still be essential especially when giving advice and passing down their experience on the young generation. As a result, business can save time as well as reduce cost of mistakes made by inexperienced staff. Secondly, older parents still play a vital role in family. Their descendants can see them as their motivation as well as their child instructor. They can not only support them when they are having pressure, but they can also become an alternate parent to teach and supervise their grandchildren when they are busy. Thus, this reduce the pressure parents have to endure after a long stressful working period.

On the other hand, the old generation may creates some challenges to the economy. First of all, the increasement of older population can leads to labour shortage which can cause negative affects on the development of the nation's economic system. Consequently, many businesses may struggle to fill vacant position leading to lower productivity and economic growth. In some case, many elderly requires a long-term care due to age related health problems. As a result, their adults children may have to provide long term financial support or reduce their working hours to taking care of them.

In conclusion, although a longer life expectancy may place pressure on both family and economy, I believe that the disadvantages are outweighed by the benefits it brings due to the valuable contribution of older people to both society and households.`;

let timerId = null;
let timerSeconds = 40 * 60;
let currentCorrections = [];
let currentImprovedEssay = "";

const els = {
  overallScore: document.querySelector("#overallScore"),
  confidence: document.querySelector("#confidence"),
  trLabel: document.querySelector("#trLabel"),
  trScore: document.querySelector("#trScore"),
  ccScore: document.querySelector("#ccScore"),
  lrScore: document.querySelector("#lrScore"),
  graScore: document.querySelector("#graScore"),
  feedbackList: document.querySelector("#feedbackList")
};

updateWordCount();
setCorrectionActions(false);

essayInput.addEventListener("input", () => {
  updateWordCount();
  clearCorrectionPreview();
});
form.addEventListener("submit", handleSubmit);
acceptButton.addEventListener("click", acceptCorrections);
rejectButton.addEventListener("click", rejectCorrections);

document.querySelector("#clearPromptButton").addEventListener("click", () => {
  promptInput.value = "";
  promptInput.focus();
});

document.querySelector("#clearEssayButton").addEventListener("click", () => {
  essayInput.value = "";
  updateWordCount();
  essayInput.focus();
});

document.querySelector("#copyButton").addEventListener("click", async () => {
  await navigator.clipboard.writeText(essayInput.value);
  showStatus("Đã copy bài viết.", false);
});

document.querySelector("#pasteButton").addEventListener("click", async () => {
  try {
    essayInput.value += await navigator.clipboard.readText();
    updateWordCount();
    essayInput.focus();
  } catch {
    showStatus("Trình duyệt chưa cho phép đọc clipboard.", true);
  }
});

document.querySelector("#outlineButton").addEventListener("click", () => {
  const outline = [
    "Introduction: paraphrase đề + nêu quan điểm.",
    "Body 1: lợi ích chính + ví dụ cụ thể.",
    "Body 2: bất lợi chính + giải thích vì sao vẫn kém thuyết phục hơn.",
    "Conclusion: khẳng định lại quan điểm."
  ].join("\n");
  essayInput.value = essayInput.value.trim() ? `${outline}\n\n${essayInput.value}` : outline;
  updateWordCount();
});

document.querySelector("#vocabButton").addEventListener("click", () => {
  showStatus("Gợi ý từ vựng sẽ được trả về trong phần Word Choice sau khi chấm.", false);
});

document.querySelector("#demoButton").addEventListener("click", () => {
  promptInput.value = demoPrompt;
  essayInput.value = demoEssay;
  updateWordCount();
  showStatus("Đã nạp bài demo. Bạn có thể sửa hoặc xoá để dán bài khác.", false);
});

timerButton.addEventListener("click", () => {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
    timerLabel.textContent = "Timer";
    return;
  }

  timerSeconds = 40 * 60;
  renderTimer();
  timerId = setInterval(() => {
    timerSeconds -= 1;
    renderTimer();
    if (timerSeconds <= 0) {
      clearInterval(timerId);
      timerId = null;
      showStatus("Hết 40 phút. Bạn có thể bấm chấm điểm ngay.", false);
    }
  }, 1000);
});

async function handleSubmit(event) {
  event.preventDefault();
  const essay = essayInput.value.trim();
  if (countWords(essay) < 40) {
    showStatus("Bài viết hơi ngắn. Hãy nhập ít nhất khoảng 40 từ để chấm chính xác hơn.", true);
    return;
  }

  scoreButton.disabled = true;
  scoreButton.innerHTML = '<span class="icon sparkle" aria-hidden="true"></span> Checking...';
  showStatus("Đang chấm bài viết, thường mất vài giây.", false);

  try {
    const response = await fetch("/api/grade", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskType: document.querySelector("#taskType").value,
        aiLanguage: document.querySelector("#aiLanguage").value,
        prompt: promptInput.value,
        essay,
        aiReasoning: document.querySelector("#aiReasoning").checked,
        improveWordChoice: document.querySelector("#improveWordChoice").checked,
        detailedFeedback: document.querySelector("#detailedFeedback").checked,
        sampleEssays: document.querySelector("#sampleEssays").checked
      })
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Không chấm được bài viết.");
    renderAssessment(payload);
    renderCorrectionPreview(essay, payload);
    showStatus(
      `Đã chấm xong. Request ${payload.requestId || "mới"} · Essay ${payload.essayHash || "n/a"}.`,
      false
    );
  } catch (error) {
    showStatus(error.message || "Có lỗi khi chấm bài.", true);
  } finally {
    scoreButton.disabled = false;
    scoreButton.innerHTML = '<span class="icon sparkle" aria-hidden="true"></span> Check Writing Score';
  }
}

function renderAssessment(data) {
  const criteria = data.criteria || {};
  const tr = criteria.TR || {};
  const cc = criteria.CC || {};
  const lr = criteria.LR || {};
  const gra = criteria.GRA || {};

  els.overallScore.textContent = formatBand(data.overallBand);
  els.confidence.textContent = data.confidence || "(+/- 0.5)";
  els.trLabel.textContent = /task 1/i.test(document.querySelector("#taskType").value) ? "TA" : "TR";
  els.trScore.textContent = formatBand(tr.score);
  els.ccScore.textContent = formatBand(cc.score);
  els.lrScore.textContent = formatBand(lr.score);
  els.graScore.textContent = formatBand(gra.score);

  const cards = [
    diagnosticsCard(data),
    correctionsCard(data.corrections || []),
    criterionCard(els.trLabel.textContent, tr),
    criterionCard("CC", cc),
    criterionCard("LR", lr),
    criterionCard("GRA", gra),
    listCard("Priority Fixes", data.priorityFixes || []),
    detailsCard("Detailed Feedback", data.detailedFeedback || []),
    wordChoiceCard(data.wordChoice || []),
    essayCard("Improved Essay", data.improvedEssay),
    essayCard("Sample Essay", data.sampleEssay)
  ].filter(Boolean);

  if (Array.isArray(data.warnings) && data.warnings.length) {
    cards.unshift(listCard("Warnings", data.warnings));
  }

  els.feedbackList.innerHTML = cards.join("");
}

function renderCorrectionPreview(essay, data) {
  currentCorrections = buildCorrections(data);
  currentImprovedEssay = String(data.improvedEssay || "").trim();

  const matches = findCorrectionMatches(essay, currentCorrections);
  if (!matches.length) {
    if (currentImprovedEssay && currentImprovedEssay !== essay) {
      correctionPreview.innerHTML = renderTextDiff(essay, currentImprovedEssay);
      correctionPreview.hidden = false;
      essayShell.classList.add("has-corrections");
      setCorrectionActions(true);
    } else {
      const corrections = currentCorrections;
      const improvedEssay = currentImprovedEssay;
      clearCorrectionPreview();
      currentCorrections = corrections;
      currentImprovedEssay = improvedEssay;
      setCorrectionActions(Boolean(currentImprovedEssay));
      if (currentImprovedEssay) {
        showStatus("Đã có bản Improved Essay. Bấm Accept All để thay bài hiện tại bằng bản sửa.", false);
      }
    }
    return;
  }

  let html = "";
  let cursor = 0;
  matches.forEach((match, index) => {
    html += escapeHtml(essay.slice(cursor, match.index));
    html += `<del>${escapeHtml(match.original)}</del><ins>${escapeHtml(match.suggestion)}</ins>`;
    html += `<span class="correction-note" title="${escapeHtml(match.reason || match.type)}">[${index + 1}]</span>`;
    cursor = match.index + match.original.length;
  });
  html += escapeHtml(essay.slice(cursor));

  correctionPreview.innerHTML = html;
  correctionPreview.hidden = false;
  essayShell.classList.add("has-corrections");
  setCorrectionActions(true);
}

function buildCorrections(data) {
  const inlineCorrections = Array.isArray(data.corrections) ? data.corrections : [];
  const wordChoiceCorrections = Array.isArray(data.wordChoice)
    ? data.wordChoice.map(item => ({
        original: item.original,
        suggestion: item.suggestion,
        type: "lexis",
        reason: item.reason
      }))
    : [];

  return [...inlineCorrections, ...wordChoiceCorrections]
    .map(item => ({
      original: String(item.original || "").trim(),
      suggestion: String(item.suggestion || "").trim(),
      type: String(item.type || "grammar").trim(),
      reason: String(item.reason || "").trim()
    }))
    .filter(item => item.original && item.suggestion && item.original !== item.suggestion)
    .slice(0, 20);
}

function findCorrectionMatches(essay, corrections) {
  const candidates = corrections
    .map(item => ({
      ...item,
      index: essay.indexOf(item.original)
    }))
    .filter(item => item.index >= 0)
    .sort((a, b) => a.index - b.index || b.original.length - a.original.length);

  const matches = [];
  for (const item of candidates) {
    const end = item.index + item.original.length;
    const overlaps = matches.some(match => item.index < match.index + match.original.length && end > match.index);
    if (!overlaps) matches.push(item);
  }
  return matches.sort((a, b) => a.index - b.index);
}

function acceptCorrections() {
  if (currentImprovedEssay) {
    essayInput.value = currentImprovedEssay;
  } else {
    essayInput.value = applyCorrections(essayInput.value, currentCorrections);
  }
  updateWordCount();
  clearCorrectionPreview();
  showStatus("Đã áp dụng toàn bộ gợi ý sửa vào bài viết.", false);
  essayInput.focus();
}

function rejectCorrections() {
  clearCorrectionPreview();
  showStatus("Đã bỏ qua các gợi ý sửa, bài viết gốc được giữ nguyên.", false);
  essayInput.focus();
}

function applyCorrections(essay, corrections) {
  const matches = findCorrectionMatches(essay, corrections);
  return matches
    .slice()
    .reverse()
    .reduce((text, match) => {
      const start = match.index;
      const end = start + match.original.length;
      return `${text.slice(0, start)}${match.suggestion}${text.slice(end)}`;
    }, essay);
}

function renderTextDiff(original, revised) {
  const originalTokens = tokenizeForDiff(original);
  const revisedTokens = tokenizeForDiff(revised);
  const table = buildDiffTable(originalTokens, revisedTokens);
  const parts = [];
  let originalIndex = 0;
  let revisedIndex = 0;

  while (originalIndex < originalTokens.length || revisedIndex < revisedTokens.length) {
    if (
      originalIndex < originalTokens.length &&
      revisedIndex < revisedTokens.length &&
      originalTokens[originalIndex] === revisedTokens[revisedIndex]
    ) {
      parts.push(escapeHtml(originalTokens[originalIndex]));
      originalIndex += 1;
      revisedIndex += 1;
    } else if (
      revisedIndex < revisedTokens.length &&
      (originalIndex === originalTokens.length ||
        table[originalIndex][revisedIndex + 1] >= table[originalIndex + 1][revisedIndex])
    ) {
      const insert = collectChangedTokens(revisedTokens, revisedIndex);
      if (insert.text.trim()) parts.push(`<ins>${escapeHtml(insert.text)}</ins>`);
      else parts.push(escapeHtml(insert.text));
      revisedIndex = insert.nextIndex;
    } else if (originalIndex < originalTokens.length) {
      const deletion = collectChangedTokens(originalTokens, originalIndex);
      if (deletion.text.trim()) parts.push(`<del>${escapeHtml(deletion.text)}</del>`);
      else parts.push(escapeHtml(deletion.text));
      originalIndex = deletion.nextIndex;
    }
  }

  return parts.join("");
}

function tokenizeForDiff(text) {
  return String(text || "").match(/\s+|[^\s]+/g) || [];
}

function buildDiffTable(originalTokens, revisedTokens) {
  const table = Array.from({ length: originalTokens.length + 1 }, () =>
    Array(revisedTokens.length + 1).fill(0)
  );

  for (let originalIndex = originalTokens.length - 1; originalIndex >= 0; originalIndex -= 1) {
    for (let revisedIndex = revisedTokens.length - 1; revisedIndex >= 0; revisedIndex -= 1) {
      table[originalIndex][revisedIndex] =
        originalTokens[originalIndex] === revisedTokens[revisedIndex]
          ? table[originalIndex + 1][revisedIndex + 1] + 1
          : Math.max(table[originalIndex + 1][revisedIndex], table[originalIndex][revisedIndex + 1]);
    }
  }

  return table;
}

function collectChangedTokens(tokens, startIndex) {
  return {
    text: tokens[startIndex] || "",
    nextIndex: startIndex + 1
  };
}

function clearCorrectionPreview() {
  currentCorrections = [];
  currentImprovedEssay = "";
  correctionPreview.hidden = true;
  correctionPreview.innerHTML = "";
  essayShell.classList.remove("has-corrections");
  setCorrectionActions(false);
}

function setCorrectionActions(enabled) {
  acceptButton.disabled = !enabled;
  rejectButton.disabled = !enabled;
}

function correctionsCard(corrections) {
  const items = buildCorrections({ corrections });
  if (!items.length) return "";
  return `
    <article class="feedback-card corrections-card">
      <h3>Inline Corrections</h3>
      <ul>
        ${items
          .map(
            item => `
              <li>
                <del>${escapeHtml(item.original)}</del>
                <span> → </span>
                <ins>${escapeHtml(item.suggestion)}</ins>
                <p>${escapeHtml(item.reason || item.type)}</p>
              </li>
            `
          )
          .join("")}
      </ul>
    </article>
  `;
}

function diagnosticsCard(data) {
  const diagnostics = data.diagnostics || {};
  const hasDiagnostics = Object.keys(diagnostics).length > 0;
  if (!hasDiagnostics && !data.essayHash && !data.requestId) return "";

  return `
    <article class="feedback-card">
      <h3>Request Check</h3>
      <p><strong>Request ID:</strong> ${escapeHtml(data.requestId || "n/a")}</p>
      <p><strong>Essay hash:</strong> ${escapeHtml(data.essayHash || "n/a")}</p>
      ${
        hasDiagnostics
          ? `<ul>
              <li>Grammar issues: ${escapeHtml(diagnostics.grammarIssueCount ?? 0)}</li>
              <li>Lexical issues: ${escapeHtml(diagnostics.lexicalIssueCount ?? 0)}</li>
              <li>Cohesion issues: ${escapeHtml(diagnostics.cohesionIssueCount ?? 0)}</li>
              <li>Task issues: ${escapeHtml(diagnostics.taskIssueCount ?? 0)}</li>
            </ul>`
          : ""
      }
    </article>
  `;
}

function criterionCard(label, item) {
  if (!item) return "";
  const strengths = listItems(item.strengths || []);
  const improvements = listItems(item.improvements || []);
  return `
    <article class="feedback-card">
      <h3>${escapeHtml(item.title || label)}: ${formatBand(item.score)}</h3>
      <p>${escapeHtml(item.summary || "")}</p>
      <p><span class="tag">+</span><strong>Điểm tốt</strong></p>
      <ul>${strengths}</ul>
      <p><span class="tag">!</span><strong>Cần sửa</strong></p>
      <ul>${improvements}</ul>
    </article>
  `;
}

function listCard(title, items) {
  if (!items.length) return "";
  return `
    <article class="feedback-card">
      <h3>${escapeHtml(title)}</h3>
      <ul>${listItems(items)}</ul>
    </article>
  `;
}

function detailsCard(title, items) {
  if (!items.length) return "";
  return `
    <article class="feedback-card">
      <h3>${escapeHtml(title)}</h3>
      ${items
        .map(
          item => `
            <p><strong>${escapeHtml(item.issue || "")}</strong></p>
            <p>${escapeHtml(item.whyItMatters || "")}</p>
            <p>${escapeHtml(item.howToFix || "")}</p>
          `
        )
        .join("")}
    </article>
  `;
}

function wordChoiceCard(items) {
  if (!items.length) return "";
  return `
    <article class="feedback-card">
      <h3>Word Choice</h3>
      ${items
        .map(
          item => `
            <p><strong>${escapeHtml(item.original || "")}</strong> → <strong>${escapeHtml(
              item.suggestion || ""
            )}</strong></p>
            <p>${escapeHtml(item.reason || "")}</p>
          `
        )
        .join("")}
    </article>
  `;
}

function essayCard(title, essay) {
  if (!essay) return "";
  return `
    <article class="feedback-card">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(essay).replace(/\n/g, "<br>")}</p>
    </article>
  `;
}

function listItems(items) {
  return items.map(item => `<li>${escapeHtml(item)}</li>`).join("");
}

function updateWordCount() {
  wordCount.textContent = countWords(essayInput.value);
}

function countWords(text) {
  return (text.trim().match(/\S+/g) || []).length;
}

function showStatus(message, isError) {
  statusMessage.textContent = message;
  statusMessage.hidden = false;
  statusMessage.classList.toggle("error", Boolean(isError));
}

function formatBand(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderTimer() {
  const minutes = Math.floor(timerSeconds / 60).toString().padStart(2, "0");
  const seconds = (timerSeconds % 60).toString().padStart(2, "0");
  timerLabel.textContent = `${minutes}:${seconds}`;
}
