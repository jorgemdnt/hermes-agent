"""Bounded, same-origin avatar proxy for the verified Google OIDC picture claim."""
from __future__ import annotations

from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

_MAX_BYTES = 1024 * 1024
_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


def google_picture_url(picture: str) -> str:
    """Only Google's image host is fetchable; never accept arbitrary IdP-controlled URLs."""
    try:
        url = urlsplit(picture)
        if (url.scheme == "https" and url.hostname == "lh3.googleusercontent.com"
                and url.port is None and not url.username and not url.password
                and url.path.startswith("/") and len(picture) <= 2048):
            return picture
    except ValueError:
        pass
    return ""


async def fetch_avatar(picture: str) -> tuple[bytes, str]:
    url = google_picture_url(picture)
    if not url:
        raise HTTPException(status_code=404, detail="No profile picture available")
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=False) as client:
            async with client.stream("GET", url, headers={"Accept": "image/jpeg,image/png,image/webp"}) as response:
                media_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                if response.status_code != 200 or media_type not in _IMAGE_TYPES:
                    raise HTTPException(status_code=502, detail="Profile picture unavailable")
                if int(response.headers.get("content-length", "0")) > _MAX_BYTES:
                    raise HTTPException(status_code=502, detail="Profile picture too large")
                chunks = []
                size = 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > _MAX_BYTES:
                        raise HTTPException(status_code=502, detail="Profile picture too large")
                    chunks.append(chunk)
                return b"".join(chunks), media_type
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="Profile picture unavailable") from exc
