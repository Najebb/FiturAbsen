// ==============================================================================
// RUNTIME UTILITY: Native Healthcheck Monitor
// Executed by Docker engine / PM2 monitoring to verify Express application life
// ==============================================================================

const http = require('http');

// Load environment configuration parameters to check correct running port
const PORT = process.env.PORT || 3001;

const options = {
  host: 'localhost',
  port: PORT,
  path: '/api/health',
  timeout: 5000 // 5 seconds request timeout
};

const request = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log(`[HEALTHCHECK] OK: Server responsive on port ${PORT}. Code: ${res.statusCode}`);
      process.exit(0); // Responsive - Happy exit
    } else {
      console.error(`[HEALTHCHECK] FAILURE: Status code was ${res.statusCode}. Body: ${body}`);
      process.exit(1); // Unresponsive/Error - Unhappy exit
    }
  });
});

request.on('error', (err) => {
  console.error(`[HEALTHCHECK] FAILURE: Connection error occurred. Message: ${err.message}`);
  process.exit(1); // Dead exit
});

request.on('timeout', () => {
  console.error('[HEALTHCHECK] FAILURE: Server timed out after 5000ms.');
  request.destroy();
  process.exit(1); // Timeout exit
});

request.end();
