require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const chalk = require('chalk');
const keys = require('./config/keys');
const routes = require('./routes');
const socket = require('./socket');
const setupDB = require('./utils/db');
const { metricsMiddleware, metricsHandler } = require('./middleware/metrics');
const { port } = keys;

// Initialize the Express application
const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  helmet({
    contentSecurityPolicy: false,
    frameguard: true
  })
);
app.use(cors());
app.use(metricsMiddleware);

// DB + Auth + Routes
if (process.env.NODE_ENV !== 'test') {
  setupDB();
}
require('./config/passport')(app);
app.use(routes);
// Metrics endpoint for Prometheus
app.get('/metrics', metricsHandler);

// Only start the HTTP server (and websockets) outside of tests
if (process.env.NODE_ENV !== 'test' && require.main === module) {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(
      `${chalk.green('✓')} ${chalk.blue(
        `Listening on port ${port}. Visit http://localhost:${port}/ in your browser.`
      )}`
    );
  });
  // Initialize WebSocket server
  socket(server);
}

// Export app for testing
module.exports = app;
