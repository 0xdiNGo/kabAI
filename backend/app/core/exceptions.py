class KabAIError(Exception):
    """Base exception for the application."""

    def __init__(self, detail: str, status_code: int = 400):
        self.detail = detail
        self.status_code = status_code
        super().__init__(detail)


class NotFoundError(KabAIError):
    def __init__(self, resource: str, identifier: str):
        super().__init__(f"{resource} '{identifier}' not found", status_code=404)


class ConflictError(KabAIError):
    def __init__(self, detail: str):
        super().__init__(detail, status_code=409)


class AuthenticationError(KabAIError):
    def __init__(self, detail: str = "Invalid credentials"):
        super().__init__(detail, status_code=401)


class AuthorizationError(KabAIError):
    def __init__(self, detail: str = "Insufficient permissions"):
        super().__init__(detail, status_code=403)
