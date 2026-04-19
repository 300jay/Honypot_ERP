const mysql = require("mysql2/promise");

const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "jayesh#2006",
    database: "og"
});

module.exports = db;