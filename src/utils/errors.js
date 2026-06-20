export class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function notFound(message = "Resource not found") {
  return new ApiError(404, message);
}

export function badRequest(message, details) {
  return new ApiError(400, message, details);
}

export function forbidden(message) {
  return new ApiError(403, message);
}

export function conflict(message) {
  return new ApiError(409, message);
}
