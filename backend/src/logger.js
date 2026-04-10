const logActivity = (db, logData) => {
    const{
        account_id = null,
        activity,
        ip_address,
        result,
        source,
        session_id = null
    } = logData;
    const query = 'INSERT INTO admin.activity_logs (account_id, activity, ip_address, result, source) VALUES (?,?,?,?,?)';
    db.query(query, [account_id,activity, ip_address, result, source], (err) =>{
        if(err){
            console.error("Logging failed:", err);
        }
    });
};

module.exports = {logActivity};