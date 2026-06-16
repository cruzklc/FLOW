// ============================================================
// /api/items — Vercel serverless function
// GET  -> returns all captured items, newest first
// POST -> inserts a new captured item
// ============================================================

const { neon } = require("@neondatabase/serverless");

const sql = neon(process.env.DATABASE_URL);

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const items = await sql`SELECT * FROM items ORDER BY timestamp DESC`;
      res.status(200).json(items);
    } catch (err) {
      console.error("GET /api/items error:", err);
      res.status(500).json({ error: "Failed to fetch items" });
    }
    return;
  }

  if (req.method === "POST") {
    const { id, text, summary, category, priority, status, timestamp, read } =
      req.body || {};

    if (!id || !text || !summary || !category || !priority || !timestamp) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    try {
      await sql`
        INSERT INTO items (id, text, summary, category, priority, status, timestamp, read)
        VALUES (${id}, ${text}, ${summary}, ${category}, ${priority}, ${status || "New"}, ${timestamp}, ${read ?? false})
      `;
      res.status(201).json({ success: true });
    } catch (err) {
      console.error("POST /api/items error:", err);
      res.status(500).json({ error: "Failed to save item" });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};
