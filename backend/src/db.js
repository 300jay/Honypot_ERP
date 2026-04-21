const mysql = require("mysql2/promise");

const db = mysql.createPool({
    host: "localhost",
    user: "siem",
    password: "1234",
    database: "og"
});

module.exports = db;
(async () => {
    try {
        const conn = await db.getConnection();
        console.log("✅ Connected to MySQL");
        conn.release();
    } catch (err) {
        console.error("❌ MySQL Connection Failed:", err.message);
    }
})();