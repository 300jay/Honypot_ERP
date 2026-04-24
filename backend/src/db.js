const mysql = require("mysql2/promise");

const db = mysql.createPool({
    host: "nozomi.proxy.rlwy.net",
    user: "root",
    password: "qAIglKdeJlQtzvXDNJpzLLYoVaJPsqZz",
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