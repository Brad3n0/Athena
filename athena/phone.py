"""Use Athena from your phone: the addresses to open on the same Wi-Fi."""
from __future__ import annotations

import os
import socket


def lan_ips() -> list[str]:
    """This PC's addresses on the home network (the one your phone can reach)."""
    ips: list[str] = []
    try:  # the address Windows uses to reach the internet; no data is sent
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.168.1.1", 9))
            ips.append(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    private = [ip for ip in ips if ip.startswith(("192.168.", "10.", "172.")) or ip.startswith("100.")]
    return private or [ip for ip in ips if not ip.startswith("127.")]


def lan_urls(port: int) -> list[str]:
    return [f"http://{ip}:{port}" for ip in lan_ips()]


def listening_on_network() -> bool:
    return os.environ.get("ATHENA_LISTEN", "127.0.0.1") not in ("127.0.0.1", "localhost", "::1")
