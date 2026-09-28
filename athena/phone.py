"""Use Athena from your phone: the addresses to open on the same Wi-Fi."""
from __future__ import annotations

import os
import socket
from pathlib import Path


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


# ------------------------------------------------------------------ secure (https) address for the phone
# Phone browsers only allow the microphone on https pages. Athena makes her own certificate for your home
# network. It isn't from a public authority, so the phone warns once; after you accept it, voice works.

def https_port(port: int) -> int:
    return port + 1


def cert_paths() -> tuple[Path, Path]:
    from . import store

    folder = store.DATA_DIR / "https"
    return folder / "athena-cert.pem", folder / "athena-key.pem"


def ensure_cert() -> tuple[str, str] | None:
    """Make (or refresh, when the PC's network address changed) the certificate. None if it can't be made."""
    try:
        import datetime
        import ipaddress

        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.x509.oid import NameOID
    except ImportError:
        return None
    cert_file, key_file = cert_paths()
    ips = sorted(set(lan_ips()) | {"127.0.0.1"})
    names = sorted({"localhost", socket.gethostname(), socket.gethostname().lower() + ".local"})
    stamp = cert_file.with_suffix(".for")
    wanted = ",".join(ips + names)
    if cert_file.exists() and key_file.exists() and stamp.exists() and stamp.read_text() == wanted:
        return str(cert_file), str(key_file)
    cert_file.parent.mkdir(parents=True, exist_ok=True)
    key = ec.generate_private_key(ec.SECP256R1())
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Athena AI on " + socket.gethostname()[:40])])
    now = datetime.datetime.now(datetime.timezone.utc)
    san = [x509.DNSName(n) for n in names] + [x509.IPAddress(ipaddress.ip_address(ip)) for ip in ips]
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=820))
            .add_extension(x509.SubjectAlternativeName(san), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(key, hashes.SHA256()))
    key_file.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    stamp.write_text(wanted)
    return str(cert_file), str(key_file)


def https_server(app, host: str, port: int):
    """A second server with the same Athena on https (for the phone's microphone). None if it can't start."""
    import uvicorn

    try:
        paths = ensure_cert()
    except (KeyboardInterrupt, SystemExit):
        raise
    except BaseException as exc:  # a broken crypto library can even panic; never let that stop Athena starting
        print(f"  (Couldn't make the secure phone address: {exc.__class__.__name__}. Typing from the phone still works.)")
        paths = None
    if not paths:
        return None
    os.environ["ATHENA_HTTPS_PORT"] = str(https_port(port))
    config = uvicorn.Config(app, host=host, port=https_port(port), log_level="warning", lifespan="off",
                            ssl_certfile=paths[0], ssl_keyfile=paths[1])
    return uvicorn.Server(config)


def secure_urls() -> list[str]:
    port = os.environ.get("ATHENA_HTTPS_PORT")
    return [f"https://{ip}:{port}" for ip in lan_ips()] if port else []
