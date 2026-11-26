require("dotenv").config();

const { start } = require("./api/app");

start().catch(error => {
    console.error("❌ Impossible de démarrer La communauté live :", error);
    process.exitCode = 1;
});
