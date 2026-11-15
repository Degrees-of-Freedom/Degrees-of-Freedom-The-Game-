"""Independent OpenSeesPy elastic frame for the nominal four-panel printing in SI.

Rigid factory posts and continuous chords are beam-columns. Pinned diagonals
are axial truss elements. The only restraint is the lower chord's left tip.
"""
import openseespy.opensees as ops


def displacement(station, direction):
    ops.wipe()
    ops.model("basic", "-ndm", 3, "-ndf", 6)
    span = 4.0
    xs = [0.125, span/4, span/2, 3*span/4, span-0.125]
    for i, x in enumerate(xs, 1):
        ops.node(i, x, 0, 0)
        ops.node(i+5, x, 0, 0.5)
    ops.node(11, 0, 0, 0)
    ops.node(12, span, 0, 0)
    ops.fix(11, 1, 1, 1, 1, 1, 1)
    ops.uniaxialMaterial("Elastic", 1, 210e9)
    ops.geomTransf("Linear", 1, 0, 0, 1)
    ops.geomTransf("Linear", 2, 0, 1, 0)
    def beam(tag, a, b, axes):
        ops.element("elasticBeamColumn", tag, a, b, 2.24e-3, 210e9, 81e9,
                    5.13e-6, 3.2e-6, 3.2e-6, axes)
    beam(1, 11, 1, 1)
    beam(2, 5, 12, 1)
    for i in range(1,6):
        beam(10+i, i, i+5, 2)
        if i < 5:
            beam(20+i, i, i+1, 1)
            beam(30+i, i+5, i+6, 1)
            a, b = (i, i+6) if i % 2 else (i+5, i+1)
            ops.element("truss", 40+i, a, b, 2.24e-3, 1)
    ops.timeSeries("Linear", 1)
    ops.pattern("Plain", 1, 1)
    force = [0.0]*6
    force[direction] = -1000
    ops.load(station+1, *force)
    ops.constraints("Plain")
    ops.numberer("RCM")
    ops.system("BandGeneral")
    ops.algorithm("Linear")
    ops.integrator("LoadControl", 1.0)
    ops.analysis("Static")
    assert ops.analyze(1) == 0
    return ops.nodeDisp(station+1, direction+1)


if __name__ == "__main__":
    for direction in [1, 2]:
        print(direction, [displacement(i, direction) for i in range(1, 4)])
