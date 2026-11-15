"""Dependency-free isometric SVG preview of a structure.

Members are drawn back to front (so near members overlay far ones) and coloured
by height; foundations are dark squares and loads red markers. Previews show
exact lattice geometry, not deflected shapes.
"""

from __future__ import annotations

import math

from .lattice import Node, Structure

_COS, _SIN = math.cos(math.radians(30)), math.sin(math.radians(30))
_MAX_Z = 11


def _project(node: Node) -> tuple[float, float]:
    x, y, z = node
    return ((x - y) * _COS, (x + y) * _SIN * 0.5 - z)


def _colour(z: float) -> str:
    """Teal at the ground to amber at the top."""
    t = min(max(z / _MAX_Z, 0.0), 1.0)
    r, g, b = (int(a + (c - a) * t) for a, c in zip((38, 120, 150), (235, 170, 60)))
    return f"#{r:02x}{g:02x}{b:02x}"


def render_svg(structure: Structure, size: int = 360) -> str:
    """Return a self-contained ``<svg>`` string."""
    points = {n: _project(n) for n in structure.nodes}
    xs, ys = [p[0] for p in points.values()], [p[1] for p in points.values()]
    pad = 1.0
    x0, y0 = min(xs) - pad, min(ys) - pad
    w, h = max(xs) - x0 + pad, max(ys) - y0 + pad
    scale = size / max(w, h)

    def at(node: Node) -> str:
        px, py = points[node]
        return f"{(px - x0) * scale:.1f},{(py - y0) * scale:.1f}"

    # Depth: larger x + y is nearer the viewer in this projection.
    ordered = sorted(structure.edges, key=lambda e: (e[0][0] + e[0][1] + e[1][0] + e[1][1], e))
    lines = [
        f'<line x1="{at(a).split(",")[0]}" y1="{at(a).split(",")[1]}" x2="{at(b).split(",")[0]}" '
        f'y2="{at(b).split(",")[1]}" stroke="{_colour((a[2] + b[2]) / 2)}" stroke-width="1.6" stroke-linecap="round"/>'
        for a, b in ordered
    ]
    feet = [
        f'<circle cx="{at(n).split(",")[0]}" cy="{at(n).split(",")[1]}" r="3.5" fill="#222"/>'
        for n in sorted(structure.supports)
    ]
    loads = [
        f'<circle cx="{at(n).split(",")[0]}" cy="{at(n).split(",")[1]}" r="3.2" fill="#d33"/>'
        for n in sorted(structure.loads)
    ]
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w * scale:.0f} {h * scale:.0f}" '
        f'width="{size}" height="{size}" role="img" aria-label="Isometric preview">'
        f'<rect width="100%" height="100%" fill="#f6f4ef"/>{"".join(lines + feet + loads)}</svg>'
    )
