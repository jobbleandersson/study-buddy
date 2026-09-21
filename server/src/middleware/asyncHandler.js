// Express 4 doesn't catch a rejected promise from an async route handler: the
// rejection goes unhandled and, on Node 15+, takes the whole process down —
// frontend and API alike, since one process serves both. Wrap an async handler
// and a throw lands in the error middleware in index.js instead.
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
