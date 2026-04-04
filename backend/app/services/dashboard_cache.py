from time import monotonic
from typing import Any


_summary_cache: dict[str, tuple[float, Any]] = {}


def _cache_key(namespace: str, identifier: str) -> str:
    return f"{namespace}:{identifier}"


def get_summary(namespace: str, identifier: str) -> Any | None:
    key = _cache_key(namespace, identifier)
    cached = _summary_cache.get(key)
    if not cached:
        return None

    expires_at, value = cached
    if expires_at <= monotonic():
        _summary_cache.pop(key, None)
        return None

    return value


def set_summary(namespace: str, identifier: str, value: Any, ttl_sec: float) -> Any:
    prune_expired()
    _summary_cache[_cache_key(namespace, identifier)] = (monotonic() + ttl_sec, value)
    return value


def invalidate_summary(namespace: str, identifier: str):
    _summary_cache.pop(_cache_key(namespace, identifier), None)


def prune_expired():
    now = monotonic()
    expired = [key for key, (expires_at, _) in _summary_cache.items() if expires_at <= now]
    for key in expired:
        _summary_cache.pop(key, None)
