const validDays = ["Monday", "Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const db = require("../db");
const { logActivity } = require("../logger"); 
const crypto = require("crypto");

function isValidDay(day){
    return validDays.includes(day);
}
function log(req, db, activity, result, source="TIMETABLE") {
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
}exports.createTimetable = async(req,res) =>{
    try{
        const {offering_id, day_of_week, start_time, end_time, room_no} = req.body;
        const account_id = req.user.id;
        const ip = req.headers['x-forwarded-for'] || req.ip;
        const [teacherRows] = await db.execute("SELECT teacher_id FROM teacher_profiles WHERE account_id = ?",[account_id]);
        const [ownership] = await db.execute(
            "SELECT * FROM course_offerings WHERE offering_id = ? AND teacher_id = ?",
            [offering_id, teacher_id]
        );

        const [clash] = await db.execute(
            "SELECT * FROM timetable_entries WHERE day_of_week = ? AND offering_id = ? AND (start_time < ? AND end_time > ?)",
            [day_of_week, offering_id, end_time, start_time]
        );

        if (!offering_id || !day_of_week || !start_time || !end_time) {
            log(req, db, "CREATE_TIMETABLE", "INVALID_INPUT");
            return res.status(400).json({ message: "Invalid input" });
        }
        if (!isValidDay(day_of_week)) {
            log(req, db, "CREATE_TIMETABLE", "INVALID_DAY");
            return res.status(400).json({ message: "Invalid day" });
        }
        if (start_time >= end_time) {
            log(req, db, "CREATE_TIMETABLE", "INVALID_TIME");
            return res.status(400).json({ message: "Invalid time range" });
        }
        if (teacherRows.length === 0) {
            log(req, db, "CREATE_TIMETABLE", "TEACHER_NOT_FOUND");
            return res.status(403).json({ message: "Teacher not found" });
        }
        if (ownership.length === 0) {
            log(req, db, "CREATE_TIMETABLE", "UNAUTHORIZED");
            return res.status(403).json({ message: "Unauthorized" });
        }
        if (clash.length > 0) {
            log(req, db, "CREATE_TIMETABLE", "TIME_CONFLICT");
            return res.status(400).json({ message: "Time conflict" });
        }
        await db.execute("INSERT INTO timetable_entries (offering_id, day_of_week, start_time, end_time, room_no) VALUES (?,?,?,?,?)", [offering_id, day_of_week, start_time, end_time, room_no] );
        log(req, db, "CREATE_TIMETABLE", "SUCCESS");
        res.json({message: "Timetable added"});

    }catch (err){
        log(req, db, "CREATE_TIMETABLE", "ERROR");
        res.status(500).json({message:"Server error"});
    }
};

exports.updateTimetable = async (req, res)=>{
    try{
        const {id} = req.params;
        const {day_of_week, start_time, end_time, room_no} = req.body;
        const account_id = req.user.id;
        const ip = req.headers['x-forwarded-for'] || req.ip;
        const [teacherRows] = await db.execute("SELECT teacher_id FROM teacher_profiles WHERE account_id = ?",[account_id]);
        const teacher_id = teacherRows[0].teacher_id;

        const [result] = await db.execute(
            "SELECT te.*, co.teacher_id FROM timetable_entries te JOIN course_offerings co ON te.offering_id = co.offering_id WHERE te.timetable_id = ?",
            [id]
        );

        const [clash] = await db.execute(
            "SELECT * FROM timetable_entries WHERE day_of_week = ? AND offering_id = ? AND (start_time < ? AND end_time > ?) AND timetable_id != ?",
            [day_of_week, result[0]?.offering_id, end_time, start_time, id]
        );
        if (teacherRows.length === 0) {
            log(req, db, "UPDATE_TIMETABLE", "TEACHER_NOT_FOUND");
            return res.status(403).json({ message: "Teacher not found" });
        }
        if (!day_of_week || !start_time || !end_time) {
            log(req, db, "UPDATE_TIMETABLE", "INVALID_INPUT");
            return res.status(400).json({ message: "Invalid input" });
        }
        if (!isValidDay(day_of_week)) {
            log(req, db, "UPDATE_TIMETABLE", "INVALID_DAY");
            return res.status(400).json({ message: "Invalid day" });
        }
        if (start_time >= end_time) {
            log(req, db, "UPDATE_TIMETABLE", "INVALID_TIME");
            return res.status(400).json({ message: "Invalid time range" });
        }
        if (result.length === 0) {
            log(req, db, "UPDATE_TIMETABLE", "NOT_FOUND");
            return res.status(404).json({ message: "Not found" });
        }
        if (result[0].teacher_id !== teacher_id) {
            log(req, db, "UPDATE_TIMETABLE", "UNAUTHORIZED");
            return res.status(403).json({ message: "Unauthorized" });
        }
        if (clash.length > 0) {
            log(req, db, "UPDATE_TIMETABLE", "TIME_CONFLICT");
            return res.status(400).json({ message: "Time conflict" });
        }
        await db.execute("UPDATE timetable_entries SET day_of_week=?, start_time=?, end_time=?, room_no=? WHERE timetable_id=?", [day_of_week, start_time, end_time, room_no, id]);
        log(req, db, "UPDATE_TIMETABLE", "SUCCESS");
        res.json({message:"Updated"});
    }
    catch(err){
        log(req, db, "UPDATE_TIMETABLE", "ERROR");
        res.status(500).json({message: "Server error"});
    }
};

exports.deleteTimetable = async(req, res)=>{
    try{
        const{id} = req.params;
        const account_id = req.user.id;
        const ip = req.headers['x-forwarded-for'] || req.ip;
        const [teacherRows] = await db.execute("SELECT teacher_id FROM teacher_profiles WHERE account_id = ?",[account_id]);

        if (teacherRows.length === 0){
            log(req, db, "DELETE_TIMETABLE", "TEACHER_NOT_FOUND");
            return res.status(403).json({ message: "Teacher not found" });
        }
        const teacher_id = teacherRows[0].teacher_id;
        
        const [result] = await db.execute("SELECT co.teacher_id FROM timetable_entries te JOIN course_offerings co ON te.offering_id = co.offering_id WHERE te.timetable_id = ?", [id]);
        if (result.length === 0) {
            log(req, db, "DELETE_TIMETABLE", "NOT_FOUND");
            return res.status(404).json({ message: "Not found" });
        }

        if (result[0].teacher_id !== teacher_id) {
            log(req, db, "DELETE_TIMETABLE", "UNAUTHORIZED");
            return res.status(403).json({ message: "Unauthorized" });
        }
        await db.execute("DELETE FROM timetable_entries WHERE timetable_id =?", [id]);
        log(req, db, "DELETE_TIMETABLE", "SUCCESS");
        res.json({message: "Deleted"});
    }catch (err){
        log(req, db, "DELETE_TIMETABLE", "ERROR");
        res.status(500).json({message:"Server error"});
    }
};

exports.getTeacherTimetable = async(req,res)=>{
    try{
        const account_id = req.user.id;
        const ip = req.headers['x-forwarded-for'] || req.ip;
        const [teacherRows] = await db.execute("SELECT teacher_id FROM teacher_profiles WHERE account_id = ?",[account_id]);

        if (teacherRows.length === 0) {
            log(req, db, "VIEW_TIMETABLE_TEACH", "TEACHER_NOT_FOUND");
            return res.status(403).json({ message: "Teacher not found" });
        }
        const teacher_id = teacherRows[0].teacher_id;
        const {day}=req.query;

        let query="SELECT te.*, c.course_name FROM timetable_entries te JOIN course_offerings co ON te.offering_id = co.offering_id JOIN courses c ON co.course_id = c.course_id WHERE co.teacher_id=?";
        const params = [teacher_id];

        if(day){
            if (!isValidDay(day)) {
            log(req, db, "VIEW_TIMETABLE_TEACH", "INVALID_DAY");
            return res.status(400).json({ message: "Invalid day" });
        }
            query+=" AND te.day_of_week=?";
            params.push(day);
        }
        query +=" ORDER BY te.day_of_week, te.start_time";
        const[result] = await db.execute(query, params);
        log(req, db, "VIEW_TIMETABLE_TEACH", "SUCCESS");
        res.json(result);
    } catch (err){
        log(req, db, "VIEW_TIMETABLE_TEACH", "ERROR");
        res.status(500).json({message: "Server error"});
    }
};

exports.getStudentTimetable = async(req, res) =>{
    try{
        const account_id = req.user.id;
        const ip = req.headers['x-forwarded-for'] || req.ip;
        const [studentRows] = await db.execute("SELECT student_id FROM student_profiles WHERE account_id = ?", [account_id]);

        if (studentRows.length === 0) {
            log(req, db, "VIEW_TIMETABLE_STUDENT", "STUDENT_NOT_FOUND");
            return res.status(403).json({ message: "Student not found" });
        }

        const student_id = studentRows[0].student_id;
        const{day} = req.query;
        let query = `SELECT te.*, c.course_name, tp.full_name AS teacher_name FROM timetable_entries te 
            JOIN course_offerings co ON te.offering_id = co.offering_id 
            JOIN student_course_enrollments sce ON sce.offering_id = co.offering_id
            JOIN courses c ON co.course_id = c.course_id
            JOIN teacher_profiles tp ON co.teacher_id = tp.teacher_id
            WHERE sce.student_id=?`;

        const params= [student_id];
        if(day){
            if (!isValidDay(day)) {
                log(req, db, "VIEW_TIMETABLE_STUDENT", "INVALID_DAY");
                return res.status(400).json({ message: "Invalid day" });
            }
        
            query+=" AND te.day_of_week=?";
            params.push(day);
        }
        query +=" ORDER BY te.day_of_week, te.start_time";
        const [result]= await db.execute(query, params);
        log(req, db, "VIEW_TIMETABLE_STUDENT", "SUCCESS");
        res.json(result || []);
    } catch(err){
        log(req, db, "VIEW_TIMETABLE_STUDENT", "ERROR");
        res.status(500).json({message: "Server error"})
    }
};
exports.fakeTimetableAdmin = async(req, res) => {
    try{
        const user_id = req.user?.id || null;
        const ip = req.headers['x-forwarded-for'] || req.ip;

        log(req, db, "DECOY_TIMETABLE_ACCESS", "ALERT", "HONEYPOT");
        res.json({message:"Timetable updated successfully"});
    } catch (err){
        log(req, db, "DECOY_TIMETABLE_ACCESS", "ERROR", "HONEYPOT");
        res.json({message:"Timetable updated successfully"});
    }
};
