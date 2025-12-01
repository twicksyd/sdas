// api/backup.js
import { Pool } from "pg";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Helper: save a backup row
async function saveBackup(label, payload) {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `
        INSERT INTO twicks_backups (label, payload)
        VALUES ($1, $2)
        RETURNING id, created_at, label, payload
      `,
            [label || null, payload]
        );
        return result.rows[0];
    } finally {
        client.release();
    }
}

// Helper: get the newest backup row
async function getLatestBackup() {
    const client = await pool.connect();
    try {
        const result = await client.query(
            `
        SELECT id, created_at, label, payload
        FROM twicks_backups
        ORDER BY created_at DESC
        LIMIT 1
      `
        );
        return result.rows[0] || null;
    } finally {
        client.release();
    }
}

// Common CORS headers so the browser can call this from your main site
function setCors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
    setCors(res);

    if (req.method === "OPTIONS") {
        // Preflight for CORS
        return res.status(200).end();
    }

    try {
        if (req.method === "POST") {
            // Expect { payload: ..., label: "manual" }
            const { payload, label } = req.body || {};

            if (!payload) {
                return res.status(400).json({
                    success: false,
                    error: "Missing payload",
                });
            }

            const row = await saveBackup(label || "manual", payload);

            return res.status(200).json({
                success: true,
                backup: {
                    id: row.id,
                    created_at: row.created_at,
                    label: row.label,
                    payload: row.payload,
                },
            });
        }

        if (req.method === "GET") {
            const row = await getLatestBackup();

            if (!row) {
                return res.status(200).json({
                    success: false,
                    backup: null,
                    error: "No backups found",
                });
            }

            return res.status(200).json({
                success: true,
                backup: {
                    id: row.id,
                    created_at: row.created_at,
                    label: row.label,
                    payload: row.payload,
                },
            });
        }

        // Any other HTTP method
        return res.status(405).json({
            success: false,
            error: "Method not allowed",
        });
    } catch (err) {
        console.error("[backup] error:", err);
        return res.status(500).json({
            success: false,
            error: err.message || "Internal server error",
        });
    }
}
