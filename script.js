// --- INICIO: Código JS adaptado para AR sin WebXR ---

let scene, camera, renderer, controls, gltfLoader;
let modelContainer = null, currentModel = null;
let deviceOrientationControls, deviceOrientationObject;
let isARMode = false, isMotionTrackingActive = false;

const videoElement = document.getElementById('video-feed');

const MODELS = {
  Duck: 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0/Duck/glTF/Duck.gltf',
  Helmet: 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0/DamagedHelmet/glTF/DamagedHelmet.gltf',
  BoomBox: 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0/BoomBox/glTF/BoomBox.gltf'
};

const placementDot = document.getElementById('placement-dot');
const placementHint = document.getElementById('placement-hint');
const reubicBtn = document.getElementById('reubic-btn');
const resetScaleBtn = document.getElementById('reset-scale-btn');

let lastTapTime = 0;
let placedOnce = false;
let pinchState = { active: false, lastDist: 0 };

let yawOffset = 0, pitchOffset = 0, rollOffset = 0;

const permissionOverlay = document.getElementById('request-permission-overlay');
const permissionButton = document.getElementById('request-permission-btn');

permissionButton.addEventListener('click', async () => {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') {
        permissionOverlay.style.display = 'none';
        enableMotionTracking();
      } else alert('Permiso denegado para sensores.');
    } catch (e) { alert('Error solicitando permisos.'); }
  } else { permissionOverlay.style.display = 'none'; enableMotionTracking(); }
});

function initThree() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 1000);
  camera.position.set(0, 0, 0);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x3b4233, 1);
  document.getElementById('three-container').appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 1.5); scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 1); dir.position.set(5,5,5); scene.add(dir);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.target.set(0,0,-2); controls.update();

  modelContainer = new THREE.Group();
  scene.add(modelContainer);

  gltfLoader = new THREE.GLTFLoader();

  deviceOrientationObject = new THREE.Object3D();
  deviceOrientationControls = new THREE.DeviceOrientationControls(deviceOrientationObject);
  deviceOrientationControls.enabled = false;

  window.addEventListener('resize', onWindowResize);

  renderer.domElement.addEventListener('touchstart', onTouchStart, { passive:false });
  renderer.domElement.addEventListener('touchmove', onTouchMove, { passive:false });
  renderer.domElement.addEventListener('touchend', onTouchEnd, { passive:false });
}

function loadModelByName(name){
  document.getElementById('current-model').textContent = name;
  if(currentModel){ modelContainer.remove(currentModel); disposeModel(currentModel); currentModel=null; }
  showAlert(`Cargando ${name}...`);
  gltfLoader.load(MODELS[name], (gltf) => {
    currentModel = gltf.scene;
    const box = new THREE.Box3().setFromObject(currentModel);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    currentModel.position.sub(center);
    const scaleFactor = 1.5 / Math.max(size.x, size.y, size.z);
    currentModel.scale.setScalar(scaleFactor);
    modelContainer.add(currentModel);
    addContactShadow(currentModel, size.y);
    showAlert(`${name} cargado.`);
    currentModel.visible = placedOnce ? true : false;
  });
}

function disposeModel(obj){
  obj.traverse(o => {
    if(o.isMesh){
      if(o.geometry) o.geometry.dispose();
      if(o.material) Array.isArray(o.material)? o.material.forEach(m=>m.dispose()):o.material.dispose();
    }
  });
}

function addContactShadow(model, modelHeight){
  const c=document.createElement('canvas'); c.width=c.height=256;
  const ctx=c.getContext('2d');
  const g=ctx.createRadialGradient(128,128,10,128,128,128);
  g.addColorStop(0,'rgba(0,0,0,0.6)'); g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,256,256);
  const tex=new THREE.CanvasTexture(c);
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
  sprite.name='contactShadow';
  sprite.position.set(0,-(modelHeight/2||0.5),0); sprite.scale.set(1.6,1.6,1);
  model.add(sprite);
}

function onWindowResize(){
  if(!camera||!renderer) return;
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth,window.innerHeight);
}

let lastCameraQuat = new THREE.Quaternion();
let smoothedCameraQuat = new THREE.Quaternion();
let anchorWorldPosition = new THREE.Vector3();

function animate(){
  requestAnimationFrame(animate);
  if(controls && controls.enabled) controls.update();

  if(isMotionTrackingActive && deviceOrientationControls.enabled){
    deviceOrientationControls.update();
    const offsetEuler = new THREE.Euler(pitchOffset, yawOffset, rollOffset,'YXZ');
    const offsetQuat = new THREE.Quaternion().setFromEuler(offsetEuler);
    const targetQuat = deviceOrientationObject.quaternion.clone().multiply(offsetQuat);
    const angle = smoothedCameraQuat.angleTo(targetQuat);
    let alpha=0.18; if(angle>0.5) alpha=0.45; else if(angle>0.15) alpha=0.28;
    smoothedCameraQuat.slerp(targetQuat,alpha);
    camera.quaternion.copy(smoothedCameraQuat);
    lastCameraQuat.copy(smoothedCameraQuat);
  }

  // --- FIX: Estabiliza modelo con tracking visual simple ---
  if(placedOnce && modelContainer){
    // Aquí podrías agregar detección simple de plano usando opencv.js en el futuro
    // Por ahora, solo suavizamos la posición hacia anchor
    modelContainer.position.lerp(anchorWorldPosition,0.25);
  }

  renderer.render(scene,camera);
}

// --- Resto de tu código pinch, sliders, placement dot, toggleARMode, etc. ---
// Funciones startCameraPassThrough, stopCameraPassThrough, toggleARMode, enableMotionTracking, 
// disableMotionTracking, placeModelAtScreen, screenToWorld permanecen igual, pero ahora
// la posición del modelo se fija usando anchorWorldPosition y smoothedCameraQuat para la cámara

// --- FIN: Código JS adaptado para AR sin WebXR ---
