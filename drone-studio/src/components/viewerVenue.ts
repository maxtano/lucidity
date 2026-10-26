import * as THREE from 'three';

/**
 * A quiet, human-scale reference for the audience camera. Three world axes are
 * East / Up / -North. Move only `stage` along -Z; its front faces the viewer at +Z.
 * This scenery has no connection to authored show coordinates or drone channels.
 */
export function createViewerVenue(): {
  group: THREE.Group;
  stage: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();
  group.name = 'Audience venue';
  const stage = new THREE.Group();
  stage.name = 'Stage · front faces +Z';
  group.add(stage);

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const instances = new Set<THREE.InstancedMesh>();
  const geometry = <T extends THREE.BufferGeometry>(resource: T): T => {
    geometries.add(resource);
    return resource;
  };
  const material = <T extends THREE.Material>(resource: T): T => {
    materials.add(resource);
    return resource;
  };
  const standard = (color: number, metalness = 0.1) =>
    material(new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness }));
  const basic = (color: number) => material(new THREE.MeshBasicMaterial({ color }));
  const unitBox = geometry(new THREE.BoxGeometry(1, 1, 1));
  const box = (
    parent: THREE.Group,
    name: string,
    size: [number, number, number],
    position: [number, number, number],
    surface: THREE.Material
  ) => {
    const mesh = new THREE.Mesh(unitBox, surface);
    mesh.name = name;
    mesh.scale.set(...size);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  };

  // Lighting belongs to this group, so hiding the venue also hides its lights.
  // No shadow maps, textures, animation, or per-frame work are needed.
  const ambient = new THREE.HemisphereLight(0x9aaec6, 0x14131b, 0.85);
  ambient.name = 'Dim venue sky';
  group.add(ambient);
  const stageKey = new THREE.DirectionalLight(0xcbd7e2, 1.35);
  stageKey.position.set(-20, 26, 18);
  stageKey.target.position.set(0, 3, 0);
  stage.add(stageKey, stageKey.target);

  const ground = new THREE.Mesh(
    geometry(new THREE.CircleGeometry(340, 128)),
    standard(0x111720, 0)
  );
  ground.name = 'Circular audience ground';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  group.add(ground);

  // Thin low-contrast distance marks remain useful when looking away from the stage.
  // The center is deliberately clear rather than surrounded by a bright reference grid.
  const ringMaterial = material(
    new THREE.LineBasicMaterial({ color: 0x42505e, transparent: true, opacity: 0.24 })
  );
  for (const radius of [12, 28, 48, 76, 112]) {
    const points = Array.from({ length: 192 }, (_, index) => {
      const angle = (index / 192) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * radius, 0.012, Math.sin(angle) * radius);
    });
    const ring = new THREE.LineLoop(
      geometry(new THREE.BufferGeometry().setFromPoints(points)),
      ringMaterial
    );
    ring.name = `Audience distance mark ${radius} m`;
    group.add(ring);
  }
  const aislePoints: THREE.Vector3[] = [];
  for (const x of [-5.4, 5.4]) {
    for (let z = -51; z <= 83; z += 9) {
      if (Math.abs(z) < 8) continue;
      aislePoints.push(new THREE.Vector3(x, 0.014, z), new THREE.Vector3(x, 0.014, z + 1.5));
    }
  }
  const aisles = new THREE.LineSegments(
    geometry(new THREE.BufferGeometry().setFromPoints(aislePoints)),
    material(new THREE.LineBasicMaterial({ color: 0x65717c, transparent: true, opacity: 0.26 }))
  );
  aisles.name = 'Quiet central viewing aisle';
  group.add(aisles);

  const deck = standard(0x35414c, 0.15);
  const front = standard(0x29333f, 0.15);
  const dark = standard(0x1b2530, 0.1);
  // With no environment map, highly metallic steel loses the readable portal outline.
  const steel = standard(0x596b79, 0.25);
  const edge = basic(0xb39164);
  const panel = basic(0x344b5d);
  const panelEdge = basic(0x5b7281);
  const panelDivision = basic(0x456171);
  const panelWash = basic(0x514b42);
  box(stage, 'Stage plinth', [32, 1.03, 12], [0, 0.515, 0], front);
  box(stage, 'Stage deck · 1.1 m', [32.2, 0.07, 12.2], [0, 1.065, 0], deck);
  box(stage, 'Warm front deck edge', [31.5, 0.09, 0.055], [0, 1.06, 6.13], edge);
  for (const x of [-16.08, 16.08])
    box(stage, 'Deck side edge', [0.075, 0.045, 9.5], [x, 1.08, 1.2], panelEdge);

  // Low central stairs give a readable scale cue without putting anything at eye height.
  for (let index = 0; index < 3; index++) {
    const height = 0.825 - index * 0.275;
    const z = 6.65 + index * 1.1;
    box(stage, 'Front access step', [5.8, height, 1.1], [0, height / 2, z], deck);
    box(stage, 'Step edge marker', [5.65, 0.045, 0.045], [0, height, z + 0.545], edge);
  }

  // The dim cool panel and restrained warm reveal remain legible from audience distance.
  // These are static architectural references, not a second animated light show.
  box(stage, 'Backdrop housing', [28.8, 8.45, 0.38], [0, 6.325, -4.7], dark);
  box(stage, 'Dim cool widescreen panel', [27.8, 7.45, 0.035], [0, 6.325, -4.485], panel);
  box(stage, 'Panel lower warm wash', [27.65, 0.45, 0.025], [0, 2.9, -4.445], panelWash);
  for (const x of [-9.3, -4.65, 0, 4.65, 9.3])
    box(stage, 'Quiet panel division', [0.11, 6.8, 0.025], [x, 6.55, -4.445], panelDivision);
  box(stage, 'Backdrop lower warm reveal', [27.85, 0.075, 0.055], [0, 2.6, -4.44], edge);
  box(stage, 'Backdrop upper reveal', [27.85, 0.075, 0.055], [0, 10.075, -4.44], panelEdge);
  for (const x of [-13.95, 13.95])
    box(stage, 'Backdrop side reveal', [0.09, 7.5, 0.055], [x, 6.325, -4.44], panelEdge);
  box(stage, 'Overhead fascia', [34, 0.32, 1.5], [0, 12.55, -4.8], dark);
  box(stage, 'Portal front highlight', [32.8, 0.075, 0.04], [0, 12.43, -4.035], panelEdge);

  // One instanced truss draw, sharing a unit cylinder for poles, crossbars, and braces.
  const members: [THREE.Vector3, THREE.Vector3, number][] = [];
  const member = (a: [number, number, number], b: [number, number, number], radius = 0.065) =>
    members.push([new THREE.Vector3(...a), new THREE.Vector3(...b), radius]);
  for (const x of [-16.4, 16.4]) {
    for (const z of [-5.25, -4.35]) member([x, 1.1, z], [x, 12.4, z], 0.085);
    for (let y = 1.15; y < 12; y += 1.4) {
      const top = Math.min(12.4, y + 1.4);
      member([x, y, -5.25], [x, top, -4.35], 0.045);
      member([x, y, -4.35], [x, top, -5.25], 0.045);
    }
    box(stage, 'Truss footing', [1.5, 0.22, 1.65], [x, 1.21, -4.8], dark);
  }
  for (const y of [11.6, 12.4]) member([-16.4, y, -4.35], [16.4, y, -4.35], 0.075);
  for (let x = -16.4; x < 16.3; x += 2.05) {
    member([x, 11.6, -4.35], [Math.min(16.4, x + 2.05), 12.4, -4.35], 0.04);
  }
  const truss = new THREE.InstancedMesh(
    geometry(new THREE.CylinderGeometry(1, 1, 1, 6)),
    steel,
    members.length
  );
  truss.name = 'Minimal rear portal truss';
  instances.add(truss);
  const pose = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3();
  members.forEach(([start, end, radius], index) => {
    direction.subVectors(end, start);
    pose.position.copy(start).add(end).multiplyScalar(0.5);
    pose.quaternion.setFromUnitVectors(up, direction.clone().normalize());
    pose.scale.set(radius, direction.length(), radius);
    pose.updateMatrix();
    truss.setMatrixAt(index, pose.matrix);
  });
  truss.instanceMatrix.needsUpdate = true;
  truss.computeBoundingSphere();
  stage.add(truss);

  // A few bodies behind and beside the viewer convey scale in every look direction.
  // Foreground and the forward aisle stay empty; a wide x clearance keeps stage movement free.
  const audiencePositions: [number, number, number][] = [];
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 22; column++) {
      const angle = ((column + (row % 2) * 0.5) / 22) * Math.PI * 2;
      const radius = 17 + row * 9 + Math.sin(column * 2.17 + row) * 1.2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (Math.abs(x) < 8 || (z < 6 && Math.abs(x) < 24)) continue;
      audiencePositions.push([x, z, 0.89 + ((column * 7 + row * 3) % 11) * 0.022]);
    }
  }
  const bodyMaterial = standard(0x19222c, 0);
  const headMaterial = standard(0x222a33, 0);
  const bodies = new THREE.InstancedMesh(
    geometry(new THREE.CylinderGeometry(0.17, 0.235, 1.3, 7)),
    bodyMaterial,
    audiencePositions.length
  );
  const heads = new THREE.InstancedMesh(
    geometry(new THREE.SphereGeometry(0.125, 8, 6)),
    headMaterial,
    audiencePositions.length
  );
  bodies.name = 'Abstract audience bodies';
  heads.name = 'Abstract audience heads';
  instances.add(bodies);
  instances.add(heads);
  audiencePositions.forEach(([x, z, height], index) => {
    pose.position.set(x, 0.65 * height, z);
    pose.quaternion.identity();
    pose.scale.set(height, height, height);
    pose.updateMatrix();
    bodies.setMatrixAt(index, pose.matrix);
    pose.position.y = 1.43 * height;
    pose.updateMatrix();
    heads.setMatrixAt(index, pose.matrix);
  });
  for (const mesh of [bodies, heads]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  let disposed = false;
  return {
    group,
    stage,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const mesh of instances) mesh.dispose();
      for (const resource of geometries) resource.dispose();
      for (const resource of materials) resource.dispose();
      ambient.dispose();
      stageKey.dispose();
      instances.clear();
      geometries.clear();
      materials.clear();
      stage.clear();
      group.clear();
    },
  };
}
