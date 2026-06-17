// ============================================================
// /api/threads
// GET  ?user_id=X  — threads where user is a participant,
//                    with last message + unread count
// POST             — create a new thread
// ============================================================

const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);

module.exports = async function handler(req, res) {
  // ---- GET ----
  if (req.method === "GET") {
    const userId = req.query.user_id ? parseInt(req.query.user_id, 10) : null;
    if (!userId) return res.status(400).json({ error: "user_id required" });

    try {
      // All threads this user participates in
      const threads = await sql`
        SELECT
          t.id,
          t.title,
          t.item_id,
          t.created_by,
          t.created_at,
          i.summary  AS item_summary,
          i.category AS item_category
        FROM threads t
        JOIN thread_participants tp ON tp.thread_id = t.id
        LEFT JOIN items i ON i.id = t.item_id
        WHERE tp.user_id = ${userId}
        ORDER BY t.created_at DESC
      `;

      // For each thread, attach last message + unread count
      const enriched = await Promise.all(
        threads.map(async (t) => {
          const [lastMsg] = await sql`
            SELECT m.id, m.text, m.created_at, u.name AS sender_name
            FROM messages m
            LEFT JOIN users u ON u.id = m.sender_id
            WHERE m.thread_id = ${t.id}
            ORDER BY m.created_at DESC
            LIMIT 1
          `;
          const [{ count }] = await sql`
            SELECT COUNT(*) AS count
            FROM messages m
            WHERE m.thread_id = ${t.id}
              AND m.sender_id != ${userId}
              AND NOT EXISTS (
                SELECT 1 FROM message_reads mr
                WHERE mr.message_id = m.id AND mr.user_id = ${userId}
              )
          `;
          // Participants list
          const participants = await sql`
            SELECT u.id, u.name
            FROM thread_participants tp
            JOIN users u ON u.id = tp.user_id
            WHERE tp.thread_id = ${t.id}
          `;
          return {
            ...t,
            last_message: lastMsg || null,
            unread_count: parseInt(count, 10),
            participants,
          };
        })
      );

      // Sort by last message timestamp desc
      enriched.sort((a, b) => {
        const aT = a.last_message?.created_at || a.created_at;
        const bT = b.last_message?.created_at || b.created_at;
        return new Date(bT) - new Date(aT);
      });

      return res.status(200).json(enriched);
    } catch (err) {
      console.error("GET /api/threads error:", err);
      return res.status(500).json({ error: "Failed to fetch threads" });
    }
  }

  // ---- POST ----
  if (req.method === "POST") {
    const { title, item_id, created_by, participant_ids, first_message } = req.body || {};
    if (!created_by || !first_message?.trim()) {
      return res.status(400).json({ error: "created_by and first_message required" });
    }

    try {
      const threadId = Date.now();
      await sql`
        INSERT INTO threads (id, title, item_id, created_by, created_at)
        VALUES (
          ${threadId},
          ${title || null},
          ${item_id || null},
          ${created_by},
          NOW()
        )
      `;

      // Participants = creator + any additional ids passed
      const allParticipants = Array.from(new Set([created_by, ...(participant_ids || [])]));
      for (const uid of allParticipants) {
        await sql`
          INSERT INTO thread_participants (thread_id, user_id)
          VALUES (${threadId}, ${uid})
          ON CONFLICT DO NOTHING
        `;
      }

      // First message
      const msgId = Date.now() + 1;
      await sql`
        INSERT INTO messages (id, thread_id, sender_id, text, created_at)
        VALUES (${msgId}, ${threadId}, ${created_by}, ${first_message.trim()}, NOW())
      `;

      return res.status(201).json({ id: threadId });
    } catch (err) {
      console.error("POST /api/threads error:", err);
      return res.status(500).json({ error: "Failed to create thread" });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
};
