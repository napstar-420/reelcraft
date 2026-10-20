"""Reports this Blender's version and GPUs as one JSON line, for Settings.

Run with: blender -b --factory-startup --python probe.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from reelcraft_gpu import list_devices  # noqa: E402

result = {"version": bpy.app.version_string, "devices": []}
try:
    result["devices"] = list_devices()
except Exception as error:  # A broken GPU driver must not hide the version.
    result["error"] = str(error)
print("REELCRAFT_PROBE " + json.dumps(result), flush=True)
