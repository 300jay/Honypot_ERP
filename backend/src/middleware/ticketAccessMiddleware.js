const db = require("../db");

module.exports = async(req, res, next)=>{
    try{
        const ticketId = req.params.id;
        const [rows] = await db.execute("SELECT * FROM support_tickets WHERE ticket_id=? AND (raised_by=? OR assigned_to=?)",[ticketId, req.user.id, req.user.id]);
        if (!rows.length){
            await db.execute("INSERT INTO decoy_events(user_id, event_type, source_ip) VALUES (?,?,?)", [req.user.id, "TICKET_ENUM_ATTEMPT", req.ip]);
            return res.status(403).json({message: "Unauthorized access to ticket"});
        }
        req.ticket=rows[0];
        next();
    }catch(err){
        console.error(err);
        res.status(500).json({message: "Server error"});
    }
};