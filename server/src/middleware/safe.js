// Express 4 does not catch a rejected promise from an async route handler: the
// rejection goes unhandled and Node 20 exits the process. Wrapping the handler
// sends the error to Express's error middleware (a logged 500) instead.
export const safe = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
