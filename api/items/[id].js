// ============================================================
// /api/items/[id] — Vercel serverless function
// PATCH  -> updates status, read, notes, and/or archived for an item.
//           Setting status to "Done" stamps completed_at; moving away
//           from "Done" clears it (used for the "Completed This Week" stat).
// DELETE -> removes a single item
// ============================================================

const { neon } = require("@neondatabase/serverless");

const sql = neon(process.env.DATABASE_URL);

module.exports = async function handler(req, res) {
  const { id } = req.query;

  if (req.method === "PATCH") {
    const { status, read, notes, archived, category, priority } = req.body || {};

    try {
      await sql`
        UPDATE items
        SET status   = COALESCE(${status},   status),
            read     = COALESCE(${read},     read),
            notes    = COALESCE(${notes},    notes),
            archived = COALESCE(${archived}, archived),
            category = COALESCE(${category}, category),
            priority = COALESCE(${priority}, priority),
            completed_at = CASE
              WHEN ${status}::text = 'Done' THEN NOW()
              WHEN ${status}::text IS NOT NULL THEN NULL
              ELSE completed_at
            END
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
