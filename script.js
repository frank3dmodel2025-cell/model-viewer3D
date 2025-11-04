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

// Estado para pinch scaling
let pinchState = { active: false, lastDist: 0 };

// Variables añadidas para fijar anclaje
let modelWorldPosition = new THREE.Vector3();
let cameraQuaternionOnPlacement = new THREE.Quaternion();
let smoothingFactor = 0.1; // para suavizado de sensores

// Overlay permisos sensores iOS
const permissionOverlay = document.getElementById('request-permission-overlay');
const permissionButton = document.getElementById('request-permission-btn');

permissionButton.addEventListener('click', async () => {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res === 'granted') {
        permissionOverlay.style.display = 'none';
        enableMotionTracking();
      } else {
        alert('Permiso denegado para sensores.');
      }
    } catch (e) {
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
  camera.updateProjectionMatrix();

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

function disposeModel(obj){
  obj.traverse(o => {
    if(o.isMesh){
      if(o.geometry) o.geometry.dispose();
      if(o.material){
        if(Array.isArray(o.material)){
          o.material.forEach(m => m.dispose());
        } else m.dispose();
      }
    }
  });
}

function addContactShadow(model, modelHeight){
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent:true, depthWrite:false })
  );
  sprite.name = 'contactShadow';
  sprite.position.set(0, -(modelHeight / 2 || 0.5), 0);
  sprite.scale.set(1.6, 1.6, 1);
  model.add(sprite);
}

function onWindowResize(){
  if(!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate(){
  requestAnimationFrame(animate);

  if (controls && controls.enabled){
    controls.update();
  }

  if (isMotionTrackingActive && deviceOrientationControls && deviceOrientationControls.enabled){
    deviceOrientationControls.update();

    // Suavizado de la orientación para evitar saltos bruscos
    camera.quaternion.slerp(deviceOrientationControls.deviceQuaternion || camera.quaternion, smoothingFactor);

    // Nota: asumimos que la cámara rota pero la posición del modelo no debe cambiar ahora.
    // No añadimos offsets de yaw/pitch/roll porque la lógica de fijación se basa en quaternion de la cámara en el momento de la colocación.
  }

  renderer.render(scene, camera);
}

function showAlert(msg){
  const box = document.getElementById('custom-alert');
  document.getElementById('alert-message').textContent = msg;
  box.classList.remove('opacity-0','pointer-events-none');
  box.classList.add('opacity-100','pointer-events-auto');
  clearTimeout(box._t);
  box._t = setTimeout(() => {
    box.classList.remove('opacity-100','pointer-events-auto');
    box.classList.add('opacity-0','pointer-events-none');
  }, 2200);
}

function toggleModelSelector(show){
  const modal = document.getElementById('model-selector-modal');
  if(show){
    modal.classList.remove('pointer-events-none','opacity-0');
    modal.classList.add('opacity-100');
  } else {
    modal.classList.remove('opacity-100');
    modal.classList.add('pointer-events-none','opacity-0');
  }
}
function selectModel(name){
  toggleModelSelector(false);
  loadModelByName(name);
}

function toggleControlPanel(){
  const panel = document.getElementById('control-panel');
  const menuIcon = document.getElementById('menu-icon');
  const closeIcon = document.getElementById('close-icon');
  const visible = panel.classList.toggle('is-visible');
  if(visible){
    menuIcon.classList.add('hidden');
    closeIcon.classList.remove('hidden');
  } else {
    menuIcon.classList.remove('hidden');
    closeIcon.classList.add('hidden');
  }
}

function toggleInteractionMode(){
  if(controls.enabled){
    controls.enabled = false;
    document.getElementById('lock-status').textContent = 'ON (Mover)';
    renderer.domElement.addEventListener('pointerdown', onPointerDownForDrag, false);
    showAlert('Modo Mover activado.');
  } else {
    controls.enabled = true;
    document.getElementById('lock-status').textContent = 'OFF (Rotar)';
    renderer.domElement.removeEventListener('pointerdown', onPointerDownForDrag, false);
    showAlert('Modo Rotar activado.');
  }
}

let dragObject = null;
const pointer = new THREE.Vector2();
const raycaster = new THREE.Raycaster();

function onPointerDownForDrag(event){
  pointer.x = (event.clientX / window.innerWidth)*2 - 1;
  pointer.y = -(event.clientY / window.innerHeight)*2 + 1;
  raycaster.setFromCamera(pointer, camera);
  if(!currentModel) return;
  const intersects = raycaster.intersectObjects(currentModel.children, true);
  if(intersects.length >0){
    dragObject = modelContainer;
    renderer.domElement.addEventListener('pointermove', onPointerMoveForDrag, false);
    renderer.domElement.addEventListener('pointerup', onPointerUpForDrag, false);
    showAlert('Arrastrando modelo...');
  }
}
function onPointerMoveForDrag(event){
  if(!dragObject) return;
  dragObject.position.x += event.movementX * 0.005;
  dragObject.position.y -= event.movementY * 0.005;
  if(!isARMode){
    document.getElementById('ar-x-slider').value = dragObject.position.x;
    document.getElementById('ar-y-slider').value = dragObject.position.y;
    document.getElementById('ar-x-value').textContent = dragObject.position.x.toFixed(1);
    document.getElementById('ar-y-value').textContent = dragObject.position.y.toFixed(1);
  }
}
function onPointerUpForDrag(){
  dragObject = null;
  renderer.domElement.removeEventListener('pointermove', onPointerMoveForDrag, false);
  renderer.domElement.removeEventListener('pointerup', onPointerUpForDrag, false);
}

function updateModelPlacement(){
  if(!modelContainer) return;
  const x = parseFloat(document.getElementById('ar-x-slider').value);
  const y = parseFloat(document.getElementById('ar-y-slider').value);
  const zRot = parseFloat(document.getElementById('ar-z-slider').value) * Math.PI/180;
  modelContainer.position.set(x, y, -2);
  modelContainer.rotation.z = zRot;
  document.getElementById('ar-x-value').textContent = x.toFixed(1);
  document.getElementById('ar-y-value').textContent = y.toFixed(1);
  document.getElementById('ar-z-value').textContent = (zRot * 180/Math.PI).toFixed(0);
}

function adjustScale(delta){
  if(!currentModel) return;
  currentModel.scale.x = Math.max(0.1, currentModel.scale.x + delta);
  currentModel.scale.y = Math.max(0.1, currentModel.scale.y + delta);
  currentModel.scale.z = Math.max(0.1, currentModel.scale.z + delta);
  const shadow = currentModel.getObjectByName('contactShadow');
  if(shadow) shadow.scale.set(currentModel.scale.x*2, currentModel.scale.x*2,1);
}

// Colocar modelo en pantalla doble tap placement dot
(function setupPlacementDotEvents(){
  let dragging = false;
  let startTouchOffset={x:0,y:0};

  placementDot.addEventListener('pointerdown', (e)=>{
    e.preventDefault();
    dragging=true;
    placementDot.setPointerCapture(e.pointerId);
    startTouchOffset.x = e.clientX - placementDot.getBoundingClientRect().left;
    startTouchOffset.y = e.clientY - placementDot.getBoundingClientRect().top;
  });
  placementDot.addEventListener('pointermove', (e)=>{
    if(!dragging) return;
    e.preventDefault();
    const nx = e.clientX - startTouchOffset.x + placementDot.offsetWidth/2;
    const ny = e.clientY - startTouchOffset.y + placementDot.offsetHeight/2;
    placementDot.style.left = `${Math.max(8, Math.min(window.innerWidth-8,nx))}px`;
    placementDot.style.top = `${Math.max(8, Math.min(window.innerHeight-8,ny))}px`;
  });
  placementDot.addEventListener('pointerup', (e)=>{
    dragging=false;
    try { placementDot.releasePointerCapture(e.pointerId); } catch(e) {}
    handleDotTap(e.clientX, e.clientY);
  });

  placementDot.addEventListener('touchstart', (e)=>{
    e.preventDefault();
    if(e.touches.length === 1){
      const t = e.touches[0];
      dragging = true;
      startTouchOffset.x = t.clientX - placementDot.getBoundingClientRect().left;
      startTouchOffset.y = t.clientY - placementDot.getBoundingClientRect().top;
    }
  }, {passive:false});
  placementDot.addEventListener('touchmove', (e)=>{
    if(!dragging) return;
    e.preventDefault();
    const t = e.touches[0];
    const nx = t.clientX - startTouchOffset.x + placementDot.offsetWidth/2;
    const ny = t.clientY - startTouchOffset.y + placementDot.offsetHeight/2;
    placementDot.style.left = `${Math.max(8, Math.min(window.innerWidth-8,nx))}px`;
    placementDot.style.top = `${Math.max(8, Math.min(window.innerHeight-8,ny))}px`;
  }, {passive:false});
  placementDot.addEventListener('touchend', (e)=>{
    dragging=false;
    const t = (e.changedTouches && e.changedTouches[0]) || {};
    const x = t.clientX || (placementDot.getBoundingClientRect().left + placementDot.offsetWidth/2);
    const y = t.clientY || (placementDot.getBoundingClientRect().top + placementDot.offsetHeight/2);
    handleDotTap(x, y);
  }, {passive:false});

  function handleDotTap(clientX, clientY){
    const now = Date.now();
    const dt = now - lastTapTime;
    lastTapTime = now;
    if(dt < 300){
      placeModelAtScreen(clientX, clientY);
    } else {
      placementDot.style.transform = 'translate(-50%,-50%) scale(0.98)';
      setTimeout(()=> placementDot.style.transform = 'translate(-50%,-50%) scale(1)', 120);
    }
  }
})();

function screenToWorld(x, y, distance=2.0){
  const ndcX = (x / window.innerWidth)*2 - 1;
  const ndcY = -(y / window.innerHeight)*2 + 1;
  const ndcZ = 0.5;
  const vec = new THREE.Vector3(ndcX, ndcY, ndcZ).unproject(camera);
  const dir = vec.sub(camera.position).normalize();
  return camera.position.clone().add(dir.multiplyScalar(distance));
}

function placeModelAtScreen(x, y){
  if(!modelContainer) return;
  const pos = screenToWorld(x, y, 2.0);
  modelContainer.position.copy(pos);
  modelContainer.rotation.set(0, 0, 0);
  if(currentModel) currentModel.visible = true;
  placedOnce = true;
  showPlacementDot(false);
  reubicBtn.style.display = 'block';
  resetScaleBtn.style.display = 'block';
  showAlert('Modelo colocado ✅');

  // Guardar anclaje de posición y orientación de la cámara
  modelWorldPosition.copy(pos);
  cameraQuaternionOnPlacement.copy(camera.quaternion);

  document.getElementById('ar‑x‑slider').value = modelContainer.position.x;
  document.getElementById('ar‑y‑slider').value = modelContainer.position.y;
  document.getElementById('ar‑x‑value').textContent = modelContainer.position.x.toFixed(1);
  document.getElementById('ar‑y‑value').textContent = modelContainer.position.y.toFixed(1);
}

function showPlacementDot(show){
  placementDot.style.display = show ? 'flex' : 'none';
  placementHint.style.display = show ? 'block' : 'none';
  if(show) placementDot.setAttribute('aria‑hidden', 'false');
  else placementDot.setAttribute('aria‑hidden', 'true');
}

function onTouchStart(e){
  if(e.touches && e.touches.length === 2){
    pinchState.active = true;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinchState.lastDist = Math.hypot(dx, dy);
  }
}
function onTouchMove(e){
  if(pinchState.active && e.touches && e.touches.length === 2 && currentModel){
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const newDist = Math.hypot(dx, dy);
    if(pinchState.lastDist > 0){
      const factor = newDist / pinchState.lastDist;
      const newScale = Math.max(0.05, Math.min(10, currentModel.scale.x * factor));
      currentModel.scale.set(newScale,newScale,newScale);
      const shadow = currentModel.getObjectByName('contactShadow');
      if(shadow) shadow.scale.set(newScale*2,newScale*2,1);
    }
    pinchState.lastDist = newDist;
  }
}
function onTouchEnd(e){
  if(!e.touches || e.touches.length < 2) pinchState.active = false;
}

async function startCameraPassThrough(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    videoElement.srcObject = stream;
    videoElement.style.display = 'block';
    videoElement.play();
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.zIndex = 10;
    return true;
  }catch(err){
    console.error('Camera error', err);
    showAlert('No se pudo activar la cámara. Revisa permisos.');
    return false;
  }
}
function stopCameraPassThrough(){
  if(videoElement.srcObject){
    videoElement.srcObject.getTracks().forEach(t => t.stop());
  }
  videoElement.srcObject = null;
  videoElement.style.display = 'none';
  renderer.setClearColor(0x3b4233, 1);
  renderer.domElement.style.zIndex = 10;
}

async function toggleARMode(){
  isARMode = !isARMode;
  const statusSpan = document.getElementById('ar‑mode‑status');
  const controlsDiv = document.getElementById('placement‑controls');
  const toggleBtn = document.getElementById('toggle‑ar‑mode‑btn');

  if (isARMode) {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      permissionOverlay.style.display = 'flex';
    } else {
      const ok = await startCameraPassThrough();
      if(!ok){ isARMode = false; return; }
      statusSpan.textContent = 'Activo';
      controlsDiv.classList.remove('hidden');
      toggleBtn.textContent = 'Desactivar Cámara y AR';
      toggleBtn.classList.remove('bg‑red‑500'); toggleBtn.classList.add('bg‑green‑600');
      controls.enabled = false;
      document.getElementById('lock‑status').textContent = 'ON (Mover)';
      if (!placedOnce){
        showPlacementDot(true);
        placementDot.style.left = '50%'; placementDot.style.top = '50%';
        placementDot.style.display = 'flex';
        placementHint.style.display = 'block';
      } else {
        showPlacementDot(false);
        placementHint.style.display = 'none';
        reubicBtn.style.display = 'block';
        resetScaleBtn.style.display = 'block';
      }
      toggleMotionTracking(true);
    }
  } else {
    stopCameraPassThrough();
    statusSpan.textContent = 'Inactivo';
    controlsDiv.classList.add('hidden');
    toggleBtn.textContent = 'Activar Cámara y AR';
    toggleBtn.classList.remove('bg‑green‑600'); toggleBtn.classList.add('bg‑red‑500');
    controls.enabled = true;
    document.getElementById('lock‑status').textContent = 'OFF (Rotar)';
    showPlacementDot(false);
    placementHint.style.display = 'none';
    toggleMotionTracking(false);
  }
}

function enableMotionTracking(){
  if(!isARMode){
    showAlert('Activa Modo AR primero.');
    return;
  }
  isMotionTrackingActive = true;
  deviceOrientationControls.enabled = true;
  deviceOrientationControls.connect();
  showAlert('Giroscopio activo.');
}

function disableMotionTracking(){
  isMotionTrackingActive = false;
  deviceOrientationControls.enabled = false;
  try{ deviceOrientationControls.disconnect(); } catch(e){}
  showAlert('Giroscopio desactivado.');
}

function toggleMotionTracking(forceState){
  if(typeof forceState === 'boolean'){
    if(forceState) enableMotionTracking();
    else disableMotionTracking();
  } else {
    if(isMotionTrackingActive) disableMotionTracking();
    else enableMotionTracking();
  }
}

function startRelocate(){
  if(!isARMode){
    showAlert('Activa Modo AR para reubicar.');
    return;
  }
  showPlacementDot(true);
  placementDot.style.left = `${window.innerWidth/2}px`;
  placementDot.style.top = `${window.innerHeight/2}px`;
  if(currentModel) currentModel.visible = true;
  showAlert('Mueve el punto y doble tap para confirmar la nueva posición.');
}

function resetScale(){
  if(!currentModel) return;
  currentModel.scale.setScalar(1);
  const shadow = currentModel.getObjectByName('contactShadow');
  if(shadow) shadow.scale.set(2,2,1);
  showAlert('Escala reiniciada.');
}

window.onload = function(){
  initThree();
  loadModelByName('Duck');
  animate();
  document.getElementById('placement‑controls').classList.add('hidden');
  document.getElementById('ar‑mode‑status').textContent = 'Inactivo';
  document.getElementById('lock‑status').textContent = 'OFF (Rotar)';
  document.getElementById('control‑panel').classList.remove('is‑visible');
};

window.toggleControlPanel = toggleControlPanel;
window.toggleARMode = toggleARMode;
window.toggleMotionTracking = toggleMotionTracking;
window.toggleInteractionMode = toggleInteractionMode;
window.adjustScale = adjustScale;
window.updateModelPlacement = updateModelPlacement;
window.selectModel = selectModel;
window.toggleModelSelector = toggleModelSelector;
window.startRelocate = startRelocate;
window.resetScale = resetScale;
