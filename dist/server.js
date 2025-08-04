"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config(); // This line MUST be at the very top to load .env variables
const app_1 = __importDefault(require("./app"));
const PORT = process.env.PORT || 3000;
app_1.default.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Now the .env variables will be loaded and these logs will show the correct values
    console.log(`Make sure MY_BACKEND_URL in .env is: ${process.env.MY_BACKEND_URL}`);
    console.log(`Initiate Zid OAuth via: ${process.env.MY_BACKEND_URL}/auth/zid`);
    console.log(`Zid Redirect URI should be: ${process.env.MY_BACKEND_URL}/auth/zid/callback`);
});
