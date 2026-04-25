const mysql = require("mysql2/promise");

const db = mysql.createPool({
    host: process.env.MYSQLHOST,
    port: process.env.MYSQLPORT,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQL_ROOT_PASSWORD,
    database: process.env.MYSQLDATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

//server currently US time zone
pool.getConnection().then(conn => {
    conn.execute("SET time_zone = '+05:30'");
    conn.release();
});

module.exports = db;
