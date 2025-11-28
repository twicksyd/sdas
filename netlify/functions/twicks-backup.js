// netlify/functions/twicks-backup.js
const { Pool } = require("pg");

exports.handler = async (event, context) => {
    const pool = new Pool({
        connectionString: process.env.NEON_DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });

    try {
        if (event.httpMethod === "POST") {
            // Save backup
            const { payload, label } = JSON.parse(event.body);

            const result = await pool.query(
                `INSERT INTO twicks_backups (payload, label)
                 VALUES ($1, $2)
                 RETURNING id, created_at`,
                [payload, label || "manual"]
            );

            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    saved: result.rows[0],
                }),
            };
        }

        if (event.httpMethod === "GET") {
            // Load latest backup
            const result = await pool.query(
                `SELECT id, created_at, label, payload
                 FROM twicks_backups
                 ORDER BY created_at DESC
                 LIMIT 1`
            );

            return {
                statusCode: 200,
                body: JSON.stringify({
                    success: true,
                    backup: result.rows[0] || null,
                }),
            };
        }

        return {
            statusCode: 405,
            body: "Method not allowed",
        };

    } catch (err) {
        console.error("Function error:", err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message }),
        };
    } finally {
        await pool.end();
    }
};
