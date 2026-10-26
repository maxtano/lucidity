import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createViewerVenue } from './viewerVenue';

function worldPosition(object: THREE.Object3D) {
  return object.getWorldPosition(new THREE.Vector3()).toArray();
}

function instanceWorldMatrix(mesh: THREE.InstancedMesh, index: number) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return matrix.premultiply(mesh.matrixWorld).toArray();
}

describe('audience reference venue', () => {
  it('moves the complete stage and its lighting without moving the ground or audience', () => {
    const venue = createViewerVenue();
    try {
      const ground = venue.group.getObjectByName('Circular audience ground')!;
      const bodies = venue.group.getObjectByName('Abstract audience bodies') as THREE.InstancedMesh;
      const heads = venue.group.getObjectByName('Abstract audience heads') as THREE.InstancedMesh;
      const front = venue.stage.getObjectByName('Warm front deck edge')!;
      const backdrop = venue.stage.getObjectByName('Backdrop housing')!;
      const truss = venue.stage.getObjectByName('Minimal rear portal truss') as THREE.InstancedMesh;
      const stageLight = venue.stage.children.find(
        (child) => child instanceof THREE.DirectionalLight
      ) as THREE.DirectionalLight;
      expect(ground.parent).toBe(venue.group);
      expect(bodies.parent).toBe(venue.group);
      expect(heads.parent).toBe(venue.group);
      expect(stageLight.target.parent).toBe(venue.stage);
      // Actual architecture defines the local front; this does not restate Stage's heading formula.
      expect(front.position.z).toBeGreaterThan(0);
      expect(backdrop.position.z).toBeLessThan(0);
      expect(bodies.count).toBeGreaterThan(0);
      venue.group.updateMatrixWorld(true);
      const before = {
        ground: ground.matrixWorld.toArray(),
        body: instanceWorldMatrix(bodies, 0),
        head: instanceWorldMatrix(heads, heads.count - 1),
        front: worldPosition(front),
        backdrop: worldPosition(backdrop),
        truss: instanceWorldMatrix(truss, 0),
        light: worldPosition(stageLight),
        target: worldPosition(stageLight.target),
        frontToBackdrop: front
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(backdrop.getWorldPosition(new THREE.Vector3())),
      };

      // Exercise the returned stage group's isolation under a nontrivial rigid transform.
      venue.stage.position.set(37, 0, -95);
      venue.stage.rotation.y = Math.PI / 3;
      venue.group.updateMatrixWorld(true);
      expect(worldPosition(venue.stage)).toEqual([37, 0, -95]);
      expect(ground.matrixWorld.toArray()).toEqual(before.ground);
      expect(instanceWorldMatrix(bodies, 0)).toEqual(before.body);
      expect(instanceWorldMatrix(heads, heads.count - 1)).toEqual(before.head);
      expect(worldPosition(front)).not.toEqual(before.front);
      expect(worldPosition(backdrop)).not.toEqual(before.backdrop);
      expect(instanceWorldMatrix(truss, 0)).not.toEqual(before.truss);
      expect(worldPosition(stageLight)).not.toEqual(before.light);
      expect(worldPosition(stageLight.target)).not.toEqual(before.target);
      expect(
        front
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(backdrop.getWorldPosition(new THREE.Vector3()))
      ).toBeCloseTo(before.frontToBackdrop, 10);
    } finally {
      venue.dispose();
    }
  });

  it('disposes every attached graphics resource exactly once, including shared assets and instances', () => {
    const venue = createViewerVenue();
    const parent = new THREE.Scene();
    parent.add(venue.group);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const instances: THREE.InstancedMesh[] = [];
    const lights: THREE.Light[] = [];
    let geometryReferences = 0;
    venue.group.traverse((object) => {
      const renderable = object as THREE.Mesh;
      if (renderable.geometry) {
        geometryReferences++;
        geometries.add(renderable.geometry);
      }
      if (renderable.material)
        for (const material of Array.isArray(renderable.material)
          ? renderable.material
          : [renderable.material])
          materials.add(material);
      if (object instanceof THREE.InstancedMesh) instances.push(object);
      if (object instanceof THREE.Light) lights.push(object);
    });
    expect(geometryReferences).toBeGreaterThan(geometries.size);
    expect(materials.size).toBeGreaterThan(0);
    expect(instances.length).toBeGreaterThan(0);
    expect(lights.length).toBeGreaterThan(0);
    const spies = [...geometries, ...materials, ...instances, ...lights].map((resource) =>
      vi.spyOn(resource, 'dispose')
    );
    try {
      venue.dispose();
      expect(venue.group.parent).toBeNull();
      expect(parent.children).not.toContain(venue.group);
      expect(venue.stage.children).toEqual([]);
      expect(venue.group.children).toEqual([]);
      for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
      expect(() => venue.dispose()).not.toThrow();
      for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      venue.dispose();
      for (const spy of spies) spy.mockRestore();
    }
  });
});
