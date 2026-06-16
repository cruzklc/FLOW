// ============================================================
// /api/categorize — Vercel serverless function
// Receives raw captured text from the frontend, sends it to the
// Claude API for categorization, and returns clean JSON.
// The Anthropic API key never leaves the server.
// ============================================================

const SYSTEM_PROMPT =
  "You are an AI assistant helping a CEO organize their thoughts. " +
  "Analyze the following input and return ONLY a valid JSON object with exactly these fields: " +
  "category (must be exactly one of: Action Item, Decision Needed, Idea, FYI, Urgent), " +
  "priority (must be exactly one of: High, Medium, Low), " +
  "summary (a clean one sentence version of the input under 100 characters). " +
  "Return nothing else — no markdown, no explanation, just the raw JSON object.";

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
        max_tokens: 300,
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

    res.status(200).json(parsed);
  } catch (err) {
    console.error("Categorize handler error:", err);
    res.status(500).json({ error: "Unexpected server error" });
  }
};
