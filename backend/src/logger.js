const logActivity = (db, logData) => {
    const {
        account_id = null,
        activity,
        ip_address,
        result,
        source
    } = logData;

    const query = `
        INSERT INTO admin.activity_logs 
        (account_id, activity, ip_address, result, source) 
        VALUES (?,?,?,?,?)
    `;

    db.execute(query, [account_id, activity, ip_address, result, source])
      .catch(err => console.error("Logging failed:", err));
};

module.exports = { logActivity };