"""
Builds her refined egg head for the game and exports public/models/egg-head.glb.

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/blender/build_head.py

Conventions (Blender, Z up): the face looks toward -Y, which glTF/Three turns into +Z.
Units match src/render/egg.ts: egg height H = 2.2, base radius R = 0.82, bottom at z = 0.

Exported objects
  Body        sculpted egg (round cheeks, soft jaw), cylindrical UVs (u = 0.5 at the front,
              v = height / H) so the game's painted texture lines up. Shape key: Puff.
  (eyes, brows and mouth are painted Mii-style by the game on a decal over this head)
  Nose        soft button nose, local.
  HairLowbun  hair cap, low bun with tie, face-framing strands (body space).
  BangsWispy  wispy curtain bangs (body space).
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

H = 2.2
R = 0.82
FACE_Y = H * 0.63
FACE_S = 0.66
HAIRLINE = H * 0.8

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "public", "models", "egg-head.glb")
PREVIEW = os.path.join(ROOT, "tools", "blender", "preview")


def g(x, s):
    return math.exp(-(x * x) / (2 * s * s))


def radius_at(h):
    u = max(-1.0, min(1.0, (h / H) * 2 - 1))
    return R * math.sqrt(max(0.0, 1 - u * u)) * (1 - 0.16 * u)


def sculpt(theta, h):
    """Outward offset that turns the plain egg into her face: full round cheeks, soft jaw."""
    off = 0.0
    for s in (-1, 1):
        off += 0.06 * g(theta - s * 0.62, 0.3) * g(h - 1.12, 0.26)  # cheeks
        off -= 0.012 * g(theta - s * 0.27, 0.11) * g(h - 1.43, 0.09)  # eye sockets
    off += 0.022 * g(theta, 0.75) * g(h - 0.92, 0.22)  # chin and jaw fullness
    off += 0.008 * g(theta, 0.55) * g(h - 1.66, 0.07)  # soft brow ridge
    return off


def puff(theta, h):
    return sum(0.05 * g(theta - s * 0.6, 0.32) * g(h - 1.1, 0.25) for s in (-1, 1))


def surf(theta, h, off=0.0):
    r = radius_at(h) + off
    return Vector((math.sin(theta) * r, -math.cos(theta) * r, h))


# ---------------------------------------------------------------- scene

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def hexc(h, a=1.0):
    h = h.lstrip("#")
    srgb = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    return (*lin, a)


def material(name, color, rough=0.6, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = hexc(color)
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = hexc(color)
                break
        bsdf.inputs["Emission Strength"].default_value = emit
    return m


MAT = {
    "skin": material("skin", "#f6d3b8"),
    "white": material("white", "#ffffff", 0.25),
    "iris": material("iris", "#3a2620", 0.3),
    "pupil": material("pupil", "#120c0e", 0.3),
    "glint": material("glint", "#ffffff", 0.1, emit=1.0),
    "ink": material("ink", "#241c22", 0.5),
    "lip": material("lip", "#c9786f", 0.45),
    "mouth": material("mouth", "#5e1f30", 0.6),
    "teeth": material("teeth", "#fbf7f2", 0.3),
    "hair": material("hair", "#1c1719", 0.45),
    "tie": material("tie", "#7e4a8c", 0.6),
    "brow": material("brow", "#1c1719", 0.6),
}


def new_object(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(MAT[m])
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def add_key(ob, name, positions):
    if ob.data.shape_keys is None:
        ob.shape_key_add(name="Basis", from_mix=False)
    k = ob.shape_key_add(name=name, from_mix=False)
    assert len(positions) == len(k.data), (ob.name, name, len(positions), len(k.data))
    for i, p in enumerate(positions):
        k.data[i].co = p
    return k


def quad_strip(bm, vs, columns, per_col=4):
    """Box-section strip: each column has top-front, top-back, bottom-front, bottom-back."""
    for i in range(columns):
        a, b = i * per_col, (i + 1) * per_col
        bm.faces.new((vs[a + 0], vs[a + 2], vs[b + 2], vs[b + 0]))
        bm.faces.new((vs[a + 1], vs[b + 1], vs[b + 3], vs[a + 3]))
        bm.faces.new((vs[a + 0], vs[b + 0], vs[b + 1], vs[a + 1]))
        bm.faces.new((vs[a + 2], vs[a + 3], vs[b + 3], vs[b + 2]))


# ---------------------------------------------------------------- body

def build_body():
    NU, NV = 72, 56
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    hs = [0.003 + (H - 0.006) * (1 - math.cos(math.pi * i / NV)) / 2 for i in range(NV + 1)]
    grid, base, puffed = [], [], []
    for h in hs:
        row = []
        for j in range(NU + 1):
            th = -math.pi + 2 * math.pi * j / NU
            p = surf(th, h, sculpt(th, h))
            base.append(p)
            puffed.append(surf(th, h, sculpt(th, h) + puff(th, h)))
            row.append(bm.verts.new(p))
        grid.append(row)
    for i in range(NV):
        for j in range(NU):
            f = bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
            for loop, (ii, jj) in zip(f.loops, ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                loop[uv].uv = (jj / NU, hs[ii] / H)
    for ring, z, flip in ((0, 0.0, True), (NV, H, False)):
        c = bm.verts.new((0, 0, z))
        base.append(Vector((0, 0, z)))
        puffed.append(Vector((0, 0, z)))
        for j in range(NU):
            a, b = grid[ring][j], grid[ring][j + 1]
            f = bm.faces.new((c, b, a) if flip else (c, a, b))
            for loop in f.loops:
                vv = loop.vert
                if vv is c:
                    loop[uv].uv = ((j + 0.5) / NU, z / H)
                else:
                    loop[uv].uv = ((j + 1 if vv is b else j) / NU, z / H)
    ob = new_object("Body", bm, ["skin"])
    add_key(ob, "Puff", puffed)
    return ob


# ---------------------------------------------------------------- eyes

ER = 0.2 * FACE_S


def ellipsoid_point(t, s, a, d, b):
    """t: polar angle from the top, s: angle around the vertical axis (0 = front)."""
    return Vector((math.sin(t) * math.sin(s) * a, -math.sin(t) * math.cos(s) * d, math.cos(t) * b))


def build_sclera():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * ER * 1.18, v.co.y * ER * 0.42 + 0.012, v.co.z * ER * 0.95))
    return new_object("Sclera", bm, ["white"])


def build_iris():
    bm = bmesh.new()
    parts = [("iris", 0.66, 0.0), ("pupil", 0.36, -0.004), ("glint", 0.15, -0.008)]
    for idx, (name, r, dy) in enumerate(parts):
        res = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1.0)
        for v in res["verts"]:
            co = Vector((v.co.x * ER * r, v.co.y * ER * 0.12 - ER * 0.36 + dy, v.co.z * ER * r * 1.08 - ER * 0.12))
            if name == "glint":
                co += Vector((ER * 0.24, 0, ER * 0.26))
            v.co = co
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = idx
    return new_object("Iris", bm, ["iris", "pupil", "glint"])


def build_lid():
    """Upper lid shell just outside the eye white; coverage set by shape keys."""
    NK, NS = 10, 18
    a, d, b = ER * 1.27, ER * 0.5, ER * 1.05
    band = 0.24

    def shell(T):
        pts = []
        for k in range(NK + 1):
            t = (T - band) * k / (NK - 1) if k < NK else T
            t = max(0.0, t)
            for si in range(NS + 1):
                s = -1.45 + 2.9 * si / NS
                p = ellipsoid_point(t, s, a, d, b)
                p.y += 0.012
                if k >= NK - 1:
                    p.y -= 0.004
                pts.append(p)
        return pts

    bm = bmesh.new()
    verts = [bm.verts.new(p) for p in shell(0.85)]
    for k in range(NK):
        for si in range(NS):
            i0 = k * (NS + 1) + si
            f = bm.faces.new((verts[i0], verts[i0 + 1], verts[i0 + NS + 2], verts[i0 + NS + 1]))
            f.material_index = 1 if k >= NK - 1 else 0
    ob = new_object("Lid", bm, ["skin", "ink"])
    add_key(ob, "Close", shell(math.pi * 0.98))
    add_key(ob, "Sleepy", shell(math.pi * 0.63))
    add_key(ob, "Wide", shell(0.42))
    return ob


# ---------------------------------------------------------------- brows

def build_brow():
    N = 14
    w = 0.17 * FACE_S
    th = 0.028

    def strip(curve):
        pts = []
        for i in range(N + 1):
            x = -w + 2 * w * i / N
            u = i / N
            z = curve(x, u)
            taper = 0.55 + 0.45 * math.sin(math.pi * min(1.0, u * 1.15))
            for side in (1, -1):
                for depth in (0.0, -0.012):
                    pts.append(Vector((x, depth, z + side * th * 0.5 * taper)))
        return pts

    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in strip(lambda x, u: 0.022 * (1 - (x / w) ** 2))]
    quad_strip(bm, vs, N)
    ob = new_object("Brow", bm, ["brow"])
    # inner end is -x (toward the nose) for the right brow
    add_key(ob, "Worry", strip(lambda x, u: 0.022 * (1 - (x / w) ** 2) + 0.045 * (1 - u) ** 1.5 - 0.008 * u))
    add_key(ob, "Angry", strip(lambda x, u: 0.022 * (1 - (x / w) ** 2) - 0.035 * (1 - u) ** 1.5 + 0.01 * u))
    add_key(ob, "Raise", strip(lambda x, u: 0.03 * (1 - (x / w) ** 2) + 0.03))
    add_key(ob, "Flat", strip(lambda x, u: 0.0))
    add_key(ob, "Arch", strip(lambda x, u: 0.05 * (1 - (x / w) ** 2)))
    return ob


# ---------------------------------------------------------------- mouth

MW = 0.25 * FACE_S


def build_mouth_line():
    N = 20
    th = 0.024

    def line(f, width=1.0):
        pts = []
        for i in range(N + 1):
            u = -1 + 2 * i / N
            x = u * MW * width
            z = f(u)
            taper = 0.6 + 0.4 * math.cos(u * math.pi / 2)
            for side in (1, -1):
                for depth in (0.0, -0.008):
                    pts.append(Vector((x, depth, z + side * th * 0.5 * taper)))
        return pts

    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in line(lambda u: -0.035 * (1 - u * u))]
    quad_strip(bm, vs, N)
    ob = new_object("MouthLine", bm, ["lip"])
    add_key(ob, "Flat", line(lambda u: -0.004))
    add_key(ob, "Frown", line(lambda u: 0.028 * (1 - u * u) - 0.02))
    add_key(ob, "Wavy", line(lambda u: 0.018 * math.sin(u * math.pi * 3.5)))
    add_key(ob, "Big", line(lambda u: -0.06 * (1 - u * u), 1.25))
    add_key(ob, "Small", line(lambda u: -0.02 * (1 - u * u), 0.5))
    return ob


def build_mouth_open():
    NX, NY = 18, 8
    soft = lambda u: -0.035 * (1 - u * u)

    def shape(top, bottom, xs=1.0):
        pts = []
        for j in range(NY + 1):
            t = j / NY
            for i in range(NX + 1):
                u = -1 + 2 * i / NX
                z = top(u) + (bottom(u) - top(u)) * t
                pts.append(Vector((u * MW * xs, -0.004, z)))
        return pts

    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in shape(soft, soft)]
    for j in range(NY):
        for i in range(NX):
            a = j * (NX + 1) + i
            f = bm.faces.new((vs[a], vs[a + NX + 1], vs[a + NX + 2], vs[a + 1]))
            f.material_index = 1 if j < 2 else 0
    ob = new_object("MouthOpen", bm, ["mouth", "teeth"])
    add_key(ob, "Grin", shape(lambda u: 0.012 - 0.012 * u * u, lambda u: -0.13 * (1 - u * u) ** 0.8, 1.2))
    add_key(ob, "O", shape(lambda u: 0.06 * math.sqrt(max(0.0, 1 - u * u)), lambda u: -0.075 * math.sqrt(max(0.0, 1 - u * u)) - 0.01, 0.32))
    return ob


def build_nose():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.048, v.co.y * 0.03 - 0.01, v.co.z * 0.036))
    return new_object("Nose", bm, ["skin"])


# ---------------------------------------------------------------- hair

def head_normal(p):
    n = Vector((p.x, p.y, 0.0))
    if n.length < 1e-6:
        return Vector((0, 0, 1))
    n.normalize()
    up = (p.z - H * 0.6) / H
    return (n + Vector((0, 0, up))).normalized()


def ribbon(bm, path, widths, mat_index=0):
    """Flat tapered clump along `path`, double-sided by the renderer."""
    left, right = [], []
    for i, p in enumerate(path):
        nxt = path[min(i + 1, len(path) - 1)]
        prv = path[max(i - 1, 0)]
        tangent = (nxt - prv).normalized()
        side = tangent.cross(head_normal(p)).normalized()
        left.append(bm.verts.new(p + side * widths[i]))
        right.append(bm.verts.new(p - side * widths[i]))
    for i in range(len(path) - 1):
        f = bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
        f.material_index = mat_index


def build_hair():
    bm = bmesh.new()
    NU, NV = 56, 14
    rows = []
    for i in range(NV + 1):
        h = HAIRLINE - 0.04 + (H - 0.03 - HAIRLINE + 0.04) * (i / NV) ** 0.9
        row = []
        for j in range(NU):
            th = -math.pi + 2 * math.pi * j / NU
            dip = 0.08 * g(abs(th) - 1.3, 0.35) + 0.22 * g(abs(th) - math.pi, 0.7)
            hh = h - dip * (1 - i / NV)
            vol = 0.05 + 0.025 * math.sin(i / NV * math.pi)
            row.append(bm.verts.new(surf(th, min(hh, H - 0.002), vol)))
        rows.append(row)
    for i in range(NV):
        for j in range(NU):
            bm.faces.new((rows[i][j], rows[i][(j + 1) % NU], rows[i + 1][(j + 1) % NU], rows[i + 1][j]))
    top = bm.verts.new((0, 0, H + 0.03))
    for j in range(NU):
        bm.faces.new((rows[NV][j], rows[NV][(j + 1) % NU], top))

    # low bun at the back, with swirl grooves
    res = bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=0.3)
    c = Vector((0, 0.86, H * 0.5))
    for v in res["verts"]:
        a = math.atan2(v.co.z, v.co.x)
        groove = 1 + 0.06 * math.sin(a * 5 + v.co.y * 18)
        v.co = Vector((v.co.x * groove, v.co.y * 0.85 * groove, v.co.z * 0.92 * groove)) + c

    # face-framing strands
    for s in (-1, 1):
        for t0, drop, w0 in ((1.0, 0.55, 0.035), (1.18, 0.42, 0.028)):
            qs = [x / 9 for x in range(10)]
            path = [surf(s * (t0 + 0.05 * q), HAIRLINE - 0.02 - drop * q, 0.05 + 0.01 * math.sin(q * 3)) for q in qs]
            ribbon(bm, path, [w0 * (1 - 0.85 * q) for q in qs])

    # hair tie around the bun (a torus in the XZ plane)
    tie_c = Vector((0, 0.64, H * 0.5))
    seg, ring = 24, 8
    tv = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for j in range(ring):
            b = 2 * math.pi * j / ring
            rr = 0.18 + 0.035 * math.cos(b)
            tv.append(bm.verts.new(tie_c + Vector((math.cos(a) * rr, math.sin(b) * 0.035, math.sin(a) * rr))))
    for i in range(seg):
        for j in range(ring):
            a0 = i * ring + j
            a1 = i * ring + (j + 1) % ring
            b0 = ((i + 1) % seg) * ring + j
            b1 = ((i + 1) % seg) * ring + (j + 1) % ring
            f = bm.faces.new((tv[a0], tv[b0], tv[b1], tv[a1]))
            f.material_index = 1
    return new_object("HairLowbun", bm, ["hair", "tie"])


def build_bangs():
    bm = bmesh.new()
    xs = [-0.95, -0.76, -0.58, -0.4, -0.24, -0.09, 0.09, 0.24, 0.4, 0.58, 0.76, 0.95]
    for idx, t0 in enumerate(xs):
        side = -1 if t0 < 0 else 1
        length = 0.12 + abs(t0) * 0.16 + (idx % 3) * 0.03
        sweep = side * (0.06 + abs(t0) * 0.14)
        steps = 10
        path = []
        for q in range(steps + 1):
            u = q / steps
            th = t0 + sweep * u * u
            h = HAIRLINE + 0.03 - length * u
            path.append(surf(th, h, 0.045 + 0.012 * (1 - u)))
        ribbon(bm, path, [0.042 * (1 - 0.9 * (q / steps) ** 1.2) for q in range(steps + 1)])
    return new_object("BangsWispy", bm, ["hair"])


# ---------------------------------------------------------------- build + preview + export

# The game paints her face Mii-style on top of this head, so only the sculpted shapes ship.
# The eye/brow/mouth builders above are kept for experiments; add them here to export them.
parts = [
    build_body(),
    build_nose(),
    build_hair(),
    build_bangs(),
]


def place_preview():
    """Assemble a copy the way the game does, for render checks only (not exported)."""
    col = bpy.data.collections.new("Preview")
    scene.collection.children.link(col)

    def copy(name, loc, rot_z=0.0, mirror=False, keys=None):
        src = bpy.data.objects[name]
        ob = src.copy()
        ob.data = src.data.copy()
        ob.location = loc
        ob.rotation_euler = (0, 0, rot_z)
        if mirror:
            ob.scale.x = -1
        if keys and ob.data.shape_keys:
            for k, v in keys.items():
                ob.data.shape_keys.key_blocks[k].value = v
        col.objects.link(ob)
        return ob

    copy("Body", (0, 0, 0))
    copy("HairLowbun", (0, 0, 0))
    copy("BangsWispy", (0, 0, 0))
    ny = FACE_Y - 0.24 * FACE_S
    copy("Nose", surf(0, ny, sculpt(0, ny)))
    return col


def render_previews():
    for ob in parts:
        ob.hide_render = True
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 70
    scene.collection.objects.link(cam)
    scene.camera = cam
    light = bpy.data.objects.new("key", bpy.data.lights.new("key", "SUN"))
    light.data.energy = 3.0
    light.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(light)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = hexc("#efe9fb")
    bg.inputs[1].default_value = 1.0
    scene.world = world
    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    for e in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        if e in engines:
            scene.render.engine = e
            break
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    os.makedirs(PREVIEW, exist_ok=True)
    target = Vector((0, 0, 1.25))
    for name, direction in (("front", Vector((0, -1, 0.12))), ("three_quarter", Vector((0.75, -1, 0.2))), ("back", Vector((0.2, 1, 0.15)))):
        cam.location = target + direction.normalized() * 6.5
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(PREVIEW, f"{name}.png")
        bpy.ops.render.render(write_still=True)
    for ob in parts:
        ob.hide_render = False


place_preview()
if "--no-preview" not in sys.argv:
    render_previews()

bpy.ops.object.select_all(action="DESELECT")
for ob in parts:
    ob.select_set(True)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_morph=True,
    export_morph_normal=False,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
)
print("EXPORTED", OUT, os.path.getsize(OUT))
for ob in parts:
    keys = [k.name for k in ob.data.shape_keys.key_blocks] if ob.data.shape_keys else []
    print("PART", ob.name, len(ob.data.vertices), keys)
