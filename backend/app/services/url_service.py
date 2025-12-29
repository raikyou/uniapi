from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit


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
    if base_segments and path_segments and base_segments[-1] == path_segments[0]:
        base_segments = base_segments[:-1]
        base_path = "/" + "/".join(base_segments) if base_segments else ""

    if base_path.endswith("/") and path_part.startswith("/"):
        joined_path = base_path + path_part[1:]
    elif not base_path.endswith("/") and not path_part.startswith("/"):
        joined_path = base_path + "/" + path_part
    else:
        joined_path = base_path + path_part

    return urlunsplit((base.scheme, base.netloc, joined_path, base.query, base.fragment))
