export class AppError extends Error {
  constructor(message, status = 500, code = "INTERNAL_ERROR", details = undefined) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new AppError(message, 400, "BAD_REQUEST", details);
export const unauthorized = (message) => new AppError(message, 401, "UNAUTHORIZED");
export const forbidden = (message) => new AppError(message, 403, "FORBIDDEN");
export const notFound = (message) => new AppError(message, 404, "NOT_FOUND");
export const conflict = (message, details) => new AppError(message, 409, "CONFLICT", details);

export function normalizeError(error) {
  if (error instanceof AppError) return error;
  const status = Number(error?.status) || 500;
  return new AppError(
    error?.message || "Ошибка сервера.",
    status,
    status >= 500 ? "INTERNAL_ERROR" : `HTTP_${status}`,
    error?.details,
  );
}
