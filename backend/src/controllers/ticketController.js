const db = require("../db");

const logDecoyEvent = async (userId, type, ip) => {
    try{
        await db.execute("INSERT INTO decoy_events (user_id, event_type, source_ip) VALUES (?,?,?)",[userId, type, ip]);
    } catch(err){
        console.error("logged error", err)
    }
};
//to create a ticket
exports.createTicket = async (req, res) =>{
    try{
        let {subject, description, priority} = req.body;
        subject = subject?.trim();
        description = description?.trim();
    if(!subject||!description){
        return res.status(400).json({message: "Invalid Input"});
    }
    const [count] = await db.execute("SELECT COUNT(*) as total FROM support_tickets WHERE raised_by = ? AND created_at > NOW() - INTERVAL 1 MINUTE",[req.user.id]);
    if(count[0].total > 5){
        await logDecoyEvent(req.user.id, "TICKET_SPAM", req.ip);
        return res.status(429).json({message: "Too many requests"});
    }
    const allowed = ["low","medium","high"];
    if (!allowed.includes(priority)) priority = "low";
    const [result] = await db.execute("INSERT INTO support_tickets (raised_by, subject, description, priority) VALUES (?,?,?,?)", [req.user.id, subject, description, priority]
    );
    const ticketId = result.insertId;

    const [admins] = await db.execute("SELECT account_id FROM account_role_map WHERE role_id = 1");
    const [notif] = await db.execute(
        "INSERT INTO notifications (sender_id, title, message, type) VALUES (?,?,?,?)", [req.user.id, "New Ticket", `Ticket #${ticketId} created`, "ticket_created"]
    );
    for (let admin of admins){
        await db.execute(
            "INSERT INTO notification_recipients (notification_id, account_id) VALUES (?,?)", [notif.insertId, admin.account_id]
        );
    }
    res.json({message: "Ticket created", ticketId});
}catch(err){
    console.error(err);
    res.status(500).json({message:"Server error"});
}
};
//get my tickets
exports.getMyTickets = async(req, res) => {
    try{
        const[tickets] = await db.execute(
            "SELECT * FROM support_tickets WHERE raised_by = ?", [req.user.id]
        );
        res.json(tickets);
    }catch(err){
        res.status(500).json({message: "Server error"});
    }
};
//Find ticket by id
exports.getTicketById = async(req, res)=>{
    try{
        const ticket = req.ticket;
        const id = req.params.id
        //for decoy ticket
        if(ticket.internal_flag === 1){
            await logDecoyEvent(req.user.id, "DECOY_TICKET_ACCESS", req.ip);
        }
        const [messages] = await db.execute("SELECT * FROM ticket_messages WHERE ticket_id = ?", [id]
        );
        res.json({ticket, messages});
    }
    catch(err){
        res.status(500).json({message: "Server error"});
    }
};
exports.replyTicket = async(req, res) =>{
    try{
        const{id} =req.params;
        let{message} = req.body;
        message=message?.trim();
        if(!message){
            return res.status(400).json({message:"Invalid message"});
        }
        if(message.includes("' OR")||message.includes("<script>")){
            await logDecoyEvent(req.user.id, "INJECTION_ATTEMPT", req.ip)
        }
        const ticket=req.ticket;
        await db.execute("INSERT INTO ticket_messages (ticket_id, sender_id, message) VALUES (?,?,?)", [id, req.user.id, message]);
        const targetUser = ticket.raised_by===req.user.id ? ticket.assigned_to:ticket.raised_by;
        if (targetUser){
            const[notif] = await db.execute("INSERT INTO notifications (sender_id, title, message, type) VALUES (?,?,?,?)", [req.user.id, "Ticket Reply", `Reply on ticket #${id}`, "ticket_reply"]);
            await db.execute("INSERT INTO notification_recipients (notification_id, account_id) VALUES (?,?)", [notif.insertId, targetUser]);
        }
        res.json({message: "Reply added"});
    }
    catch(err){
        res.status(500).json({message: "Server error"});
    }
}