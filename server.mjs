import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// ---------- text helper ----------
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^ก-ฮa-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function similarity(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (!ta.size || !tb.size) return 0;

  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

// ---------- GDELT ----------
async function fetchFromGdelt(query) {
  const base = "https://api.gdeltproject.org/api/v2/doc/doc";
  const params = new URLSearchParams({
    query,
    mode: "ArtList",
    format: "json",
    maxrecords: "30",
    sort: "datedesc"
  });

  const url = `${base}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("GDELT error", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  const articles = data.articles || data.documents || [];

  return articles.map(a => ({
    title: a.title || a.semtag || "",
    description: a.seendesc || a.excerpt || "",
    url: a.url || a.shareurl || a.sourceurl || "",
    source: a.domain || a.source || "GDELT",
    publishedAt: a.seendate || a.date || null
  }));
}

function buildReliability(inputText, articles) {
  if (!articles.length) {
    return {
      score: 25,
      reason: "ไม่พบข่าวที่ใกล้เคียง",
      matches: []
    };
  }

  const scored = articles.map(a => {
    const baseText = `${a.title} ${a.description || ""}`;
    const sim = similarity(inputText, baseText);
    return { ...a, sim };
  }).sort((a, b) => b.sim - a.sim);

  const top = scored[0];
  const topSim = top.sim;

  let score, reason;
  if (topSim > 0.7) {
    score = 90;
    reason = "พบข่าวที่มีเนื้อหาใกล้เคียงมากในฐานข่าวระดับโลก";
  } else if (topSim > 0.45) {
    score = 70;
    reason = "พบข่าวที่ใกล้เคียงระดับหนึ่ง";
  } else if (topSim > 0.25) {
    score = 50;
    reason = "พบข่าวที่เกี่ยวข้องห่าง ๆ";
  } else {
    score = 30;
    reason = "ข่าวที่พบยังไม่ตรงสาระสำคัญของข้อความนี้";
  }

  return {
    score,
    reason,
    topMatch: top,
    matches: scored.slice(0, 10)
  };
}

app.post("/api/fact-check-gdelt", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !text.trim()) {
      return res.status(400).json({ ok: false, error: "text_required" });
    }

    const query = text.trim().slice(0, 120);
    const articles = await fetchFromGdelt(query);
    const reliability = buildReliability(text, articles);

    res.json({
      ok: true,
      engine: "gdelt-doc-v2",
      reliability
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("GDELT fact-check backend listening on", PORT);
});
