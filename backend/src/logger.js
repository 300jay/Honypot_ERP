const logActivity = (db, logData) => {
    const {
        account_id = null,
        activity,
        ip_address,
        result,
        source,
        token_hash = null  
    } = logData;
    const query = `
        INSERT INTO admin.activity_logs 
        (account_id, activity, ip_address, result, source, token_hash) 
        VALUES (?,?,?,?,?,?)
    `;

    db.execute(query, [account_id, activity, ip_address, result, source, token_hash])
      .catch(err => console.error("Logging failed:", err));
};

module.exports = { logActivity };