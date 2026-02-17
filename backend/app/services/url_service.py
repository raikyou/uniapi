from __future__ import annotations

import re
from urllib.parse import urlsplit, urlunsplit

_VERSION_RE = re.compile(r"^v\d+(?:beta\d*)?$", re.IGNORECASE)


def _is_version_segment(segment: str) -> bool:
    return bool(_VERSION_RE.match(segment))


def join_base_url(base_url: str, path: str) -> str:
    if not base_url:
        return path
    if not path:
        return base_url

    base = urlsplit(base_url)
    base_path = base.path or ""
    path_part = path

    base_segments = [segment for segment in base_path.split("/") if segment]
    path_segments = [segment for segment in path_part.split("/") if segment]
    if base_segments and path_segments:
        if base_segments[-1] == path_segments[0]:
            # Exact duplicate segment: remove from base (existing behaviour)
            base_segments = base_segments[:-1]
            base_path = "/" + "/".join(base_segments) if base_segments else ""
        elif (
            _is_version_segment(base_segments[-1])
            and _is_version_segment(path_segments[0])
        ):
            # Different API version prefixes (e.g. base ends /v3, path starts /v1):
            # keep the version from base_url, strip from path
            path_segments = path_segments[1:]
            path_part = "/" + "/".join(path_segments) if path_segments else ""

    if base_path.endswith("/") and path_part.startswith("/"):
        joined_path = base_path + path_part[1:]
    elif not base_path.endswith("/") and not path_part.startswith("/"):
        joined_path = base_path + "/" + path_part
    else:
        joined_path = base_path + path_part

    return urlunsplit((base.scheme, base.netloc, joined_path, base.query, base.fragment))


def strip_version_prefix(path: str) -> str:
    """Strip leading version segment (e.g. /v1, /v1beta) from a URL path."""
    segments = path.lstrip("/").split("/", 1)
    if segments and _is_version_segment(segments[0]):
        return "/" + segments[1] if len(segments) > 1 else "/"
    return path
