"""Build a 6-inch, 4 mm pad with a flush, separately printable L color region."""

from pathlib import Path
import struct
import sys
import xml.etree.ElementTree as ET
import zipfile

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'sma-standoff-mount'))
from widen_mount import inspect_mesh, read_stl

WIDTH = 152.4
HEIGHT = 4.0
LETTER_DEPTH = 0.8
XS = np.array([0, 44.2, 60.2, 108.2, WIDTH])
YS = np.array([0, 35.2, 51.2, 117.2, WIDTH])
ZS = np.array([0, HEIGHT - LETTER_DEPTH, HEIGHT])
CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'


def surface(labels, selected):
    """Emit only cell boundary faces; the common grid keeps edges conforming."""
    result = []
    for i, j, k in np.ndindex(labels.shape):
        if labels[i, j, k] not in selected:
            continue
        x0, x1 = XS[i:i + 2]
        y0, y1 = YS[j:j + 2]
        z0, z1 = ZS[k:k + 2]
        faces = [
            ((-1, 0, 0), [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)]),
            ((1, 0, 0), [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)]),
            ((0, -1, 0), [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)]),
            ((0, 1, 0), [(x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)]),
            ((0, 0, -1), [(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)]),
            ((0, 0, 1), [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]),
        ]
        for delta, quad in faces:
            neighbor = np.array([i, j, k]) + delta
            if (np.all(neighbor >= 0) and np.all(neighbor < labels.shape)
                    and labels[tuple(neighbor)] in selected):
                continue
            result.extend([[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]])
    return np.array(result).astype(np.float32).astype(np.float64)


def write_stl(path, triangles):
    data = bytearray(b'Lucidity launch pad; STL units millimetres'.ljust(80, b'\0'))
    data.extend(struct.pack('<I', len(triangles)))
    for triangle in triangles:
        normal = np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0])
        normal /= np.linalg.norm(normal)
        data.extend(struct.pack('<12fH', *normal, *triangle.ravel(), 0))
    path.write_bytes(data)
    assert np.array_equal(read_stl(path), triangles)


def model_xml(parts):
    ET.register_namespace('', CORE)
    root = ET.Element(f'{{{CORE}}}model', {'unit': 'millimeter', '{http://www.w3.org/XML/1998/namespace}lang': 'en-US'})
    for name, text in [('Title', 'Lucidity launch pad - 6 inches, 4 mm, flush L'),
                       ('Designer', 'Lucidity'),
                       ('Description', 'Two aligned parts. Assign contrasting PLA filaments to Pad and L. No printer settings or toolpaths included.')]:
        ET.SubElement(root, 'metadata', {'name': name}).text = text
    resources = ET.SubElement(root, 'resources')
    materials = ET.SubElement(resources, 'basematerials', {'id': '1'})
    ET.SubElement(materials, 'base', {'name': 'Pad - dark PLA', 'displaycolor': '#303840FF'})
    ET.SubElement(materials, 'base', {'name': 'L - light PLA', 'displaycolor': '#F6F1E7FF'})
    for object_id, name, index, triangles in parts:
        obj = ET.SubElement(resources, 'object', {'id': str(object_id), 'type': 'model',
                                                'name': name, 'pid': '1', 'pindex': str(index)})
        mesh = ET.SubElement(obj, 'mesh')
        vertices, inverse = np.unique(triangles.reshape(-1, 3), axis=0, return_inverse=True)
        vertex_xml = ET.SubElement(mesh, 'vertices')
        for vertex in vertices:
            ET.SubElement(vertex_xml, 'vertex', {key: f'{value:.9g}' for key, value in zip('xyz', vertex)})
        triangle_xml = ET.SubElement(mesh, 'triangles')
        for face in inverse.reshape(-1, 3):
            ET.SubElement(triangle_xml, 'triangle', {f'v{i + 1}': str(value) for i, value in enumerate(face)})
    assembly = ET.SubElement(resources, 'object', {'id': '4', 'type': 'model', 'name': 'Launch Pad 6x6in - 4mm - L'})
    components = ET.SubElement(assembly, 'components')
    for object_id, _, _, _ in parts:
        ET.SubElement(components, 'component', {'objectid': str(object_id)})
    build = ET.SubElement(root, 'build')
    ET.SubElement(build, 'item', {'objectid': '4'})
    return ET.tostring(root, encoding='utf-8', xml_declaration=True)


def main():
    labels = np.ones((len(XS) - 1, len(YS) - 1, len(ZS) - 1), dtype=int)
    # Large upright L, centered by its 64 x 82 mm bounding box; 16 mm strokes.
    labels[1, 1:3, 1] = 2
    labels[2, 1, 1] = 2
    pad = surface(labels, {1})
    letter = surface(labels, {2})
    full = surface(labels, {1, 2})
    reports = [inspect_mesh(mesh)[1] for mesh in (pad, letter, full)]
    assert all(report['euler_characteristic'] == 2 for report in reports)
    assert np.isclose(reports[0]['volume_mm3'] + reports[1]['volume_mm3'], reports[2]['volume_mm3'])
    assert np.isclose(reports[2]['volume_mm3'], WIDTH * WIDTH * HEIGHT)
    assert np.allclose(reports[2]['size_mm'], [WIDTH, WIDTH, HEIGHT], atol=1e-5, rtol=0)
    assert reports[1]['bounds_mm'][1][2] == HEIGHT
    assert np.allclose(reports[1]['size_mm'], [64, 82, LETTER_DEPTH], atol=1e-5, rtol=0)
    write_stl(HERE / 'Launch-Pad_6x6in_4mm_Pad.stl', pad)
    write_stl(HERE / 'Launch-Pad_6x6in_4mm_L.stl', letter)
    # A simple plain option remains available if the departure deadline is tight.
    write_stl(HERE / 'Launch-Pad_6x6in_4mm_Plain.stl', full)
    parts = [(2, 'Pad', 0, pad), (3, 'L', 1, letter)]
    xml = model_xml(parts)
    package = HERE / 'Launch-Pad_6x6in_4mm_L.3mf'
    with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as out:
        out.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?>'
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                     '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
                     '</Types>')
        out.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?>'
                     '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                     '<Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/>'
                     '</Relationships>')
        out.writestr('3D/3dmodel.model', xml)
    with zipfile.ZipFile(package) as saved:
        assert saved.testzip() is None
        root = ET.fromstring(saved.read('3D/3dmodel.model'))
        assert len(root.findall(f'.//{{{CORE}}}mesh')) == 2
        assert len(root.findall(f'.//{{{CORE}}}component')) == 2
    print(package)
    for name, report in zip(('Pad', 'L', 'Complete shape'), reports):
        print(f"{name}: {report['triangles']} faces, watertight, one component, positive volume, no degenerate faces.")
    print('Dimensions 152.4 x 152.4 x 4 mm; 0.8 mm flush letter; parts have no volume overlap.')


if __name__ == '__main__':
    main()
