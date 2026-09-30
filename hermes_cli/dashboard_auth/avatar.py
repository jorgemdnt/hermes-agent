"""Bounded, same-origin avatar proxy for the verified Google OIDC picture claim."""
from __future__ import annotations

import logging
import sqlite3
import time
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException

from hermes_cli.dashboard_auth.base import Session

_MAX_BYTES = 1024 * 1024
_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
_log = logging.getLogger(__name__)


def picture_for_session(session: Session) -> str:
    from hermes_cli.dashboard_auth.avatar_cache import profile_picture
    picture = google_picture_url(session.picture)
    # A supplied but disallowed URL is not an omitted optional claim.
    if session.picture and not picture:
        return ""
    try:
        return google_picture_url(profile_picture(session.provider, session.user_id, picture))
    except (OSError, sqlite3.DatabaseError):
        _log.warning("dashboard-avatar: profile cache unavailable")
        return picture


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
    from hermes_cli.dashboard_auth.avatar_cache import read_image, write_image
    try:
        cached = read_image(url)
    except (OSError, sqlite3.DatabaseError):
        _log.warning("dashboard-avatar: image cache unavailable")
        cached = None
    if cached and time.time() - cached[2] < 86400:
        return cached[:2]
    try:
        image, media_type = await _download_avatar(url)
    except HTTPException:
        if cached:
            _log.warning("dashboard-avatar: upstream unavailable; serving cached photo")
            return cached[:2]
        raise
    try:
        write_image(url, image, media_type)
    except (OSError, sqlite3.DatabaseError):
        _log.warning("dashboard-avatar: could not cache photo")
    return image, media_type


async def _download_avatar(url: str) -> tuple[bytes, str]:
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=False) as client:
            async with client.stream("GET", url, headers={"Accept": "image/jpeg,image/png,image/webp"}) as response:
                media_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                if response.status_code != 200 or media_type not in _IMAGE_TYPES:
                    _log.warning("dashboard-avatar: upstream status=%s media_type=%s", response.status_code, media_type)
                    raise HTTPException(status_code=502, detail="Profile picture unavailable", headers={"Cache-Control": "no-store", "Retry-After": "1"})
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
        _log.warning("dashboard-avatar: upstream request failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Profile picture unavailable", headers={"Cache-Control": "no-store", "Retry-After": "1"}) from exc
