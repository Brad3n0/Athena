"""How's my PC doing? CPU, memory, disks, graphics card, battery, network and the busiest apps."""
from __future__ import annotations

import subprocess
import sys
import time
from typing import Any

WIN = sys.platform.startswith("win")
_gpu_info: list[dict[str, Any]] | None = None


def _run(cmd: list[str], timeout: float = 8) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                              creationflags=0x08000000 if WIN else 0).stdout  # no console window flash
    except Exception:
        return ""


def gpu_live() -> dict[str, Any] | None:
    """Current graphics card load, memory in use and (NVIDIA only) temperature."""
    global _gpu_info
    out = _run(["nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
                "--format=csv,noheader,nounits"])
    if out.strip():
        name, util, used, total, temp = [p.strip() for p in out.strip().splitlines()[0].split(",")]
        return {"name": name, "usage_percent": float(util), "memory_used_gb": round(float(used) / 1024, 1),
                "memory_total_gb": round(float(total) / 1024, 1), "temperature_c": float(temp)}
    if not WIN:
        return None
    if _gpu_info is None:
        from .system import gpus

        _gpu_info = gpus()
    # Windows' own performance counters work for any brand of graphics card.
    ps = ("$u=(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples | "
          "Measure-Object CookedValue -Sum; $m=(Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage' -ErrorAction SilentlyContinue)"
          ".CounterSamples | Measure-Object CookedValue -Maximum; \"$($u.Sum)|$($m.Maximum)\"")
    util, _, mem = _run(["powershell", "-NoProfile", "-Command", ps], timeout=12).strip().partition("|")
    info = (_gpu_info or [{}])[0]
    result: dict[str, Any] = {"name": info.get("name", "Graphics card"), "memory_total_gb": info.get("vram_gb"),
                              "temperature_c": None, "temperature_note": "Windows doesn't share this card's temperature with apps"}
    try:
        result["usage_percent"] = round(min(100.0, float(util)), 1)
    except ValueError:
        pass
    try:
        result["memory_used_gb"] = round(float(mem) / 1024**3, 1)
    except ValueError:
        pass
    return result


def status(top: int = 5) -> dict[str, Any]:
    import psutil

    procs = list(psutil.process_iter(["name", "memory_info"]))
    for p in procs:  # first reading; the second one after the CPU sample gives each app's share
        try:
            p.cpu_percent(None)
        except psutil.Error:
            pass
    net1 = psutil.net_io_counters()
    t0 = time.time()
    cpu = psutil.cpu_percent(interval=0.8)
    dt = time.time() - t0
    net2 = psutil.net_io_counters()
    cores = psutil.cpu_count() or 1

    by_app: dict[str, dict[str, float]] = {}
    for p in procs:
        try:
            name = (p.info["name"] or "?").removesuffix(".exe")
            if name.lower() in ("system idle process", "idle", "system", "memory compression", "registry"):
                continue
            entry = by_app.setdefault(name, {"cpu": 0.0, "mem": 0.0})
            entry["cpu"] += p.cpu_percent(None) / cores
            entry["mem"] += (p.info["memory_info"].rss if p.info["memory_info"] else 0) / 1024**3
        except psutil.Error:
            continue
    top_cpu = sorted(by_app.items(), key=lambda kv: -kv[1]["cpu"])[:top]
    top_mem = sorted(by_app.items(), key=lambda kv: -kv[1]["mem"])[:top]

    mem = psutil.virtual_memory()
    disks = []
    for part in psutil.disk_partitions(all=False):
        if WIN and ("cdrom" in part.opts or not part.fstype):
            continue
        if not WIN and part.mountpoint.startswith(("/snap", "/boot", "/proc", "/sys", "/run", "/dev")):
            continue
        try:
            u = psutil.disk_usage(part.mountpoint)
        except (PermissionError, OSError):
            continue
        if u.total < 2 * 1024**3:  # tiny system/recovery partitions
            continue
        disks.append({"drive": part.device.rstrip("\\") if WIN else part.mountpoint, "free_gb": round(u.free / 1024**3, 1),
                      "total_gb": round(u.total / 1024**3, 1), "used_percent": round(u.percent)})
    freq = psutil.cpu_freq()
    battery = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None
    temps = {}
    if hasattr(psutil, "sensors_temperatures"):
        try:
            for chip, readings in (psutil.sensors_temperatures() or {}).items():
                if readings and chip in ("coretemp", "k10temp", "zenpower", "cpu_thermal"):
                    temps["cpu_c"] = max(r.current for r in readings)
        except Exception:
            pass
    uptime_h = (time.time() - psutil.boot_time()) / 3600
    return {
        "cpu": {"usage_percent": cpu, "cores": cores, "speed_ghz": round(freq.current / 1000, 2) if freq else None,
                "temperature_c": temps.get("cpu_c"), **({} if temps else {"temperature_note": "Windows doesn't share the CPU temperature with apps"} if WIN else {})},
        "memory": {"used_gb": round(mem.used / 1024**3, 1), "total_gb": round(mem.total / 1024**3, 1), "used_percent": mem.percent},
        "gpu": gpu_live(),
        "disks": disks,
        "network": {"download_mbps": round((net2.bytes_recv - net1.bytes_recv) * 8 / dt / 1e6, 1),
                    "upload_mbps": round((net2.bytes_sent - net1.bytes_sent) * 8 / dt / 1e6, 1)},
        "battery": {"percent": round(battery.percent), "charging": battery.power_plugged} if battery else None,
        "uptime": f"{int(uptime_h // 24)}d {int(uptime_h % 24)}h" if uptime_h >= 24 else f"{int(uptime_h)}h {int(uptime_h * 60 % 60)}m",
        "busiest_apps_cpu": [{"app": n, "cpu_percent": round(v["cpu"], 1)} for n, v in top_cpu if v["cpu"] >= 0.5],
        "biggest_apps_memory": [{"app": n, "memory_gb": round(v["mem"], 2)} for n, v in top_mem],
    }
