const db = require("../db")
const { logActivity } = require("../logger");

function log(req, db, activity, result, source="ADMIN") {
    const token = req.headers.authorization?.split(" ")[1];
    const tokenHash = token ? hashToken(token) : null;

    logActivity(db, {
        account_id: req.user?.id || null,
        activity,
        ip_address: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
        session_id: req.user?.session_id || null,
        result,
        source,
        token_hash: tokenHash
    });
}
exports.getDashboardStats = async (req, res)=>{
    try{
        const [students] = await db.execute(
            "SELECT COUNT(*) as count FROM og.student_profiles"
        );
        const [teachers] = await db.execute(
            "SELECT COUNT(*) as count FROM og.teacher_profiles"
        );
        const [tickets] = await db.execute(
            "SELECT COUNT(*) as count FROM og.support_tickets"
        );

        log(req, db, "VIEW_DASHBOARD_STATS", "SUCCESS");

        res.json({
            students: students[0].count,
            teachers: teachers[0].count,
            tickets: tickets[0].count,
        });
    }catch(err){
        console.error("Dashboard error:", err);
        log(req, db, "VIEW_DASHBOARD_STATS", "ERROR");
        res.status(500).json({message:"Server error"});
    }
}

exports.getAllTickets = async(req, res)=>{
    try{
        const[tickets]=await db.execute("SELECT * FROM og.support_tickets ORDER BY created_at DESC");

        log(req, db, "VIEW_ALL_TICKETS", "SUCCESS");

        res.json(tickets);
    }
    catch(err){
        log(req, db, "VIEW_ALL_TICKETS", "ERROR");
        res.status(500).json({message:"Server error"});
    }
};

exports.getTicketById = async(req, res)=>{
    try{
        const{id}= req.params;
        const [tickets]=await db.execute("SELECT * FROM og.support_tickets WHERE ticket_id = ?", [id]);

        if(tickets.length === 0){
            log(req, db, "VIEW_TICKET", "NOT_FOUND");
            return res.status(404).json({message: "Ticket not found"});
        }

        const ticket = tickets[0];

        const[messages] = await db.execute(
            "SELECT * FROM og.ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC",
            [id]
        );

        log(req, db, "VIEW_TICKET", "SUCCESS");

        res.json({ticket, messages});
    }catch (err){
        console.error(err);
        log(req, db, "VIEW_TICKET", "ERROR");
        res.status(500).json({message: "Server error"});
    }
};

exports.updateTicketStatus = async(req, res) =>{
    try{
        const{status}=req.body;
        const{id}=req.params;
        const allowed = ["open","in_progress","closed"];

        if(!allowed.includes(status)){
            log(req, db, "UPDATE_TICKET_STATUS", "INVALID_STATUS");
            return res.status(400).json({message: "Invalid status"});
        }

        await db.execute(
            "UPDATE og.support_tickets SET status = ? WHERE ticket_id=?",
            [status, id]
        );

        log(req, db, "UPDATE_TICKET_STATUS", "SUCCESS");

        res.json({message: "Status updated"});
    }
    catch(err){
        log(req, db, "UPDATE_TICKET_STATUS", "ERROR");
        res.status(500).json({message:"Server error"});
    }
};

exports.assignTicket = async(req, res)=>{
    try{
        const{assigned_to} = req.body;
        const {id} = req.params;

        if (!assigned_to){
            log(req, db, "ASSIGN_TICKET", "INVALID_INPUT");
            return res.status(400).json({ message: "assigned_to required"});
        }

        await db.execute(
            "UPDATE og.support_tickets SET assigned_to=? WHERE ticket_id =?",
            [assigned_to, id]
        );

        log(req, db, "ASSIGN_TICKET", "SUCCESS");

        res.json({message: "Ticket assigned"})
    }
    catch(err){
        log(req, db, "ASSIGN_TICKET", "ERROR");
        res.status(500).json({ message: "Server error"});
    }
};

exports.getAllUsers = async(req, res) => {
    try{
        const [users] = await db.execute(
            "SELECT account_id, email, last_login FROM og.accounts"
        );

        log(req, db, "VIEW_ALL_USERS", "SUCCESS");

        res.json(users);
    }
    catch(err){
        log(req, db, "VIEW_ALL_USERS", "ERROR");
        res.status(500).json({message: "Server error"});
    }
};

exports.getMyNotifications = async (req, res) => {
    try {
        const [rows] = await db.execute(`
            SELECT 
                n.notification_id,
                n.title,
                n.message,
                n.type,
                n.created_at,
                nr.is_read
            FROM notifications n
            JOIN notification_recipients nr 
                ON n.notification_id = nr.notification_id
            WHERE nr.account_id = ?
            ORDER BY n.created_at DESC
        `, [req.user.id]);

        log(req, db, "VIEW_NOTIFICATIONS", "SUCCESS");

        res.json(rows);
    } catch (err) {
        console.error(err);
        log(req, db, "VIEW_NOTIFICATIONS", "ERROR");
        res.status(500).json({ message: "Server error" });
    }
};
