"""Explicit platform backend services and runtime dispatch.""";

from .errors import ServiceError;
from .models import AuthUser;
__all__ = ["AuthUser", "ServiceError"];
