const client = require('prom-client');

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add default metrics to the registry
client.collectDefaultMetrics({ register });

// Example custom metrics
const httpRequestDurationMs = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [50, 100, 200, 300, 400, 500, 1000]
});

register.registerMetric(httpRequestDurationMs);

// Middleware to time requests
const metricsMiddleware = (req, res, next) => {
  const end = httpRequestDurationMs.startTimer({ method: req.method, route: req.path });
  res.on('finish', () => {
    end({ status_code: res.statusCode });
  });
  next();
};

// Handler to expose metrics
const metricsHandler = async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
};

module.exports = { metricsMiddleware, metricsHandler };


