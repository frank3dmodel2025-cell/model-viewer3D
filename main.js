let scene, camera, renderer, controls;
let currentModel;
const loader = new THREE.GLTFLoader();

init();
animate();

function init() {
  // Escena
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x121212);

  // Cámara
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 1.5, 3);

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('sceneCanvas'), antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);

  // Controles
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  // Luz
  const ambientLight = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(5,5,5);
  scene.add(directionalLight);

  // Cargar modelo inicial
  loadModel(document.querySelector('.carousel-items img.active').dataset.model);

  // Carrusel
  const carouselImages = document.querySelectorAll('.carousel-items img');
  carouselImages.forEach(img => {
    img.addEventListener('click', () => {
      document.querySelector('.carousel-items img.active').classList.remove('active');
      img.classList.add('active');
      loadModel(img.dataset.model);
    });
  });

  // Botones de control
  document.getElementById('zoomIn').addEventListener('click', () => {
    camera.position.multiplyScalar(0.9);
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    camera.position.multiplyScalar(1.1);
  });
  document.getElementById('rotate').addEventListener('click', () => {
    currentModel.rotation.y += Math.PI/4;
  });

  window.addEventListener('resize', onWindowResize, false);
}

function loadModel(path) {
  if(currentModel) scene.remove(currentModel);
  loader.load(path, gltf => {
    currentModel = gltf.scene;
    currentModel.scale.set(1,1,1);
    scene.add(currentModel);
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
