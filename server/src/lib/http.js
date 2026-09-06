export function asyncHandler(handler) {
  return function handledAsyncRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = status >= 400 && status < 500;
  return error;
}
