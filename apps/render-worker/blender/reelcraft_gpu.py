"""Finding and choosing the GPU Blender renders with. Shared by probe.py and run_scene.py."""

import bpy

# In order of preference: the fastest backend a computer has wins.
BACKENDS = ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI")


def _cycles_prefs():
    return bpy.context.preferences.addons["cycles"].preferences


def list_devices():
    """Every GPU Cycles can use, as [{"backend", "name"}]. Empty on a CPU-only computer."""
    prefs = _cycles_prefs()
    found = []
    for backend in BACKENDS:
        try:
            prefs.compute_device_type = backend
        except TypeError:
            # This Blender build has no such backend (e.g. METAL on Linux).
            continue
        prefs.refresh_devices()
        for device in prefs.devices:
            if device.type == backend:
                found.append({"backend": backend, "name": device.name})
    return found


def use_best_gpu():
    """Turns on every GPU of the best backend for Cycles. Returns that backend, or None for the CPU."""
    prefs = _cycles_prefs()
    for backend in BACKENDS:
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.refresh_devices()
        gpus = [device for device in prefs.devices if device.type == backend]
        if not gpus:
            continue
        for device in prefs.devices:
            device.use = device.type == backend
        return backend
    prefs.compute_device_type = "NONE"
    return None
