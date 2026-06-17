// ============================================================
// /api/users — Vercel serverless function
// POST {name} -> finds existing user by name (case-insensitive)
//               or creates a new one. Returns {id, name}.
// ============================================================

const { neon } = require("@neondatabase/serverless");

const sql = neon(process.env.DATABASE_URL);

module.exports = async function handler(req, res) {
  // GET — list all users (for recipient picker)
  if (req.method === "GET") {
    try {
      const users = await sql`SELECT id, name FROM users ORDER BY name ASC`;
      return res.status(200).json(users);
    } catch (err) {
      console.error("GET /api/users error:", err);
      return res.status(500).json({ error: "Failed to fetch users" });
    }
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { name } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Missing name" });
    return;
  }

  const cleanName = name.trim();

  try {
    // Find existing user (case-insensitive)
    const existing = await sql`
      SELECT id, name FROM users WHERE LOWER(name) = LOWER(${cleanName}) LIMIT 1
    `;
    if (existing.length > 0) {
      res.status(200).json(existing[0]);
      return;
    }

    // Create new user
    const id = Date.now();
    await sql`
      INSERT INTO users (id, name, created_at)
      VALUES (${id}, ${cleanName}, NOW())
    `;
    res.status(201).json({ id, name: cleanName });
  } catch (err) {
    console.error("POST /api/users error:", err);
    res.status(500).json({ error: "Failed to find or create user" });
  }
};
