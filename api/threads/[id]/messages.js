// ============================================================
// /api/threads/[id]/messages
// GET  ?user_id=X  — fetch all messages, mark incoming as read
// POST             — send a new message
// ============================================================

const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

module.exports = async function handler(req, res) {
  const threadId = parseInt(req.query.id, 10);
  if (!threadId) return res.status(400).json({ error: "Thread id required" });

  // ---- GET ----
  if (req.method === "GET") {
    const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;

    try {
      const messages = await sql`
        SELECT m.id, m.thread_id, m.sender_id, m.text, m.created_at,
               u.name AS sender_name
        FROM messages m
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.thread_id = ${threadId}
        ORDER BY m.created_at ASC
      `;

      // Mark all messages from others as read for this user
      if (userId) {
        const unread = messages.filter((m) => m.sender_id !== userId);
        for (const m of unread) {
          await sql`
            INSERT INTO message_reads (message_id, user_id)
            VALUES (${m.id}, ${userId})
            ON CONFLICT DO NOTHING
          `;
        }
      }

      return res.status(200).json(messages);
    } catch (err) {
      console.error("GET messages error:", err);
      return res.status(500).json({ error: "Failed to fetch messages" });
    }
  }

  // ---- POST ----
  if (req.method === "POST") {
    const { sender_id, text } = req.body || {};
    if (!sender_id || !text?.trim()) {
      return res.status(400).json({ error: "sender_id and text required" });
    }

    try {
      // Verify sender is a participant
      const [participant] = await sql`
        SELECT 1 FROM thread_participants
        WHERE thread_id = ${threadId} AND user_id = ${sender_id}
      `;
      if (!participant) return res.status(403).json({ error: "Not a participant" });

      const msgId = Date.now();
      await sql`
        INSERT INTO messages (id, thread_id, sender_id, text, created_at)
        VALUES (${msgId}, ${threadId}, ${sender_id}, ${text.trim()}, NOW())
      `;

      // Auto-mark as read for the sender
      await sql`
        INSERT INTO message_reads (message_id, user_id)
        VALUES (${msgId}, ${sender_id})
        ON CONFLICT DO NOTHING
      `;

      const [msg] = await sql`
        SELECT m.id, m.thread_id, m.sender_id, m.text, m.created_at,
               u.name AS sender_name
        FROM messages m
        LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.id = ${msgId}
      `;

      return res.status(201).json(msg);
    } catch (err) {
      console.error("POST message error:", err);
      return res.status(500).json({ error: "Failed to send message" });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
};
