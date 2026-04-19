module.exports = (allowedRoles) =>{
    return (req, res, next) => {
        if(!req.user||!req.user.role){
            return res.json({message:"Unauthorized"});
        }
        if(Array.isArray(allowedRoles)){
            if(!allowedRoles.includes(req.user.role)){
                return res.json({message:"Forbidden"});
            }
        } else{
            if(req.user.role != allowedRoles){
                return res.json({message: "Forbidden"});
            }
        }
        next();
    };
};