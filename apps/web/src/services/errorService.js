class ErrorService {
  static handleError(error, context = '') {
    // Log the error with context
    console.error(`Error in ${context}:`, error);

    // Format the error message for display
    let message = 'An unexpected error occurred';
    
    if (error.response) {
      // Handle API errors
      const status = error.response.status;
      if (status === 401) {
        message = 'Authentication failed. Please log in again.';
      } else if (status === 403) {
        message = 'You do not have permission to perform this action.';
      } else if (status === 404) {
        message = 'The requested resource was not found.';
      } else if (status >= 500) {
        message = 'A server error occurred. Please try again later.';
      }
    } else if (error.message) {
      message = error.message;
    }

    return {
      message,
      originalError: error,
    };
  }

  static isNetworkError(error) {
    return !error.response && !error.request;
  }

  static isAuthError(error) {
    return error.response && (error.response.status === 401 || error.response.status === 403);
  }
}

export default ErrorService; 