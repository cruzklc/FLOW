// ============================================================
// /api/categorize — Vercel serverless function
// Receives raw captured text, sends it to Claude, and returns
// a JSON array of items. Multi-thought inputs are split into
// separate items automatically. Single thoughts return a
// one-element array.
// ============================================================

const SYSTEM_PROMPT =
  "You are an AI assistant helping a CEO organize their thoughts. " +
  "Analyze the following input carefully. If it contains multiple distinct thoughts, " +
  "action items, ideas, or topics, split them into separate items. " +
  "If it is one single cohesive thought, return just one item. " +
  "Return ONLY a valid JSON array, even if there is just one item. " +
  "Each item in the array must have exactly these fields: " +
  "category (must be exactly one of: Action Item, Decision Needed, Idea, FYI, Urgent), " +
  "priority (must be exactly one of: High, Medium, Low), " +
  "summary (a clean one sentence version of that specific thought, under 100 characters). " +
  "Return nothing else — no markdown, no explanation, just the raw JSON array.";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { text } = req.body || {};

  if (!text || typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "Missing or invalid 'text' field" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY" });
    return;
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Claude API error:", errText);
      res.status(502).json({ error: "Claude API request failed" });
      return;
    }

    const data = await response.json();
    const rawText = data?.content?.[0]?.text?.trim() || "";

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      console.error("Failed to parse Claude response as JSON:", rawText);
      res.status(502).json({ error: "Could not parse categorization result" });
      return;
    }

    // Normalise: always return an array
    const items = Array.isArray(parsed) ? parsed : [parsed];
    res.status(200).json(items);
  } catch (err) {
    console.error("Categorize handler error:", err);
    res.status(500).json({ error: "Unexpected server error" });
  }
};
