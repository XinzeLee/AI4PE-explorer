import * as THREE from 'three';

// This small story-only assembly surrounds a single conceptual output cable.
// Coordinates are local to J2; it is never parented to the exported assembly.
export function createRogowskiSensor() {
  const group = new THREE.Group();
  group.name = 'Rogowski current sensor and output cable (illustrative)';
  const shell = new THREE.MeshStandardMaterial({ color: '#263940', metalness: .3, roughness: .43 });
  const cableMaterial = new THREE.MeshStandardMaterial({ color: '#334651', metalness: .14, roughness: .62 });
  const windingMaterial = new THREE.MeshStandardMaterial({ color: '#c98a4c', metalness: .72, roughness: .32 });
  const center = new THREE.Vector3(.94, .35, .24), radius = .235, coreRadius = .045;

  const cable = new THREE.Mesh(new THREE.CylinderGeometry(.081, .081, 1.24, 24), cableMaterial);
  cable.name = 'Single output conductor through sensing loop';
  cable.rotation.z = Math.PI / 2; cable.position.set(.98, .35, .24); cable.castShadow = true;
  group.add(cable);

  const core = new THREE.Mesh(new THREE.TorusGeometry(radius, coreRadius, 12, 72), shell);
  core.name = 'Rogowski coil former'; core.position.copy(center); core.rotation.y = Math.PI / 2;
  core.castShadow = true; group.add(core);

  // Wind the copper continuously around the torus cross-section; its open
  // centre leaves the output conductor clearly visible through the loop.
  const turns = 19, samples = turns * 24, points = [];
  for (let i = 0; i <= samples; i++) {
    const angle = i / samples * Math.PI * 2, winding = angle * turns, r = radius + .052 * Math.cos(winding);
    points.push(new THREE.Vector3(center.x + .052 * Math.sin(winding), center.y + r * Math.cos(angle), center.z + r * Math.sin(angle)));
  }
  const winding = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), samples, .008, 6, false), windingMaterial);
  winding.name = 'Fine copper sensing winding'; winding.castShadow = true; group.add(winding);

  const connector = new THREE.Mesh(new THREE.BoxGeometry(.15, .10, .11), shell);
  connector.name = 'Sensor lead exit'; connector.position.set(.94, .35 + radius + .055, .24); group.add(connector);
  const leadPoints = [new THREE.Vector3(.94,.35+radius+.105,.24), new THREE.Vector3(1.08,.35+radius+.18,.27), new THREE.Vector3(1.32,.35+radius+.16,.30)];
  const lead = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(leadPoints), 18, .022, 8, false), cableMaterial);
  lead.name = 'Sensor signal lead'; group.add(lead);
  group.userData.anchorLocal = [.94, .35 + radius + .04, .24];
  return group;
}

export function disposeRogowskiSensor(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
}
