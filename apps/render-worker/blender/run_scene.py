"""Runs a scene script inside Blender: builds the scene, then renders it or exports it.

    blender -b --factory-startup --disable-autoexec --python-exit-code 1 \\
        --python run_scene.py -- job.json OUTPUT

`job.json` says what to do (see `SceneJob` in apps/api/src/capability/scene/scene-job.ts). Its
`script` and asset paths are relative to the folder it is in. OUTPUT is the file (or, for "frames",
the folder) to write:

- mode "video":  render every frame to PNG in `framesDir`, then encode `output` with ffmpeg.
                 Frames already in `framesDir` are kept, so a retry carries on where it stopped.
- mode "frames": render only `frames` (frame numbers) as PNGs into the folder `output`, as drafts.
                 This is how the model that wrote the script looks at its work.
- mode "model":  export the built scene to `output` (.glb or .blend).

The script is a Python module with `build(rc)`. It starts from an empty scene whose size, frame rate
and length are already set, and adds everything itself: objects, materials, lights and a camera.
"""

import importlib.util
import json
import math
import os
import random
import subprocess
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from reelcraft_gpu import use_best_gpu  # noqa: E402

CONTRACT_VERSION = 1


class SceneError(Exception):
    """A problem with the scene itself, reported to the model as it is."""


class Context:
    """What `build(rc)` gets. Everything about the video it should follow is here."""

    def __init__(self, job):
        self.width = job["width"]
        self.height = job["height"]
        self.fps = job["fps"]
        self.duration = job["durationSec"]
        #: The last frame; frames run from 1 to `frames`.
        self.frames = max(1, round(job["durationSec"] * job["fps"]))
        self.transparent = job.get("transparent", False)
        self.quality = job.get("quality", "final")
        #: Data the scene reads, e.g. `rc.data["timing"]["words"]` for a voice-over's words.
        self.data = job.get("data") or {}
        #: Each asset's local file, by name.
        self.assets = {name: entry["path"] for name, entry in job.get("assets", {}).items()}
        self.seed = job.get("seed", 0)
        #: Use this (never the clock) for anything random, so a render is the same every time.
        self.random = random.Random(self.seed)
        self.scene = bpy.context.scene

    def frame(self, seconds):
        """The frame shown at `seconds` into the video."""
        return 1 + round(seconds * self.fps)

    def asset(self, name):
        """The local path of the asset called `name`."""
        if name not in self.assets:
            known = ", ".join(sorted(self.assets)) or "none"
            raise SceneError(f'There is no asset called "{name}". Assets: {known}.')
        return self.assets[name]

    def import_model(self, name, collection=None):
        """Imports a .glb/.gltf/.fbx/.obj model, or every object of a .blend, and returns the new
        top-level objects (those with no parent)."""
        path = self.asset(name)
        before = set(bpy.data.objects)
        ext = os.path.splitext(path)[1].lower()
        if ext in (".glb", ".gltf"):
            bpy.ops.import_scene.gltf(filepath=path)
        elif ext == ".fbx":
            bpy.ops.import_scene.fbx(filepath=path)
        elif ext == ".obj":
            bpy.ops.wm.obj_import(filepath=path)
        elif ext == ".blend":
            with bpy.data.libraries.load(path, link=False) as (source, target):
                target.objects = list(source.objects)
            for obj in target.objects:
                if obj is not None:
                    bpy.context.scene.collection.objects.link(obj)
        else:
            raise SceneError(f'"{name}" is not a 3D model ({ext}).')
        added = [obj for obj in bpy.data.objects if obj not in before]
        if collection is not None:
            for obj in added:
                for owner in list(obj.users_collection):
                    owner.objects.unlink(obj)
                collection.objects.link(obj)
        return [obj for obj in added if obj.parent is None]

    def image_plane(self, name, height=1.0):
        """A flat card showing the picture `name`, unlit and with its transparency, standing upright
        in the picture plane (x right, z up, facing -y). `height` is in scene units; the width
        follows the picture's shape. The building block of cut-out 2D animation."""
        image = bpy.data.images.load(self.asset(name))
        width_px, height_px = image.size
        aspect = width_px / height_px if height_px else 1.0
        bpy.ops.mesh.primitive_plane_add(size=1)
        card = bpy.context.object
        card.name = name
        card.rotation_euler = (math.pi / 2, 0, 0)
        card.scale = (height * aspect, height, 1)
        bpy.ops.object.transform_apply(rotation=True, scale=True)
        material = bpy.data.materials.new(name)
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        nodes.clear()
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        texture.interpolation = "Closest" if max(width_px, height_px) <= 64 else "Linear"
        emission = nodes.new("ShaderNodeEmission")
        clear = nodes.new("ShaderNodeBsdfTransparent")
        mix = nodes.new("ShaderNodeMixShader")
        out = nodes.new("ShaderNodeOutputMaterial")
        links.new(texture.outputs["Color"], emission.inputs["Color"])
        links.new(texture.outputs["Alpha"], mix.inputs["Fac"])
        links.new(clear.outputs["BSDF"], mix.inputs[1])
        links.new(emission.outputs["Emission"], mix.inputs[2])
        links.new(mix.outputs["Shader"], out.inputs["Surface"])
        card.data.materials.append(material)
        return card


def load_script(path):
    spec = importlib.util.spec_from_file_location("scene", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not callable(getattr(module, "build", None)):
        raise SceneError("The scene script must define build(rc).")
    return module


def set_up(job):
    """An empty scene with the video's size, frame rate and length."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.resolution_x = job["width"]
    scene.render.resolution_y = job["height"]
    scene.render.resolution_percentage = 100
    scene.render.fps = job["fps"]
    scene.render.fps_base = 1
    scene.frame_start = 1
    scene.frame_end = max(1, round(job["durationSec"] * job["fps"]))
    scene.render.film_transparent = bool(job.get("transparent"))
    # Colours come out as written (flat, cartoon, brand colours); a script wanting a filmic look
    # sets "AgX" itself.
    scene.view_settings.view_transform = "Standard"
    choose_engine(scene, job.get("renderEngine", "auto"), gpu=use_best_gpu())
    return scene


def choose_engine(scene, wanted, gpu):
    """`auto`: EEVEE when there is a GPU, else Cycles on the CPU, which never needs one."""
    engine = {
        "eevee": "BLENDER_EEVEE",
        "cycles": "CYCLES",
        "workbench": "BLENDER_WORKBENCH",
    }.get(wanted, "BLENDER_EEVEE" if gpu else "CYCLES")
    scene.render.engine = engine
    scene.cycles.device = "GPU" if gpu else "CPU"
    if engine == "CYCLES":
        scene.cycles.samples = 64 if gpu else 32
        scene.cycles.use_denoising = True


def enforce(job, scene, draft):
    """What the video needs wins over anything the script changed; a draft is quick and small."""
    scene.render.resolution_x = job["width"]
    scene.render.resolution_y = job["height"]
    scene.render.fps = job["fps"]
    scene.render.fps_base = 1
    scene.frame_start = 1
    scene.frame_end = max(1, round(job["durationSec"] * job["fps"]))
    scene.render.film_transparent = bool(job.get("transparent"))
    if job.get("renderEngine", "auto") != "auto":
        choose_engine(scene, job["renderEngine"], gpu=use_best_gpu())
    elif scene.render.engine == "CYCLES":
        scene.cycles.device = "GPU" if use_best_gpu() else "CPU"
    if scene.camera is None:
        raise SceneError("The scene has no camera. Add one and set scene.camera.")
    if draft:
        scene.render.resolution_percentage = 50
        if scene.render.engine == "CYCLES":
            scene.cycles.samples = min(scene.cycles.samples, 16)
        elif scene.render.engine == "BLENDER_EEVEE":
            scene.eevee.taa_render_samples = min(scene.eevee.taa_render_samples, 16)


def png_output(scene, transparent):
    settings = scene.render.image_settings
    settings.file_format = "PNG"
    settings.color_mode = "RGBA" if transparent else "RGB"
    settings.color_depth = "8"


def render_video(job, scene):
    frames_dir = job["framesDir"]
    os.makedirs(frames_dir, exist_ok=True)
    # A frame cut off mid-write by a crash is left empty; render it again.
    for name in os.listdir(frames_dir):
        file = os.path.join(frames_dir, name)
        if os.path.getsize(file) == 0:
            os.remove(file)
    png_output(scene, job.get("transparent"))
    scene.render.filepath = os.path.join(frames_dir, "frame_")
    scene.render.use_file_extension = True
    # Frames already rendered (by an earlier attempt) are skipped.
    scene.render.use_overwrite = False
    scene.render.use_placeholder = False
    bpy.ops.render.render(animation=True)
    encode(job, frames_dir)


def encode(job, frames_dir):
    pattern = os.path.join(frames_dir, "frame_%04d.png")
    if job.get("transparent"):
        codec = ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30"]
    else:
        crf = "23" if job.get("quality") == "draft" else "18"
        codec = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", crf, "-movflags", "+faststart"]
    command = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-framerate", str(job["fps"]), "-start_number", "1", "-i", pattern,
        # Odd sizes can't be encoded as 4:2:0; drop the last pixel row or column.
        "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2",
        *codec, job["output"],
    ]
    subprocess.run(command, check=True)


def render_frames(job, scene):
    out = job["output"]
    os.makedirs(out, exist_ok=True)
    png_output(scene, job.get("transparent"))
    for number in job.get("frames") or [1]:
        number = min(max(1, int(number)), scene.frame_end)
        scene.frame_set(number)
        scene.render.filepath = os.path.join(out, f"frame_{number:04d}.png")
        bpy.ops.render.render(write_still=True)


def export_model(job, scene):
    out = job["output"]
    if out.endswith(".blend"):
        bpy.ops.wm.save_as_mainfile(filepath=out, copy=True, compress=True)
    else:
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animations=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(argv) < 2:
        raise SceneError("run_scene.py needs the job file and the output: -- job.json OUTPUT")
    with open(argv[0], encoding="utf-8") as handle:
        job = json.load(handle)
    base = os.path.dirname(os.path.abspath(argv[0]))
    job["output"] = os.path.abspath(argv[1])
    job["script"] = os.path.join(base, job["script"])
    for entry in job.get("assets", {}).values():
        entry["path"] = os.path.join(base, entry["path"])
    if job.get("contractVersion") != CONTRACT_VERSION:
        raise SceneError(f"Scene contract {job.get('contractVersion')} is not supported.")
    random.seed(job.get("seed", 0))
    scene = set_up(job)
    rc = Context(job)
    load_script(job["script"]).build(rc)
    mode = job.get("mode", "video")
    enforce(job, scene, draft=mode == "frames" or job.get("quality") == "draft")
    if mode == "video":
        render_video(job, scene)
    elif mode == "frames":
        render_frames(job, scene)
    elif mode == "model":
        export_model(job, scene)
    else:
        raise SceneError(f"Unknown mode {mode}.")


try:
    main()
except SceneError as error:
    print(f"REELCRAFT_ERROR: {error}", file=sys.stderr, flush=True)
    sys.exit(1)
except Exception:
    # The script's own error: the end of the traceback says where in it.
    print("REELCRAFT_ERROR: " + traceback.format_exc()[-1500:], file=sys.stderr, flush=True)
    sys.exit(1)
