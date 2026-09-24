// Your own 3D anime character (.vrm, e.g. made in VRoid Studio) for voice chat.
// Uses three.js + three-vrm, bundled in /vendor so it works offline.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from './vendor/three-vrm.module.min.js';

const lerp = (a, b, t) => a + (b - a) * t;

export class VrmAvatar {
  static async create(container, url) {
    const avatar = new VrmAvatar(container);
    try {
      await avatar.load(url);
    } catch (e) {
      avatar.destroy();
      throw e;
    }
    return avatar;
  }

  constructor(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'vrm-canvas';
    container.append(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.6, 1.4, 2);
    this.scene.add(key, new THREE.AmbientLight(0xffffff, 0.9));
    this.lookTarget = new THREE.Object3D();
    this.scene.add(this.lookTarget);

    this.state = 'idle';
    this.mouth = 0;
    this.joy = 0;
    this.nextBlink = 1.5;
    this.blinkT = -1;
    this.pointer = { x: 0, y: 0 };
    this.getLevel = () => 0;
    this.clock = new THREE.Clock();

    this._onMove = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointer.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / r.width));
      this.pointer.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.3)) / r.height));
    };
    window.addEventListener('pointermove', this._onMove);
    this._resize = new ResizeObserver(() => this._fit());
    this._resize.observe(container);
  }

  async load(url) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (!vrm) throw new Error('This file is not a VRM character');
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons?.(gltf.scene);
    VRMUtils.rotateVRM0(vrm); // older VRM 0.x models face the other way
    vrm.scene.traverse((o) => { o.frustumCulled = false; });
    this.scene.add(vrm.scene);
    this.vrm = vrm;
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;

    // Relax the arms out of the T-pose.
    const bone = (name) => vrm.humanoid.getNormalizedBoneNode(name);
    this.bones = { head: bone('head'), neck: bone('neck'), spine: bone('spine'), chest: bone('chest') || bone('upperChest') };
    const lArm = bone('leftUpperArm'), rArm = bone('rightUpperArm');
    if (lArm) lArm.rotation.z = -1.2;
    if (rArm) rArm.rotation.z = 1.2;
    const lFore = bone('leftLowerArm'), rFore = bone('rightLowerArm');
    if (lFore) lFore.rotation.z = -0.15;
    if (rFore) rFore.rotation.z = 0.15;
    vrm.update(0);

    // Frame the head and shoulders.
    const head = new THREE.Vector3();
    (this.bones.head || vrm.scene).getWorldPosition(head);
    this.headY = head.y;
    this._fit();
    this._raf = requestAnimationFrame(() => this._tick());
  }

  _fit() {
    const r = this.canvas.parentElement?.getBoundingClientRect();
    if (!r || !r.width) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    const y = this.headY ?? 1.4;
    this.camera.position.set(0, y + 0.02, 1.4);
    this.camera.lookAt(0, y - 0.12, 0);
    this.camera.updateProjectionMatrix();
  }

  setState(state) { this.state = state; }

  cheer(ms = 1400) { this.joyUntil = performance.now() + ms; }

  _tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const t = this.clock.elapsedTime;
    const vrm = this.vrm;
    const em = vrm.expressionManager;
    const level = this.getLevel();

    // lip-sync: mostly "aa" with a little "oh"/"ih" so it doesn't look robotic
    this.mouth = lerp(this.mouth, level, level > this.mouth ? 0.5 : 0.22);
    em?.setValue('aa', Math.min(1, this.mouth * 0.95));
    em?.setValue('oh', Math.max(0, Math.sin(t * 9) * this.mouth * 0.35));
    em?.setValue('ih', Math.max(0, Math.sin(t * 7 + 1) * this.mouth * 0.25));

    // blinking
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkT < 0) this.blinkT = 0;
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt / 0.16;
      blink = this.blinkT < 0.5 ? this.blinkT * 2 : Math.max(0, 2 - this.blinkT * 2);
      if (this.blinkT >= 1) { this.blinkT = -1; this.nextBlink = 2.2 + Math.random() * 3.2; }
    }
    this.joy = lerp(this.joy, performance.now() < (this.joyUntil || 0) ? 1 : 0, 0.12);
    em?.setValue('happy', Math.min(1, this.joy + (this.state === 'speaking' ? 0.18 : 0)));
    em?.setValue('blink', this.joy > 0.5 ? 0 : blink);

    // head + body motion per state
    let tilt = Math.sin(t * 0.7) * 0.03, pitch = 0, yaw = 0;
    if (this.state === 'thinking') { tilt = 0.12; pitch = -0.08; yaw = 0.1; }
    else if (this.state === 'listening') { tilt = -0.07; pitch = 0.03; }
    else if (this.state === 'speaking') { tilt = Math.sin(t * 1.9) * 0.05; pitch = Math.sin(t * 5) * this.mouth * 0.05; }
    const b = this.bones;
    if (b.head) {
      b.head.rotation.z = lerp(b.head.rotation.z, tilt, 0.08);
      b.head.rotation.x = lerp(b.head.rotation.x, pitch, 0.1);
      b.head.rotation.y = lerp(b.head.rotation.y, yaw + this.pointer.x * 0.15, 0.06);
    }
    if (b.chest) b.chest.rotation.x = Math.sin(t * 1.6) * 0.015;
    if (b.spine) b.spine.rotation.z = Math.sin(t * 0.5) * 0.015;

    // eyes follow the pointer (or glance up while thinking)
    const lx = this.state === 'thinking' ? 0.4 : this.pointer.x * 0.6;
    const ly = this.state === 'thinking' ? 0.35 : -this.pointer.y * 0.4;
    this.lookTarget.position.set(lx, this.headY + ly, 1.2);

    vrm.update(dt);
    this.renderer.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(() => this._tick());
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('pointermove', this._onMove);
    this._resize.disconnect();
    if (this.vrm) VRMUtils.deepDispose(this.vrm.scene);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
