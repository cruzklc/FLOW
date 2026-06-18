// ============================================================
// /api/theme — Vercel serverless function
// GET  ?userId=123      → returns { theme }
// PATCH {userId, theme} → saves theme_preference to users table
// ============================================================

const { neon } = require("@neondatabase/serverless");

const sql = neon(process.env.DATABASE_URL);

const VALID_THEMES = ["violet", "ocean", "sunset", "forest", "midnight", "crimson"];

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "GET") {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    try {
      const rows = await sql`
        SELECT theme_preference FROM users WHERE id = ${userId} LIMIT 1
      `;
      const theme = rows[0]?.theme_preference || "violet";
      return res.status(200).json({ theme });
    } catch (err) {
      console.error("GET /api/theme error:", err);
      return res.status(500).json({ error: "DB error" });
    }
  }

  if (req.method === "PATCH") {
    const { userId, theme } = req.body || {};
    if (!userId || !theme) return res.status(400).json({ error: "Missing userId or theme" });
    if (!VALID_THEMES.includes(theme)) return res.status(400).json({ error: "Invalid theme" });

    try {
      await sql`
        UPDATE users SET theme_preference = ${theme} WHERE id = ${parseInt(userId, 10)}
      `;
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("PATCH /api/theme error:", err);
      return res.status(500).json({ error: "DB error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
