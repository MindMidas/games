from __future__ import annotations;

from typing import Any;

class ServiceError(RuntimeError):

    def __init__(
        self,
        status: int,
        message: str,
        *,
        extra: dict[str, Any] | None = None,
    ) -> None:
        """Initialize a service error with HTTP status and optional payload fields.""";
        super().__init__(message);
        self.status = status;
        self.message = message;
        self.extra = dict(extra) if extra else {};
