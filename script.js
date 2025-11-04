<script type="module">

let scene, camera, renderer, controls, gltfLoader;
let modelContainer = null, currentModel = null, initialScale = new THREE.Vector3(1, 1, 1);
let deviceOrientationControls;
let isARMode = false, isMotionTrackingActive = false;

// --- MEJORA 1: Arquitectura para suavizado y offset ---
// Usaremos un objeto intermedio para leer los sensores sin afectar directamente la cámara.
let sensorRig; 
// Almacenará la diferencia entre la orientación inicial de la cámara y la del sensor.
let orientationOffset = new THREE.Quaternion();
// Factor de suavizado para el movimiento de la cámara (menor valor = más suave).
const SMOOTHING_FACTOR = 0.05;

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

const permissionOverlay = document.getElementById('request-permission-overlay');
const permissionButton = document.getElementById('request-permission-btn');

permissionButton.addEventListener('click', async () => {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') {
        permissionOverlay.style.display = 'none';
        await onPermissionGranted();
      } else {
        showAlert('Permiso denegado. La función AR no estará disponible.');
      }
    } catch (e) {
      showAlert('Error solicitando permisos.');
    }
  } else {
    permissionOverlay.style.display = 'none';
    await onPermissionGranted();
  }
});

// Función centralizada para cuando se conceden los permisos
async function onPermissionGranted() {
  const ok = await startCameraPassThrough();
  if (!ok) {
      isARMode = false;
      return;
  }
  
  const statusSpan = document.getElementById('ar-mode-status');
  const controlsDiv = document.getElementById('placement-controls');
  const toggleBtn = document.getElementById('toggle-ar-mode-btn');

  statusSpan.textContent = 'Activo';
  controlsDiv.classList.remove('hidden');
  toggleBtn.textContent = 'Desactivar Cámara y AR';
  toggleBtn.classList.remove('bg-red-500');
  toggleBtn.classList.add('bg-green-600');
  controls.enabled = false;
  document.getElementById('lock-status').textContent = 'ON (Mover)';

  if (!placedOnce) {
    showPlacementDot(true);
  } else {
    showPlacementDot(false);
    reubicBtn.style.display = 'block';
    resetScaleBtn.style.display = 'block';
  }
  
  // Activa el seguimiento de movimiento DESPUÉS de que todo esté configurado
  enableMotionTracking();
}

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
  scene.add(modelContainer);

  gltfLoader = new THREE.GLTFLoader();

  // --- MEJORA 1 (continuación): Inicializar el sensorRig ---
  sensorRig = new THREE.Object3D();
  deviceOrientationControls = new THREE.DeviceOrientationControls(sensorRig);
  deviceOrientationControls.enabled = false;

  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
  renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
  renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: false });
}

function loadModelByName(name){
  document.getElementById('current-model').textContent = name;
  if (currentModel) {
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
    
    // Guardamos la escala inicial para la función de reinicio
    initialScale.set(scaleFactor, scaleFactor, scaleFactor);

    modelContainer.add(currentModel);
    showAlert(`${name} cargado.`);
    currentModel.visible = placedOnce;
  }, undefined, (err) => {
    console.error('Error cargando GLTF', err);
    showAlert('Error cargando modelo.');
  });
}

function disposeModel(obj){
  obj.traverse(o => {
    if (o.isMesh) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) {
          o.material.forEach(m => m.dispose());
        } else m.dispose();
      }
    }
  });
}

function onWindowResize(){
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(){
  requestAnimationFrame(animate);

  // --- MEJORA 2: Lógica de renderizado con suavizado y offset ---
  if (isMotionTrackingActive && deviceOrientationControls && deviceOrientationControls.enabled) {
    // 1. Actualiza el sensorRig con los datos crudos del giroscopio.
    deviceOrientationControls.update();
    
    // 2. Calcula la orientación final deseada aplicando el offset a la lectura del sensor.
    const targetQuaternion = new THREE.Quaternion().multiplyQuaternions(orientationOffset, sensorRig.quaternion);

    // 3. Interpola suavemente la cámara hacia esa orientación final (¡esto evita los saltos!).
    camera.quaternion.slerp(targetQuaternion, SMOOTHING_FACTOR);

  } else if (controls && controls.enabled) {
    controls.update();
  }

  renderer.render(scene, camera);
}

function enableMotionTracking() {
  if (!isARMode) {
    showAlert('Activa Modo AR primero.');
    return;
  }
  
  isMotionTrackingActive = true;
  deviceOrientationControls.enabled = true;
  
  // --- MEJORA 3: Cálculo del Offset para una transición perfecta ---
  // Capturamos la orientación actual de la cámara
  const initialCameraQuaternion = camera.quaternion.clone();

  // Forzamos una actualización para tener la primera lectura del sensor en sensorRig
  deviceOrientationControls.update(); 
  const initialSensorQuaternion = sensorRig.quaternion.clone();

  // El offset es la "diferencia" rotacional. Se calcula multiplicando la orientación de la cámara
  // por la inversa de la orientación del sensor.
  const inverseSensorQuat = initialSensorQuaternion.invert();
  orientationOffset.multiplyQuaternions(initialCameraQuaternion, inverseSensorQuat);
  
  showAlert('Giroscopio activo.');
}

function disableMotionTracking() {
  isMotionTrackingActive = false;
  if (deviceOrientationControls) {
    deviceOrientationControls.enabled = false;
  }
  showAlert('Giroscopio desactivado.');
}


function placeModelAtScreen(x, y) {
  if (!modelContainer || !camera) return;
  
  // Proyectamos un punto desde el centro de la pantalla al mundo 3D
  const raycaster = new THREE.Raycaster();
  const screenPos = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(screenPos, camera);
  
  const distance = 2.0; // Distancia fija a la que se coloca el modelo
  const position = raycaster.ray.at(distance, new THREE.Vector3());

  modelContainer.position.copy(position);
  // Importante: La rotación del contenedor del modelo debe ser neutra.
  // La cámara es la que se mueve, no el modelo.
  modelContainer.rotation.set(0, 0, 0); 
  
  if (currentModel) currentModel.visible = true;
  placedOnce = true;
  showPlacementDot(false);
  reubicBtn.style.display = 'block';
  resetScaleBtn.style.display = 'block';
  showAlert('Modelo colocado ✅');
  
  document.getElementById('ar-x-slider').value = modelContainer.position.x;
  document.getElementById('ar-y-slider').value = modelContainer.position.y;
  document.getElementById('ar-x-value').textContent = modelContainer.position.x.toFixed(1);
  document.getElementById('ar-y-value').textContent = modelContainer.position.y.toFixed(1);
}

// -------------------------------------------------------------------
// FUNCIONES DE UI Y GESTOS (Mayormente sin cambios, pero revisadas)
// -------------------------------------------------------------------

async function toggleARMode() {
  isARMode = !isARMode;
  const statusSpan = document.getElementById('ar-mode-status');
  const controlsDiv = document.getElementById('placement-controls');
  const toggleBtn = document.getElementById('toggle-ar-mode-btn');

  if (isARMode) {
    // Si es iOS, se muestra overlay para pedir permisos. Si es Android/Desktop, se procede directamente.
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const state = await DeviceOrientationEvent.requestPermission().catch(() => 'denied');
      if (state === 'granted') {
        permissionOverlay.style.display = 'none';
        await onPermissionGranted();
      } else {
        permissionOverlay.style.display = 'flex'; // Mostrar overlay si no hay permisos
        isARMode = false; // Revertir estado si no se conceden
      }
    } else {
      await onPermissionGranted();
    }
  } else {
    stopCameraPassThrough();
    statusSpan.textContent = 'Inactivo';
    controlsDiv.classList.add('hidden');
    toggleBtn.textContent = 'Activar Cámara y AR';
    toggleBtn.classList.remove('bg-green-600');
    toggleBtn.classList.add('bg-red-500');
    controls.enabled = true;
    document.getElementById('lock-status').textContent = 'OFF (Rotar)';
    showPlacementDot(false);
    disableMotionTracking();
    reubicBtn.style.display = 'none';
    resetScaleBtn.style.display = 'none';
  }
}

function resetScale() {
  if (!currentModel) return;
  currentModel.scale.copy(initialScale); // Usar la escala inicial calculada
  showAlert('Escala reiniciada.');
}

async function startCameraPassThrough() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    videoElement.srcObject = stream;
    videoElement.style.display = 'block';
    await videoElement.play();
    renderer.setClearColor(0x000000, 0);
    return true;
  } catch (err) {
    console.error('Camera error', err);
    showAlert('No se pudo activar la cámara. Revisa permisos.');
    return false;
  }
}

function stopCameraPassThrough() {
  if (videoElement.srcObject) {
    videoElement.srcObject.getTracks().forEach(t => t.stop());
    videoElement.srcObject = null;
  }
  videoElement.style.display = 'none';
  renderer.setClearColor(0x3b4233, 1);
}

function showPlacementDot(show) {
  placementDot.style.display = show ? 'flex' : 'none';
  placementHint.style.display = show ? 'block' : 'none';
  if (show) {
    placementDot.style.left = '50%';
    placementDot.style.top = '50%';
  }
}

// --- Resto de las funciones auxiliares (UI, gestos, etc.) sin cambios significativos ---

function showAlert(msg) {
  const box = document.getElementById('custom-alert');
  document.getElementById('alert-message').textContent = msg;
  box.style.opacity = '1';
  box.style.pointerEvents = 'auto';
  clearTimeout(box._t);
  box._t = setTimeout(() => {
    box.style.opacity = '0';
    box.style.pointerEvents = 'none';
  }, 2200);
}

function toggleControlPanel() {
  document.getElementById('control-panel').classList.toggle('is-visible');
}

function toggleModelSelector(show) {
  const modal = document.getElementById('model-selector-modal');
  modal.style.opacity = show ? '1' : '0';
  modal.style.pointerEvents = show ? 'auto' : 'none';
}

function selectModel(name) {
  toggleModelSelector(false);
  loadModelByName(name);
}

function toggleInteractionMode() {
    showAlert("Esta función está desactivada en modo AR para una mejor estabilidad.");
}

function startRelocate() {
  if (!isARMode) {
    showAlert('Activa Modo AR para reubicar.');
    return;
  }
  showPlacementDot(true);
  if (currentModel) currentModel.visible = false;
  showAlert('Mueve el punto y doble tap para confirmar la nueva posición.');
}

function adjustScale(delta) {
  if (!currentModel) return;
  const newScale = Math.max(0.1, currentModel.scale.x + delta);
  currentModel.scale.setScalar(newScale);
}

(function setupPlacementDotEvents() {
  let lastTap = 0;
  placementDot.addEventListener('pointerup', (e) => {
    const now = Date.now();
    if (now - lastTap < 300) { // Doble tap
      placeModelAtScreen(e.clientX, e.clientY);
    }
    lastTap = now;
  });
}());

function onTouchStart(e) {
  if (e.touches && e.touches.length === 2) {
    pinchState.active = true;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinchState.lastDist = Math.hypot(dx, dy);
  }
}

function onTouchMove(e) {
  if (pinchState.active && e.touches && e.touches.length === 2 && currentModel) {
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const newDist = Math.hypot(dx, dy);
    if (pinchState.lastDist > 0) {
      const factor = newDist / pinchState.lastDist;
      const newScale = Math.max(0.05, Math.min(10, currentModel.scale.x * factor));
      currentModel.scale.setScalar(newScale);
    }
    pinchState.lastDist = newDist;
  }
}

function onTouchEnd(e) {
  if (!e.touches || e.touches.length < 2) pinchState.active = false;
}

// Inicialización
window.onload = function() {
  initThree();
  loadModelByName('Duck');
  animate();
};

// Exponer funciones al scope global para los `onclick` del HTML
window.toggleControlPanel = toggleControlPanel;
window.toggleARMode = toggleARMode;
window.toggleInteractionMode = toggleInteractionMode;
window.adjustScale = adjustScale;
window.selectModel = selectModel;
window.toggleModelSelector = toggleModelSelector;
window.startRelocate = startRelocate;
window.resetScale = resetScale;
// Las funciones de sliders y de motion tracking ya no necesitan estar en global
// ya que son controladas por la lógica interna.

</script>
