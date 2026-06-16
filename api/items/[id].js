// ============================================================
// /api/items/[id] — Vercel serverless function
// PATCH  -> updates status and/or read flag for a single item
// DELETE -> removes a single item
// ============================================================

const { neon } = require("@neondatabase/serverless");

const sql = neon(process.env.DATABASE_URL);

module.exports = async function handler(req, res) {
  const { id } = req.query;

  if (req.method === "PATCH") {
    const { status, read } = req.body || {};

    try {
      await sql`
        UPDATE items
        SET status = COALESCE(${status}, status),
            read = COALESCE(${read}, read)
        WHERE id = ${id}
      `;
      res.status(200).json({ success: true });
    } catch (err) {
      console.error("PATCH /api/items/[id] error:", err);
      res.status(500).json({ error: "Failed to update item" });
    }
    return;
  }

  if (req.method === "DELETE") {
    try {
      await sql`DELETE FROM items WHERE id = ${id}`;
      res.status(200).json({ success: true });
    } catch (err) {
      console.error("DELETE /api/items/[id] error:", err);
      res.status(500).json({ error: "Failed to delete item" });
    }
    return;
  }

  res.status(405).json({ error: "Method not allowed" });
};
