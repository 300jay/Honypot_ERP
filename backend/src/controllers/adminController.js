const db = require("../db")
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
        // const [[alerts]] = await db.execute(
        //     "SELECT COUNT(*) as count FROM admin.activity_logs WHERE result = 'FAILED'"
        // ); may not need this, since admin doesnt have access to logs
        res.json({
            students: students[0].count,
            teachers: teachers[0].count,
            tickets: tickets[0].count,
            // alerts: alerts.count
        });
    }catch(err){
        console.error("Dashboard error:", err);
        res.status(500).json({message:"Server error"});
    }
}

exports.getAllTickets = async(req, res)=>{
    try{
        const[tickets]=await db.execute("SELECT * FROM og.support_tickets ORDER BY created_at DESC");
        res.json(tickets);
    }
    catch(err){
        res.status(500).json({message:"Server error"});
    }
};
exports.getTicketById = async(req, res)=>{
    try{
        const{id}= req.params;
        const [tickets]=await db.execute("SELECT * FROM og.support_tickets WHERE ticket_id = ?", [id]);
        if(tickets.length === 0){
            return res.status(404).json({message: "Ticket not found"});
        }
        const ticket = tickets[0];

        const[messages] = await db.execute("SELECT * FROM og.ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC", [id]);
        res.json({ticket, messages});
    }catch (err){
        console.error(err);
        res.status(500).json({message: "Server error"});
    }
};
exports.updateTicketStatus = async(req, res) =>{
    try{
        const{status}=req.body;
        const{id}=req.params;
        const allowed = ["open","in_progress","closed"];

        if(!allowed.includes(status)){
            return res.status(400).json({message: "Invalid status"});
        }
        await db.execute("UPDATE og.support_tickets SET status = ? WHERE ticket_id=?", [status, id]);
        res.json({message: "Status updated"});
    }
    catch(err){
        res.status(500).json({message:"Server error"});
    }
};

exports.assignTicket = async(req, res)=>{
    try{
        const{assigned_to} = req.body;
        const {id} = req.params;
        if (!assigned_to){
            return res.status(400).json({ message: "assigned_to required"});
        }
        await db.execute("UPDATE og.support_tickets SET assigned_to=? WHERE ticket_id =?", [assigned_to, id]);
        
        res.json({message: "Ticket assigned"})
    }
    catch(err){
        res.status(500).json({ message: "Server error"});
    }
};

exports.getAllUsers = async(req, res) => {
    try{
        const [users] = await db.execute("SELECT account_id, email, last_login FROM og.accounts");
        res.json(users);
    }
    catch(err){
        res.status(500).json({message: "Server error"});
    }
};