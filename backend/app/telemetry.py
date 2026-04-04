"""
Request-scoped performance telemetry helpers.

Tracks lightweight timing counters for:
  - total request time
  - database time / calls
  - notification time / calls
"""

from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import dataclass
from time import perf_counter


@dataclass
class RequestMetrics:
    db_time_ms: float = 0.0
    db_calls: int = 0
    notification_time_ms: float = 0.0
    notification_calls: int = 0
    started_at: float = 0.0


_request_metrics_var: ContextVar[RequestMetrics | None] = ContextVar(
    "request_metrics",
    default=None,
)


def start_request_metrics() -> Token:
    metrics = RequestMetrics(started_at=perf_counter())
    return _request_metrics_var.set(metrics)


def reset_request_metrics(token: Token) -> None:
    _request_metrics_var.reset(token)


def get_request_metrics() -> RequestMetrics | None:
    return _request_metrics_var.get()


def record_db_time(duration_ms: float) -> None:
    metrics = get_request_metrics()
    if metrics is None:
        return
    metrics.db_time_ms += duration_ms
    metrics.db_calls += 1


def record_notification_time(duration_ms: float) -> None:
    metrics = get_request_metrics()
    if metrics is None:
        return
    metrics.notification_time_ms += duration_ms
    metrics.notification_calls += 1


def current_request_age_ms() -> float | None:
    metrics = get_request_metrics()
    if metrics is None or metrics.started_at == 0.0:
        return None
    return (perf_counter() - metrics.started_at) * 1000
