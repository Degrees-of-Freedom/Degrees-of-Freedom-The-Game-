"""Independent SI OpenSeesPy reference of the four-panel ring truss.

Loads are applied to actual chord joints. The torque fixture applies equal
opposite vertical forces at the two lower joints of the middle triangle.
"""
import math
import openseespy.opensees as ops


def reference(quarter, direction, torque=False, shear=False):
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    offsets = [(0., 0.), (.5, 0.), (.25, math.sqrt(3)/4)]
    locations = [(0., 0., 0.), (4., 0., 0.)]
    for y, z in offsets:
        locations.extend((x, y, z) for x in [.125, 1., 2., 3., 3.875])
    for i, xyz in enumerate(locations):
        ops.node(1+i, *xyz)
    ops.fix(1, 1, 1, 1, 1, 1, 1)
    ops.uniaxialMaterial("Elastic", 1, 210e9)
    def joint(chord, station):
        return 3 + 5*chord + station

    tag = 0
    def part(start, end, axial=False):
        nonlocal tag
        tag += 1
        if axial:
            ops.element("truss", tag, start, end, 0.00224, 1)
        else:
            # Any nonparallel local reference direction gives the same
            # response for the doubly symmetric square hollow section.
            a, b = locations[start-1], locations[end-1]
            orientation = [0, 0, 1] if a[:2] != b[:2] else [0, 1, 0]
            ops.geomTransf("Linear", tag, *orientation)
            if shear:
                return ops.element("ElasticTimoshenkoBeam", tag, start, end, 210e9, 81e9, .00224,
                                   5.13e-6, 3.2e-6, 3.2e-6, 1.12e-3, 1.12e-3, tag)
            ops.element("elasticBeamColumn", tag, start, end, .00224, 210e9, 81e9,
                        5.13e-6, 3.2e-6, 3.2e-6, tag)
    part(1, joint(0, 0))
    part(joint(0, 4), 2)
    for chord in range(3):
        for station in range(4):
            part(joint(chord, station), joint(chord, station+1))
    for station in range(5):
        for c in range(3):
            d = (c+1) % 3
            part(joint(c, station), joint(d, station))
            if station < 4:
                first, last = (c,d) if station % 2 == 0 else (d,c)
                part(joint(first, station), joint(last, station+1), True)
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    force = [0.] * 6
    force[direction] = -1000.
    point = joint(0, quarter)
    ops.load(point, *force)
    if torque:
        ops.load(joint(1, quarter), 0, 0, 1000., 0, 0, 0)
    ops.constraints("Plain")
    ops.numberer("RCM")
    ops.system("BandGeneral")
    ops.algorithm("Linear")
    ops.integrator("LoadControl", 1.)
    ops.analysis("Static")
    assert ops.analyze(1) == 0
    ops.reactions()
    return [ops.nodeDisp(point, direction+1), ops.nodeDisp(point, 4), ops.nodeReaction(1,4)]


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--shear", action="store_true", help="Include the SHS card shear flexibility used by Rust")
    args = parser.parse_args()
    for direction in [1, 2]:
        print(direction, [reference(q, direction, shear=args.shear) for q in [1,2,3]])
    print("Torque", reference(2, 2, torque=True, shear=args.shear))
