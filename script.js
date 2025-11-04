let scene, camera, renderer, controls, gltfLoader;
let modelContainer = null, currentModel = null;
let deviceOrientationControls;
let isARMode = false, isMotionTrackingActive = false;
// Nuevo grupo para anclar el modelo en el espacio.
// Este grupo contendrá el modelo y recibirá la rotación del giroscopio.
let anchorGroup = new THREE.Group(); 
// Posición donde el modelo fue colocado y anclado.
let fixedPosition = new THREE.Vector3(); 
let modelPlaced = false;

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

// Overlay permisos sensores iOS
const permissionOverlay = document.getElementById('request-permission-overlay');
const permissionButton = document.getElementById('request-permission-btn');

permissionButton.addEventListener('click', async () => {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permissionState = await DeviceOrientationEvent.requestPermission();
        if (permissionState === 'granted') {
            permissionOverlay.style.display = 'none';
            enableMotionTracking(); // Llama a la función si se obtiene el permiso
        } else {
            showAlert('Permiso de sensores denegado.');
        }
    } else {
        // Para Android/otros que no requieren solicitud de permiso explícita
        permissionOverlay.style.display = 'none';
        enableMotionTracking();
    }
});

// Raycaster y plano de referencia para simulación de superficie
const raycaster = new THREE.Raycaster();
// Plano invisible para simular el piso (horizontal)
const plane = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial({ visible: false }));
plane.rotation.x = -Math.PI / 2; // Rotar para que sea horizontal
plane.position.y = 0;

function initThree() {
    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.add(plane); // Añadir el plano de referencia para raycasting

    // 2. Camera Setup
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 1.5, 3); // Posición inicial para modo estándar

    // 3. Renderer Setup
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0); // Fondo transparente para AR
    renderer.shadowMap.enabled = true;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    // 4. Lighting
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemiLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(2, 5, 4);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // 5. Controls (OrbitControls for standard mode)
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.2, 0);
    controls.update();

    // 6. GLTF Loader
    gltfLoader = new THREE.GLTFLoader();

    // 7. Añadir el grupo de anclaje a la escena
    scene.add(anchorGroup);

    window.addEventListener('resize', onWindowResize, false);
    document.addEventListener('touchstart', doubleTapHandler, false);

    // Eventos Touch para escalado por pellizco (pinch-to-scale)
    renderer.domElement.addEventListener('touchstart', onTouchStart, false);
    renderer.domElement.addEventListener('touchmove', onTouchMove, false);
    renderer.domElement.addEventListener('touchend', onTouchEnd, false);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// =========================================================
// Modelo
// =========================================================

function loadModelByName(name) {
    const url = MODELS[name];
    if (!url) return;

    if (currentModel) {
        if (modelContainer) scene.remove(modelContainer);
        // Quitar el modelo del anchorGroup antes de eliminarlo
        if (currentModel.parent === anchorGroup) anchorGroup.remove(currentModel);
        currentModel = null;
    }

    // Mostrar loader (opcional, pero buena práctica)
    showAlert('Cargando modelo: ' + name + '...');

    gltfLoader.load(url, (gltf) => {
        modelContainer = gltf.scene;
        modelContainer.scale.setScalar(1); // Escala inicial
        modelContainer.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;
            }
        });

        // Crear una sombra de contacto simple (para mejorar el AR)
        const shadowPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({
                color: 0x000000,
                transparent: true,
                opacity: 0.5,
            })
        );
        shadowPlane.rotation.x = -Math.PI / 2;
        shadowPlane.position.y = 0.01;
        shadowPlane.receiveShadow = true;
        shadowPlane.name = 'contactShadow';
        shadowPlane.scale.set(2, 2, 1);
        modelContainer.add(shadowPlane);

        currentModel = modelContainer;
        // El modelo se añade inicialmente al anchorGroup
        anchorGroup.add(currentModel);

        // Resetear posición y rotación del modelo dentro del grupo
        currentModel.position.set(0, 0, 0);
        currentModel.rotation.set(0, 0, 0);

        // Por defecto en modo no-AR, colocar cerca del centro
        if (!isARMode) {
            currentModel.position.set(0, 0, 0);
            anchorGroup.position.set(0, 0, 0);
            modelPlaced = true;
        } else {
            // En modo AR, esperar a la colocación
            modelPlaced = false;
        }

        showAlert(name + ' cargado. ' + (isARMode ? '¡Doble tap para colocar!' : 'Listo para explorar.'));
    }, undefined, (error) => {
        console.error('An error happened during model loading:', error);
        showAlert('Error al cargar el modelo.');
    });
}

function selectModel(name) {
    loadModelByName(name);
    toggleModelSelector(false);
}

function adjustScale(amount) {
    if (!currentModel) return;
    const currentScale = currentModel.scale.x;
    const newScale = Math.max(0.1, currentScale + amount);
    currentModel.scale.setScalar(newScale);

    // Ajustar la escala de la sombra de contacto
    const shadow = currentModel.getObjectByName('contactShadow');
    if (shadow) {
        shadow.scale.set(newScale * 2, newScale * 2, 1);
    }
}

function resetScale() {
    if (!currentModel) return;
    currentModel.scale.setScalar(1);
    const shadow = currentModel.getObjectByName('contactShadow');
    if (shadow) shadow.scale.set(2, 2, 1);
    showAlert('Escala reiniciada.');
}

// =========================================================
// AR y Controles
// =========================================================

function toggleARMode(activate) {
    isARMode = activate;

    // Elementos UI
    document.getElementById('ar-mode-status').textContent = isARMode ? 'Activo' : 'Inactivo';
    document.getElementById('placement-controls').classList.toggle('hidden', !isARMode);
    document.getElementById('ar-toggle-btn').classList.toggle('bg-red-600', isARMode);
    document.getElementById('ar-toggle-btn').classList.toggle('bg-indigo-600', !isARMode);
    document.getElementById('ar-toggle-btn').querySelector('span').textContent = isARMode ? 'Desactivar AR' : 'Activar AR';


    if (isARMode) {
        // 1. Mostrar video de la cámara
        videoElement.style.display = 'block';
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
                .then(stream => {
                    videoElement.srcObject = stream;
                    videoElement.play();
                })
                .catch(err => {
                    console.error("Error al acceder a la cámara:", err);
                    showAlert('Error: No se pudo acceder a la cámara. Revisa permisos.');
                    toggleARMode(false); // Volver al modo estándar
                });
        }

        // 2. Deshabilitar OrbitControls
        controls.enabled = false;

        // 3. Inicializar DeviceOrientationControls (sin activarlos aún)
        if (!deviceOrientationControls) {
            // Nota: Inicializamos DeviceOrientationControls para que rote la cámara, pero
            // en el animate, vamos a aplicar esa rotación al anchorGroup.
            deviceOrientationControls = new THREE.DeviceOrientationControls(camera);
        }

        // 4. Si el modelo no ha sido colocado, empezar la reubicación
        if (!modelPlaced) startRelocate();
        // Si ya ha sido colocado, asegurar que el giroscopio esté activo
        else if(currentModel && isMotionTrackingActive) enableMotionTracking();

    } else {
        // Modo Estándar
        videoElement.pause();
        videoElement.srcObject = null;
        videoElement.style.display = 'none';
        
        // Esconder UI de AR
        showPlacementDot(false);
        disableMotionTracking();

        // Restaurar OrbitControls
        controls.enabled = true;
        controls.update();
        
        // Resetear la posición del anchorGroup para que el modelo vuelva al centro de la escena.
        anchorGroup.position.set(0, 0, 0);
        anchorGroup.rotation.set(0, 0, 0);
        // La cámara debe estar en su posición de inicio para el modo estándar.
        camera.position.set(0, 1.5, 3);
        controls.target.set(0, 1.2, 0);
        controls.update();

        // El modelo no necesita ser visible si ya estaba escondido (ej. al inicio)
        if (currentModel) currentModel.visible = true; 
    }
}

function enableMotionTracking() {
    isMotionTrackingActive = true;
    if (deviceOrientationControls) {
        deviceOrientationControls.connect();
        document.getElementById('motion-status').textContent = 'Activado';
        showAlert('Sensores de movimiento activados.');
    } else {
        // Si se activa Motion Tracking sin haber entrado a AR Mode antes
        if (!deviceOrientationControls) {
            deviceOrientationControls = new THREE.DeviceOrientationControls(camera);
            deviceOrientationControls.connect();
        }
        document.getElementById('motion-status').textContent = 'Activado';
        showAlert('Sensores de movimiento activados.');
    }
}

function disableMotionTracking() {
    isMotionTrackingActive = false;
    if (deviceOrientationControls) deviceOrientationControls.disconnect();
    document.getElementById('motion-status').textContent = 'Desactivado';
    showAlert('Sensores de movimiento desactivados.');
}

function toggleMotionTracking() {
    if (typeof DeviceOrientationEvent.requestPermission === 'function' && !isMotionTrackingActive) {
        // Mostrar overlay si es iOS y aún no está activo
        permissionOverlay.style.display = 'flex';
    } else {
        if (isMotionTrackingActive) disableMotionTracking();
        else enableMotionTracking();
    }
}

function toggleInteractionMode() {
    if (isARMode) {
        // En modo AR, si los sensores están activos, NO se pueden rotar el modelo manualmente.
        showAlert('En modo AR, el control manual de rotación se deshabilita al activar los sensores.');
        return;
    }
    // En modo estándar, habilitar/deshabilitar OrbitControls
    controls.enabled = !controls.enabled;
    document.getElementById('lock-status').textContent = controls.enabled ? 'OFF (Rotar)' : 'ON (Fijo)';
}

function showPlacementDot(show) {
    placementDot.style.display = show ? 'flex' : 'none';
    placementHint.style.display = show ? 'block' : 'none';
    reubicBtn.disabled = show; // Deshabilitar reubicación mientras se busca
    resetScaleBtn.disabled = show; // Deshabilitar escalado mientras se busca
}

function startRelocate() {
    if (!isARMode) {
        showAlert('Activa Modo AR para reubicar.');
        return;
    }
    modelPlaced = false; // Permitir que la lógica de updateModelPlacement mueva el modelo
    showPlacementDot(true);
    // Posicionar el punto de colocación en el centro (CSS ya lo hace con transform)
    if (currentModel) currentModel.visible = true;
    showAlert('Mueve el punto y doble tap para confirmar la nueva posición.');
}

// =========================================================
// Colocación del Modelo (Raycasting y Anclaje)
// =========================================================

function updateModelPlacement() {
    if (isARMode && currentModel && !modelPlaced) {
        // 1. Obtener coordenadas de la pantalla (centro)
        const x = 0; // Centro horizontal
        const y = 0; // Centro vertical

        // 2. Proyectar el rayo
        raycaster.setFromCamera({ x, y }, camera);

        // 3. Intersectar con el plano (simulación de superficie)
        const intersects = raycaster.intersectObject(plane);

        if (intersects.length > 0) {
            const intersect = intersects[0];
            const targetPosition = intersect.point;
            
            // Mover el modelo al punto de intersección
            // IMPORTANTE: Mover el currentModel dentro de anchorGroup 
            // para que su posición sea relativa al mundo.
            currentModel.position.copy(targetPosition); 
            // Compensar la posición del anchorGroup, que es fijo en 0,0,0
            anchorGroup.position.copy(targetPosition).negate(); 

            // Mostrar el modelo si estaba escondido
            if (!currentModel.visible) currentModel.visible = true;

            // Actualizar el placementDot para que siga la intersección si es necesario
            // En este caso, el dot está fijo en el centro de la pantalla, así que no se mueve.
        } else {
            // Si no hay intersección, esconder el modelo (ej: apuntando al cielo)
            currentModel.visible = false;
        }
    }
}

function doubleTapHandler(event) {
    const now = Date.now();
    const isDoubleTap = now - lastTapTime < 300; // 300ms de umbral

    if (isDoubleTap) {
        if (isARMode && currentModel && !modelPlaced) {
            // Confirmación de colocación
            const x = 0; // Centro horizontal
            const y = 0; // Centro vertical
            raycaster.setFromCamera({ x, y }, camera);
            const intersects = raycaster.intersectObject(plane);

            if (intersects.length > 0) {
                const intersect = intersects[0];
                fixedPosition.copy(intersect.point);
                
                // 1. Fijar la posición del modelo en el mundo.
                // El modelo debe estar en fixedPosition. 
                // Dado que currentModel está en anchorGroup, y anchorGroup está compensando
                // el movimiento de la cámara, el modelo ya está en la posición correcta 
                // gracias a la llamada en updateModelPlacement().
                
                // 2. Anclar el anchorGroup:
                // La rotación de la cámara (giroscopio) debe aplicarse INVERSAMENTE al anchorGroup
                // para que el modelo parezca anclado.

                // Obtener la rotación actual de la cámara
                const cameraRotation = camera.rotation.clone();
                
                // Aplicar la rotación del giroscopio (DeviceOrientationControls) al anchorGroup.
                // Esto es lo que crea el efecto de anclaje.
                // El modelo ya está posicionado correctamente por updateModelPlacement,
                // ahora necesitamos que el 'mundo' rote alrededor del modelo.

                // La posición final del modelo debe ser fixedPosition.
                currentModel.position.copy(fixedPosition);

                // El anchorGroup no necesita compensar la rotación aquí, 
                // solo necesitamos que el raycaster no lo mueva más.

                modelPlaced = true;
                showPlacementDot(false);
                showAlert('Modelo anclado con éxito. ¡Mueve tu teléfono!');
            } else {
                showAlert('No se detecta superficie. Intenta de nuevo.');
            }
        }
    }
    lastTapTime = now;
}


// Pinch-to-scale handlers
function getDistance(touches) {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
}

function onTouchStart(event) {
    if (event.touches.length === 2 && currentModel) {
        pinchState.active = true;
        pinchState.lastDist = getDistance(event.touches);
    }
}

function onTouchMove(event) {
    if (pinchState.active && event.touches.length === 2) {
        const currentDist = getDistance(event.touches);
        const delta = currentDist - pinchState.lastDist;

        // Ajustar el factor de escalado basado en el delta
        const scaleFactor = delta * 0.005; 
        
        adjustScale(scaleFactor);
        
        pinchState.lastDist = currentDist;
    }
}

function onTouchEnd(event) {
    if (pinchState.active) {
        pinchState.active = false;
    }
}

// =========================================================
// Loop Principal
// =========================================================

function animate() {
    requestAnimationFrame(animate);

    if (isARMode && isMotionTrackingActive && deviceOrientationControls) {
        // 1. Actualizar DeviceOrientationControls (lee los sensores)
        deviceOrientationControls.update();

        // 2. Aplicar la rotación del giroscopio al anchorGroup
        // Al aplicar la rotación de la cámara al anchorGroup (que contiene el modelo),
        // y como la cámara misma NO está rotando (deviceOrientationControls.update()
        // solo calcula la rotación, pero OrbitControls está deshabilitado),
        // se crea el efecto de que el fondo (el video) y el "mundo" rotan,
        // dejando el modelo fijo en su posición 3D.

        // Clonar y aplicar la rotación de la cámara (que es calculada por DeviceOrientationControls)
        // en el eje Y y X (yaw y pitch) al grupo de anclaje.
        // Hacemos que el anchorGroup rote en la dirección opuesta a la cámara para estabilizar el modelo.

        // NOTA IMPORTANTE: Para Three.js AR sin WebXR, se recomienda rotar el grupo de escena.
        // DeviceOrientationControls actualiza la rotación de la cámara. Para estabilizar el modelo,
        // aplicamos la rotación INVERSA al anchorGroup.
        
        // Creamos una matriz de rotación del dispositivo.
        const rotationMatrix = new THREE.Matrix4();
        rotationMatrix.extractRotation(camera.matrix); // La cámara ya tiene la rotación del giroscopio aplicada en update()
        
        // Aplicamos la inversa de esa rotación al anchorGroup.
        anchorGroup.quaternion.setFromRotationMatrix(rotationMatrix).invert();
        
        // Pequeña corrección de posición para simular una colocación más estable, 
        // ya que el anchorGroup se está moviendo con la rotación del mundo simulado.
        
    } else if (!isARMode && controls.enabled) {
        controls.update();
    }
    
    // Si estamos en modo AR y el modelo no ha sido fijado, actualizar su posición
    if (isARMode && !modelPlaced) {
        updateModelPlacement();
    }

    renderer.render(scene, camera);
}

// =========================================================
// Utilidades UI
// =========================================================

function showAlert(message) {
    const alertDiv = document.getElementById('app-alert');
    alertDiv.textContent = message;
    alertDiv.classList.remove('opacity-0', 'pointer-events-none');
    alertDiv.classList.add('opacity-100');

    setTimeout(() => {
        alertDiv.classList.remove('opacity-100');
        alertDiv.classList.add('opacity-0', 'pointer-events-none');
    }, 3000);
}

function toggleModelSelector(show) {
    const modal = document.getElementById('model-selector-modal');
    modal.classList.toggle('opacity-0', !show);
    modal.classList.toggle('pointer-events-none', !show);
}

function toggleControlPanel(show) {
    const panel = document.getElementById('control-panel');
    const menuIcon = document.getElementById('menu-icon');
    
    if (show !== undefined) {
        panel.classList.toggle('is-visible', show);
        menuIcon.style.display = show ? 'none' : 'block';
    } else {
        const isVisible = panel.classList.toggle('is-visible');
        menuIcon.style.display = isVisible ? 'none' : 'block';
    }
}


window.onload = function() {
    initThree();
    loadModelByName('Duck');
    animate();
    document.getElementById('placement-controls').classList.add('hidden');
    document.getElementById('ar-mode-status').textContent = 'Inactivo';
    document.getElementById('lock-status').textContent = 'OFF (Rotar)';
    document.getElementById('control-panel').classList.remove('is-visible');

    // Cargar la vista por defecto de la cámara delantera para el modo AR
    // Se llama de nuevo en toggleARMode, pero lo hacemos aquí para pre-cargar la lógica
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
            .then(stream => {
                videoElement.srcObject = stream;
            })
            .catch(err => {
                console.warn("No se pudo pre-cargar la cámara, se intentará al activar AR.", err);
            });
    }
};

window.toggleControlPanel = toggleControlPanel;
window.toggleARMode = toggleARMode;
window.toggleMotionTracking = toggleMotionTracking;
window.toggleInteractionMode = toggleInteractionMode;
window.adjustScale = adjustScale;
// Ya no necesitamos updateModelPlacement fuera, se llama en el loop
window.selectModel = selectModel;
window.toggleModelSelector = toggleModelSelector;
window.startRelocate = startRelocate;
window.resetScale = resetScale;
