from __future__ import annotations

from typing import Optional

import httpx


def create_async_client(timeout: float, proxy: Optional[str] = None) -> httpx.AsyncClient:
    """Create an AsyncClient compatible with both old and new proxy parameters."""
    # Always follow redirects so upstream providers that issue 308/307 responses
    # (for example, Vercel AI Gateway) complete transparently to the caller.
    kwargs = {"timeout": timeout, "follow_redirects": True}
    if not proxy:
        return httpx.AsyncClient(**kwargs)

    try:
        return httpx.AsyncClient(proxy=proxy, **kwargs)
    except TypeError:
        try:
            return httpx.AsyncClient(proxies=proxy, **kwargs)
        except TypeError as exc:
            raise TypeError(
                "Failed to initialize httpx.AsyncClient with either 'proxy' or 'proxies' parameter"
            ) from exc


__all__ = ["create_async_client"]
