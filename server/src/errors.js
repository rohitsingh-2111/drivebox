export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const fail = (status, code, message, details) => {
  throw new AppError(status, code, message, details);
};

export const notFound = () => fail(404, 'NOT_FOUND', 'Item not found.');

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error.status || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.message;
  if (error.code === 11000) {
    status = 409;
    code = error.keyPattern?.email ? 'EMAIL_IN_USE' : 'NAME_CONFLICT';
    message = code === 'EMAIL_IN_USE' ? 'An account with this email already exists.' : 'An item with this name already exists in the destination.';
  } else if (error.name === 'MulterError') {
    status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = error.code === 'LIMIT_FILE_SIZE' ? 'UPLOAD_TOO_LARGE' : 'INVALID_UPLOAD';
    message = error.code === 'LIMIT_FILE_SIZE' ? 'The file exceeds the upload size limit.' : 'Send one file in the file field and valid form fields.';
  } else if (error.name === 'ValidationError' || error.name === 'CastError' || error.type === 'entity.parse.failed') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'The request contains invalid data.';
  } else if (error.type === 'entity.too.large') {
    status = 413;
    code = 'REQUEST_TOO_LARGE';
    message = 'The request body is too large.';
  }
  if (status >= 500 && !(error instanceof AppError)) {
    console.error(`[${req.id}] ${error.name}: ${error.message}`);
    message = 'Something went wrong. Please try again.';
    code = 'INTERNAL_ERROR';
  }
  res.status(status).json({ error: { code, message, ...(error.details ? { details: error.details } : {}) } });
}
