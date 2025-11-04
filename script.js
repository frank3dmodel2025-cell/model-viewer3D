// --- VARIABLES GLOBALES ---
let scene, camera, renderer, controls, gltfLoader;
let modelContainer = null, currentModel = null;
let deviceOrientationControls;
let isARMode = false, isMotionTrackingActive = false;

const videoElement = document.getElementById('video-feed');
const threeContainer = document.getElementById('three-container');

const MODELS = {
    Duck: 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0/Duck/glTF/Duck.gltf',
    Helmet: 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0/DamagedHelmet/glTF/DamagedHelmet.gltf',
    BoomBox: 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0/BoomBox/glTF/BoomBox.gltf'
};

const placementDot = document.getElementById('placement-dot');
const placementHint = document.getElementById('placement-hint');
const reubicBtn = document.getElementById('reubic-btn');
const resetScaleBtn = document.getElementById('reset-scale-btn');
const alertContainer = document.getElementById('alert-container');

let worldAnchor = new THREE.Object3D(); // NUEVO: ancla fija
let placedOnce = false;
let lastTapTime = 0;

// --- INICIALIZACIÓN ---
function initThree() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x3b4233, 1);
    threeContainer.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    dir.position.set(5, 5, 5);
    scene.add(dir);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 0, -2);
    controls.update();

    gltfLoader = new THREE.GLTFLoader();

    modelContainer = new THREE.Group();
    worldAnchor.add(modelContainer);
    scene.add(worldAnchor);

    deviceOrientationControls = new THREE.DeviceOrientationControls(camera);
    deviceOrientationControls.enabled = false;

    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
    renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: false });

    window.addEventListener('resize', onWindowResize);
}

// --- FUNCIONES DE MODELOS ---
function loadModelByName(name) {
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
        modelContainer.add(currentModel);
        addContactShadow(currentModel, size.y);
        showAlert(`${name} cargado.`);
        if (placedOnce) currentModel.visible = true;
        else currentModel.visible = false;
    }, undefined, (err) => {
        console.error('Error cargando GLTF', err);
        showAlert('Error cargando modelo.');
    });
}

function disposeModel(model) {
    model.traverse((child) => {
        if (child.isMesh) {
            child.geometry.dispose();
            if (child.material.isMaterial) cleanMaterial(child.material);
        }
    });
}

function cleanMaterial(material) {
    Object.keys(material).forEach((prop) => {
        const value = material[prop];
        if (value && typeof value === 'object' && 'minFilter' in value) value.dispose();
    });
    material.dispose();
}

// --- COLOCACIÓN AR ---
function screenToWorldAR(x, y, distance = 2.0) {
    const ndcX = (x / window.innerWidth) * 2 - 1;
    const ndcY = -(y / window.innerHeight) * 2 + 1;
    const vec = new THREE.Vector3(ndcX, ndcY, 0.5).unproject(camera);
    const dir = vec.sub(camera.position).normalize();
    const worldPos = camera.position.clone().add(dir.multiplyScalar(distance));
    return worldPos;
}

function placeModelAtScreen(x, y) {
    if (!modelContainer) return;
    const pos = screenToWorldAR(x, y, 2.0);
    worldAnchor.position.copy(pos);
    worldAnchor.rotation.set(0, 0, 0);
    if (currentModel) currentModel.visible = true;
    placedOnce = true;
    showPlacementDot(false);
    reubicBtn.style.display = 'block';
    resetScaleBtn.style.display = 'block';
    showAlert('Modelo colocado ✅');
    updateSlidersFromAnchor();
}

// --- SLIDERS Y AJUSTES ---
function updateSlidersFromAnchor() {
    document.getElementById('ar-x-slider').value = worldAnchor.position.x;
    document.getElementById('ar-y-slider').value = worldAnchor.position.y;
    document.getElementById('ar-z-slider').value = worldAnchor.rotation.z * 180 / Math.PI;
    document.getElementById('ar-x-value').textContent = worldAnchor.position.x.toFixed(1);
    document.getElementById('ar-y-value').textContent = worldAnchor.position.y.toFixed(1);
    document.getElementById('ar-z-value').textContent = worldAnchor.rotation.z.toFixed(1);
}

function updateModelPlacement() {
    if (!worldAnchor) return;
    const x = parseFloat(document.getElementById('ar-x-slider').value);
    const y = parseFloat(document.getElementById('ar-y-slider').value);
    const zRot = parseFloat(document.getElementById('ar-z-slider').value) * Math.PI / 180;
    worldAnchor.position.set(x, y, -2);
    worldAnchor.rotation.z = zRot;
    updateSlidersFromAnchor();
}

// --- ESCALA ---
function resetScale() {
    if (currentModel) {
        currentModel.scale.setScalar(1);
        showAlert('Escala reiniciada');
    }
}

// --- EVENTOS DE PANTALLA ---
function onTouchStart(event) {
    if (event.touches.length === 1) {
        const now = Date.now();
        const delta = now - lastTapTime;
        lastTapTime = now;
        if (delta < 300) {
            const touch = event.touches[0];
            placeModelAtScreen(touch.clientX, touch.clientY);
        }
    }
}

function onTouchMove(event) {
    if (event.touches.length === 2 && currentModel) {
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (!onTouchMove.lastDist) onTouchMove.lastDist = dist;
        const scaleChange = dist / onTouchMove.lastDist;
        currentModel.scale.multiplyScalar(scaleChange);
        onTouchMove.lastDist = dist;
    }
}

function onTouchEnd(event) {
    if (event.touches.length < 2) onTouchMove.lastDist = null;
}

// --- INTERFAZ ---
function showPlacementDot(show) {
    placementDot.style.display = show ? 'block' : 'none';
    placementHint.style.display = show ? 'block' : 'none';
}

function showAlert(msg) {
    const alert = document.createElement('div');
    alert.textContent = msg;
    alert.className = 'alert';
    alertContainer.appendChild(alert);
    setTimeout(() => alert.remove(), 2000);
}

// --- MODO AR ---
function enableMotionTracking() {
    deviceOrientationControls.enabled = true;
    isMotionTrackingActive = true;
    showAlert('Seguimiento activado');
}

function toggleARMode() {
    isARMode = !isARMode;
    if (isARMode) {
        enableMotionTracking();
        startVideoFeed();
    } else {
        stopVideoFeed();
        deviceOrientationControls.enabled = false;
        isMotionTrackingActive = false;
    }
}

// --- VIDEO ---
async function startVideoFeed() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        videoElement.srcObject = stream;
        videoElement.play();
        videoElement.style.display = 'block';
    } catch (err) {
        console.error('No se pudo iniciar la cámara', err);
    }
}

function stopVideoFeed() {
    const stream = videoElement.srcObject;
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
    }
    videoElement.style.display = 'none';
}

// --- LOOP PRINCIPAL ---
function animate() {
    requestAnimationFrame(animate);
    if (controls && controls.enabled) controls.update();
    if (isMotionTrackingActive && deviceOrientationControls && deviceOrientationControls.enabled)
        deviceOrientationControls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- INICIO ---
initThree();
animate();
