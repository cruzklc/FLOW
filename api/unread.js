// ============================================================
// /api/unread?user_id=X
// Returns total unread message count for the user — used by
// all pages to keep the inbox badge current.
// ============================================================

const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
  if (!userId) return res.status(400).json({ error: "user_id required" });

  try {
    const [{ count }] = await sql`
      SELECT COUNT(*) AS count
      FROM messages m
      JOIN thread_participants tp ON tp.thread_id = m.thread_id AND tp.user_id = ${userId}
      WHERE m.sender_id != ${userId}
        AND NOT EXISTS (
          SELECT 1 FROM message_reads mr
          WHERE mr.message_id = m.id AND mr.user_id = ${userId}
        )
    `;
    return res.status(200).json({ unread: parseInt(count, 10) });
  } catch (err) {
    console.error("GET /api/unread error:", err);
    return res.status(500).json({ error: "Failed to fetch unread count" });
  }
};
