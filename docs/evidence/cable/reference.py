"""Independent force-method solution for a point load clamped to a taut, extensible string.

The horizontal component H is uniform; V_left + V_right equals the load.
Each material leg extends by T/EA. The two horizontal projections must reach
the opposite anchor and the vertical projections must cancel. Units are kN/m.
"""
from math import hypot
import json
from pathlib import Path
import sys
import urllib.request


def cable(q, span=8.0, weight=5.0, pretension=25.0, ea=57600.0):
    rest = span / (1 + pretension / ea)
    left, right = q * rest, (1-q) * rest

    def closure(h, v):
        tl, tr = hypot(h,v), hypot(h,weight-v)
        a, b = left*(1/tl+1/ea), right*(1/tr+1/ea)
        return (a+b)*h-span, -a*v+b*(weight-v)

    # With zero pretension a horizontal initial guess of zero points both
    # legs straight down. Start at the shallow-cable scale for this case.
    h = pretension if pretension > 0 else (ea*weight**2*q*(1-q)/2)**(1/3)
    v = (1-q)*weight
    for _ in range(30):
        x, z = closure(h, v)
        if hypot(x,z) < 1e-13:
            break
        step = 1e-5
        a,c = [(t-s)/step for t,s in zip(closure(h+step,v),(x,z))]
        b,d = [(t-s)/step for t,s in zip(closure(h,v+step),(x,z))]
        det = a*d-b*c
        h, v = h-(d*x-b*z)/det, v-(-c*x+a*z)/det
    assert hypot(*closure(h,v)) < 1e-11
    a = left*(1/hypot(h,v)+1/ea)
    return dict(q=q, horizontal=h, left_up=v, right_up=weight-v,
                x=a*h, z=-a*v, left_tension=hypot(h,v), right_tension=hypot(h,weight-v))


if __name__ == "__main__":
    for station in (0.25,0.50,0.75):
        expected = cable(station)
        print(expected)
        if len(sys.argv) > 1:
            sys.path.insert(0,str(Path(__file__).resolve().parents[3] / "services/opensees/tests"))
            from helpers import FIXED, model
            data=model({"a":(0,0,0),"p":(8*station,0,0),"b":(8,0,0)},
                       [("a","p","pinned","pinned"),("p","b","pinned","pinned")],
                       {"a":FIXED,"b":FIXED},{"p":(0,0,-5000)})
            for member, fraction in zip(data["members"],[station,1-station]):
                member["law"]={"kind":"cable","elasticModulus":160e9,"area":0.00036,
                               "restLength":8*fraction/(1+25/57600)}
            data["analysis"]={"type":"corotational"}
            request=urllib.request.Request(sys.argv[1].rstrip("/")+"/analyze", json.dumps(data).encode(), {"Content-Type":"application/json"})
            with urllib.request.urlopen(request,timeout=10) as reply:
                result=json.load(reply)
            assert result["status"]=="success",result
            uz=result["displacements"]["p"][2]
            assert abs(uz-expected["z"])<1e-7,(uz,expected)
            assert abs(result["reactions"]["a"][2]/1000-expected["left_up"])<1e-6
            print("OpenSees clamp z (m):",uz)
