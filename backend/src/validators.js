const isEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const isNumber = (value) => {
    return !isNaN(value);
};

const isValidDate = (date) =>{
    return !isNaN(Date.parse(date));
};

const isEnum = (value, allowed) => {
    return allowed.includes(value);
};

module.exports ={
    isEmail,
    isNumber,
    isValidDate,
    isEnum
};