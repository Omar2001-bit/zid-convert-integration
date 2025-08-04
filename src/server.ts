import dotenv from 'dotenv';
dotenv.config(); // This line MUST be at the very top to load .env variables

import app from './app';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Now the .env variables will be loaded and these logs will show the correct values
    console.log(`Make sure MY_BACKEND_URL in .env is: ${process.env.MY_BACKEND_URL}`);
    console.log(`Initiate Zid OAuth via: ${process.env.MY_BACKEND_URL}/auth/zid`);
    console.log(`Zid Redirect URI should be: ${process.env.MY_BACKEND_URL}/auth/zid/callback`);
});