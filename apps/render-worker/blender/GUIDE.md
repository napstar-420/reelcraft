# Writing a scene for Blender

You are writing `outputs/scene.py`, a Python module for Blender 5.2 that builds one shot of a
video. Reelcraft runs it headless (no window, no user add-ons) and renders it. The same script is
run again for the draft and the final render, so it must build the same scene every time.

## The contract

```python
import bpy

def build(rc):
    ...  # add everything the shot needs
```

`build(rc)` starts from an **empty scene** (no objects, no camera, no lights, no world). The size,
frame rate and length are already set: frames run from `1` to `rc.frames`. Reelcraft resets them
after `build`, so don't change them. You must add a camera and set `rc.scene.camera`. A scene
without one fails.

`rc` gives you:

|                                          |                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `rc.scene`                               | `bpy.context.scene`                                                                                                 |
| `rc.width`, `rc.height`, `rc.fps`        | the video's size and frame rate                                                                                     |
| `rc.duration`, `rc.frames`               | length in seconds, and the last frame                                                                               |
| `rc.frame(seconds)`                      | the frame shown at that time: use it to key things to moments                                                       |
| `rc.asset(name)`                         | the local path of an input file, by its name                                                                        |
| `rc.assets`                              | every input, `{name: path}`                                                                                         |
| `rc.import_model(name, collection=None)` | imports a .glb/.gltf/.fbx/.obj (or every object of a .blend) and returns the new top-level objects                  |
| `rc.image_plane(name, height=1.0)`       | a flat, unlit card showing a picture with its transparency, upright in the picture plane (x right, z up, facing -y) |
| `rc.data`                                | data the stage was given, e.g. `rc.data["timing"]` (see below)                                                      |
| `rc.random`                              | a seeded `random.Random`. Use it for anything random, never `random` or the clock                                   |
| `rc.transparent`                         | the background must stay transparent (a clip laid over others)                                                      |
| `rc.quality`                             | `"draft"` or `"final"`. Don't branch on it; Reelcraft lowers the size and samples itself                            |

Only load files through `rc.asset`, `rc.import_model` and `rc.image_plane`. Never read or write
anything else, use the network, or run other programs.

## Checking your work

Run `node preview.mjs 1 24 48` (any frame numbers) to render those frames as draft PNGs into
`outputs/previews/`. **Look at them**, fix what is wrong, and preview again. Check that:

- the subject is in frame and the right size, at the start, middle and end
- nothing important is cut off, hidden behind something, or lit too dark
- motion happens when the instructions say (use `rc.frame(seconds)`)

The previews run your real `outputs/scene.py`, so an error in it shows up there with its
traceback. Two or three rounds of previews are usually enough. Attach the last ones as evidence.

## Units and space

Blender units are metres; z is up. For a person-sized character, 1.6 to 1.8 units tall. For 2D work,
the picture plane is x (right) and z (up), and the camera looks along +y from negative y.

## Camera

```python
cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
rc.scene.collection.objects.link(cam)
rc.scene.camera = cam
cam.location = (0, -8, 1.6)
cam.rotation_euler = (math.radians(90), 0, 0)  # looking along +y
```

- For 2D, an orthographic camera: `cam.data.type = "ORTHO"`, `cam.data.ortho_scale` = the visible
  width in units.
- To aim at something: add a `TRACK_TO` constraint (`track_axis="TRACK_NEGATIVE_Z"`,
  `up_axis="UP_Y"`) with an empty as its target, and animate the empty or the camera.
- For a 9:16 video, the frame is tall: keep the subject narrow and centred.

## Animation

Animate by setting a property and keying it: `obj.location = (...)` then
`obj.keyframe_insert("location", frame=rc.frame(1.5))`. Keyed curves ease in and out by default; for
steady motion set each keyframe's `interpolation = "LINEAR"` through `obj.animation_data.action`.
Blender 5 uses layered actions: reach a curve with
`for fcurve in action.layers[0].strips[0].channelbags[0].fcurves`. Shape keys (`obj.shape_key_add`,
then key `key_blocks[name].value`) animate a face or a squash. Drivers and Python handlers don't
run in the render; bake motion into keyframes instead.

## Characters and rigs

- A model from the inputs: `rc.import_model("hero")`. It may bring its own armature and actions
  (glTF animations become actions). Play one by assigning it:
  `armature.animation_data_create(); armature.animation_data.action = bpy.data.actions[name]`.
- Building a cartoon character yourself: combine simple meshes (spheres, capsules from cylinders
  with a `SUBSURF` modifier, cones), parent the parts to one empty or to bones, and give them flat
  colours. Keep it simple and readable: a clear silhouette beats detail.
- Posing: rotate bones in pose mode data (`armature.pose.bones[name].rotation_euler`, with
  `rotation_mode = "XYZ"`) and key them. Rigify needs the add-on, which isn't loaded; build plain
  armatures.
- Lip sync: with `rc.data["timing"]["words"]` (each `{"text", "startSec", "endSec"}`), open the
  mouth (a shape key or a scaled mouth mesh) at each word's start and close it at its end.

## Looks

- **Flat cartoon (2D or 3D):** an `Emission` shader with the colour gives a flat colour that needs no
  light. For shading in bands, EEVEE's `Shader to RGB` into a `Color Ramp` with `CONSTANT`
  interpolation (EEVEE only, not Cycles).
- **Outlines:** a Line Art modifier (`gp_obj.modifiers.new("Lines", "LINEART")`) on a Grease
  Pencil object, with the scene or a collection as its source, or `rc.scene.render.use_freestyle = True` with a line set.
- **Lit 3D:** `Principled BSDF`, a sun (`bpy.data.lights.new(name, "SUN")`) or area lights, and a
  world colour or HDRI-free sky colour. For a filmic look set
  `rc.scene.view_settings.view_transform = "AgX"`; the default here is `"Standard"`, which keeps
  colours exactly as written.
- **World colour:** `world = bpy.data.worlds.new("World"); rc.scene.world = world`, then set the
  `Background` node's colour in `world.node_tree`. Leave the world out when `rc.transparent`.
- Materials: create node materials with `bpy.data.materials.new(name)`; nodes are in
  `material.node_tree.nodes`. `Material.use_nodes` is going away; materials made in Blender 5 have
  nodes already.

## 2D

- **Cut-out animation:** each picture input becomes `rc.image_plane(name, height=...)`. Move, rotate
  (about y) and scale the cards, layer them by y (nearer the camera covers further away), and
  parent parts (arm to body) to animate them like puppets.
- **Drawn lines:** Grease Pencil (Blender 5 API):

```python
gp = bpy.data.grease_pencils.new("Drawing")
obj = bpy.data.objects.new("Drawing", gp)
rc.scene.collection.objects.link(obj)
ink = bpy.data.materials.new("Ink")
bpy.data.materials.create_gpencil_data(ink)
ink.grease_pencil.color = (0.05, 0.05, 0.05, 1)
gp.materials.append(ink)
layer = gp.layers.new("Lines")
drawing = layer.frames.new(1).drawing  # a frame per drawing; add more frames to animate
drawing.add_strokes([32])               # one stroke of 32 points
for i, point in enumerate(drawing.strokes[0].points):
    point.position = (x, 0, z)          # in the picture plane
    point.radius = 0.02
```

To draw a line on over time, add a frame per step with more points each time, or add the build
modifier: `obj.modifiers.new("Build", "GREASE_PENCIL_BUILD")`.

- Text: `bpy.data.curves.new(name, "FONT")` with `body`, an object from it, and an emission
  material. Prefer leaving words to the video's timeline when they are titles or captions.

## Rendering

Reelcraft picks the engine (EEVEE when there is a GPU, otherwise Cycles on the CPU) unless the
stage chose one, and sets samples and the GPU. Don't change render settings except the colour view
transform, Freestyle and film transparency (which follows `rc.transparent`). Keep scenes light:
modest subdivision, a few lights, no heavy simulations. A frame should render in seconds.

The same script can be rendered as a single picture instead of a clip: the stage picks the moment
to show (in seconds, as with `rc.frame`). When you are asked for a still, make the scene short
(`durationSec` of 1 is enough) and compose the whole picture at that moment.

## Sound

Scenes are silent. Voice, music and sound effects belong on the video's timeline, which places the
rendered clip with them. Use the voice's timing data to key motion to the words.
