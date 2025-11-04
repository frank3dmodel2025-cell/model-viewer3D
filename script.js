let scene, camera, renderer, controls, gltfLoader;
let modelContainer = null, currentModel = null;
let deviceOrientationControls;
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
let worldAnchor = new THREE.Object3D(); // NUEVO: Ancla para mantener modelo fijo

// Estado para pinch scaling
let pinchState = { active: false, lastDist: 0 };

// Overlay permisos sensores iOS
const permissionOverlay = document.getElementById('request-permission-overlay');
const permissionButton = document.getElementById('request-permission-btn');

permissionButton.addEventListener('click', async () => {
  if(typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'){
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if(res === 'granted'){
        permissionOverlay.style.display = 'none';
        enableMotionTracking();
      } else {
        alert('Permiso denegado para sensores.');
      }
    } catch (e){
      alert('Error solicitando permisos.');
    }
  } else {
    permissionOverlay.style.display = 'none';
    enableMotionTracking();
  }
});

function initThree(){
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x3b4233, 1);
  document.getElementById('three-container').appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 1.5);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 1);
  dir.position.set(5, 5, 5);
  scene.add(dir);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, -2);
  controls.update();

  modelContainer = new THREE.Group();
  worldAnchor.add(modelContainer); // Modelo ahora hijo del ancla
  scene.add(worldAnchor);

  gltfLoader = new THREE.GLTFLoader();

  deviceOrientationControls = new THREE.DeviceOrientationControls(camera);
  deviceOrientationControls.enabled = false;

  window.addEventListener('resize', onWindowResize);

  renderer.domElement.addEventListener('touchstart', onTouchStart, { passive:false });
  renderer.domElement.addEventListener('touchmove', onTouchMove, { passive:false });
  renderer.domElement.addEventListener('touchend', onTouchEnd, { passive:false });
}

function loadModelByName(name){
  document.getElementById('current-model').textContent = name;
  if(currentModel){
    modelContainer.remove(currentModel);
    disposeModel(currentModel);
    currentModel = null;
  }
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
    if(placedOnce){
      currentModel.visible = true;
    } else {
      currentModel.visible = false;
    }
  }, undefined, (err) => {
    console.error('Error cargando GLTF', err);
    showAlert('Error cargando modelo.');
  });
}

function animate(){
  requestAnimationFrame(animate);
  if (controls && controls.enabled) controls.update();
  if (isMotionTrackingActive && deviceOrientationControls && deviceOrientationControls.enabled){
    deviceOrientationControls.update();
  }
  renderer.render(scene, camera);
}

// NUEVO: función para convertir coords de pantalla a posición AR relativa a worldAnchor
function screenToWorldAR(x, y, distance = 2.0){
  const ndcX = (x / window.innerWidth)*2 - 1;
  const ndcY = -(y / window.innerHeight)*2 + 1;
  const ndcZ = 0.5;
  const vec = new THREE.Vector3(ndcX, ndcY, ndcZ).unproject(camera);
  const dir = vec.sub(camera.position).normalize();
  const worldPos = camera.position.clone().add(dir.multiplyScalar(distance));
  return worldPos;
}

// NUEVO: Colocar modelo usando worldAnchor para fijarlo en AR
function placeModelAtScreen(x, y){
  if(!modelContainer) return;
  const pos = screenToWorldAR(x, y, 2.0);
  worldAnchor.position.copy(pos); // mover el ancla, no la cámara ni la escena
  worldAnchor.rotation.set(0, 0, 0);
  if(currentModel) currentModel.visible = true;
  placedOnce = true;
  showPlacementDot(false);
  reubicBtn.style.display = 'block';
  resetScaleBtn.style.display = 'block';
  showAlert('Modelo colocado ✅');

  // Actualizar sliders
  document.getElementById('ar-x-slider').value = worldAnchor.position.x;
  document.getElementById('ar-y-slider').value = worldAnchor.position.y;
  document.getElementById('ar-x-value').textContent = worldAnchor.position.x.toFixed(1);
  document.getElementById('ar-y-value').textContent = worldAnchor.position.y.toFixed(1);
}

function updateModelPlacement(){
  if(!worldAnchor) return;
  const x = parseFloat(document.getElementById('ar-x-slider').value);
  const y = parseFloat(document.getElementById('ar-y-slider').value);
  const zRot = parseFloat(document.getElementById('ar-z-slider').value) * Math.PI/180;
  worldAnchor.position.set(x, y, -2);
  worldAnchor.rotation.z = zRot;
  document.getElementById('ar-x-value').textContent = x.toFixed(1);
  document.getElementById('ar-y-value').textContent = y.toFixed(1);
  document.getElementById('ar-z-value').textContent = (zRot * 180/Math.PI).toFixed(0);
}
