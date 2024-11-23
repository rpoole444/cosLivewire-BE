const serverless = require('serverless-http');
const app = require('../app'); // Adjust path as needed

module.exports = serverless(app);
