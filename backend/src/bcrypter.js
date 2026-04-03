const bcrypt = require("bcrypt");

bcrypt.hash("adminpass", 10).then(hash => {
    console.log(hash);
});