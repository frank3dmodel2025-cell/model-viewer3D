// --- INICIO: Código JS AR simulado mejorado ---
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

// Pinch/rotation multitouch state
let pinchState = { active:false, lastDist:0, lastAngle:0 };

// Offsets para rotación manual
let yawOffset=0, pitchOffset=0, rollOffset=0;

// Anchor world
let anchorWorldPosition = new THREE.Vector3();
let anchorWorldQuat = new THREE.Quaternion();

// Permission overlay
const permissionOverlay = document.getElementById('request-permission-overlay');
const permissionButton = document.getElementById('request-permission-btn');

permissionButton.addEventListener('click', async () => {
  if(typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'){
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if(res==='granted'){
        permissionOverlay.style.display='none';
        enableMotionTracking();
      } else alert('Permiso denegado para sensores.');
    } catch(e){ alert('Error solicitando permisos.'); }
  } else { permissionOverlay.style.display='none'; enableMotionTracking(); }
});

// ----------------- Inicialización Three.js -----------------
function initThree(){
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.01, 1000);
  camera.position.set(0,1.6,0); // altura humana típica
  camera.updateProjectionMatrix();

  renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x3b4233,1);
  document.getElementById('three-container').appendChild(renderer.domElement);

  // ----------------- Luces -----------------
  const ambient = new THREE.AmbientLight(0xffffff,1.2);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff,0.8);
  dirLight.position.set(5,10,7);
  scene.add(dirLight);

  const hemiLight = new THREE.HemisphereLight(0xffffff,0x444444,0.6);
  hemiLight.position.set(0,20,0);
  scene.add(hemiLight);

  // ----------------- Controls (modo no AR) -----------------
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0,0,-2);
  controls.update();

  // ----------------- Contenedor modelo -----------------
  modelContainer = new THREE.Group();
  scene.add(modelContainer);

  gltfLoader = new THREE.GLTFLoader();

  // ----------------- DeviceOrientation -----------------
  deviceOrientationObject = new THREE.Object3D();
  deviceOrientationControls = new THREE.DeviceOrientationControls(deviceOrientationObject);
  deviceOrientationControls.enabled = false;

  window.addEventListener('resize', onWindowResize);

  // Touch handlers
  renderer.domElement.addEventListener('touchstart', onTouchStart,{passive:false});
  renderer.domElement.addEventListener('touchmove', onTouchMove,{passive:false});
  renderer.domElement.addEventListener('touchend', onTouchEnd,{passive:false});
}

// ----------------- Carga y normalización de modelos -----------------
function loadModelByName(name){
  document.getElementById('current-model').textContent = name;
  if(currentModel){ modelContainer.remove(currentModel); disposeModel(currentModel); currentModel=null; }
  showAlert(`Cargando ${name}...`);
  gltfLoader.load(MODELS[name], gltf=>{
    currentModel = gltf.scene;
    const box = new THREE.Box3().setFromObject(currentModel);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    currentModel.position.sub(center);
    const scaleFactor = 1.5 / Math.max(size.x,size.y,size.z);
    currentModel.scale.setScalar(scaleFactor);
    modelContainer.add(currentModel);
    addContactShadow(currentModel, size.y);
    currentModel.visible = placedOnce ? true : false;
    showAlert(`${name} cargado.`);
  }, undefined, err=>{
    console.error(err); showAlert('Error cargando modelo.');
  });
}
function disposeModel(obj){
  obj.traverse(o=>{
    if(o.isMesh){
      if(o.geometry) o.geometry.dispose();
      if(o.material){
        if(Array.isArray(o.material)) o.material.forEach(m=>m.dispose());
        else m.dispose();
      }
    }
  });
}
function addContactShadow(model, modelHeight){
  const c = document.createElement('canvas'); c.width=c.height=256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128,128,10,128,128,128);
  g.addColorStop(0,'rgba(0,0,0,0.6)'); g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,256,256);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false}));
  sprite.name='contactShadow';
  sprite.position.set(0,-(modelHeight/2 ||0.5),0);
  sprite.scale.set(1.6,1.6,1);
  model.add(sprite);
}

// ----------------- Resizing -----------------
function onWindowResize(){
  camera.aspect = window.innerWidth/window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ----------------- Animación -----------------
let lastCameraQuat = new THREE.Quaternion();
let smoothedCameraQuat = new THREE.Quaternion();
function animate(){
  requestAnimationFrame(animate);
  if(controls && controls.enabled) controls.update();

  // Actualización giroscopio
  if(isMotionTrackingActive && deviceOrientationControls.enabled){
    deviceOrientationControls.update();
    const offsetEuler = new THREE.Euler(pitchOffset, yawOffset, rollOffset,'YXZ');
    const offsetQuat = new THREE.Quaternion().setFromEuler(offsetEuler);
    const targetQuat = deviceOrientationObject.quaternion.clone().multiply(offsetQuat);
    const angle = smoothedCameraQuat.angleTo(targetQuat);
    let alpha=0.18; if(angle>0.5) alpha=0.45; else if(angle>0.15) alpha=0.28;
    smoothedCameraQuat.slerp(targetQuat, alpha);
    camera.quaternion.copy(smoothedCameraQuat);
    lastCameraQuat.copy(smoothedCameraQuat);
  }

  // Suavizado de modelo anclado
  if(placedOnce && modelContainer){
    modelContainer.position.lerp(anchorWorldPosition,0.15);
    modelContainer.quaternion.slerp(anchorWorldQuat,0.15);
  }

  renderer.render(scene,camera);
}

// ----------------- Alertas -----------------
function showAlert(msg){
  const box = document.getElementById('custom-alert');
  document.getElementById('alert-message').textContent=msg;
  box.classList.remove('opacity-0','pointer-events-none');
  box.classList.add('opacity-100','pointer-events-auto');
  clearTimeout(box._t);
  box._t=setTimeout(()=>{ box.classList.remove('opacity-100','pointer-events-auto'); box.classList.add('opacity-0','pointer-events-none'); },2200);
}

// ----------------- Funciones de UI -----------------
function toggleModelSelector(show){ const modal = document.getElementById('model-selector-modal'); if(show){ modal.classList.remove('pointer-events-none','opacity-0'); modal.classList.add('opacity-100'); } else { modal.classList.remove('opacity-100'); modal.classList.add('pointer-events-none','opacity-0'); } }
function selectModel(name){ toggleModelSelector(false); loadModelByName(name); }
function toggleControlPanel(){ const panel = document.getElementById('control-panel'); const menuIcon = document.getElementById('menu-icon'); const closeIcon = document.getElementById('close-icon'); const visible = panel.classList.toggle('is-visible'); if(visible){ menuIcon.classList.add('hidden'); closeIcon.classList.remove('hidden'); } else { menuIcon.classList.remove('hidden'); closeIcon.classList.add('hidden'); } }

// ----------------- Gestos multitouch -----------------
function onTouchStart(e){
  if(e.touches && e.touches.length===2){
    pinchState.active=true;
    const dx=e.touches[0].clientX-e.touches[1].clientX;
    const dy=e.touches[0].clientY-e.touches[1].clientY;
    pinchState.lastDist = Math.hypot(dx,dy);
    pinchState.lastAngle = Math.atan2(dy,dx);
  }
}
function onTouchMove(e){
  if(pinchState.active && e.touches && e.touches.length===2 && currentModel){
    e.preventDefault();
    const dx=e.touches[0].clientX-e.touches[1].clientX;
    const dy=e.touches[0].clientY-e.touches[1].clientY;
    const newDist = Math.hypot(dx,dy);
    const newAngle = Math.atan2(dy,dx);

    // Escala
    const factor = newDist / pinchState.lastDist;
    const newScale = Math.max(0.05,Math.min(10,currentModel.scale.x*factor));
    currentModel.scale.set(newScale,newScale,newScale);
    const shadow = currentModel.getObjectByName('contactShadow');
    if(shadow) shadow.scale.set(newScale*1.6,newScale*1.6,1);

    // Rotación
    const deltaAngle = newAngle - pinchState.lastAngle;
    currentModel.rotation.y += deltaAngle;

    pinchState.lastDist=newDist;
    pinchState.lastAngle=newAngle;
  }
}
function onTouchEnd(e){ if(!e.touches || e.touches.length<2) pinchState.active=false; }

// ----------------- Función para convertir pantalla a mundo -----------------
function screenToWorldAtPlane(x, y, planeY=0){
  const ndcX = (x / window.innerWidth)*2-1;
  const ndcY = -(y / window.innerHeight)*2+1;
  const ray = new THREE.Raycaster();
  ray.setFromCamera({x:ndcX,y:ndcY}, camera);
  const t = (planeY - camera.position.y)/ray.ray.direction.y;
  return camera.position.clone().add(ray.ray.direction.clone().multiplyScalar(t));
}

// ----------------- Colocación inicial del modelo -----------------
function placeModelAtScreen(x,y){
  if(!currentModel) return;
  anchorWorldPosition.copy(screenToWorldAtPlane(x,y,0));
  anchorWorldQuat.copy(new THREE.Quaternion());
  placedOnce=true;
  currentModel.visible=true;
}

// ----------------- Botones -----------------
reubicBtn.addEventListener('click',()=>{
  if(currentModel){ placedOnce=false; }
});
resetScaleBtn.addEventListener('click',()=>{
  if(currentModel){ currentModel.scale.set(1,1,1); const shadow = currentModel.getObjectByName('contactShadow'); if(shadow) shadow.scale.set(1.6,1.6,1); }
});

// ----------------- Activación DeviceOrientation -----------------
function enableMotionTracking(){
  deviceOrientationControls.enabled=true;
  isMotionTrackingActive=true;
  animate();
}

// ----------------- Click rápido para colocar modelo -----------------
renderer.domElement.addEventListener('click', e=>{
  const now = Date.now();
  if(now-lastTapTime<300){ placeModelAtScreen(e.clientX,e.clientY); }
  lastTapTime = now;
});

initThree();
// --- FIN: Código JS AR simulado mejorado ---
